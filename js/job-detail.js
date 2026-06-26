import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";
import { GALLERY_TYPES, JOB_STATUSES, getGalleryTypeLabel, getJobStatusLabel, getJobTypeLabel } from "./constants.js";
import { createDeposit, deleteDeposit, getDepositsByJob } from "./deposits.js";
import { createGallery, deactivateGallery, getGalleriesByJob } from "./galleries.js";
import { generateAndLogWhatsAppMessage } from "./whatsapp.js";
import { calculateTotals, copyToClipboard, escapeHtml, formToObject, generateToken, getQueryParam, openInNewTab, showToast, today } from "./utils.js";
import { formatDate, formatDateTime, formatMoney } from "./formatters.js";

await requireAuth();

const jobId = getQueryParam("id");
let job;
let galleries = [];
let deposits = [];
let selectedWhatsappUrl = "";
let currentMessage = "";
const modal = document.querySelector("#detailModal");
const form = document.querySelector("#detailForm");

function approvalUrl() {
  return `${APP_CONFIG.appUrl.replace(/\/$/, "")}/approval.html?token=${job.approval_token}`;
}

async function loadJob() {
  const { data, error } = await supabase
    .from("jobs")
    .select("*, clients(*, school_profiles(*)), packages(*)")
    .eq("id", jobId)
    .single();
  if (error) throw error;
  job = data;
  galleries = await getGalleriesByJob(jobId);
  deposits = await getDepositsByJob(jobId);
  render();
  await loadLogs();
}

function render() {
  const totals = calculateTotals(job.price, deposits);
  const school = job.clients.school_profiles?.[0] || {};
  document.querySelector("#jobTitle").textContent = job.title;
  document.querySelector("#summaryCard").innerHTML = `
    <div class="page-header"><h2>Resumen</h2><div class="actions"><select id="statusSelect" class="select">${Object.entries(JOB_STATUSES).map(([value, label]) => `<option value="${value}" ${value === job.status ? "selected" : ""}>${label}</option>`).join("")}</select><button id="saveStatusBtn" class="btn">Cambiar estado</button><button id="regenerateTokenBtn" class="btn">Regenerar token</button><button id="revokeTokenBtn" class="btn btn-danger">Revocar token</button></div></div>
    <div class="grid">
      <p><strong>Cliente:</strong><br>${escapeHtml(job.clients.name)}</p>
      <p><strong>Tipo:</strong><br>${getJobTypeLabel(job.job_type)}</p>
      <p><strong>Estado:</strong><br><span class="badge badge-status ${job.status}">${getJobStatusLabel(job.status)}</span></p>
      <p><strong>Fecha evento:</strong><br>${formatDate(job.event_date)}</p>
      <p><strong>Fecha entrega:</strong><br>${formatDate(job.delivery_date)}</p>
      <p><strong>Paquete:</strong><br>${escapeHtml(job.packages?.name || "Sin paquete")}</p>
      <p><strong>Cantidad:</strong><br>${job.package_quantity}</p>
      <p><strong>Precio:</strong><br>${formatMoney(job.price)}</p>
      <p><strong>Total abonado:</strong><br>${formatMoney(totals.totalDeposited)}</p>
      <p><strong>Pendiente:</strong><br>${formatMoney(totals.remainingBalance)}</p>
    </div>
    <p><strong>Notas:</strong><br>${escapeHtml(job.notes || "")}</p>`;
  if (job.job_type === "SCHOOL_GRADUATION") {
    document.querySelector("#schoolCard").classList.remove("hidden");
    document.querySelector("#schoolCard").innerHTML = `<h2>Datos escolares</h2><div class="grid">
      <p><strong>Escuela:</strong><br>${escapeHtml(school.school_name || job.clients.name)}</p>
      <p><strong>Nivel:</strong><br>${escapeHtml({ KINDER: "Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[school.school_level] || "")}</p>
      <p><strong>Maestra:</strong><br>${escapeHtml(school.teacher_name)}<br>${escapeHtml(school.teacher_phone)}</p>
      <p><strong>Directora:</strong><br>${escapeHtml(school.principal_name)}<br>${escapeHtml(school.principal_phone)}</p>
      <p><strong>Curso:</strong><br>${escapeHtml(school.grade_or_class)}</p>
      <p><strong>Estudiantes:</strong><br>${school.student_count || ""}</p>
    </div>`;
  }
  renderGalleries();
  renderDeposits();
  renderApproval();
  renderPhones();
  document.querySelector("#statusSelect")?.addEventListener("change", async (event) => {
    if (event.target.value !== "GALLERY_READY") return;
    try {
      const canContinue = await requestGalleryLinkIfNeeded("GALLERY_READY");
      if (!canContinue) event.target.value = job.status;
    } catch (error) {
      console.error(error);
      showToast(error.message || "No se pudo guardar el link de Google Photos.", "error");
      event.target.value = job.status;
    }
  });
}

function renderPhones() {
    const school = job.clients.school_profiles?.[0] || {};
  const phones = [
    ["Teléfono principal", job.clients.phone],
    ["Maestra", school.teacher_phone],
    ["Directora", school.principal_phone]
  ].filter(([, phone]) => phone);
  document.querySelector("#phoneChoice").innerHTML = `<div class="form-group"><label>Número para WhatsApp</label><select id="whatsappPhone" class="select">${phones.map(([label, phone]) => `<option value="${escapeHtml(phone)}">${label}: ${escapeHtml(phone)}</option>`).join("")}</select></div>`;
}

function renderGalleries() {
  document.querySelector("#galleriesList").innerHTML = galleries.length ? `<table class="table"><thead><tr><th>Título</th><th>Tipo</th><th>Link</th><th>Enviada</th><th>Acciones</th></tr></thead><tbody>${galleries.map((gallery) => `<tr><td>${escapeHtml(gallery.title)}<br><span class="muted">${gallery.is_active ? "Activa" : "Inactiva"}</span></td><td>${getGalleryTypeLabel(gallery.gallery_type)}</td><td><a href="${escapeHtml(gallery.google_photos_url)}" target="_blank" rel="noopener">Abrir galería</a></td><td>${formatDateTime(gallery.sent_at)}</td><td class="actions"><button class="btn btn-danger" data-deactivate-gallery="${gallery.id}">Desactivar</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">No hay galerías registradas.</div>`;
}

function renderDeposits() {
  document.querySelector("#depositsList").innerHTML = deposits.length ? `<table class="table"><thead><tr><th>Fecha</th><th>Monto</th><th>Nota</th><th>Acciones</th></tr></thead><tbody>${deposits.map((deposit) => `<tr><td>${formatDate(deposit.deposit_date)}</td><td>${formatMoney(deposit.amount)}</td><td>${escapeHtml(deposit.notes)}</td><td><button class="btn btn-danger" data-delete-deposit="${deposit.id}">Eliminar</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">No hay abonos registrados.</div>`;
}

function renderApproval() {
  document.querySelector("#approvalCard").innerHTML = `<h2>Aprobación</h2><div class="grid">
    <p><strong>Link público:</strong><br><a href="${approvalUrl()}" target="_blank" rel="noopener">${approvalUrl()}</a></p>
    <p><strong>Estado:</strong><br>${job.approved_at ? "Aprobado" : "Pendiente"}</p>
    <p><strong>Fecha:</strong><br>${formatDateTime(job.approved_at)}</p>
    <p><strong>Nombre:</strong><br>${escapeHtml(job.approval_name)}</p>
    <p><strong>Condiciones aceptadas:</strong><br>${job.approval_terms_accepted ? "Sí" : "No"}</p>
    <p><strong>Token revocado:</strong><br>${job.approval_revoked_at ? "Sí" : "No"}</p>
  </div>`;
}

function openGalleryForm() {
  document.querySelector("#detailModalTitle").textContent = "Agregar galería";
  form.innerHTML = `<div class="form-grid"><div class="form-group"><label>Título</label><input class="input" name="title" required></div><div class="form-group"><label>Tipo</label><select class="select" name="gallery_type">${Object.entries(GALLERY_TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div></div><div class="form-group"><label>Link de Google Photos</label><input class="input" name="google_photos_url" required></div><div class="form-group"><label>Notas</label><textarea class="textarea" name="notes"></textarea></div><input type="hidden" name="form_type" value="gallery"><button class="btn btn-primary" type="submit">Guardar galería</button>`;
  modal.classList.remove("hidden");
}

function openDepositForm() {
  document.querySelector("#detailModalTitle").textContent = "Agregar abono";
  form.innerHTML = `<div class="form-grid"><div class="form-group"><label>Monto abonado</label><input class="input" type="number" min="0.01" step="0.01" name="amount" required></div><div class="form-group"><label>Fecha del abono</label><input class="input" type="date" name="deposit_date" value="${today()}" required></div></div><div class="form-group"><label>Nota</label><textarea class="textarea" name="notes"></textarea></div><input type="hidden" name="form_type" value="deposit"><button class="btn btn-primary" type="submit">Guardar abono</button>`;
  modal.classList.remove("hidden");
}

async function loadLogs() {
  const { data } = await supabase.from("message_logs").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  document.querySelector("#messageLogs").innerHTML = (data || []).length ? `<table class="table"><tbody>${data.map((log) => `<tr><td>${formatDateTime(log.created_at)}</td><td>${escapeHtml(log.message_type)}</td><td><a href="${escapeHtml(log.wa_me_url)}" target="_blank" rel="noopener">Abrir</a></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">No hay mensajes generados.</div>`;
}

async function requestGalleryLinkIfNeeded(nextStatus) {
  if (nextStatus !== "GALLERY_READY") return true;
  const hasActiveGallery = galleries.some((gallery) => gallery.is_active && gallery.google_photos_url);
  if (hasActiveGallery) return true;

  const galleryUrl = prompt("Pegue el link compartido de Google Photos para enviar al cliente por WhatsApp:");
  if (!galleryUrl) {
    showToast("Debe agregar el link de Google Photos para marcar la galería como lista.", "error");
    return false;
  }

  await createGallery(jobId, {
    title: job.job_type === "SCHOOL_GRADUATION" ? "Galería para revisión" : "Galería principal",
    gallery_type: job.job_type === "SCHOOL_GRADUATION" ? "STUDENT_GALLERY" : "GENERAL",
    google_photos_url: galleryUrl.trim(),
    notes: "Link agregado al marcar galería lista.",
    is_active: true
  });
  galleries = await getGalleriesByJob(jobId);
  showToast("Link de Google Photos guardado.");
  return true;
}

async function offerWhatsappAfterGalleryReady(nextStatus) {
  if (nextStatus !== "GALLERY_READY") return;
  const phone = document.querySelector("#whatsappPhone")?.value;
  const result = await generateAndLogWhatsAppMessage(jobId, phone);
  currentMessage = result.message;
  selectedWhatsappUrl = result.waMeUrl;
  document.querySelector("#whatsappMessage").value = currentMessage;
  showToast("Mensaje de WhatsApp generado.");
  await loadLogs();
  openInNewTab(selectedWhatsappUrl);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  try {
    if (data.form_type === "gallery") await createGallery(jobId, { title: data.title, gallery_type: data.gallery_type, google_photos_url: data.google_photos_url, notes: data.notes || null, is_active: true });
    if (data.form_type === "deposit") await createDeposit(jobId, { amount: Number(data.amount), deposit_date: data.deposit_date, notes: data.notes || null });
    modal.classList.add("hidden");
    showToast(data.form_type === "deposit" ? "Abono registrado." : "Galería guardada.");
    loadJob();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo guardar la información.", "error");
  }
});

document.addEventListener("click", async (event) => {
  try {
    if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
    if (event.target.matches("#newGalleryBtn")) openGalleryForm();
    if (event.target.matches("#newDepositBtn")) openDepositForm();
    if (event.target.matches("#copyApprovalBtn")) copyToClipboard(approvalUrl());
    if (event.target.matches("#openApprovalBtn")) openInNewTab(approvalUrl());
    if (event.target.matches("#deleteJobBtn")) {
      const confirmed = confirm(`¿Está seguro de eliminar el trabajo "${job.title}"? También se eliminarán sus galerías, abonos, aprobaciones y mensajes.`);
      if (!confirmed) return;
      const { error } = await supabase.from("jobs").delete().eq("id", jobId);
      if (error) {
        console.error(error);
        showToast("No se pudo eliminar el trabajo.", "error");
        return;
      }
      showToast("Trabajo eliminado.");
      window.location.href = "jobs.html";
      return;
    }
    if (event.target.matches("#saveStatusBtn")) {
      const nextStatus = document.querySelector("#statusSelect").value;
      const canContinue = await requestGalleryLinkIfNeeded(nextStatus);
      if (!canContinue) return;
      await supabase.from("jobs").update({ status: nextStatus }).eq("id", jobId);
      showToast("Trabajo actualizado.");
      await loadJob();
      await offerWhatsappAfterGalleryReady(nextStatus);
    }
    if (event.target.matches("#regenerateTokenBtn") && confirm("¿Regenerar el token de aprobación?")) {
      await supabase.from("jobs").update({ approval_token: generateToken(48), approval_revoked_at: null }).eq("id", jobId);
      showToast("Token regenerado.");
      loadJob();
    }
    if (event.target.matches("#revokeTokenBtn") && confirm("¿Revocar este link de aprobación?")) {
      await supabase.from("jobs").update({ approval_revoked_at: new Date().toISOString() }).eq("id", jobId);
      showToast("Token revocado.");
      loadJob();
    }
    if (event.target.dataset.deactivateGallery) {
      await deactivateGallery(event.target.dataset.deactivateGallery);
      showToast("Galería desactivada.");
      loadJob();
    }
    if (event.target.dataset.deleteDeposit && confirm("¿Eliminar este abono?")) {
      await deleteDeposit(event.target.dataset.deleteDeposit);
      showToast("Abono eliminado.");
      loadJob();
    }
    if (event.target.matches("#generateWhatsappBtn")) {
      const phone = document.querySelector("#whatsappPhone")?.value;
      const result = await generateAndLogWhatsAppMessage(jobId, phone);
      currentMessage = result.message;
      selectedWhatsappUrl = result.waMeUrl;
      document.querySelector("#whatsappMessage").value = currentMessage;
      showToast("Mensaje generado.");
      loadLogs();
      loadJob();
    }
    if (event.target.matches("#copyWhatsappBtn") && currentMessage) copyToClipboard(currentMessage);
    if (event.target.matches("#openWhatsappBtn") && selectedWhatsappUrl) openInNewTab(selectedWhatsappUrl);
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo completar la acción.", "error");
  }
});

if (!jobId) {
  document.querySelector(".container").innerHTML = `<div class="alert alert-error">No se encontró el trabajo.</div>`;
} else {
  loadJob().catch((error) => { console.error(error); showToast("No se pudo cargar la información.", "error"); });
}
