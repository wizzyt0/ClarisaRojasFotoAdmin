import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";

export const R2_FILE_TYPES = {
  TEACHER_PREVIEW: "Preview maestra",
  PRINT_HIGH_RES: "Alta calidad imprenta"
};

export const R2_LINK_TYPES = {
  TEACHER_PREVIEW: "Preview maestra",
  PRINT_DOWNLOAD: "Descarga imprenta"
};

const authorizedFileUrls = new Map();
window.addEventListener("pagehide", () => {
  authorizedFileUrls.forEach((entry) => URL.revokeObjectURL(entry));
  authorizedFileUrls.clear();
});

export async function getAuthorizedR2ObjectUrl(path) {
  if (authorizedFileUrls.has(path)) return authorizedFileUrls.get(path);
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Debe iniciar sesión para ver archivos.");
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || "No se pudo cargar el archivo.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  authorizedFileUrls.set(path, objectUrl);
  return objectUrl;
}

export async function getR2FilesByJob(jobId) {
  const { data, error } = await supabase
    .from("job_files")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getR2ShareLinksByJob(jobId) {
  const { data, error } = await supabase
    .from("file_share_links")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createR2File(jobId, payload) {
  const { data, error } = await supabase
    .from("job_files")
    .insert([{ ...payload, job_id: jobId }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createR2ShareLink(jobId, linkType, expiresAt, printItemId = null) {
  const { data, error } = await supabase
    .from("file_share_links")
    .insert([{ job_id: jobId, print_item_id: printItemId, link_type: linkType, expires_at: expiresAt }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function revokeR2ShareLink(linkId) {
  const { error } = await supabase
    .from("file_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) throw error;
}

export async function uploadR2File(jobId, fileType, file, printItemId = null) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Debe iniciar sesión para subir archivos.");

  const formData = new FormData();
  formData.append("job_id", jobId);
  if (printItemId) formData.append("print_item_id", printItemId);
  formData.append("file_type", fileType);
  formData.append("file", file);

  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    body: formData
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo subir el archivo.");
  return result;
}

export async function deleteR2File(fileId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Debe iniciar sesión para eliminar archivos.");

  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/files/${fileId}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo eliminar el archivo.");
  return result;
}

export async function getAdminFileUrl(fileId, download = false) {
  if (download) return downloadAdminFile(fileId);
  return getAuthorizedR2ObjectUrl(`/admin/files/${encodeURIComponent(fileId)}`);
}

export async function downloadAdminFile(fileId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Debe iniciar sesión para descargar archivos.");
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/files/${encodeURIComponent(fileId)}?download=1`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || "No se pudo descargar el archivo.");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `archivo-${fileId}`;
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
