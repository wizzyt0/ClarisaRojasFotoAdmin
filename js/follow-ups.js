import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";
import { FOLLOW_UP_STATUSES, getFollowUpStatusLabel } from "./constants.js";
import { buildWhatsAppUrl } from "./whatsapp.js";
import { escapeHtml, formToObject, openInNewTab, showToast, today } from "./utils.js";
import { formatDate } from "./formatters.js";

await requireAuth();

let profiles = [];
let editing = null;
const modal = document.querySelector("#followModal");
const form = document.querySelector("#followForm");
document.querySelector("#statusFilter").insertAdjacentHTML("beforeend", Object.entries(FOLLOW_UP_STATUSES).map(([value, label]) => `<option value="${value}">${label}</option>`).join(""));

const SCHOOL_LEVELS = {
  KINDER: "Kinder",
  PRIMARY: "Primaria",
  SECONDARY: "Secundaria"
};

function isThisMonth(date) {
  return date?.startsWith(new Date().toISOString().slice(0, 7));
}

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const status = document.querySelector("#statusFilter").value;
  const month = document.querySelector("#monthFilter").value;
  const rows = profiles.filter((profile) => {
    const text = `${profile.school_name} ${profile.teacher_name || ""} ${profile.principal_name || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!status || profile.follow_up_status === status) && (!month || isThisMonth(profile.next_follow_up_date));
  });
  document.querySelector("#followUpsTable").innerHTML = rows.length ? `<table class="table"><thead><tr><th>Escuela</th><th>Nivel</th><th>Teléfono</th><th>Maestra</th><th>Directora</th><th>Último contacto</th><th>Próximo seguimiento</th><th>Estado</th><th>Notas</th><th>Acciones</th></tr></thead><tbody>${rows.map((profile) => `<tr><td>${escapeHtml(profile.school_name)}</td><td>${escapeHtml(SCHOOL_LEVELS[profile.school_level] || "")}</td><td>${escapeHtml(profile.clients?.phone)}</td><td>${escapeHtml(profile.teacher_name)}</td><td>${escapeHtml(profile.principal_name)}</td><td>${formatDate(profile.last_contact_date)}</td><td>${formatDate(profile.next_follow_up_date)}</td><td><span class="badge">${getFollowUpStatusLabel(profile.follow_up_status)}</span></td><td>${escapeHtml(profile.commercial_notes)}</td><td class="actions"><button class="btn" data-edit="${profile.id}">Editar</button><button class="btn" data-contacted="${profile.id}">Contactado hoy</button><button class="btn" data-whatsapp="${profile.id}">WhatsApp</button><a class="btn" href="jobs.html?client=${profile.client_id}&action=new">Nuevo trabajo</a></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">No hay escuelas para mostrar.</div>`;
}

async function load() {
  const { data, error } = await supabase.from("school_profiles").select("*, clients(name, phone, is_active)").order("next_follow_up_date");
  if (error) throw error;
  profiles = (data || []).filter((profile) => profile.clients?.is_active !== false);
  render();
}

function openForm(profile) {
  editing = profile;
  form.innerHTML = `<div class="form-grid">
    <div class="form-group"><label>Último contacto</label><input class="input" type="date" name="last_contact_date" value="${escapeHtml(profile.last_contact_date)}"></div>
    <div class="form-group"><label>Próximo seguimiento</label><input class="input" type="date" name="next_follow_up_date" value="${escapeHtml(profile.next_follow_up_date)}"></div>
    <div class="form-group"><label>Estado</label><select class="select" name="follow_up_status">${Object.entries(FOLLOW_UP_STATUSES).map(([value, label]) => `<option value="${value}" ${value === profile.follow_up_status ? "selected" : ""}>${label}</option>`).join("")}</select></div>
  </div>
  <div class="form-group"><label>Notas comerciales</label><textarea class="textarea" name="commercial_notes">${escapeHtml(profile.commercial_notes)}</textarea></div>
  <button class="btn btn-primary" type="submit">Guardar seguimiento</button>`;
  modal.classList.remove("hidden");
}

function followMessage(profile) {
  const greetingName = profile.teacher_name || profile.principal_name || profile.school_name;
  return `Hola ${greetingName} 👋

Le saluda Clarisa de ${APP_CONFIG.businessName}.

Estamos organizando nuestra agenda de graduaciones escolares para este año y nos gustaría saber si la escuela ${profile.school_name} desea cotizar o reservar su sesión de graduación.

También puede ver nuestro trabajo en redes sociales:
Facebook: ${APP_CONFIG.facebookUrl}
Instagram: ${APP_CONFIG.instagramUrl}

Quedo atento/a. Muchas gracias.`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  const { error } = await supabase.from("school_profiles").update(data).eq("id", editing.id);
  if (error) { console.error(error); return showToast("No se pudo guardar el seguimiento.", "error"); }
  modal.classList.add("hidden");
  showToast("Seguimiento actualizado.");
  load();
});

document.addEventListener("click", async (event) => {
  const profile = profiles.find((item) => item.id === (event.target.dataset.edit || event.target.dataset.contacted || event.target.dataset.whatsapp));
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (event.target.dataset.edit) openForm(profile);
  if (event.target.dataset.contacted) {
    await supabase.from("school_profiles").update({ last_contact_date: today() }).eq("id", profile.id);
    showToast("Último contacto actualizado.");
    load();
  }
  if (event.target.dataset.whatsapp) {
    const message = followMessage(profile);
    const waMeUrl = buildWhatsAppUrl(profile.clients?.phone, message);
    const { data: job } = await supabase.from("jobs").select("id").eq("client_id", profile.client_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (job?.id) {
      await supabase.from("message_logs").insert({ job_id: job.id, client_id: profile.client_id, message_type: "FOLLOW_UP", message_text: message, wa_me_url: waMeUrl });
    }
    openInNewTab(waMeUrl);
  }
});

["searchInput", "statusFilter", "monthFilter"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", render));
load().catch((error) => { console.error(error); showToast("No se pudo cargar la información.", "error"); });
