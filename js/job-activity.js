import { supabase } from "./supabase.js";
import { escapeHtml } from "./utils.js";
import { formatMoney, formatDateTime } from "./formatters.js";
import { getJobStatusLabel } from "./constants.js";
import { getPrintItemStatusLabel } from "./print-items.js";

const labels = {
  selected_package_id: "Paquete", package_quantity: "Cantidad", price: "Total",
  amount: "Abono", deposit_date: "Fecha de abono", notes: "Nota",
  group_id: "Grupo", group_name: "Grupo", status: "Estado", title: "Título"
};
const entities = { school_groups: "Grupo", deposits: "Abono", jobs: "Trabajo", print_items: "Pieza" };
const operations = { INSERT: "Registro", UPDATE: "Cambio", DELETE: "Eliminación" };

function valueLabel(key, value, data, entity) {
  if (value === null || value === undefined || value === "") return "Sin asignar";
  if (["price", "amount"].includes(key)) return formatMoney(value);
  if (key === "selected_package_id") return data.package_name || value;
  if (key === "group_id") return data.group_label || value;
  if (key === "status") return entity === "print_items" ? getPrintItemStatusLabel(value) : getJobStatusLabel(value);
  return String(value);
}

export function activityChanges(entry) {
  const before = entry.before_data || {};
  const after = entry.after_data || {};
  return Object.keys(labels).filter((key) => before[key] !== after[key]).map((key) =>
    `${labels[key]}: ${valueLabel(key, before[key], before, entry.entity_type)} → ${valueLabel(key, after[key], after, entry.entity_type)}`
  );
}

function activityContext(entry) {
  const data = entry.after_data || entry.before_data || {};
  return [data.group_name || data.group_label, data.title].filter(Boolean).join(" · ");
}

export function mountJobActivity(jobId) {
  const details = document.querySelector("#jobActivity");
  if (!details) return;
  const target = document.querySelector("#jobActivityList");
  const more = document.querySelector("#moreJobActivity");
  let limit = 50;
  let busy = false;
  const load = async () => {
    if (busy) return;
    busy = true;
    more.disabled = true;
    target.textContent = "Cargando historial…";
    try {
      const { data, error } = await supabase.from("job_activity").select("*").eq("job_id", jobId).order("id", { ascending: false }).limit(limit + 1);
      if (error) throw error;
      more.textContent = "Ver más movimientos";
      more.hidden = data.length <= limit;
      target.innerHTML = data.length ? data.slice(0, limit).map((entry) =>
        `<article class="activity-entry"><strong>${escapeHtml(operations[entry.operation] || entry.operation)} · ${escapeHtml(entities[entry.entity_type] || entry.entity_type)}${activityContext(entry) ? ` · ${escapeHtml(activityContext(entry))}` : ""}</strong><div class="muted">${escapeHtml(formatDateTime(entry.created_at))} · ${escapeHtml(entry.actor_label)}</div>${activityChanges(entry).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</article>`
      ).join("") : '<div class="empty-state">Sin movimientos registrados.</div>';
    } catch (error) {
      target.textContent = `No se pudo cargar el historial: ${error.message}`;
      more.hidden = false;
      more.textContent = "Reintentar";
    } finally {
      busy = false;
      more.disabled = false;
    }
  };
  details.ontoggle = () => { if (details.open) load(); };
  more.onclick = () => { limit += 50; load(); };
  if (details.open) load();
}
