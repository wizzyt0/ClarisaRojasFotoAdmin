const FILE_TYPE_BY_LINK_TYPE = {
  TEACHER_PREVIEW: "TEACHER_PREVIEW",
  PRINT_DOWNLOAD: "PRINT_HIGH_RES"
};

function html(body, status = 200) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clarisa Rojas Fotografia</title><style>
    body{margin:0;background:#f6f7f9;color:#1f2933;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}
    main{max-width:1100px;margin:0 auto;padding:24px}
    .top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}
    h1{font-size:1.6rem;margin:0}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
    .item{background:white;border:1px solid #d8dee5;border-radius:8px;padding:12px}.item img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#eef4f3}
    a.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 12px;border-radius:8px;background:#2f6f73;color:white;text-decoration:none}
    .alert{background:white;border:1px solid #d8dee5;border-radius:8px;padding:18px;margin-top:18px}
  </style></head><body><main>${body}</main></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function safeText(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

async function supabaseFetch(env, path) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Supabase error ${response.status}`);
  return response.json();
}

async function getShare(env, token) {
  const links = await supabaseFetch(
    env,
    `file_share_links?select=id,job_id,link_type,expires_at,revoked_at,created_at&token=eq.${encodeURIComponent(token)}&limit=1`
  );
  const share = links[0];
  if (!share) return null;
  if (share.revoked_at) return null;
  if (new Date(share.expires_at).getTime() <= Date.now()) return null;
  return share;
}

async function getFiles(env, share) {
  const fileType = FILE_TYPE_BY_LINK_TYPE[share.link_type];
  return supabaseFetch(
    env,
    `job_files?select=id,file_type,r2_key,file_name,content_type,size_bytes,notes&job_id=eq.${share.job_id}&file_type=eq.${fileType}&order=created_at.desc`
  );
}

async function renderPreview(request, env, token) {
  const share = await getShare(env, token);
  if (!share || share.link_type !== "TEACHER_PREVIEW") return html(`<div class="alert"><h1>Link no disponible</h1><p>Este link expiró, fue revocado o no existe.</p></div>`, 404);
  const files = await getFiles(env, share);
  const url = new URL(request.url);
  const items = files.map((file) => `<article class="item"><img src="${url.origin}/file/${file.id}?token=${encodeURIComponent(token)}" alt="${safeText(file.file_name)}"><p><strong>${safeText(file.file_name)}</strong></p></article>`).join("");
  return html(`<div class="top"><div><h1>Preview de fotos</h1><p class="muted">Clarisa Rojas Fotografia</p></div></div>${items ? `<section class="grid">${items}</section>` : `<div class="alert">No hay previews registrados.</div>`}`);
}

async function renderDownload(request, env, token) {
  const share = await getShare(env, token);
  if (!share || share.link_type !== "PRINT_DOWNLOAD") return html(`<div class="alert"><h1>Link no disponible</h1><p>Este link expiró, fue revocado o no existe.</p></div>`, 404);
  const files = await getFiles(env, share);
  const url = new URL(request.url);
  if (files.length === 1) return streamFile(env, files[0], true);
  const links = files.map((file) => `<p><a class="button" href="${url.origin}/file/${file.id}?token=${encodeURIComponent(token)}&download=1">Descargar ${safeText(file.file_name)}</a></p>`).join("");
  return html(`<h1>Archivos para imprenta</h1><p class="muted">Descargue los archivos en alta calidad.</p>${links || `<div class="alert">No hay archivos de imprenta registrados.</div>`}`);
}

async function streamFile(env, file, forceDownload) {
  const object = await env.PHOTO_BUCKET.get(file.r2_key);
  if (!object) return jsonError("Archivo no encontrado en R2.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=300");
  headers.set("content-type", file.content_type || object.httpMetadata?.contentType || "application/octet-stream");
  if (forceDownload) headers.set("content-disposition", `attachment; filename="${file.file_name.replace(/"/g, "")}"`);
  return new Response(object.body, { headers });
}

async function handleFile(request, env, token, fileId) {
  const share = await getShare(env, token);
  if (!share) return jsonError("Link no disponible.", 404);
  const files = await getFiles(env, share);
  const file = files.find((item) => item.id === fileId);
  if (!file) return jsonError("Archivo no permitido para este link.", 403);
  const forceDownload = new URL(request.url).searchParams.get("download") === "1" || share.link_type === "PRINT_DOWNLOAD";
  return streamFile(env, file, forceDownload);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");
      if (!token) return html(`<div class="alert"><h1>Falta token</h1><p>Abra el link completo que recibió.</p></div>`, 400);
      if (url.pathname === "/preview") return renderPreview(request, env, token);
      if (url.pathname === "/download") return renderDownload(request, env, token);
      if (url.pathname.startsWith("/file/")) return handleFile(request, env, token, url.pathname.split("/").pop());
      return html(`<div class="alert"><h1>Link no encontrado</h1></div>`, 404);
    } catch (error) {
      return jsonError(error.message || "Error interno.", 500);
    }
  }
};
