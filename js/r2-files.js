import { supabase } from "./supabase.js";

export const R2_FILE_TYPES = {
  TEACHER_PREVIEW: "Preview maestra",
  PRINT_HIGH_RES: "Alta calidad imprenta"
};

export const R2_LINK_TYPES = {
  TEACHER_PREVIEW: "Preview maestra",
  PRINT_DOWNLOAD: "Descarga imprenta"
};

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

export async function deleteR2File(fileId) {
  const { error } = await supabase.from("job_files").delete().eq("id", fileId);
  if (error) throw error;
}

export async function createR2ShareLink(jobId, linkType, expiresAt) {
  const { data, error } = await supabase
    .from("file_share_links")
    .insert([{ job_id: jobId, link_type: linkType, expires_at: expiresAt }])
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
