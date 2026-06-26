import { supabase } from "./supabase.js";

export async function getDepositsByJob(jobId) {
  const { data, error } = await supabase.from("deposits").select("*").eq("job_id", jobId).order("deposit_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createDeposit(jobId, data) {
  const { error } = await supabase.from("deposits").insert({ ...data, job_id: jobId });
  if (error) throw error;
}

export async function updateDeposit(id, data) {
  const { error } = await supabase.from("deposits").update(data).eq("id", id);
  if (error) throw error;
}

export async function deleteDeposit(id) {
  const { error } = await supabase.from("deposits").delete().eq("id", id);
  if (error) throw error;
}

export async function getTotalDeposited(jobId) {
  const deposits = await getDepositsByJob(jobId);
  return deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
}
