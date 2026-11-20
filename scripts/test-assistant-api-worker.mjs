import assert from "node:assert/strict";
import test from "node:test";
import { handleAssistantApiRequest } from "../cloudflare/assistant-api-worker.js";

const token = "test-token-".padEnd(48, "x");
const writeToken = "write-token-".padEnd(48, "y");
const depositKey = "2cf4795d-145a-42fc-91b7-685c46bdffaa";
const env = {
  ASSISTANT_API_TOKEN: token,
  ASSISTANT_API_WRITE_TOKEN: writeToken,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-publishable-key",
  SUPABASE_ASSISTANT_EMAIL: "assistant@example.test",
  SUPABASE_ASSISTANT_PASSWORD: "test-password",
  PHOTO_BUCKET: { get: async () => null }
};
const originalFetch = globalThis.fetch;

function request(path, { method = "GET", auth = `Bearer ${token}` } = {}) {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: auth ? { authorization: auth } : {}
  });
}

test("rejects requests without a Bearer token", async () => {
  const response = await handleAssistantApiRequest(request("/v1/health", { auth: "" }), env);
  assert.equal(response.status, 401);
});

test("rejects non-GET methods", async () => {
  const response = await handleAssistantApiRequest(request("/v1/catalogs/packages", { method: "POST" }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("the read token cannot write", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Cambio" })
  }), env);
  assert.equal(response.status, 403);
});

test("a PATCH without credentials is unauthorized", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Cambio" })
  }), env);
  assert.equal(response.status, 401);
});

test("the write token cannot read", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const response = await handleAssistantApiRequest(request("/v1/health", { auth: `Bearer ${writeToken}` }), env);
  assert.equal(response.status, 403);
});

test("GET job details are not intercepted by the write route", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) {
      return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    }
    assert.equal(options.method, undefined);
    assert.match(parsed.pathname, /\/rest\/v1\/assistant_jobs$/);
    assert.equal(parsed.searchParams.get("id"), "eq.2cde2ddb-3d5a-49e8-9f09-24e42ba2e818");
    return Response.json([{ id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", title: "Trabajo de prueba" }]);
  };
  const response = await handleAssistantApiRequest(request("/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.id, "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818");
});

test("routine PATCH uses only the allowed columns and assistant session", async () => {
  const calls = [];
  const patch = { principal_phone: "6677998877", next_follow_up_date: "2026-12-01", follow_up_status: "CONTACT_NEXT_YEAR" };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    assert.match(parsed.pathname, /\/rest\/v1\/(school_profiles|assistant_jobs)$/);
    assert.equal(parsed.searchParams.get("id"), "eq.2cde2ddb-3d5a-49e8-9f09-24e42ba2e818");
    if (options.method === "PATCH") {
      assert.match(parsed.pathname, /\/rest\/v1\/school_profiles$/);
      assert.equal(options.headers.prefer, "return=minimal");
      assert.deepEqual(JSON.parse(options.body), patch);
      return new Response(null, { status: 204, headers: { "content-range": "0-0/*" } });
    }
    assert.equal(options.method, undefined);
    assert.match(parsed.pathname, /\/rest\/v1\/school_profiles$/);
    return Response.json([{ id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", ...patch }]);
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/schools/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", {
    method: "PATCH",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify(patch)
  }), env);
  assert.equal(response.status, 200);
  assert.ok(calls.some(({ options }) => options.method === "PATCH"));
  assert.ok(calls.some(({ parsed, options }) => parsed.pathname.endsWith("/school_profiles") && options.method === undefined));
});

test("school creation uses the narrow RPC and rejects packages before database access", async () => {
  const input = { school_name: "Escuela de prueba", contact_phone: "6677001100", school_level: "PRIMARY",
    teacher_name: "Maestra", follow_up_status: "NEW_CONTACT" };
  let rpcCalls = 0;
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    assert.match(parsed.pathname, /\/rest\/v1\/rpc\/assistant_create_school$/);
    rpcCalls++;
    assert.deepEqual(JSON.parse(options.body), { p_input: input });
    return Response.json({ ok: true, data: { id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", school_name: "Escuela de prueba" } });
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/schools", {
    method: "POST",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify(input)
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.school_name, "Escuela de prueba");

  const rejected = await handleAssistantApiRequest(new Request("https://api.example.test/v1/schools", {
    method: "POST",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ school_name: "Escuela", contact_phone: "6677001100", price: 200 })
  }), env);
  assert.equal(rejected.status, 400);

  for (const invalid of [{ follow_up_status: "INVALID_STATUS" }, { school_name: "x".repeat(201) }]) {
    const invalidResponse = await handleAssistantApiRequest(new Request("https://api.example.test/v1/schools", {
      method: "POST",
      headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...input, ...invalid })
    }), env);
    assert.equal(invalidResponse.status, 400);
  }
  assert.equal(rpcCalls, 1);
});

test("job creation sends only the approved fields to the restricted RPC", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    assert.match(parsed.pathname, /\/rest\/v1\/rpc\/assistant_create_job$/);
    assert.deepEqual(JSON.parse(options.body), { p_input: {
      client_id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", title: "Graduacion", notes: "Nuevo trabajo"
    } });
    return Response.json({ ok: true, data: { id: "job-id", title: "Graduacion", status: "CREATED" } });
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs", {
    method: "POST",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ client_id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", title: "Graduacion", notes: "Nuevo trabajo" })
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, "CREATED");
});

test("group creation accepts teacher and student count but never package or price fields", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    assert.match(parsed.pathname, /\/rest\/v1\/rpc\/assistant_create_group$/);
    assert.deepEqual(JSON.parse(options.body), {
      p_job_id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818",
      p_input: { group_name: "1A", teacher_name: "Maestra", student_count: 28 }
    });
    return Response.json({ ok: true, data: { id: "group-id", group_name: "1A", student_count: 28 } });
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818/groups", {
    method: "POST",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ group_name: "1A", teacher_name: "Maestra", student_count: 28 })
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.student_count, 28);
});

test("the read token cannot create records", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/schools", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ school_name: "Escuela", contact_phone: "6677001100" })
  }), env);
  assert.equal(response.status, 403);
});

test("deposit RPC no_data_found becomes 404 without exposing database errors", async () => {
  const path = "/v1/jobs/d47f9795-14d3-4f31-9449-9428fd328857/deposits";
  for (const [code, status, publicCode] of [
    ["P0002", 404, "not_found"],
    ["XX000", 500, "internal_error"]
  ]) {
    let rpcCalls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname.endsWith("/auth/v1/token")) {
        return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
      }
      assert.match(new URL(url).pathname, /\/rest\/v1\/rpc\/assistant_record_deposit_once$/);
      rpcCalls++;
      return Response.json({ code, message: "Internal database details" }, { status: 500 });
    };
    const response = await handleAssistantApiRequest(new Request(`https://api.example.test${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json", "idempotency-key": depositKey },
      body: JSON.stringify({ amount: 1, deposit_date: "2026-11-20" })
    }), env);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, publicCode);
    assert.doesNotMatch(body.error.message, /Internal database details/);
    assert.equal(rpcCalls, 1);
  }
});

test("deposit creation is append-only and calls only its restricted RPC", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    assert.match(parsed.pathname, /\/rest\/v1\/rpc\/assistant_record_deposit_once$/);
    assert.deepEqual(JSON.parse(options.body), {
      p_job_id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818",
      p_input: { amount: 750.5, deposit_date: "2026-11-20", notes: "Transferencia" },
      p_request_key: depositKey
    });
    return Response.json({ ok: true, data: { id: "deposit-id", amount: 750.5 } });
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818/deposits", {
    method: "POST",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json", "idempotency-key": depositKey },
    body: JSON.stringify({ amount: 750.5, deposit_date: "2026-11-20", notes: "Transferencia" })
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.amount, 750.5);

  const forbiddenBody = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818/deposits", {
    method: "POST",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ amount: 750.5, deposit_date: "2026-11-20", delete_existing: true })
  }), env);
  assert.equal(forbiddenBody.status, 400);

  const deletion = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818/deposits", {
    method: "DELETE",
    headers: { authorization: `Bearer ${writeToken}` }
  }), env);
  assert.equal(deletion.status, 405);
});

test("deposit creation requires a UUID request key before accessing Supabase", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected database call"); };
  for (const key of [null, "not-a-uuid"]) {
    const headers = { authorization: `Bearer ${writeToken}`, "content-type": "application/json" };
    if (key) headers["idempotency-key"] = key;
    const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818/deposits", {
      method: "POST", headers, body: JSON.stringify({ amount: 1, deposit_date: "2026-11-20" })
    }), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /Idempotency-Key/);
  }
  assert.equal(calls, 0);
});

test("group routines reject package, price, approval and event-date fields", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const cases = [
    ["/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818/groups", "POST", { group_name: "1A", selected_package_id: "x" }],
    ["/v1/groups/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", "PATCH", { student_count: 30, price: 100 }],
    ["/v1/jobs", "POST", { client_id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", title: "Graduacion", event_date: "2026-12-01" }]
  ];
  for (const [path, method, body] of cases) {
    const response = await handleAssistantApiRequest(new Request(`https://api.example.test${path}`, {
      method,
      headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }), env);
    assert.equal(response.status, 400);
  }
});

test("job updates are verified through the restricted assistant view", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    if (parsed.pathname.endsWith("/rpc/assistant_update_job_routine")) {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), {
        p_job_id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818",
        p_patch: { title: "Trabajo actualizado" }
      });
      return Response.json([{ id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", title: "Trabajo actualizado", notes: null }]);
    }
    assert.match(parsed.pathname, /\/rest\/v1\/assistant_jobs$/);
    return Response.json([{ id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", title: "Trabajo actualizado" }]);
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", {
    method: "PATCH",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Trabajo actualizado" })
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.title, "Trabajo actualizado");
  assert.ok(calls.some(({ parsed, options }) => parsed.pathname.endsWith("/assistant_jobs") && options.method === undefined));
});

test("does not report success when the job routine function updates zero rows", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    assert.match(parsed.pathname, /\/rest\/v1\/rpc\/assistant_update_job_routine$/);
    return Response.json([]);
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", {
    method: "PATCH",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Titulo original" })
  }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("school updates fail closed when PostgREST omits the affected-row count", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    if (options.method === "PATCH") return new Response(null, { status: 204 });
    throw new Error("A read should not follow an unconfirmed update");
  };
  const response = await handleAssistantApiRequest(new Request("https://api.example.test/v1/schools/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", {
    method: "PATCH",
    headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ principal_phone: "6677998877" })
  }), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "update_unconfirmed");
});

test("rejects protected fields and invalid values before contacting Supabase", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const payloads = [
    ["/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", { event_date: "2026-12-01" }],
    ["/v1/jobs/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", { status: "APPROVED_FOR_PRINT" }],
    ["/v1/schools/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", { student_count: 10001 }],
    ["/v1/clients/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", { phone: "x", is_active: false }],
    ["/v1/schools/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818", { next_follow_up_date: "2026-02-31" }]
  ];
  for (const [path, body] of payloads) {
    const response = await handleAssistantApiRequest(new Request(`https://api.example.test${path}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }), env);
    assert.equal(response.status, 400);
  }
});

test("health requires authentication and does not query Supabase", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const response = await handleAssistantApiRequest(request("/v1/health"), env);
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()), JSON.stringify({ ok: true, version: "1.2.0" }));
});

test("validates pagination bounds", async () => {
  const response = await handleAssistantApiRequest(request("/v1/schools?limit=101"), env);
  assert.equal(response.status, 400);
});

test("returns bounded pages and never issues writes", async () => {
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/auth/v1/token")) {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { email: env.SUPABASE_ASSISTANT_EMAIL, password: env.SUPABASE_ASSISTANT_PASSWORD });
      return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    }
    assert.equal(options.method, undefined);
    assert.match(String(url), /\/rest\/v1\/school_profiles/);
    assert.equal(new URL(url).searchParams.get("limit"), "2");
    return Response.json([{ id: "one" }, { id: "two" }]);
  };
  const response = await handleAssistantApiRequest(request("/v1/schools?limit=1"), env);
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()), JSON.stringify({
    data: [{ id: "one" }],
    page: { limit: 1, offset: 0, has_more: true }
  }));
});

test("does not expose routes outside the allowlist", async () => {
  globalThis.fetch = async () => { throw new Error("unexpected database call"); };
  const response = await handleAssistantApiRequest(request("/rest/v1/clients"), env);
  assert.equal(response.status, 404);
});

test("serves only authenticated teacher-preview images", async () => {
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/auth/v1/token")) {
      return Response.json({ access_token: "mock-assistant-jwt", expires_in: 3600 });
    }
    assert.match(parsed.pathname, /\/rest\/v1\/assistant_job_files$/);
    assert.equal(parsed.searchParams.get("file_type"), "eq.TEACHER_PREVIEW");
    return Response.json([{
      id: "2cde2ddb-3d5a-49e8-9f09-24e42ba2e818",
      r2_key: "private/preview.jpg",
      file_name: "preview.jpg",
      content_type: "image/jpeg",
      size_bytes: 4
    }]);
  };
  const imageEnv = {
    ...env,
    PHOTO_BUCKET: { get: async () => ({
      body: new Uint8Array([1, 2, 3, 4]),
      size: 4,
      httpMetadata: { contentType: "image/jpeg" }
    }) }
  };
  const response = await handleAssistantApiRequest(request("/v1/previews/2cde2ddb-3d5a-49e8-9f09-24e42ba2e818"), imageEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("restores the process fetch after tests", () => {
  globalThis.fetch = originalFetch;
  assert.equal(globalThis.fetch, originalFetch);
});
