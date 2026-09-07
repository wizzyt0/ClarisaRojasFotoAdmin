import { supabase } from "./supabase.js";

export const ASSIGNMENT_STATUSES = {
  ASSIGNED: "Asignada",
  IN_PROGRESS: "En proceso",
  READY_FOR_OWNER_REVIEW: "Lista para revisión interna",
  SENT_TO_CLIENT: "En revisión con la maestra",
  CHANGES_REQUESTED: "Cambios solicitados",
  COMPLETED: "Aprobada para impresión",
  CANCELLED: "Cancelada"
};

export async function getEditors() {
  const { data, error } = await supabase
    .from("staff_roles")
    .select("user_id, display_name")
    .eq("role", "editor")
    .order("display_name");
  if (error) throw error;
  return data || [];
}

export async function getAssignmentsByPrintItems(printItemIds) {
  if (!printItemIds.length) return [];
  const { data, error } = await supabase
    .from("work_assignments")
    .select("*")
    .in("print_item_id", printItemIds);
  if (error) throw error;
  return data || [];
}

export async function saveAssignment(payload) {
  const { data, error } = await supabase
    .from("work_assignments")
    .upsert(payload, { onConflict: "print_item_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getMyAssignments() {
  const { data, error } = await supabase
    .from("work_assignments")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateMyAssignment(assignmentId, status, note) {
  const { data, error } = await supabase.rpc("update_own_work_assignment", {
    assignment_id: assignmentId,
    next_status: status,
    next_editor_note: note || null
  });
  if (error) throw error;
  return data;
}
