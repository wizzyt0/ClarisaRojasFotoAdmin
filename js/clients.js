import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { CLIENT_TYPES, FOLLOW_UP_STATUSES, getClientTypeLabel } from "./constants.js";
import { escapeHtml, formToObject, showToast } from "./utils.js";

let clients = [];
let editingClient = null;

const modal = document.querySelector("#clientModal");
const form = document.querySelector("#clientForm");

window.photoAdminClientsModuleReady = true;

function options(map, selected = "") {
  return Object.entries(map).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function schoolLevelOptions(selected = "") {
  return [
    ["KINDER", "Kinder"],
    ["PRIMARY", "Primaria"],
    ["SECONDARY", "Secundaria"]
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function renderForm(client = {}, profile = {}) {
  form.innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Tipo de cliente</label><select class="select" name="client_type" required>${options(CLIENT_TYPES, client.client_type)}</select></div>
      <div class="form-group"><label>Nombre</label><input class="input" name="name" required value="${escapeHtml(client.name)}"></div>
      <div class="form-group"><label>Teléfono principal</label><input class="input" name="phone" required value="${escapeHtml(client.phone)}"></div>
      <div class="form-group"><label>Email</label><input class="input" type="email" name="email" value="${escapeHtml(client.email)}"></div>
      <div class="form-group"><label>Activo</label><select class="select" name="is_active"><option value="true" ${client.is_active !== false ? "selected" : ""}>Sí</option><option value="false" ${client.is_active === false ? "selected" : ""}>No</option></select></div>
    </div>
    <div class="form-group"><label>Notas</label><textarea class="textarea" name="notes">${escapeHtml(client.notes)}</textarea></div>
    <section id="schoolFields" class="card">
      <h3>Datos escolares</h3>
      <div class="form-grid">
        <div class="form-group"><label>Nombre de la escuela</label><input class="input" name="school_name" value="${escapeHtml(profile.school_name)}"></div>
        <div class="form-group"><label>Nivel escolar</label><select class="select" name="school_level"><option value="">Seleccione</option>${schoolLevelOptions(profile.school_level)}</select></div>
        <div class="form-group"><label>Maestra</label><input class="input" name="teacher_name" value="${escapeHtml(profile.teacher_name)}"></div>
        <div class="form-group"><label>Teléfono maestra</label><input class="input" name="teacher_phone" value="${escapeHtml(profile.teacher_phone)}"></div>
        <div class="form-group"><label>Directora</label><input class="input" name="principal_name" value="${escapeHtml(profile.principal_name)}"></div>
        <div class="form-group"><label>Teléfono directora</label><input class="input" name="principal_phone" value="${escapeHtml(profile.principal_phone)}"></div>
        <div class="form-group"><label>Curso o grado</label><input class="input" name="grade_or_class" value="${escapeHtml(profile.grade_or_class)}"></div>
        <div class="form-group"><label>Cantidad de estudiantes</label><input class="input" type="number" min="0" name="student_count" value="${escapeHtml(profile.student_count)}"></div>
        <div class="form-group"><label>Último contacto</label><input class="input" type="date" name="last_contact_date" value="${escapeHtml(profile.last_contact_date)}"></div>
        <div class="form-group"><label>Próximo seguimiento</label><input class="input" type="date" name="next_follow_up_date" value="${escapeHtml(profile.next_follow_up_date)}"></div>
        <div class="form-group"><label>Estado</label><select class="select" name="follow_up_status">${options(FOLLOW_UP_STATUSES, profile.follow_up_status || "NEW_CONTACT")}</select></div>
      </div>
      <div class="form-group"><label>Notas comerciales</label><textarea class="textarea" name="commercial_notes">${escapeHtml(profile.commercial_notes)}</textarea></div>
    </section>
    <div class="actions">
      <button class="btn btn-primary" type="submit" name="after_save_action" value="stay">Guardar cliente</button>
      <button class="btn btn-secondary" type="submit" name="after_save_action" value="new_job">Guardar y crear trabajo</button>
    </div>
  `;
  const toggleSchool = () => document.querySelector("#schoolFields").classList.toggle("hidden", form.client_type.value !== "SCHOOL_GRADUATION");
  form.client_type.addEventListener("change", toggleSchool);
  toggleSchool();
}

async function openModal(client = null) {
  editingClient = client;
  let profile = {};
  if (client?.client_type === "SCHOOL_GRADUATION") {
    const { data } = await supabase.from("school_profiles").select("*").eq("client_id", client.id).maybeSingle();
    profile = data || {};
  }
  document.querySelector("#clientModalTitle").textContent = client ? "Editar cliente" : "Nuevo cliente";
  renderForm(client || { client_type: "PHOTO_SESSION", is_active: true }, profile);
  modal.classList.remove("hidden");
}

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const type = document.querySelector("#typeFilter").value;
  const active = document.querySelector("#activeFilter").value;
  const rows = clients.filter((client) => {
    const text = `${client.name} ${client.phone} ${client.email || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!type || client.client_type === type) && (active === "" || String(client.is_active) === active);
  });
  document.querySelector("#clientsTable").innerHTML = rows.length ? `
    <table class="table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Teléfono</th><th>Email</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
    ${rows.map((client) => `<tr><td>${escapeHtml(client.name)}</td><td>${getClientTypeLabel(client.client_type)}</td><td>${escapeHtml(client.phone)}</td><td>${escapeHtml(client.email)}</td><td><span class="badge">${client.is_active ? "Activo" : "Inactivo"}</span></td><td class="actions"><button class="btn" data-edit="${client.id}" type="button">Editar</button><a class="btn" href="jobs.html?client=${client.id}">Trabajos</a><a class="btn btn-secondary" href="jobs.html?client=${client.id}&action=new">Nuevo trabajo</a><button class="btn btn-danger" data-deactivate="${client.id}" type="button">Desactivar</button><button class="btn btn-danger" data-delete-client="${client.id}" type="button">Eliminar todo</button></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty-state">No hay clientes para mostrar.</div>`;
}

async function load() {
  const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  clients = data || [];
  render();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const afterSaveAction = event.submitter?.value || "stay";
  const data = formToObject(form);
  if (data.client_type === "SCHOOL_GRADUATION" && !data.school_name.trim()) {
    showToast("Si es escuela, el nombre de la escuela es requerido.", "error");
    return;
  }
  const clientPayload = {
    client_type: data.client_type,
    name: data.name.trim(),
    phone: data.phone.trim(),
    secondary_phone: null,
    email: data.email || null,
    notes: data.notes || null,
    is_active: data.is_active === "true"
  };
  const { data: saved, error } = editingClient
    ? await supabase.from("clients").update(clientPayload).eq("id", editingClient.id).select().single()
    : await supabase.from("clients").insert(clientPayload).select().single();
  if (error) {
    console.error(error);
    showToast("No se pudo guardar el cliente.", "error");
    return;
  }
  if (data.client_type === "SCHOOL_GRADUATION") {
    const profilePayload = {
      client_id: saved.id,
      school_name: data.school_name.trim(),
      school_level: data.school_level || null,
      teacher_name: data.teacher_name || null,
      teacher_phone: data.teacher_phone || null,
      principal_name: data.principal_name || null,
      principal_phone: data.principal_phone || null,
      grade_or_class: data.grade_or_class || null,
      student_count: data.student_count ? Number(data.student_count) : null,
      last_contact_date: data.last_contact_date || null,
      next_follow_up_date: data.next_follow_up_date || null,
      follow_up_status: data.follow_up_status || "NEW_CONTACT",
      commercial_notes: data.commercial_notes || null
    };
    const { data: existing } = await supabase.from("school_profiles").select("id").eq("client_id", saved.id).maybeSingle();
    const result = existing
      ? await supabase.from("school_profiles").update(profilePayload).eq("id", existing.id)
      : await supabase.from("school_profiles").insert(profilePayload);
    if (result.error) {
      console.error(result.error);
      showToast("El cliente se guardó, pero no se pudo guardar el perfil escolar.", "error");
      return;
    }
  }
  if (afterSaveAction === "new_job") {
    window.location.href = `jobs.html?client=${saved.id}&action=new`;
    return;
  }
  modal.classList.add("hidden");
  showToast("Cliente guardado correctamente.");
  load();
});

document.querySelector("#newClientBtn")?.addEventListener("click", () => {
  openModal().catch((error) => {
    console.error(error);
    showToast("No se pudo abrir el formulario.", "error");
  });
});

document.addEventListener("click", async (event) => {
  const editId = event.target.dataset.edit;
  const deactivateId = event.target.dataset.deactivate;
  const deleteClientId = event.target.dataset.deleteClient;
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (editId) openModal(clients.find((client) => client.id === editId));
  if (deactivateId && confirm("¿Desactivar este cliente?")) {
    await supabase.from("clients").update({ is_active: false }).eq("id", deactivateId);
    showToast("Cliente desactivado.");
    load();
  }
  if (deleteClientId && confirm("¿Eliminar este cliente y todos sus trabajos, galerías, abonos y mensajes? Esta acción es para borrar datos de prueba y no se puede deshacer.")) {
    let result = await supabase.from("clients").delete().eq("id", deleteClientId);
    if (result.error) {
      await supabase.from("jobs").delete().eq("client_id", deleteClientId);
      result = await supabase.from("clients").delete().eq("id", deleteClientId);
    }
    if (result.error) {
      console.error(result.error);
      showToast("No se pudo eliminar el cliente.", "error");
      return;
    }
    showToast("Cliente y trabajos eliminados.");
    load();
  }
});

["searchInput", "typeFilter", "activeFilter"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("input", render));

requireAuth()
  .then(load)
  .catch((error) => {
    console.error(error);
    showToast("No se pudo cargar la información.", "error");
  });
