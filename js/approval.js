import { supabase } from "./supabase.js";
import { GALLERY_TYPES, getGalleryTypeLabel } from "./constants.js";
import { formatMoney } from "./formatters.js";
import { escapeHtml, getQueryParam, openInNewTab, showToast } from "./utils.js";

const token = getQueryParam("token");
const content = document.querySelector("#approvalContent");
let approvalData = null;

function galleryButton(gallery) {
  return `<button class="btn btn-secondary" data-open-url="${escapeHtml(gallery.google_photos_url)}">Ver ${getGalleryTypeLabel(gallery.gallery_type).toLowerCase()}</button>`;
}

function render() {
  const { job, client, package: pkg, school_profile: school, galleries, financial } = approvalData;
  if (job.approved_at) {
    content.innerHTML = `<h1>Este trabajo ya fue autorizado para impresión.</h1><p class="muted">Fecha de aprobación: ${new Date(job.approved_at).toLocaleString("es-DO")}</p>`;
    return;
  }
  const galleryHtml = job.job_type === "SCHOOL_GRADUATION"
    ? Object.keys(GALLERY_TYPES).map((type) => galleries.filter((gallery) => gallery.gallery_type === type).map((gallery) => `<p><strong>${getGalleryTypeLabel(type)}</strong><br>${galleryButton(gallery)}</p>`).join("")).join("")
    : galleries.map((gallery) => `<p><strong>Galería</strong><br>${galleryButton(gallery)}</p>`).join("");
  content.innerHTML = `
    <h1 class="approval-title">${escapeHtml(job.job_type === "SCHOOL_GRADUATION" ? (school?.school_name || client.name) : client.name)}</h1>
    <p class="muted">Revise cuidadosamente antes de aprobar.</p>
    <div class="grid">
      <p><strong>Trabajo:</strong><br>${escapeHtml(job.title)}</p>
      <p><strong>Paquete:</strong><br>${escapeHtml(pkg?.name || "Sin paquete")}</p>
      ${job.job_type === "SCHOOL_GRADUATION" ? `<p><strong>Nivel:</strong><br>${escapeHtml({ KINDER: "Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[school?.school_level] || "")}</p><p><strong>Curso:</strong><br>${escapeHtml(school?.grade_or_class)}</p><p><strong>Maestra:</strong><br>${escapeHtml(school?.teacher_name)}</p><p><strong>Directora:</strong><br>${escapeHtml(school?.principal_name)}</p><p><strong>Cantidad de paquetes:</strong><br>${job.package_quantity}</p><p><strong>Estudiantes:</strong><br>${school?.student_count || ""}</p>` : `<p><strong>Tipo de sesión:</strong><br>${escapeHtml(job.event_type || "Sesión de fotos")}</p>`}
    </div>
    <h2>Links para revisar</h2>
    ${galleryHtml || `<div class="empty-state">No hay galerías activas registradas.</div>`}
    <h2>Resumen</h2>
    <div class="grid">
      <p><strong>${job.job_type === "SCHOOL_GRADUATION" ? "Total" : "Precio"}:</strong><br>${formatMoney(financial.price)}</p>
      <p><strong>Abonado:</strong><br>${formatMoney(financial.total_deposited)}</p>
      <p><strong>Pendiente:</strong><br>${formatMoney(financial.remaining_balance)}</p>
    </div>
    <div class="alert alert-warning"><strong>IMPORTANTE:</strong><br>Una vez autorizado este trabajo para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá un costo extra. Por favor revise cuidadosamente toda la información antes de aprobar.</div>
    <form id="approvalForm">
      <div class="form-group"><label>Nombre de quien aprueba</label><input class="input" name="approval_name" required></div>
      <label class="form-group"><span><input type="checkbox" name="terms" required> Confirmo que revisé la información, fotos, nombres, cantidades, diseño y detalles del trabajo, y autorizo enviar a impresión. Entiendo que cualquier cambio solicitado después de esta aprobación tendrá costo adicional.</span></label>
      <button class="btn btn-primary" type="submit">${job.job_type === "SCHOOL_GRADUATION" ? "Autorizar todo para impresión" : "Autorizar para impresión"}</button>
    </form>`;
}

async function load() {
  if (!token) {
    content.innerHTML = `<div class="alert alert-error">El link de aprobación no existe o expiró.</div>`;
    return;
  }
  const { data, error } = await supabase.rpc("get_public_approval_by_token", { token });
  if (error || !data) {
    console.error(error);
    content.innerHTML = `<div class="alert alert-error">El link de aprobación no existe o expiró.</div>`;
    return;
  }
  approvalData = data;
  render();
}

document.addEventListener("click", (event) => {
  if (event.target.dataset.openUrl) openInNewTab(event.target.dataset.openUrl);
});

document.addEventListener("submit", async (event) => {
  if (!event.target.matches("#approvalForm")) return;
  event.preventDefault();
  if (!event.target.terms.checked) return showToast("Debe aceptar las condiciones antes de aprobar.", "error");
  const approvalName = event.target.approval_name.value.trim();
  if (!approvalName) return showToast("Escriba el nombre de quien aprueba.", "error");
  const { data, error } = await supabase.rpc("approve_job_by_token", { token, approval_name: approvalName });
  if (error || !data?.ok) {
    console.error(error || data);
    showToast(data?.message || "No se pudo aprobar el trabajo.", "error");
    return;
  }
  content.innerHTML = `<div class="alert alert-success"><h1>Trabajo autorizado para impresión.</h1><p>Gracias. La aprobación fue registrada correctamente.</p></div>`;
});

load();
