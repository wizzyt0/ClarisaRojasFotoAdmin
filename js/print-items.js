import { supabase } from "./supabase.js";

export const PRINT_ITEM_TYPES = {
  STUDENT_GALLERY: "Galería de niños",
  DIPLOMA: "Diploma",
  FOLDER_OPTION: "Carpeta",
  GROUP_PHOTO: "Foto grupal",
  PHOTO_PACKAGE: "Paquete de fotos",
  OTHER: "Otro"
};

export const PRINT_ITEM_STATUSES = {
  PENDING: "Pendiente de subir",
  READY_FOR_REVIEW: "Lista para revisión",
  SENT_FOR_APPROVAL: "Enviada a maestra",
  APPROVED_FOR_PRINT: "Aprobada para imprimir",
  PRINTING: "En impresión",
  PRINTED: "Impresa",
  DELIVERED: "Entregada",
  CHANGES_REQUESTED: "Cambios solicitados",
  CANCELLED: "Cancelada"
};

export const DEFAULT_SCHOOL_PRINT_ITEMS = [
  { item_type: "STUDENT_GALLERY", title: "Galería de niños" },
  { item_type: "DIPLOMA", title: "Diploma" },
  { item_type: "FOLDER_OPTION", title: "Carpeta" },
  { item_type: "GROUP_PHOTO", title: "Foto grupal" },
  { item_type: "PHOTO_PACKAGE", title: "Paquete de fotos" }
];

export function getPrintItemTypeLabel(value) {
  return PRINT_ITEM_TYPES[value] || value || "";
}

export function getPrintItemStatusLabel(value) {
  return PRINT_ITEM_STATUSES[value] || value || "";
}

export async function getPrintItemsByJob(jobId) {
  const { data, error } = await supabase
    .from("print_items")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function ensureDefaultPrintItems(jobId) {
  const existing = await getPrintItemsByJob(jobId);
  if (existing.length) return existing;
  const rows = DEFAULT_SCHOOL_PRINT_ITEMS.map((item) => ({ ...item, job_id: jobId }));
  const { data, error } = await supabase.from("print_items").insert(rows).select("*");
  if (error) throw error;
  return data || [];
}

export async function updatePrintItem(itemId, payload) {
  const { data, error } = await supabase
    .from("print_items")
    .update(payload)
    .eq("id", itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
