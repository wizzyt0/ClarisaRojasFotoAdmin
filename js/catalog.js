import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";

async function sessionToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Debe iniciar sesión.");
  return token;
}

export async function getPackageImages(packageId = null) {
  let query = supabase.from("package_images").select("*, packages(name, price, package_type)").order("created_at", { ascending: false });
  if (packageId) query = query.eq("package_id", packageId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getDiplomaTemplates(schoolLevel = null) {
  let query = supabase.from("diploma_templates").select("*").order("created_at", { ascending: false });
  if (schoolLevel) query = query.eq("school_level", schoolLevel);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getFolderTemplates(schoolLevel = null) {
  let query = supabase.from("folder_templates").select("*").order("created_at", { ascending: false });
  if (schoolLevel) query = query.eq("school_level", schoolLevel);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function uploadPackageImage(packageId, file) {
  const formData = new FormData();
  formData.append("catalog_type", "PACKAGE");
  formData.append("package_id", packageId);
  formData.append("file", file);
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/catalog/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${await sessionToken()}` },
    body: formData
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo subir la imagen del paquete.");
  return result;
}

export async function uploadDiplomaTemplate(name, schoolLevel, file, canvaUrl = "") {
  const formData = new FormData();
  formData.append("catalog_type", "DIPLOMA");
  formData.append("name", name);
  formData.append("school_level", schoolLevel);
  formData.append("canva_url", canvaUrl.trim());
  formData.append("file", file);
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/catalog/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${await sessionToken()}` },
    body: formData
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo subir el diploma.");
  return result;
}

export async function uploadFolderTemplate(name, schoolLevel, file) {
  const formData = new FormData();
  formData.append("catalog_type", "FOLDER");
  formData.append("name", name);
  formData.append("school_level", schoolLevel);
  formData.append("file", file);
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/catalog/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${await sessionToken()}` },
    body: formData
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo subir la carpeta.");
  return result;
}

export async function getCatalogFileUrl(table, fileId) {
  return `${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/catalog/${table}/${fileId}?auth=${encodeURIComponent(await sessionToken())}`;
}

export async function updateDiplomaTemplate(templateId, payload, table = "diploma_templates") {
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/admin/catalog/${table}/${templateId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${await sessionToken()}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo actualizar el diploma.");
  return result;
}

export async function toggleDiplomaTemplate(templateId, isActive) {
  return updateDiplomaTemplate(templateId, { is_active: isActive });
}
