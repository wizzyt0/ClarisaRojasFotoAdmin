const API_VERSION = "1.2.0";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let cachedAssistantSession = null;
let assistantLoginPromise = null;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

function error(code, message, status, extraHeaders = {}) {
  return json({ error: { code, message } }, status, extraHeaders);
}

function validUuid(value) {
  return UUID_RE.test(value || "");
}

function pageOptions(url) {
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new InputError("limit debe ser un entero entre 1 y 100.");
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new InputError("offset debe ser un entero entre 0 y 100000.");
  return { limit, offset };
}

class InputError extends Error {}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secureTokenMatch(candidate, expected) {
  if (!candidate || !expected || candidate.length !== expected.length) return false;
  const [left, right] = await Promise.all([sha256(candidate), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function readAuthorized(request, env) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
  return secureTokenMatch(match?.[1], env.ASSISTANT_API_TOKEN);
}

async function writeAuthorized(request, env) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
  return secureTokenMatch(match?.[1], env.ASSISTANT_API_WRITE_TOKEN);
}

function supabaseUrl(env, table, params) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base || !env.SUPABASE_ANON_KEY) throw new Error("API backend unavailable");
  const url = new URL(`${base}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function getAssistantAccessToken(env) {
  if (cachedAssistantSession && cachedAssistantSession.expiresAt > Date.now() + 60000) return cachedAssistantSession.accessToken;
  if (assistantLoginPromise) return assistantLoginPromise;
  assistantLoginPromise = (async () => {
    const response = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email: env.SUPABASE_ASSISTANT_EMAIL,
        password: env.SUPABASE_ASSISTANT_PASSWORD
      })
    });
    if (!response.ok) throw new Error("Assistant account authentication failed");
    const session = await response.json();
    if (!session.access_token || !session.expires_in) throw new Error("Assistant account authentication failed");
    cachedAssistantSession = {
      accessToken: session.access_token,
      expiresAt: Date.now() + Number(session.expires_in) * 1000
    };
    return cachedAssistantSession.accessToken;
  })();
  try {
    return await assistantLoginPromise;
  } finally {
    assistantLoginPromise = null;
  }
}

async function supabaseGet(env, table, params, retry = 0) {
  const accessToken = await getAssistantAccessToken(env);
  const response = await fetch(supabaseUrl(env, table, params), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken}`
    }
  });
  if (response.status === 401 && retry === 0) {
    cachedAssistantSession = null;
    return supabaseGet(env, table, params, 1);
  }
  if (!response.ok) throw new Error("Database query failed");
  return { rows: await response.json() };
}

async function supabasePatch(env, table, id, body, select, retry = 0) {
  const accessToken = await getAssistantAccessToken(env);
  const url = supabaseUrl(env, table, { id: `eq.${id}`, select });
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify(body)
  });
  if (response.status === 401 && retry === 0) {
    cachedAssistantSession = null;
    return supabasePatch(env, table, id, body, select, 1);
  }
  if (response.status === 401 || response.status === 403) return { denied: true };
  if (!response.ok) throw new Error("Database update failed");
  const contentRange = response.headers.get("content-range")?.trim();
  if (contentRange === "*/*" || /^\*\/0$/.test(contentRange || "")) return { affectedRows: 0 };
  const rangeMatch = /^(\d+)-(\d+)\/(?:\*|\d+)$/.exec(contentRange || "");
  if (!rangeMatch) return { affectedRows: null };
  const affectedRows = Number(rangeMatch[2]) - Number(rangeMatch[1]) + 1;
  return { affectedRows };
}

async function supabaseUpdateJobRoutine(env, id, patch, retry = 0) {
  const accessToken = await getAssistantAccessToken(env);
  const response = await fetch(supabaseUrl(env, "rpc/assistant_update_job_routine", {}), {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ p_job_id: id, p_patch: patch })
  });
  if (response.status === 401 && retry === 0) {
    cachedAssistantSession = null;
    return supabaseUpdateJobRoutine(env, id, patch, 1);
  }
  if (response.status === 401 || response.status === 403) return { denied: true };
  if (!response.ok) throw new Error("Database update failed");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Database update response invalid");
  return { affectedRows: rows.length };
}

async function supabaseRpc(env, name, params, retry = 0) {
  const accessToken = await getAssistantAccessToken(env);
  const response = await fetch(supabaseUrl(env, `rpc/${name}`, {}), {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(params)
  });
  if (response.status === 401 && retry === 0) {
    cachedAssistantSession = null;
    return supabaseRpc(env, name, params, 1);
  }
  if (response.status === 401 || response.status === 403) return { denied: true };
  if (response.status === 404) return { notFound: true };
  if (response.status === 409) return { conflict: true };
  if (!response.ok) throw new Error("Database operation failed");
  return { data: await response.json() };
}

const WRITE_FIELDS = {
  clients: {
    name: { max: 200, required: true },
    phone: { max: 40, required: true },
    secondary_phone: { max: 40 },
    email: { max: 254 },
    notes: { max: 5000 }
  },
  school_profiles: {
    school_name: { max: 200, required: true },
    contact_name: { max: 200 },
    contact_phone: { max: 40 },
    contact_email: { max: 254 },
    teacher_name: { max: 200 },
    teacher_phone: { max: 40 },
    student_count: { integer: true, min: 0, max: 10000 },
    principal_name: { max: 200 },
    principal_phone: { max: 40 },
    grade_or_class: { max: 120 },
    last_contact_date: { date: true },
    next_follow_up_date: { date: true },
    follow_up_status: { values: ["NEW_CONTACT", "CONTACT_NEXT_YEAR", "INTERESTED", "QUOTE_SENT", "CONFIRMED", "NOT_INTERESTED", "RECURRING_CLIENT"] },
    commercial_notes: { max: 5000 }
  },
  jobs: {
    title: { max: 200, required: true },
    notes: { max: 5000 }
  }
};

const SCHOOL_CREATE_FIELDS = {
  school_name: { max: 200, required: true },
  school_level: { values: ["KINDER", "PRIMARY", "SECONDARY"] },
  contact_name: { max: 200 },
  contact_phone: { max: 40, required: true },
  contact_email: { max: 254 },
  teacher_name: { max: 200 },
  teacher_phone: { max: 40 },
  principal_name: { max: 200 },
  principal_phone: { max: 40 },
  grade_or_class: { max: 120 },
  student_count: { integer: true, min: 0, max: 10000 },
  last_contact_date: { date: true },
  next_follow_up_date: { date: true },
  follow_up_status: { values: ["NEW_CONTACT", "CONTACT_NEXT_YEAR", "INTERESTED", "QUOTE_SENT", "CONFIRMED", "NOT_INTERESTED", "RECURRING_CLIENT"] },
  commercial_notes: { max: 5000 }
};

const GROUP_FIELDS = {
  group_name: { max: 200, required: true },
  teacher_name: { max: 200 },
  teacher_phone: { max: 40 },
  student_count: { integer: true, min: 0, max: 10000 },
  notes: { max: 2000 }
};

const DEPOSIT_FIELDS = {
  amount: { money: true, required: true },
  deposit_date: { date: true, required: true },
  notes: { max: 500 }
};

const JOB_CREATE_FIELDS = {
  client_id: { uuid: true, required: true },
  title: { max: 200, required: true },
  event_type: { max: 60 },
  notes: { max: 5000 }
};

function validatedPatch(table, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("El cuerpo debe ser un objeto JSON.");
  const entries = Object.entries(body);
  if (entries.length === 0) throw new InputError("Indica al menos un campo para actualizar.");
  const allowed = WRITE_FIELDS[table];
  for (const [field, value] of entries) {
    const rule = allowed[field];
    if (!rule) throw new InputError(`El campo ${field} no se puede actualizar.`);
    if (value === null && !rule.required) continue;
    if (rule.integer) {
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw new InputError(`${field} debe ser un entero entre ${rule.min} y ${rule.max}.`);
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0 || (rule.max !== undefined && value.length > rule.max)) {
      if (rule.values || rule.date) throw new InputError(`${field} no tiene un valor valido.`);
      throw new InputError(`${field} debe ser texto no vacio de hasta ${rule.max} caracteres.`);
    }
    if (rule.date) {
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new InputError(`${field} debe usar una fecha valida YYYY-MM-DD.`);
      }
    }
    if (rule.values && !rule.values.includes(value)) throw new InputError(`${field} no tiene un valor permitido.`);
  }
  return body;
}

function validatedObject(body, rules, label) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("El cuerpo debe ser un objeto JSON.");
  const entries = Object.entries(body);
  if (entries.length === 0) throw new InputError("Indica al menos un campo.");
  for (const [field, value] of entries) {
    const rule = rules[field];
    if (!rule) throw new InputError(`El campo ${field} no se puede ${label}.`);
    if (value === null && !rule.required) continue;
    if (rule.uuid) {
      if (typeof value !== "string" || !validUuid(value)) throw new InputError(`${field} debe ser un UUID valido.`);
      continue;
    }
    if (rule.integer) {
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw new InputError(`${field} debe ser un entero entre ${rule.min} y ${rule.max}.`);
      continue;
    }
    if (rule.money) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 9999999999.99
        || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))) {
        throw new InputError("amount debe ser un importe positivo con hasta dos decimales.");
      }
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0 || (rule.max !== undefined && value.length > rule.max)) {
      if (rule.values || rule.date) throw new InputError(`${field} no tiene un valor valido.`);
      throw new InputError(`${field} debe ser texto no vacio de hasta ${rule.max} caracteres.`);
    }
    if (rule.date) {
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new InputError(`${field} debe usar una fecha valida YYYY-MM-DD.`);
      }
    }
    if (rule.values && !rule.values.includes(value)) throw new InputError(`${field} no tiene un valor permitido.`);
  }
  for (const [field, rule] of Object.entries(rules)) {
    if (rule.required && (body[field] === undefined || body[field] === null)) throw new InputError(`${field} es obligatorio.`);
  }
  return body;
}

async function readJsonBody(request, maxBytes = 16384) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Content-Type debe ser application/json.");
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new InputError(`El cuerpo supera el limite de ${maxBytes / 1024} KB.`);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("El cuerpo JSON esta vacio.");
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new InputError(`El cuerpo supera el limite de ${maxBytes / 1024} KB.`);
    }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder().decode(BufferlessConcat(chunks, byteLength))); }
  catch (cause) {
    if (cause instanceof InputError) throw cause;
    throw new InputError("El cuerpo JSON no es valido.");
  }
}

function requireWriteToken(request, env) {
  return writeAuthorized(request, env);
}

async function runWriteRpc(request, env, rpcName, params) {
  if (!env.ASSISTANT_API_WRITE_TOKEN || env.ASSISTANT_API_WRITE_TOKEN.length < 40
    || env.ASSISTANT_API_WRITE_TOKEN === env.ASSISTANT_API_TOKEN) {
    return error("write_not_configured", "La credencial independiente de escritura no esta configurada.", 503);
  }
  if (!await requireWriteToken(request, env)) {
    const readMatch = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
    if (await secureTokenMatch(readMatch?.[1], env.ASSISTANT_API_TOKEN)) return error("forbidden", "Se requiere la credencial de escritura autorizada.", 403);
    return error("unauthorized", "Token faltante o invalido.", 401, { "www-authenticate": "Bearer" });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_ASSISTANT_EMAIL || !env.SUPABASE_ASSISTANT_PASSWORD) {
    return error("not_configured", "API no configurada.", 503);
  }
  const result = await supabaseRpc(env, rpcName, params);
  if (result.denied) return error("forbidden", "La cuenta asistente no tiene permiso para esta operacion.", 403);
  if (result.notFound) return error("not_found", "Registro relacionado no encontrado.", 404);
  if (result.conflict) return error("already_exists", "Ya existe un registro equivalente.", 409);
  if (!result.data || result.data.ok !== true) return error("write_unconfirmed", "La base de datos no confirmo la operacion.", 502);
  return json({ data: result.data.data });
}

async function handleCreate(request, env, path) {
  let rpcName;
  let params;
  let rules;
  let expectedMethod = "POST";
  let routeParams;
  if (path === "/v1/schools") {
    if (request.method === "GET") return null;
    if (request.method !== expectedMethod) return error("method_not_allowed", "Esta ruta solo permite GET y POST.", 405, { allow: "GET, POST" });
    rpcName = "assistant_create_school";
    rules = SCHOOL_CREATE_FIELDS;
  } else if (path === "/v1/jobs") {
    if (request.method === "GET") return null;
    if (request.method !== expectedMethod) return error("method_not_allowed", "Esta ruta solo permite GET y POST.", 405, { allow: "GET, POST" });
    rpcName = "assistant_create_job";
    rules = JOB_CREATE_FIELDS;
  } else {
    routeParams = path.match(/^\/v1\/jobs\/([^/]+)\/groups$/);
    if (routeParams) {
      if (request.method === "GET") return null;
      if (request.method !== expectedMethod) return error("method_not_allowed", "Esta ruta solo permite GET y POST.", 405, { allow: "GET, POST" });
      if (!validUuid(routeParams[1])) throw new InputError("jobId debe ser un UUID valido.");
      rpcName = "assistant_create_group";
      rules = GROUP_FIELDS;
    } else {
      routeParams = path.match(/^\/v1\/groups\/([^/]+)$/);
      if (!routeParams) return null;
      if (request.method === "GET") return null;
      if (request.method !== "PATCH") return error("method_not_allowed", "Esta ruta solo permite PATCH.", 405, { allow: "PATCH" });
      if (!validUuid(routeParams[1])) throw new InputError("groupId debe ser un UUID valido.");
      rpcName = "assistant_update_group_routine";
      rules = Object.fromEntries(Object.entries(GROUP_FIELDS).map(([key, rule]) => [key, { ...rule, required: false }]));
      expectedMethod = "PATCH";
    }
  }
  if (!env.ASSISTANT_API_WRITE_TOKEN || env.ASSISTANT_API_WRITE_TOKEN.length < 40
    || env.ASSISTANT_API_WRITE_TOKEN === env.ASSISTANT_API_TOKEN) {
    return error("write_not_configured", "La credencial independiente de escritura no esta configurada.", 503);
  }
  if (!await writeAuthorized(request, env)) {
    const readMatch = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
    if (await secureTokenMatch(readMatch?.[1], env.ASSISTANT_API_TOKEN)) return error("forbidden", "Se requiere la credencial de escritura autorizada.", 403);
    return error("unauthorized", "Token faltante o invalido.", 401, { "www-authenticate": "Bearer" });
  }
  const body = validatedObject(await readJsonBody(request), rules, expectedMethod === "PATCH" ? "actualizar" : "crear");
  if (rpcName === "assistant_create_group") params = { p_job_id: routeParams[1], p_input: body };
  else if (rpcName === "assistant_update_group_routine") params = { p_group_id: routeParams[1], p_patch: body };
  else params = { p_input: body };
  return runWriteRpc(request, env, rpcName, params);
}

async function handleCreateDeposit(request, env, path) {
  const match = path.match(/^\/v1\/jobs\/([^/]+)\/deposits$/);
  if (!match || request.method === "GET") return null;
  if (request.method !== "POST") return error("method_not_allowed", "Esta ruta solo permite GET y POST.", 405, { allow: "GET, POST" });
  if (!validUuid(match[1])) throw new InputError("jobId debe ser un UUID valido.");
  if (!env.ASSISTANT_API_WRITE_TOKEN || env.ASSISTANT_API_WRITE_TOKEN.length < 40
    || env.ASSISTANT_API_WRITE_TOKEN === env.ASSISTANT_API_TOKEN) {
    return error("write_not_configured", "La credencial independiente de escritura no esta configurada.", 503);
  }
  if (!await writeAuthorized(request, env)) {
    const readMatch = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
    if (await secureTokenMatch(readMatch?.[1], env.ASSISTANT_API_TOKEN)) return error("forbidden", "Se requiere la credencial de escritura autorizada.", 403);
    return error("unauthorized", "Token faltante o invalido.", 401, { "www-authenticate": "Bearer" });
  }
  const body = validatedObject(await readJsonBody(request), DEPOSIT_FIELDS, "crear");
  return runWriteRpc(request, env, "assistant_record_deposit", {
    p_job_id: match[1], p_input: body
  });
}

async function updateRecord(env, table, id, select, body) {
  if (!validUuid(id)) throw new InputError("El id debe ser un UUID valido.");
  if (!env.ASSISTANT_API_WRITE_TOKEN || env.ASSISTANT_API_WRITE_TOKEN.length < 40
    || env.ASSISTANT_API_WRITE_TOKEN === env.ASSISTANT_API_TOKEN) {
    return error("write_not_configured", "La credencial independiente de escritura no esta configurada.", 503);
  }
  const patch = validatedPatch(table, body);
  const result = table === "jobs"
    ? await supabaseUpdateJobRoutine(env, id, patch)
    : await supabasePatch(env, table, id, patch, select);
  if (result.denied) return error("forbidden", "La cuenta asistente no tiene permiso para actualizar este registro.", 403);
  if (result.affectedRows === 0) return error("not_found", "Registro no encontrado.", 404);
  if (result.affectedRows !== 1) return error("update_unconfirmed", "La base de datos no confirmo cuantas filas actualizo.", 502);
  const readableTable = table === "jobs" ? "assistant_jobs" : table;
  const { rows } = await supabaseGet(env, readableTable, { select, id: `eq.${id}`, limit: 1 });
  const row = rows[0];
  if (!row) return error("not_found", "Registro no encontrado.", 404);
  if (!Object.entries(patch).every(([field, value]) => row[field] === value)) {
    return error("update_not_applied", "La base de datos no confirmó todos los cambios solicitados.", 409);
  }
  return json({ data: row });
}

async function handleWrite(request, env, path) {
  const match = path.match(/^\/v1\/(clients|schools|jobs)\/([^/]+)$/);
  if (!match) return null;
  if (request.method === "GET") return null;
  if (request.method !== "PATCH") return error("method_not_allowed", "Esta ruta solo permite PATCH.", 405, { allow: "PATCH" });
  if (!await writeAuthorized(request, env)) {
    const readMatch = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
    if (await secureTokenMatch(readMatch?.[1], env.ASSISTANT_API_TOKEN)) {
      return error("forbidden", "Se requiere la credencial de escritura autorizada.", 403);
    }
    return error("unauthorized", "Token faltante o invalido.", 401, { "www-authenticate": "Bearer" });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_ASSISTANT_EMAIL || !env.SUPABASE_ASSISTANT_PASSWORD) {
    return error("not_configured", "API no configurada.", 503);
  }
  const [, resource, id] = match;
  const config = {
    clients: ["clients", "id,name,phone,secondary_phone,email,notes"],
    schools: ["school_profiles", "id,client_id,school_name,contact_name,contact_phone,contact_email,teacher_name,teacher_phone,principal_name,principal_phone,grade_or_class,student_count,last_contact_date,next_follow_up_date,follow_up_status,commercial_notes"],
    jobs: ["jobs", "id,client_id,title,notes"]
  }[resource];
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Content-Type debe ser application/json.");
  }
  const body = await readJsonBody(request);
  return updateRecord(env, config[0], id, config[1], body);
}

function BufferlessConcat(chunks, length) {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function pagedRows(env, table, select, filters, page, order) {
  const result = await supabaseGet(env, table, {
    select,
    ...filters,
    order,
    limit: page.limit + 1,
    offset: page.offset
  });
  const hasMore = result.rows.length > page.limit;
  return {
    data: result.rows.slice(0, page.limit),
    page: { limit: page.limit, offset: page.offset, has_more: hasMore }
  };
}

async function allRows(env, table, select, filters, order) {
  const rows = [];
  const chunk = 500;
  for (let offset = 0; offset < 10000; offset += chunk) {
    const { rows: batch } = await supabaseGet(env, table, {
      select,
      ...filters,
      order,
      limit: chunk,
      offset
    });
    rows.push(...batch);
    if (batch.length < chunk) return rows;
  }
  throw new Error("Result set exceeds internal limit");
}

function safeSearch(url) {
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length > 100 || /[%*(),\\]/.test(query)) throw new InputError("q debe tener hasta 100 caracteres y no incluir comodines.");
  return query;
}

function uuidParam(url, name) {
  const value = url.searchParams.get(name);
  if (value && !validUuid(value)) throw new InputError(`${name} debe ser un UUID valido.`);
  return value;
}

function paged(rows, url) {
  const page = pageOptions(url);
  const start = page.offset;
  const data = rows.slice(start, start + page.limit);
  return json({ data, page: { ...page, has_more: start + page.limit < rows.length } });
}

const SCHOOL_SELECT = "id,client_id,school_name,school_level,contact_name,contact_phone,contact_email,teacher_name,teacher_phone,principal_name,principal_phone,grade_or_class,student_count,last_contact_date,next_follow_up_date,follow_up_status,commercial_notes,created_at,updated_at,clients(id,name,client_type,is_active)";
const JOB_SELECT = "id,client_id,package_id,job_type,title,event_type,event_date,delivery_date,status,price,package_quantity,notes,approved_at,approval_name,approval_terms_accepted,created_at,updated_at";
const GROUP_SELECT = "id,job_id,group_name,teacher_name,teacher_phone,student_count,selected_package_id,photo_format,package_quantity,price,notes,sort_order,created_at,updated_at,packages(name,description,price)";
const PIECE_SELECT = "id,job_id,group_id,item_type,title,status,sent_at,approved_at,approved_by_name,terms_accepted,selected_file_id,selected_package_id,notes,client_notes,changes_requested_at,created_at,updated_at";

async function listSchools(env, url) {
  const page = pageOptions(url);
  const query = safeSearch(url);
  return json(await pagedRows(env, "school_profiles", SCHOOL_SELECT,
    query ? { school_name: `ilike.*${query}*` } : {}, page, "school_name.asc"));
}

async function listJobs(env, url) {
  const page = pageOptions(url);
  const clientId = uuidParam(url, "client_id");
  const status = url.searchParams.get("status");
  if (status && !/^[A-Z_]{2,40}$/.test(status)) throw new InputError("status no es valido.");
  return json(await pagedRows(env, "assistant_jobs", JOB_SELECT,
    { ...(clientId ? { client_id: `eq.${clientId}` } : {}), ...(status ? { status: `eq.${status}` } : {}) },
    page, "created_at.desc"));
}

async function getJob(env, jobId) {
  const { rows } = await supabaseGet(env, "assistant_jobs", { select: JOB_SELECT, id: `eq.${jobId}`, limit: 1 });
  return rows[0] ? json({ data: rows[0] }) : error("not_found", "Trabajo no encontrado.", 404);
}

async function listJobGroups(env, jobId, url) {
  const page = pageOptions(url);
  return json(await pagedRows(env, "school_groups", GROUP_SELECT, { job_id: `eq.${jobId}` }, page, "sort_order.asc,group_name.asc"));
}

async function listJobPieces(env, jobId, url) {
  const page = pageOptions(url);
  return json(await pagedRows(env, "assistant_print_items", PIECE_SELECT, { job_id: `eq.${jobId}` }, page, "created_at.asc"));
}

async function getJobFinance(env, jobId) {
  const [jobs, deposits, expenses] = await Promise.all([
    supabaseGet(env, "assistant_jobs", { select: "id,title,price", id: `eq.${jobId}`, limit: 1 }),
    allRows(env, "deposits", "id,amount,deposit_date", { job_id: `eq.${jobId}` }, "deposit_date.asc"),
    allRows(env, "expenses", "id,amount", { job_id: `eq.${jobId}` }, "expense_date.asc")
  ]);
  const job = jobs.rows[0];
  if (!job) return error("not_found", "Trabajo no encontrado.", 404);
  const paid = deposits.reduce((total, row) => total + Number(row.amount || 0), 0);
  const cost = expenses.reduce((total, row) => total + Number(row.amount || 0), 0);
  return json({ data: {
    job_id: job.id,
    title: job.title,
    total: Number(job.price || 0),
    deposited: paid,
    balance: Math.max(Number(job.price || 0) - paid, 0),
    expenses: cost,
    revenue_after_expenses: Number(job.price || 0) - cost,
    deposit_count: deposits.length,
    expense_count: expenses.length,
    latest_deposit_date: deposits.at(-1)?.deposit_date || null
  } });
}

async function listJobDeposits(env, jobId, url) {
  const page = pageOptions(url);
  return json(await pagedRows(env, "deposits", "id,job_id,group_id,amount,deposit_date,notes,created_at",
    { job_id: `eq.${jobId}` }, page, "deposit_date.desc,created_at.desc"));
}

async function listCosts(env, url) {
  const page = pageOptions(url);
  return json(await pagedRows(env, "cost_items", "id,name,category,unit,purchase_unit,units_per_purchase,unit_cost,stock_quantity,supplier,folder_template_id,is_active,created_at,updated_at,package_material_rules(id,package_id,units_per_package,packages(name))",
    { is_active: "eq.true" }, page, "name.asc"));
}

async function listExpenses(env, url) {
  const page = pageOptions(url);
  const jobId = uuidParam(url, "job_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new InputError("from debe usar YYYY-MM-DD.");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new InputError("to debe usar YYYY-MM-DD.");
  return json(await pagedRows(env, "expenses", "id,job_id,cost_item_id,purchase_order_id,expense_date,vendor,description,quantity,unit,amount,reference,notes,created_at",
    { ...(jobId ? { job_id: `eq.${jobId}` } : {}), ...(from ? { expense_date: `gte.${from}` } : {}), ...(to ? { expense_date: `lte.${to}` } : {}) },
    page, "expense_date.desc,created_at.desc"));
}

async function listPackages(env, url) {
  const page = pageOptions(url);
  return json(await pagedRows(env, "packages", "id,name,package_type,description,price,is_active,created_at,updated_at,package_images(id,file_name,content_type,size_bytes,created_at)",
    {}, page, "name.asc"));
}

async function listTemplates(env, table, url) {
  const page = pageOptions(url);
  const level = url.searchParams.get("school_level");
  if (level && !new Set(["KINDER", "PRIMARY", "SECONDARY"]).has(level)) throw new InputError("school_level no es valido.");
  const select = table === "diploma_templates"
    ? "id,name,file_name,content_type,size_bytes,school_level,is_active,created_at,canva_url"
    : "id,name,file_name,content_type,size_bytes,school_level,is_active,created_at";
  return json(await pagedRows(env, table, select,
    { ...(level ? { school_level: `eq.${level}` } : {}) }, page, "school_level.asc,name.asc"));
}

async function getPreview(env, fileId) {
  /** @type {[string, Record<string, string>][]} */
  const lookups = [
    ["assistant_job_files", { id: `eq.${fileId}`, file_type: "eq.TEACHER_PREVIEW" }],
    ["package_images", { id: `eq.${fileId}` }],
    ["diploma_templates", { id: `eq.${fileId}` }],
    ["folder_templates", { id: `eq.${fileId}` }]
  ];
  let file = null;
  for (const [table, filters] of lookups) {
    const { rows } = await supabaseGet(env, table, { select: "id,r2_key,file_name,content_type,size_bytes", ...filters, limit: 1 });
    if (rows[0]) { file = rows[0]; break; }
  }
  if (!file) return error("not_found", "Preview no encontrado.", 404);
  const contentType = String(file.content_type || "").split(";")[0].toLowerCase();
  const size = Number(file.size_bytes || 0);
  if (!IMAGE_TYPES.has(contentType)) return error("unsupported_media", "El preview no es una imagen compatible.", 415);
  if (size > MAX_IMAGE_BYTES) return error("image_too_large", "La imagen supera el limite de 15 MB.", 413);
  const object = await env.PHOTO_BUCKET.get(file.r2_key);
  if (!object) return error("not_found", "Preview no encontrado.", 404);
  const actualType = String(object.httpMetadata?.contentType || contentType).split(";")[0].toLowerCase();
  if (!IMAGE_TYPES.has(actualType)) return error("unsupported_media", "El archivo no es una imagen compatible.", 415);
  if (object.size > MAX_IMAGE_BYTES) return error("image_too_large", "La imagen supera el limite de 15 MB.", 413);
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[actualType];
  return new Response(object.body, { headers: {
    "content-type": actualType,
    "content-length": String(object.size),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="preview.${extension}"`
  } });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const depositResult = await handleCreateDeposit(request, env, path);
  if (depositResult) return depositResult;
  const createResult = await handleCreate(request, env, path);
  if (createResult) return createResult;
  const writeResult = await handleWrite(request, env, path);
  if (writeResult) return writeResult;
  if (request.method !== "GET") return error("method_not_allowed", "Metodo no permitido para esta ruta.", 405, { allow: "GET" });
  if (!env.ASSISTANT_API_TOKEN || env.ASSISTANT_API_TOKEN.length < 40) return error("not_configured", "API no configurada.", 503);
  if (!await readAuthorized(request, env)) {
    const writeMatch = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") || "");
    if (await secureTokenMatch(writeMatch?.[1], env.ASSISTANT_API_WRITE_TOKEN)) {
      return error("forbidden", "La credencial de escritura no permite consultas GET.", 403);
    }
    return error("unauthorized", "Token faltante o invalido.", 401, { "www-authenticate": "Bearer" });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_ASSISTANT_EMAIL || !env.SUPABASE_ASSISTANT_PASSWORD) {
    return error("not_configured", "API no configurada.", 503);
  }

  if (path === "/v1/health") return json({ ok: true, version: API_VERSION });
  if (path === "/v1/schools") return listSchools(env, url);
  if (path === "/v1/jobs") return listJobs(env, url);
  if (path === "/v1/finance/costs") return listCosts(env, url);
  if (path === "/v1/finance/expenses") return listExpenses(env, url);
  if (path === "/v1/catalogs/packages") return listPackages(env, url);
  if (path === "/v1/catalogs/diplomas") return listTemplates(env, "diploma_templates", url);
  if (path === "/v1/catalogs/folders") return listTemplates(env, "folder_templates", url);

  let match = path.match(/^\/v1\/jobs\/([^/]+)(?:\/(groups|pieces|finance|deposits))?$/);
  if (match) {
    const [, jobId, subresource] = match;
    if (!validUuid(jobId)) throw new InputError("jobId debe ser un UUID valido.");
    if (subresource === "groups") return listJobGroups(env, jobId, url);
    if (subresource === "pieces") return listJobPieces(env, jobId, url);
    if (subresource === "finance") return getJobFinance(env, jobId);
    if (subresource === "deposits") return listJobDeposits(env, jobId, url);
    return getJob(env, jobId);
  }
  match = path.match(/^\/v1\/previews\/([^/]+)$/);
  if (match) {
    if (!validUuid(match[1])) throw new InputError("previewId debe ser un UUID valido.");
    if (!env.PHOTO_BUCKET) return error("not_configured", "Almacenamiento de previews no configurado.", 503);
    return getPreview(env, match[1]);
  }
  return error("not_found", "Ruta no encontrada.", 404);
}

export async function handleAssistantApiRequest(request, env) {
  try {
    return await route(request, env);
  } catch (cause) {
    if (cause instanceof InputError) return error("invalid_request", cause.message, 400);
    return error("internal_error", "No se pudo completar la consulta.", 500);
  }
}

export default { fetch: handleAssistantApiRequest };
