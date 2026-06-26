import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { JOB_STATUSES, JOB_TYPES, getJobStatusLabel, getJobTypeLabel } from "./constants.js";
import { calculateJobPrice, escapeHtml, formToObject, generateToken, getQueryParam, showToast, today, openInNewTab } from "./utils.js";
import { generateAndLogWhatsAppMessage } from "./whatsapp.js";
import { formatDate, formatMoney } from "./formatters.js";

let jobs = [];
let clients = [];
let packages = [];
let editingJob = null;
const modal = document.querySelector("#jobModal");
const form = document.querySelector("#jobForm");

document.querySelector("#statusFilter").insertAdjacentHTML("beforeend", Object.entries(JOB_STATUSES).map(([value, label]) => `<option value="${value}">${label}</option>`).join(""));

function renderForm(job = {}) {
  const depositRows = (job.deposits || []).length
    ? `<table class="table"><thead><tr><th>Fecha y hora</th><th>Monto</th><th>Nota</th></tr></thead><tbody>${job.deposits.map((deposit) => `<tr><td>${formatDate(deposit.deposit_date)}${deposit.created_at ? `<br><span class="muted">${new Date(deposit.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>` : ""}</td><td>${formatMoney(deposit.amount)}</td><td>${escapeHtml(deposit.notes || "")}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty-state">Todavía no hay abonos registrados para este trabajo.</div>`;
  form.innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Cliente</label><select class="select" name="client_id" required><option value="">Seleccione</option>${clients.map((client) => `<option value="${client.id}" data-type="${client.client_type}" ${client.id === job.client_id ? "selected" : ""}>${escapeHtml(client.name)}</option>`).join("")}</select></div>
      <div class="form-group"><label>Tipo de trabajo</label><select class="select" name="job_type" required>${Object.entries(JOB_TYPES).map(([value, label]) => `<option value="${value}" ${value === (job.job_type || "PHOTO_SESSION") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="form-group"><label>Título</label><input class="input" name="title" required value="${escapeHtml(job.title)}"></div>
      <div class="form-group"><label>Tipo de evento</label><input class="input" name="event_type" value="${escapeHtml(job.event_type)}"></div>
      <div class="form-group"><label>Fecha del evento</label><input class="input" type="date" name="event_date" value="${escapeHtml(job.event_date)}"></div>
      <div class="form-group"><label>Fecha de entrega</label><input class="input" type="date" name="delivery_date" value="${escapeHtml(job.delivery_date)}"></div>
      <div class="form-group"><label>Paquete</label><select class="select" name="package_id"><option value="">Sin paquete</option>${packages.map((pkg) => `<option value="${pkg.id}" data-price="${pkg.price}" ${pkg.id === job.package_id ? "selected" : ""}>${escapeHtml(pkg.name)} - ${formatMoney(pkg.price)}</option>`).join("")}</select></div>
      <div class="form-group"><label>Cantidad de paquetes</label><input class="input" type="number" min="1" name="package_quantity" required value="${job.package_quantity || 1}"></div>
      <div class="form-group"><label>Precio</label><input class="input" type="number" min="0" step="0.01" name="price" required value="${job.price ?? 0}"></div>
      <div class="form-group"><label>Estado</label><select class="select" name="status">${Object.entries(JOB_STATUSES).map(([value, label]) => `<option value="${value}" ${value === (job.status || "CREATED") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
    </div>
    <div class="form-group"><label>Notas</label><textarea class="textarea" name="notes">${escapeHtml(job.notes)}</textarea></div>
    <div class="card">
      <h3>Abono de maestra</h3>
      <p class="muted">Opcional. Si la maestra abona dinero, registre el monto aquí para bajar el pendiente del trabajo.</p>
      <div class="form-grid">
        <div class="form-group"><label>Monto abonado</label><input class="input" type="number" min="0" step="0.01" name="teacher_deposit_amount" placeholder="0.00"></div>
        <div class="form-group"><label>Nota del abono</label><input class="input" name="teacher_deposit_note" value="Abono entregado por la maestra"></div>
      </div>
      <h4>Historial de abonos</h4>
      ${job.id ? depositRows : `<div class="empty-state">El historial aparecerá después de guardar el trabajo.</div>`}
    </div>
    <button class="btn btn-primary" type="submit">Guardar trabajo</button>`;

  const updatePrice = () => {
    const packageOption = form.package_id.selectedOptions[0];
    const packagePrice = Number(packageOption?.dataset.price || 0);
    if (packagePrice) form.price.value = calculateJobPrice(packagePrice, form.package_quantity.value, form.job_type.value);
  };
  form.client_id.addEventListener("change", () => {
    const type = form.client_id.selectedOptions[0]?.dataset.type;
    if (type) form.job_type.value = type;
    updatePrice();
  });
  form.package_id.addEventListener("change", updatePrice);
  form.package_quantity.addEventListener("input", updatePrice);
  form.job_type.addEventListener("change", updatePrice);
  updatePrice();
}

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const type = document.querySelector("#typeFilter").value;
  const status = document.querySelector("#statusFilter").value;
  const rows = jobs.filter((job) => {
    const text = `${job.title} ${job.clients?.name || ""}`.toLowerCase();
    return (!search || text.includes(search)) && (!type || job.job_type === type) && (!status || job.status === status);
  });
  document.querySelector("#jobsTable").innerHTML = rows.length ? `<table class="table"><thead><tr><th>Trabajo</th><th>Cliente/Escuela</th><th>Tipo</th><th>Estado</th><th>Paquete</th><th>Cantidad</th><th>Precio</th><th>Abonado</th><th>Pendiente</th><th>Entrega</th><th>Acciones</th></tr></thead><tbody>${rows.map((job) => {
    const total = (job.deposits || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const pending = Math.max(Number(job.price || 0) - total, 0);
    return `<tr><td>${escapeHtml(job.title)}</td><td>${escapeHtml(job.clients?.name)}</td><td>${getJobTypeLabel(job.job_type)}</td><td><span class="badge badge-status ${job.status}">${getJobStatusLabel(job.status)}</span></td><td>${escapeHtml(job.packages?.name || "")}</td><td>${job.package_quantity}</td><td>${formatMoney(job.price)}</td><td>${formatMoney(total)}</td><td>${formatMoney(pending)}</td><td>${formatDate(job.delivery_date)}</td><td class="actions"><a class="btn" href="job-detail.html?id=${job.id}">Abrir</a><button class="btn" data-edit="${job.id}">Editar</button><button class="btn btn-danger" data-delete-job="${job.id}">Eliminar</button></td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty-state">No hay trabajos para mostrar.</div>`;
}

async function load() {
  const [{ data: jobsData, error }, { data: clientsData }, { data: packagesData }] = await Promise.all([
    supabase.from("jobs").select("*, clients(name, is_active), packages(name), deposits(amount, deposit_date, notes, created_at), galleries(id, is_active, google_photos_url)").order("created_at", { ascending: false }),
    supabase.from("clients").select("*").eq("is_active", true).order("name"),
    supabase.from("packages").select("*").eq("is_active", true).order("name")
  ]);
  if (error) throw error;
  jobs = (jobsData || []).filter((job) => job.clients?.is_active !== false);
  clients = clientsData || [];
  packages = packagesData || [];
  const clientParam = getQueryParam("client");
  const actionParam = getQueryParam("action");
  if (clientParam && !document.querySelector("#searchInput").value) {
    const client = clients.find((item) => item.id === clientParam);
    if (client) document.querySelector("#searchInput").value = client.name;
  }
  render();
  if (clientParam && actionParam === "new") {
    const client = clients.find((item) => item.id === clientParam);
    openModal({
      client_id: clientParam,
      job_type: client?.client_type || "SCHOOL_GRADUATION",
      status: "CREATED",
      package_quantity: 1,
      price: 0
    });
  }
}

function openModal(job = null) {
  editingJob = job;
  document.querySelector("#jobModalTitle").textContent = job ? "Editar trabajo" : "Nuevo trabajo";
  renderForm(job || { status: "CREATED", package_quantity: 1, price: 0 });
  modal.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  if (Number(data.package_quantity) < 1 || Number(data.price) < 0) return showToast("Revise cantidad y precio.", "error");
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
    client_id: data.client_id,
    package_id: data.package_id || null,
    job_type: data.job_type,
    title: data.title.trim(),
    event_type: data.event_type || null,
    event_date: data.event_date || null,
    delivery_date: data.delivery_date || null,
    status: data.status || "CREATED",
    price: Number(data.price),
    package_quantity: Number(data.package_quantity),
    notes: data.notes || null
  };
  if (!editingJob) payload.approval_token = generateToken(48);
  const result = editingJob
    ? await supabase.from("jobs").update(payload).eq("id", editingJob.id).select().single()
    : await supabase.from("jobs").insert(payload).select().single();
  if (result.error) { console.error(result.error); return showToast("No se pudo guardar el trabajo.", "error"); }
  if (galleryUrl) {
    const galleryResult = await supabase.from("galleries").insert({
      job_id: result.data.id,
      title: data.job_type === "SCHOOL_GRADUATION" ? "Galería para revisión" : "Galería principal",
      gallery_type: data.job_type === "SCHOOL_GRADUATION" ? "STUDENT_GALLERY" : "GENERAL",
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
  const depositAmount = Number(data.teacher_deposit_amount || 0);
  if (depositAmount > 0) {
    const depositResult = await supabase.from("deposits").insert({
      job_id: result.data.id,
      amount: depositAmount,
      deposit_date: today(),
      notes: data.teacher_deposit_note || "Abono entregado por la maestra"
    });
    if (depositResult.error) {
      console.error(depositResult.error);
      showToast("El trabajo se guardó, pero no se pudo registrar el abono.", "error");
      return;
    }
  }
  modal.classList.add("hidden");
  showToast("Trabajo actualizado.");
  load();
});

document.querySelector("#newJobBtn")?.addEventListener("click", () => {
  openModal();
});

document.addEventListener("click", async (event) => {
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (event.target.dataset.edit) openModal(jobs.find((job) => job.id === event.target.dataset.edit));
  if (event.target.dataset.deleteJob) {
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
  .then(load)
  .catch((error) => {
    console.error(error);
    showToast("No se pudo cargar la información.", "error");
  });
