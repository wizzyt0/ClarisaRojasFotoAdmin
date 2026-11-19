import { requireAuth } from "./auth.js?v=20261119-assistant-role";
import { supabase } from "./supabase.js";
import { JOB_STATUSES, SCHOOL_EVENT_TYPES, getJobStatusLabel, getJobTypeLabel, getSchoolEventTypeLabel } from "./constants.js";
import { escapeHtml, formToObject, generateToken, getTokenExpirationDate, getQueryParam, showToast, openInNewTab } from "./utils.js";
import { generateAndLogWhatsAppMessage } from "./whatsapp.js";
import { formatDate, formatMoney } from "./formatters.js";

let jobs = [];
let clients = [];
let editingJob = null;
let currentUser = null;
const modal = document.querySelector("#jobModal");
const form = document.querySelector("#jobForm");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_PATTERN.test(String(value || ""));

document.querySelector("#statusFilter").insertAdjacentHTML("beforeend", Object.entries(JOB_STATUSES).map(([value, label]) => `<option value="${value}">${label}</option>`).join(""));

function renderForm(job = {}) {
  if (currentUser?.staffRole === "assistant") {
    form.innerHTML = `<div class="form-grid"><label class="form-group"><span>Título del trabajo</span><input class="input" name="title" required value="${escapeHtml(job.title)}"></label>
      <label class="form-group"><span>Fecha del evento</span><input class="input" type="date" name="event_date" value="${escapeHtml(job.event_date)}"></label>
      <label class="form-group"><span>Fecha de entrega</span><input class="input" type="date" name="delivery_date" value="${escapeHtml(job.delivery_date)}"></label></div>
      <label class="form-group"><span>Notas</span><textarea class="textarea" name="notes">${escapeHtml(job.notes)}</textarea></label>
      <button class="btn btn-primary" type="submit">Guardar cambios</button>`;
    return;
  }
  form.innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Cliente</label><select class="select" name="client_id" required><option value="">Seleccione</option>${clients.map((client) => `<option value="${client.id}" data-type="${client.client_type}" ${client.id === job.client_id ? "selected" : ""}>${escapeHtml(client.name)}</option>`).join("")}</select></div>
      <div class="form-group" id="schoolWorkTypeField"><label>Tipo de trabajo</label><select class="select" name="school_work_type">${Object.entries(SCHOOL_EVENT_TYPES).map(([value, label]) => `<option value="${value}" ${value === (job.event_type || "GRADUATION") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="form-group hidden" id="privateWorkTypeField"><label>Tipo de trabajo</label><input class="input" name="private_work_type" value="${escapeHtml(job.job_type === "PHOTO_SESSION" ? job.event_type : "")}" placeholder="Flujo particular pendiente"></div>
      <div class="form-group"><label>Título</label><input class="input" name="title" required value="${escapeHtml(job.title)}"></div>
      <div class="form-group"><label>Fecha del evento</label><input class="input" type="date" name="event_date" value="${escapeHtml(job.event_date)}"></div>
      <div class="form-group"><label>Fecha de entrega</label><input class="input" type="date" name="delivery_date" value="${escapeHtml(job.delivery_date)}"></div>
      <div class="form-group"><label>Estado</label><select class="select" name="status">${Object.entries(JOB_STATUSES).map(([value, label]) => `<option value="${value}" ${value === (job.status || "CREATED") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
    </div>
    <div class="form-group"><label>Notas</label><textarea class="textarea" name="notes">${escapeHtml(job.notes)}</textarea></div>
    <button class="btn btn-primary" type="submit">Guardar trabajo</button>`;

  const refreshTitle = () => {
    if (editingJob || form.title.value.trim()) return;
    const clientName = form.client_id.selectedOptions[0]?.textContent?.trim() || "";
    const isSchool = form.client_id.selectedOptions[0]?.dataset.type === "SCHOOL_GRADUATION";
    const workType = isSchool ? getSchoolEventTypeLabel(form.school_work_type.value) : form.private_work_type.value.trim();
    if (clientName && workType) form.title.value = `${clientName} - ${workType}`;
  };
  const toggleWorkFields = () => {
    const isSchool = form.client_id.selectedOptions[0]?.dataset.type === "SCHOOL_GRADUATION";
    document.querySelector("#schoolWorkTypeField").classList.toggle("hidden", !isSchool);
    document.querySelector("#privateWorkTypeField").classList.toggle("hidden", isSchool);
    form.school_work_type.required = isSchool;
    form.private_work_type.required = !isSchool;
    refreshTitle();
  };
  form.client_id.addEventListener("change", () => {
    form.title.value = "";
    toggleWorkFields();
  });
  form.school_work_type.addEventListener("change", () => {
    if (!editingJob) form.title.value = "";
    refreshTitle();
  });
  form.private_work_type.addEventListener("input", refreshTitle);
  toggleWorkFields();
}

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const type = document.querySelector("#typeFilter").value;
  const status = document.querySelector("#statusFilter").value;
  const rows = jobs.filter((job) => {
    const text = `${job.title} ${job.clients?.name || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!type || job.job_type === type) && (!status || job.status === status);
  });
  document.querySelector("#jobsTable").innerHTML = rows.length ? `<table class="table"><thead><tr><th>Trabajo</th><th>Cliente/Escuela</th><th>Tipo</th><th>Estado</th><th>Grupos/Paquete</th><th>Precio</th><th>Abonado</th><th>Pendiente</th><th>Entrega</th><th>Acciones</th></tr></thead><tbody>${rows.map((job) => {
    const total = (job.deposits || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const pending = Math.max(Number(job.price || 0) - total, 0);
    const groupSummary = renderJobGroups(job);
    return `<tr><td>${escapeHtml(job.title)}<br><span class="muted">${job.job_type === "SCHOOL_GRADUATION" ? getSchoolEventTypeLabel(job.event_type) : escapeHtml(job.event_type || "")}</span></td><td>${escapeHtml(job.clients?.name)}</td><td>${getJobTypeLabel(job.job_type)}</td><td><span class="badge badge-status ${job.status}">${getJobStatusLabel(job.status)}</span></td><td>${groupSummary}</td><td>${formatMoney(job.price)}</td><td>${formatMoney(total)}</td><td>${formatMoney(pending)}</td><td>${formatDate(job.delivery_date)}</td><td class="actions"><a class="btn" href="job-detail.html?id=${job.id}">Abrir</a><button class="btn" data-edit="${job.id}">Editar</button>${currentUser?.staffRole === "assistant" ? "" : `<button class="btn btn-danger" data-delete-job="${job.id}">Eliminar</button>`}</td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty-state">No hay trabajos para mostrar.</div>`;
}

function renderJobGroups(job) {
  const groups = job.school_groups || [];
  if (!groups.length) return `${escapeHtml(job.packages?.name || "Pendiente")} · ${Number(job.package_quantity || 0) > 0 ? job.package_quantity : "Pendiente"}`;
  return `<details><summary>${groups.length} grupo${groups.length === 1 ? "" : "s"}</summary><div class="job-group-summary">${groups.map((group) => `<div><strong>${escapeHtml(group.group_name)}</strong><br><span class="muted">${escapeHtml(group.teacher_name || "Sin maestra")} · ${escapeHtml(group.packages?.name || "Paquete pendiente")} · ${Number(group.package_quantity || 0) > 0 ? `${group.package_quantity} paquetes` : "Cantidad pendiente"}</span></div>`).join("")}</div></details>`;
}

async function load() {
  let jobsData;
  let error;
  let clientsData;
  if (currentUser?.staffRole === "assistant") {
    const [jobResult, allClientsResult, packagesResult, groupsResult, depositsResult, galleriesResult, activeClientsResult] = await Promise.all([
      supabase.from("assistant_jobs").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,name,is_active"),
      supabase.from("packages").select("id,name,price"),
      supabase.from("school_groups").select("*,packages(name,price)"),
      supabase.from("deposits").select("job_id,amount,deposit_date,notes,created_at"),
      supabase.from("galleries").select("id,job_id,is_active,google_photos_url"),
      supabase.from("clients").select("*").eq("is_active", true).order("name")
    ]);
    error = jobResult.error || allClientsResult.error || packagesResult.error || groupsResult.error || depositsResult.error || galleriesResult.error || activeClientsResult.error;
    const clientById = new Map((allClientsResult.data || []).map((row) => [row.id, row]));
    const packageById = new Map((packagesResult.data || []).map((row) => [row.id, row]));
    jobsData = (jobResult.data || []).map((job) => ({
      ...job,
      clients: clientById.get(job.client_id),
      packages: packageById.get(job.package_id),
      school_groups: (groupsResult.data || []).filter((group) => group.job_id === job.id),
      deposits: (depositsResult.data || []).filter((deposit) => deposit.job_id === job.id),
      galleries: (galleriesResult.data || []).filter((gallery) => gallery.job_id === job.id)
    }));
    clientsData = activeClientsResult.data;
  } else {
    const [jobsResult, clientsResult] = await Promise.all([
      supabase.from("jobs").select("id, client_id, package_id, job_type, title, event_type, event_date, delivery_date, status, price, package_quantity, notes, created_at, clients(name, is_active), packages(name), school_groups(*, packages(name, price)), deposits(amount, deposit_date, notes, created_at), galleries(id, is_active, google_photos_url)").order("created_at", { ascending: false }),
      supabase.from("clients").select("*").eq("is_active", true).order("name")
    ]);
    jobsData = jobsResult.data;
    error = jobsResult.error;
    clientsData = clientsResult.data;
  }
  if (error) throw error;
  jobs = (jobsData || []).filter((job) => job.clients?.is_active !== false);
  clients = clientsData || [];
  const clientParam = getQueryParam("client");
  const actionParam = getQueryParam("action");
  if (clientParam && !document.querySelector("#searchInput").value) {
    const client = clients.find((item) => item.id === clientParam);
    if (client) document.querySelector("#searchInput").value = client.name;
  }
  render();
  if (clientParam && actionParam === "new" && currentUser?.staffRole !== "assistant") {
    const client = clients.find((item) => item.id === clientParam);
    openModal({
      client_id: clientParam,
      job_type: client?.client_type || "SCHOOL_GRADUATION",
      event_type: client?.client_type === "SCHOOL_GRADUATION" ? "GRADUATION" : "",
      status: "CREATED",
      package_quantity: 0,
      price: 0
    }, { isNew: true });
  }
}

function openModal(job = null, { isNew = false } = {}) {
  editingJob = isNew ? null : job;
  document.querySelector("#jobModalTitle").textContent = isNew || !job ? "Nuevo trabajo" : "Editar trabajo";
  renderForm(job || { status: "CREATED", package_quantity: 0, price: 0 });
  modal.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  if (currentUser?.staffRole === "assistant") {
    if (!editingJob) return showToast("Este usuario solo puede editar trabajos existentes.", "error");
    const result = await supabase.from("jobs").update({
      title: data.title.trim(), event_date: data.event_date || null,
      delivery_date: data.delivery_date || null, notes: data.notes || null
    }).eq("id", editingJob.id);
    if (result.error) return showToast(`No se pudo guardar el trabajo: ${result.error.message}`, "error");
    modal.classList.add("hidden");
    showToast("Datos rutinarios del trabajo guardados.");
    return load();
  }
  const selectedClient = clients.find((client) => client.id === data.client_id);
  if (!selectedClient || !isUuid(selectedClient.id)) {
    return showToast("Seleccione un cliente válido antes de guardar.", "error");
  }
  const currentJobId = editingJob?.id;
  if (editingJob && !isUuid(currentJobId)) {
    return showToast("No se pudo identificar este trabajo. Cierre la ventana, recargue la página y vuelva a intentarlo.", "error");
  }
  const isSchool = selectedClient?.client_type === "SCHOOL_GRADUATION";
  if (isSchool && !data.school_work_type) return showToast("Seleccione el tipo de trabajo escolar.", "error");
  if (!isSchool && !data.private_work_type?.trim()) return showToast("El flujo para particulares queda pendiente; escriba un tipo de trabajo temporal.", "error");
  let galleryUrl = "";
  const hasActiveGallery = (editingJob?.galleries || []).some((gallery) => gallery.is_active && gallery.google_photos_url);
  if (data.status === "GALLERY_READY" && !hasActiveGallery) {
    galleryUrl = prompt("Pegue el link compartido de Google Photos para enviar al cliente por WhatsApp:");
    if (!galleryUrl) {
      showToast("Debe agregar el link de Google Photos para marcar la galería como lista.", "error");
      return;
    }
  }
  const payload = {
    client_id: selectedClient.id,
    package_id: isUuid(editingJob?.package_id) ? editingJob.package_id : null,
    job_type: isSchool ? "SCHOOL_GRADUATION" : "PHOTO_SESSION",
    title: data.title.trim(),
    event_date: data.event_date || null,
    delivery_date: data.delivery_date || null,
    status: data.status || "CREATED",
    event_type: isSchool ? data.school_work_type || null : data.private_work_type || null,
    price: Number(editingJob?.price || 0),
    package_quantity: Number(editingJob?.package_quantity || 0),
    notes: data.notes || null
  };
  if (!editingJob) {
    payload.approval_token = generateToken(48);
    payload.approval_token_expires_at = getTokenExpirationDate();
  }
  const result = editingJob
    ? await supabase.from("jobs").update(payload).eq("id", currentJobId).select().single()
    : await supabase.from("jobs").insert(payload).select().single();
  if (result.error) {
    console.error(result.error);
    return showToast(`No se pudo guardar el trabajo: ${result.error.message}`, "error");
  }
  modal.classList.add("hidden");
  if (!editingJob && getQueryParam("action") === "new") {
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }
  if (galleryUrl) {
    const galleryResult = await supabase.from("galleries").insert({
      job_id: result.data.id,
      title: isSchool ? "Galería para revisión" : "Galería principal",
      gallery_type: isSchool ? "STUDENT_GALLERY" : "GENERAL",
      google_photos_url: galleryUrl.trim(),
      notes: "Link agregado al marcar galería lista.",
      is_active: true
    });
    if (galleryResult.error) {
      console.error(galleryResult.error);
      showToast("El trabajo se guardó, pero no se pudo guardar el link de Google Photos.", "error");
      return;
    }
    const whatsappResult = await generateAndLogWhatsAppMessage(result.data.id);
    openInNewTab(whatsappResult.waMeUrl);
    showToast("Link guardado y WhatsApp generado.");
  }
  showToast("Trabajo actualizado.");
  load().catch((error) => {
    console.error(error);
    showToast("El trabajo se guardó, pero no se pudo recargar la lista.", "error");
  });
});

document.querySelector("#newJobBtn")?.addEventListener("click", () => {
  if (currentUser?.staffRole === "assistant") return;
  openModal();
});

document.addEventListener("click", async (event) => {
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (event.target.dataset.edit) openModal(jobs.find((job) => job.id === event.target.dataset.edit));
  if (currentUser?.staffRole !== "assistant" && event.target.dataset.deleteJob) {
    const job = jobs.find((item) => item.id === event.target.dataset.deleteJob);
    const confirmed = confirm(`¿Está seguro de eliminar el trabajo "${job?.title || "seleccionado"}"? También se eliminarán sus galerías, abonos, aprobaciones y mensajes.`);
    if (!confirmed) return;
    const { error } = await supabase.from("jobs").delete().eq("id", event.target.dataset.deleteJob);
    if (error) {
      console.error(error);
      showToast("No se pudo eliminar el trabajo.", "error");
      return;
    }
    showToast("Trabajo eliminado.");
    load();
  }
});
["searchInput", "typeFilter", "statusFilter"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("input", render));

requireAuth()
  .then((user) => {
    currentUser = user;
    if (user?.staffRole === "assistant") document.querySelector("#newJobBtn")?.remove();
    if (user) return load();
    return null;
  })
  .catch((error) => {
    console.error(error);
    showToast(`No se pudieron cargar los trabajos: ${error.message || "error desconocido"}`, "error");
  });
