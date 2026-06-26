import { supabase } from "./supabase.js";
import { isValidGooglePhotosUrl } from "./utils.js";

function validateGallery(data) {
  if (!data.title?.trim()) throw new Error("El título de la galería es requerido.");
  if (!data.gallery_type) throw new Error("El tipo de galería es requerido.");
  if (!isValidGooglePhotosUrl(data.google_photos_url)) throw new Error("Esta galería no tiene un link válido.");
}

export async function getGalleriesByJob(jobId) {
  const { data, error } = await supabase.from("galleries").select("*").eq("job_id", jobId).order("created_at");
  if (error) throw error;
  return data || [];
}

export async function createGallery(jobId, data) {
  validateGallery(data);
  const { error } = await supabase.from("galleries").insert({ ...data, job_id: jobId });
  if (error) throw error;
}

export async function updateGallery(id, data) {
  validateGallery(data);
  const { error } = await supabase.from("galleries").update(data).eq("id", id);
  if (error) throw error;
}

export async function deactivateGallery(id) {
  const { error } = await supabase.from("galleries").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

export async function deleteGallery(id) {
  const { error } = await supabase.from("galleries").delete().eq("id", id);
  if (error) throw error;
}

export async function getActiveGalleryByType(jobId, galleryType) {
  const { data, error } = await supabase.from("galleries").select("*").eq("job_id", jobId).eq("gallery_type", galleryType).eq("is_active", true).maybeSingle();
  if (error) throw error;
  return data;
}
