import { supabase } from "./supabase.js";

export async function getSchoolGroupsByJob(jobId) {
  const { data, error } = await supabase
    .from("school_groups")
    .select("*, packages(name, price)")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createSchoolGroup(jobId, payload) {
  const { data, error } = await supabase
    .from("school_groups")
    .insert([{ ...payload, job_id: jobId }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSchoolGroup(groupId, payload) {
  const { data, error } = await supabase
    .from("school_groups")
    .update(payload)
    .eq("id", groupId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSchoolGroup(groupId) {
  const { error } = await supabase.from("school_groups").delete().eq("id", groupId);
  if (error) throw error;
}
