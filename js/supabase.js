import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const hasSupabaseConfig =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes("TU_SUPABASE") &&
  !SUPABASE_ANON_KEY.includes("TU_SUPABASE");

let clientPromise = null;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isTransientRequestError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("failed to fetch") || message.includes("network") || message.includes("timeout") || message.includes("fetch failed");
}

function missingConfigResult() {
  return {
    data: null,
    error: new Error("Supabase no está configurado. Edite js/config.js y ejecute los archivos SQL en Supabase.")
  };
}

async function getClient() {
  if (!hasSupabaseConfig) return null;
  if (!clientPromise) {
    clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm")
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}

function createQuery(tableName) {
  const calls = [];
  const query = {
    select(...args) { calls.push(["select", args]); return query; },
    insert(...args) { calls.push(["insert", args]); return query; },
    update(...args) { calls.push(["update", args]); return query; },
    delete(...args) { calls.push(["delete", args]); return query; },
    eq(...args) { calls.push(["eq", args]); return query; },
    order(...args) { calls.push(["order", args]); return query; },
    limit(...args) { calls.push(["limit", args]); return query; },
    single(...args) { calls.push(["single", args]); return query; },
    maybeSingle(...args) { calls.push(["maybeSingle", args]); return query; },
    async execute() {
      const client = await getClient();
      if (!client) return missingConfigResult();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let request = client.from(tableName);
        for (const [method, args] of calls) {
          request = request[method](...args);
        }
        const result = await request;
        if (!result.error || !isTransientRequestError(result.error) || attempt === 2) return result;
        await sleep((attempt + 1) * 1500);
      }
      return missingConfigResult();
    },
    then(resolve, reject) { return query.execute().then(resolve, reject); },
    catch(reject) { return query.execute().catch(reject); },
    finally(callback) { return query.execute().finally(callback); }
  };
  return query;
}

export const supabase = {
  from(tableName) {
    return createQuery(tableName);
  },
  async rpc(functionName, params) {
    const client = await getClient();
    if (!client) return missingConfigResult();
    return client.rpc(functionName, params);
  },
  auth: {
    async signInWithPassword(credentials) {
      const client = await getClient();
      if (!client) return missingConfigResult();
      return client.auth.signInWithPassword(credentials);
    },
    async signOut(options) {
      const client = await getClient();
      if (!client) return missingConfigResult();
      return client.auth.signOut(options);
    },
    async getUser() {
      const client = await getClient();
      if (!client) return { data: { user: null }, error: null };
      return client.auth.getUser();
    },
    async getSession() {
      const client = await getClient();
      if (!client) return { data: { session: null }, error: null };
      return client.auth.getSession();
    }
  }
};
