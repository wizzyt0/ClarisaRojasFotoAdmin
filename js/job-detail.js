import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";
import { GALLERY_TYPES, JOB_STATUSES, SCHOOL_EVENT_PACKAGE_TYPES, getGalleryTypeLabel, getJobStatusLabel, getJobTypeLabel } from "./constants.js";
import { getCatalogFileUrl } from "./catalog.js";
import { createDeposit, deleteDeposit, getDepositsByJob } from "./deposits.js";
import { createGallery, deactivateGallery, getGalleriesByJob } from "./galleries.js";
import { ensureDefaultPrintItems, getPrintItemStatusLabel, getPrintItemTypeLabel, updatePrintItem } from "./print-items.js";
import { R2_FILE_TYPES, R2_LINK_TYPES, createR2File, createR2ShareLink, deleteR2File, getAdminFileUrl, getR2FilesByJob, getR2ShareLinksByJob, revokeR2ShareLink, uploadR2File } from "./r2-files.js";
import { createSchoolGroup, deleteSchoolGroup, getSchoolGroupsByJob, updateSchoolGroup } from "./school-groups.js";
import { buildWhatsAppUrl, generateAndLogWhatsAppMessage } from "./whatsapp.js";
import { calculateTotals, copyToClipboard, escapeHtml, formToObject, generateToken, getQueryParam, openInNewTab, showToast, today } from "./utils.js";
import { formatDate, formatDateTime, formatMoney } from "./formatters.js";

await requireAuth();

const jobId = getQueryParam("id");
let job;
let galleries = [];
let deposits = [];
let r2Files = [];
let r2ShareLinks = [];
let printItems = [];
let schoolGroups = [];
let packages = [];
let selectedWhatsappUrl = "";
let currentMessage = "";
const modal = document.querySelector("#detailModal");
const form = document.querySelector("#detailForm");

function approvalUrl() {
  return `${APP_CONFIG.appUrl.replace(/\/$/, "")}/approval.html?token=${job.approval_token}`;
}

function printItemApprovalUrl(item) {
  return `${APP_CONFIG.appUrl.replace(/\/$/, "")}/approval.html?item_token=${item.approval_token}`;
}

function r2ShareUrl(link) {
  const baseUrl = (APP_CONFIG.r2WorkerUrl || "").replace(/\/$/, "");
  const path = link.link_type === "PRINT_DOWNLOAD" ? "download" : "preview";
  return `${baseUrl}/${path}?token=${link.token}`;
}

function defaultR2Expiry(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const DELIVERABLES = [
  { label: "Galería", galleryTypes: ["GENERAL", "STUDENT_GALLERY"], r2Types: ["TEACHER_PREVIEW"] },
  { label: "Foto grupal", galleryTypes: ["GROUP_PHOTO"], r2Types: [] },
  { label: "Carpeta", galleryTypes: ["DOCUMENTATION_FOLDER"], r2Types: [] },
  { label: "Diploma", galleryTypes: ["DIPLOMA"], r2Types: [] },
  { label: "Alta calidad", galleryTypes: [], r2Types: ["PRINT_HIGH_RES"] }
];

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "Peso no registrado";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / (1024 ** index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
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
  r2Files = await getR2FilesByJob(jobId);
  r2ShareLinks = await getR2ShareLinksByJob(jobId);
  schoolGroups = job.job_type === "SCHOOL_GRADUATION" ? await ensureSchoolGroups() : [];
  printItems = job.job_type === "SCHOOL_GRADUATION" ? await ensureGroupPrintItems() : [];
  const { data: packagesData, error: packagesError } = await supabase.from("packages").select("*").eq("is_active", true).order("name");
  if (packagesError) throw packagesError;
  packages = packagesData || [];
  render();
  await loadLogs();
}

async function ensureSchoolGroups() {
  return getSchoolGroupsByJob(jobId);
}

async function ensureGroupPrintItems() {
  if (!schoolGroups.length) return [];
  let items = printItems.length ? printItems : [];
  for (const group of schoolGroups) {
    items = await ensureDefaultPrintItems(jobId, group.id);
  }
  return items;
}

function render() {
  const totals = calculateTotals(job.price, deposits);
  const school = job.clients.school_profiles?.[0] || {};
  const groupPackageTotal = schoolGroups.reduce((sum, group) => sum + Number(group.package_quantity || 0), 0);
  const packageTotal = groupPackageTotal || Number(job.package_quantity || 0);
  document.querySelector("#jobTitle").textContent = job.title;
  document.querySelector("#summaryCard").innerHTML = `
    <div class="page-header"><h2>Resumen</h2><div class="actions"><select id="statusSelect" class="select">${Object.entries(JOB_STATUSES).map(([value, label]) => `<option value="${value}" ${value === job.status ? "selected" : ""}>${label}</option>`).join("")}</select><button id="saveStatusBtn" class="btn">Cambiar estado</button><button id="regenerateTokenBtn" class="btn">Regenerar token</button><button id="revokeTokenBtn" class="btn btn-danger">Revocar token</button></div></div>
    <div class="grid">
      <p><strong>Cliente:</strong><br>${escapeHtml(job.clients.name)}</p>
      <p><strong>Tipo:</strong><br>${getJobTypeLabel(job.job_type)}</p>
      <p><strong>Estado:</strong><br><span class="badge badge-status ${job.status}">${getJobStatusLabel(job.status)}</span></p>
      <p><strong>Fecha evento:</strong><br>${formatDate(job.event_date)}</p>
      <p><strong>Fecha entrega:</strong><br>${formatDate(job.delivery_date)}</p>
      <p><strong>Paquetes:</strong><br>${schoolGroups.length ? "Por grupo" : escapeHtml(job.packages?.name || "Pendiente de selección")}</p>
      <p><strong>Cantidad total:</strong><br>${packageTotal > 0 ? `${packageTotal} paquetes` : "Pendiente"}</p>
      <p><strong>Precio:</strong><br>${formatMoney(job.price)}</p>
      <p><strong>Total abonado:</strong><br>${formatMoney(totals.totalDeposited)}</p>
      <p><strong>Pendiente:</strong><br>${formatMoney(totals.remainingBalance)}</p>
    </div>
    <p><strong>Notas:</strong><br>${escapeHtml(job.notes || "")}</p>
    ${renderDeliverablesSummary()}`;
  if (job.job_type === "SCHOOL_GRADUATION") {
    document.querySelector("#schoolCard").classList.remove("hidden");
    document.querySelector("#schoolCard").innerHTML = `<div class="page-header"><h2>Datos escolares</h2><button id="newSchoolGroupBtn" class="btn btn-primary">Agregar grupo</button></div><div class="grid">
      <p><strong>Escuela:</strong><br>${escapeHtml(school.school_name || job.clients.name)}</p>
      <p><strong>Nivel:</strong><br>${escapeHtml({ KINDER: "Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[school.school_level] || "")}</p>
      <p><strong>WhatsApp contacto:</strong><br>${escapeHtml(school.contact_phone || school.teacher_phone)}<br>${escapeHtml(school.contact_email || "")}</p>
      <p><strong>Directora:</strong><br>${escapeHtml(school.principal_name)}<br>${escapeHtml(school.principal_phone)}</p>
    </div><h3>Grupos</h3><div class="group-list">${schoolGroups.length ? schoolGroups.map((group) => `<article class="group-card"><div class="group-card-top"><div><strong>${escapeHtml(group.group_name)}</strong><span>${escapeHtml(group.teacher_name || "Sin maestra")}</span></div><span class="badge">${Number(group.package_quantity || 0) > 0 ? `${group.package_quantity} paquetes` : "Pendiente"}</span></div><div class="group-card-body"><p><strong>WhatsApp:</strong><br>${escapeHtml(group.teacher_phone || "Sin WhatsApp")}</p><p><strong>Paquete:</strong><br>${escapeHtml(group.packages?.name || "Pendiente")}</p><p><strong>Total:</strong><br>${formatMoney(group.price || 0)}</p></div><div class="actions"><button class="btn" data-edit-group="${group.id}">Editar grupo</button><button class="btn btn-danger" data-delete-group="${group.id}">Eliminar</button></div></article>`).join("") : `<div class="empty-state">Agregue los grupos manualmente, por ejemplo 6to A, 6to B o Kinder 3.</div>`}</div>`;
  }
  renderPrintItems();
  renderGalleries();
  renderR2Files();
  renderR2ShareLinks();
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
  setupR2Dropzone();
}

function deliverableState(deliverable) {
  const hasGallery = galleries.some((gallery) => gallery.is_active && deliverable.galleryTypes.includes(gallery.gallery_type));
  const hasFile = r2Files.some((file) => deliverable.r2Types.includes(file.file_type));
  if (!hasGallery && !hasFile) return { label: "Pendiente", className: "missing" };
  if (job.approved_at) return { label: "Aprobado", className: "approved" };
  return { label: "Esperando aprobación", className: "waiting" };
}

function renderDeliverablesSummary() {
  if (printItems.length) {
    return `<div class="deliverables"><h3>Piezas de impresión</h3><div class="deliverable-grid">${printItems.map((item) => `<div class="deliverable ${printItemClass(item.status)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(statusText(item))}</span></div>`).join("")}</div></div>`;
  }
  return `<div class="deliverables"><h3>Entregables</h3><div class="deliverable-grid">${DELIVERABLES.map((item) => {
    const state = deliverableState(item);
    return `<div class="deliverable ${state.className}"><strong>${item.label}</strong><span>${state.label}</span></div>`;
  }).join("")}</div></div>`;
}

function printItemClass(status) {
  if (["APPROVED_FOR_PRINT", "PRINTING", "PRINTED", "DELIVERED"].includes(status)) return "approved";
  if (["SENT_FOR_APPROVAL", "READY_FOR_REVIEW", "CATALOG_SELECTED"].includes(status)) return "waiting";
  if (status === "CHANGES_REQUESTED") return "changes";
  return "missing";
}

function renderPrintItems() {
  const card = document.querySelector("#printItemsCard");
  if (!printItems.length) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  const groupsToRender = schoolGroups.length ? schoolGroups : [{ id: null, group_name: "Trabajo" }];
  card.innerHTML = `<div class="page-header"><h2>Piezas por grupo</h2></div>${groupsToRender.map((group) => {
    const items = printItems
      .filter((item) => (group.id ? item.group_id === group.id : !item.group_id))
      .sort((a, b) => printItemStep(a.item_type).number - printItemStep(b.item_type).number);
    return `<section class="group-workflow"><div class="group-workflow-header"><div><h3>${escapeHtml(group.group_name)}</h3><p class="muted">${escapeHtml(group.teacher_name || "Sin maestra")}${group.teacher_phone ? ` · WhatsApp ${escapeHtml(group.teacher_phone)}` : ""}</p></div>${renderGroupFinancialSummary(group)}</div><div class="print-item-grid">${items.map(renderPrintItemCard).join("")}</div></section>`;
  }).join("")}`;

  const select = document.querySelector("#r2PrintItem");
  if (select) {
    const uploadableItems = printItems.filter((item) => !["PHOTO_PACKAGE", "DIPLOMA", "FOLDER_OPTION"].includes(item.item_type));
    select.innerHTML = uploadableItems.length ? uploadableItems.map((item) => {
      const group = schoolGroups.find((entry) => entry.id === item.group_id);
      return `<option value="${item.id}">${escapeHtml(group ? `${group.group_name} · ${item.title}` : item.title)}</option>`;
    }).join("") : `<option value="">Sin piezas con preview</option>`;
  }
  hydrateCatalogThumbs();
  hydrateR2Thumbnails();
  setupItemDropzones();
}

function renderGroupFinancialSummary(group) {
  const groupPrice = Number(group.price || 0);
  const groupDeposits = deposits
    .filter((deposit) => deposit.group_id === group.id)
    .reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const pending = Math.max(groupPrice - groupDeposits, 0);
  return `<div class="group-finance-strip">
    <div><span>Paquete</span><strong>${escapeHtml(group.packages?.name || "Pendiente")}</strong></div>
    <div><span>Cantidad</span><strong>${Number(group.package_quantity || 0) > 0 ? `${group.package_quantity}` : "Pendiente"}</strong></div>
    <div><span>Total</span><strong>${formatMoney(groupPrice)}</strong></div>
    <div><span>Abonos maestra</span><strong>${formatMoney(groupDeposits)}</strong></div>
    <div><span>Pendiente</span><strong>${formatMoney(pending)}</strong></div>
    <div class="group-finance-action"><button class="btn" data-edit-group="${group.id}" type="button">Editar paquete/cantidad</button></div>
  </div>`;
}

function renderPrintItemCard(item) {
  const files = r2Files.filter((file) => file.print_item_id === item.id);
  const previewCount = files.filter((file) => file.file_type === "TEACHER_PREVIEW").length;
  const step = printItemStep(item.item_type);
  const isCatalogOnly = ["PHOTO_PACKAGE", "DIPLOMA", "FOLDER_OPTION"].includes(item.item_type);
  const actionLabel = isCatalogOnly ? "Enviar catálogo por WhatsApp" : "Enviar revisión por WhatsApp";
  return `<article class="print-item-card ${printItemClass(item.status)}">
    <div class="step-heading"><span class="step-number">${step.number}</span><div><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.description)}</span></div></div>
    <span class="badge">${statusText(item)}</span>
    ${renderSelectedVisual(item, files)}
    ${isCatalogOnly ? "" : `<p class="muted">Previews subidos: ${previewCount}</p><div class="mini-dropzone" tabindex="0" data-item-dropzone="${item.id}" data-file-type="TEACHER_PREVIEW"><strong>Subir preview</strong><span>Arrastre aquí o haga clic</span><input type="file" multiple hidden data-item-file-input="${item.id}" data-file-type="TEACHER_PREVIEW"></div>`}
    ${item.client_notes ? `<div class="review-note"><strong>Observaciones de la maestra:</strong><br>${escapeHtml(item.client_notes)}</div>` : ""}
    <div class="actions"><button class="btn btn-primary" data-send-print-item="${item.id}">${actionLabel}</button></div>
  </article>`;
}

function printItemStep(itemType) {
  const steps = {
    PHOTO_PACKAGE: { number: 1, title: "Paquete de fotos", description: "Enviar catálogo para que la maestra elija paquete y cantidad." },
    DIPLOMA: { number: 2, title: "Diploma", description: "Enviar catálogo filtrado por nivel escolar." },
    FOLDER_OPTION: { number: 3, title: "Carpeta", description: "Enviar catálogo para que la maestra elija carpeta." },
    GROUP_PHOTO: { number: 4, title: "Foto grupal", description: "Subir preview personalizado cuando esté listo." },
    STUDENT_GALLERY: { number: 5, title: "Galería de niños", description: "Subir preview o galería para revisión." }
  };
  return steps[itemType] || { number: 9, title: getPrintItemTypeLabel(itemType), description: "Seguimiento de pieza." };
}

function statusText(item) {
  if (item.item_type === "PHOTO_PACKAGE" && !item.selected_file_id) return "Maestra no ha seleccionado paquete ni cantidad";
  if (item.item_type === "DIPLOMA" && !item.selected_file_id) return "Maestra no ha seleccionado diploma";
  if (item.item_type === "FOLDER_OPTION" && !item.selected_file_id) return "Maestra no ha seleccionado carpeta";
  return getPrintItemStatusLabel(item.status);
}

function renderSelectedVisual(item, files) {
  const latestPreview = files.find((file) => file.file_type === "TEACHER_PREVIEW" && String(file.content_type || "").startsWith("image/"));
  if (latestPreview) {
    return `<div class="selected-visual"><span class="selection-label">Preview personalizado</span><button class="catalog-preview-large" data-preview-r2-file="${latestPreview.id}" type="button"><span data-r2-thumb="${latestPreview.id}">PREVIEW</span></button><p>${escapeHtml(latestPreview.file_name)}</p></div>`;
  }
  if (item.selected_file_id && item.item_type === "DIPLOMA") {
    return `<div class="selected-visual"><span class="selection-label">Diploma seleccionado</span><button class="catalog-preview-large" data-open-catalog-file="diploma_templates:${item.selected_file_id}" type="button"><span data-catalog-thumb="diploma_templates:${item.selected_file_id}">DIPLOMA</span></button><p>${escapeHtml(item.notes || "")}</p></div>`;
  }
  if (item.selected_file_id && item.item_type === "PHOTO_PACKAGE") {
    return `<div class="selected-visual"><span class="selection-label">Paquete seleccionado</span><button class="catalog-preview-large" data-open-catalog-file="package_images:${item.selected_file_id}" type="button"><span data-catalog-thumb="package_images:${item.selected_file_id}">PAQUETE</span></button><p>${escapeHtml(item.notes || "")}</p></div>`;
  }
  if (item.selected_file_id && item.item_type === "FOLDER_OPTION") {
    return `<div class="selected-visual"><span class="selection-label">Carpeta seleccionada</span><button class="catalog-preview-large" data-open-catalog-file="folder_templates:${item.selected_file_id}" type="button"><span data-catalog-thumb="folder_templates:${item.selected_file_id}">CARPETA</span></button><p>${escapeHtml(item.notes || "")}</p></div>`;
  }
  if (item.item_type === "PHOTO_PACKAGE") return `<div class="empty-state compact-empty">Maestra no ha seleccionado paquete ni cantidad.</div>`;
  if (item.item_type === "DIPLOMA") return `<div class="empty-state compact-empty">Maestra no ha seleccionado diploma.</div>`;
  if (item.item_type === "FOLDER_OPTION") return `<div class="empty-state compact-empty">Maestra no ha seleccionado carpeta.</div>`;
  return `<div class="empty-state compact-empty">Sin selección o preview</div>`;
}

function setupR2Dropzone() {
  const dropzone = document.querySelector("#r2Dropzone");
  const input = document.querySelector("#r2FileInput");
  if (!dropzone || !input || dropzone.dataset.ready) return;
  dropzone.dataset.ready = "true";
  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") input.click();
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    await uploadSelectedR2Files(Array.from(event.dataTransfer.files || []));
  });
  input.addEventListener("change", async () => {
    await uploadSelectedR2Files(Array.from(input.files || []));
    input.value = "";
  });
}

async function uploadSelectedR2Files(files) {
  if (!files.length) return;
  const fileType = document.querySelector("#r2UploadType")?.value || "TEACHER_PREVIEW";
  const printItemId = document.querySelector("#r2PrintItem")?.value || null;
  const status = document.querySelector("#r2UploadStatus");
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (status) status.textContent = `Subiendo ${index + 1} de ${files.length}: ${file.name}`;
      await uploadR2File(jobId, fileType, file, printItemId);
    }
    if (status) status.textContent = "";
    showToast(files.length === 1 ? "Archivo subido a R2." : "Archivos subidos a R2.");
    await loadJob();
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "";
    showToast(error.message || "No se pudo subir el archivo.", "error");
  }
}

function setupItemDropzones() {
  document.querySelectorAll("[data-item-dropzone]").forEach((dropzone) => {
    if (dropzone.dataset.ready) return;
    dropzone.dataset.ready = "true";
    const itemId = dropzone.dataset.itemDropzone;
    const fileType = dropzone.dataset.fileType || "TEACHER_PREVIEW";
    const input = document.querySelector(`[data-item-file-input="${itemId}"][data-file-type="${fileType}"]`);
    dropzone.addEventListener("click", () => input?.click());
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") input?.click();
    });
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      await uploadPrintItemFiles(itemId, fileType, Array.from(event.dataTransfer.files || []));
    });
  });
}

async function uploadPrintItemFiles(itemId, fileType, files) {
  if (!files.length) return;
  try {
    for (const file of files) await uploadR2File(jobId, fileType, file, itemId);
    showToast(files.length === 1 ? "Archivo subido a la pieza." : "Archivos subidos a la pieza.");
    await loadJob();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo subir el archivo.", "error");
  }
}

async function recalculateJobFromGroups() {
  const groups = await getSchoolGroupsByJob(jobId);
  const totalPrice = groups.reduce((sum, group) => sum + Number(group.price || 0), 0);
  const totalQuantity = groups.reduce((sum, group) => sum + Number(group.package_quantity || 0), 0);
  await supabase.from("jobs").update({ price: totalPrice, package_quantity: totalQuantity }).eq("id", jobId);
}

function renderPhones() {
    const school = job.clients.school_profiles?.[0] || {};
  const phones = [
    ["Teléfono principal", job.clients.phone],
    ["Contacto escuela", school.contact_phone || school.teacher_phone],
    ["Directora", school.principal_phone]
  ].filter(([, phone]) => phone);
  document.querySelector("#phoneChoice").innerHTML = `<div class="form-group"><label>Número para WhatsApp</label><select id="whatsappPhone" class="select">${phones.map(([label, phone]) => `<option value="${escapeHtml(phone)}">${label}: ${escapeHtml(phone)}</option>`).join("")}</select></div>`;
}

function renderGalleries() {
  const teacherPreviewFiles = r2Files.filter((file) => file.file_type === "TEACHER_PREVIEW");
  const googlePhotosHtml = galleries.length ? `<h3>Google Photos</h3><div class="table-wrap"><table class="table"><thead><tr><th>Título</th><th>Tipo</th><th>Link</th><th>Enviada</th><th>Acciones</th></tr></thead><tbody>${galleries.map((gallery) => `<tr><td>${escapeHtml(gallery.title)}<br><span class="muted">${gallery.is_active ? "Activa" : "Inactiva"}</span></td><td>${getGalleryTypeLabel(gallery.gallery_type)}</td><td><a href="${escapeHtml(gallery.google_photos_url)}" target="_blank" rel="noopener">Abrir galería</a></td><td>${formatDateTime(gallery.sent_at)}</td><td class="actions"><button class="btn btn-danger" data-deactivate-gallery="${gallery.id}">Desactivar</button></td></tr>`).join("")}</tbody></table></div>` : "";
  const r2GalleryHtml = teacherPreviewFiles.length ? `<h3>Preview maestra en R2</h3><div class="file-gallery">${teacherPreviewFiles.map((file) => {
    const isImage = String(file.content_type || "").startsWith("image/");
    return `<article class="file-tile"><button class="file-preview" data-preview-r2-file="${file.id}" type="button">${isImage ? `<span class="file-thumb" data-r2-thumb="${file.id}"></span>` : `<span class="file-icon">${escapeHtml((file.file_name || "").split(".").pop() || "FILE")}</span>`}</button><div class="file-meta"><strong>${escapeHtml(file.file_name)}</strong><span>${formatFileSize(file.size_bytes)}</span><span>${formatDateTime(file.created_at)}</span></div><div class="actions"><button class="btn" data-open-r2-file="${file.id}">Abrir</button></div></article>`;
  }).join("")}</div>` : "";
  document.querySelector("#galleriesList").innerHTML = googlePhotosHtml || r2GalleryHtml ? `${r2GalleryHtml}${googlePhotosHtml}` : `<div class="empty-state">No hay galerías registradas. Puede subir previews en Archivos R2 o agregar un link de Google Photos.</div>`;
  hydrateR2Thumbnails();
}

function renderR2Files() {
  const previewCount = r2Files.filter((file) => file.file_type === "TEACHER_PREVIEW").length;
  const printCount = r2Files.filter((file) => file.file_type === "PRINT_HIGH_RES").length;
  document.querySelector("#r2FilesList").innerHTML = r2Files.length ? `<div class="r2-counts"><span class="badge">Preview maestra: ${previewCount}</span><span class="badge">Alta calidad imprenta: ${printCount}</span></div><div class="file-gallery">${r2Files.map((file) => {
    const isImage = String(file.content_type || "").startsWith("image/");
    return `<article class="file-tile"><button class="file-preview" data-preview-r2-file="${file.id}" type="button">${isImage ? `<span class="file-thumb" data-r2-thumb="${file.id}"></span>` : `<span class="file-icon">${escapeHtml((file.file_name || "").split(".").pop() || "FILE")}</span>`}</button><div class="file-meta"><strong>${escapeHtml(file.file_name)}</strong><span>${R2_FILE_TYPES[file.file_type] || file.file_type}</span><span>${formatFileSize(file.size_bytes)}</span><span>${formatDateTime(file.created_at)}</span></div><div class="actions"><button class="btn" data-open-r2-file="${file.id}">Abrir</button><button class="btn btn-danger" data-delete-r2-file="${file.id}">Eliminar</button></div></article>`;
  }).join("")}</div>` : `<div class="empty-state">No hay archivos de R2 registrados.</div>`;
  hydrateR2Thumbnails();
}

async function hydrateR2Thumbnails() {
  const thumbs = Array.from(document.querySelectorAll("[data-r2-thumb]"));
  await Promise.all(thumbs.map(async (thumb) => {
    try {
      const url = await getAdminFileUrl(thumb.dataset.r2Thumb);
      thumb.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
    } catch {
      thumb.textContent = "IMG";
    }
  }));
}

async function hydrateCatalogThumbs() {
  const thumbs = Array.from(document.querySelectorAll("[data-catalog-thumb]"));
  await Promise.all(thumbs.map(async (thumb) => {
    const [table, fileId] = thumb.dataset.catalogThumb.split(":");
    try {
      const url = await getCatalogFileUrl(table, fileId);
      thumb.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
    } catch {
      thumb.textContent = "IMG";
    }
  }));
}

function renderR2ShareLinks() {
  document.querySelector("#r2ShareLinksList").innerHTML = r2ShareLinks.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Tipo</th><th>Link</th><th>Expira</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${r2ShareLinks.map((link) => {
    const url = r2ShareUrl(link);
    const expired = new Date(link.expires_at).getTime() <= Date.now();
    const inactive = link.revoked_at || expired;
    return `<tr><td>${R2_LINK_TYPES[link.link_type] || link.link_type}</td><td><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></td><td>${formatDateTime(link.expires_at)}</td><td>${link.revoked_at ? "Revocado" : expired ? "Expirado" : "Activo"}</td><td class="actions"><button class="btn" data-copy-r2-link="${escapeHtml(url)}">Copiar</button>${inactive ? "" : `<button class="btn btn-danger" data-revoke-r2-link="${link.id}">Revocar</button>`}</td></tr>`;
  }).join("")}</tbody></table></div>` : `<div class="empty-state">No hay links de R2 generados.</div>`;
}

async function sendTeacherPreviewWhatsapp() {
  const hasPreviewFiles = r2Files.some((file) => file.file_type === "TEACHER_PREVIEW");
  if (!hasPreviewFiles) {
    showToast("Primero suba fotos como Preview maestra en Archivos R2.", "error");
    return;
  }
  const phone = document.querySelector("#whatsappPhone")?.value || job.clients.phone;
  if (!phone) {
    showToast("No hay teléfono disponible para WhatsApp.", "error");
    return;
  }
  const school = job.clients.school_profiles?.[0] || {};
  const contactName = school.teacher_name || school.principal_name || job.clients.name;
  const schoolName = school.school_name || job.clients.name;
  const expiresAt = new Date(defaultR2Expiry(7)).toISOString();
  const link = await createR2ShareLink(jobId, "TEACHER_PREVIEW", expiresAt);
  const previewUrl = r2ShareUrl(link);
  const message = `Hola ${contactName} 👋

Su galería de graduación ya está lista para revisión.

Escuela: ${schoolName}
Trabajo: ${job.title}

Puede revisar las fotos aquí:
${previewUrl}

Cuando todo esté correcto, por favor autorice el trabajo para impresión en este link:
${approvalUrl()}

IMPORTANTE:
Una vez autorizado para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá costo extra.

Muchas gracias.
Clarisa Rojas Fotografia`;
  const waMeUrl = buildWhatsAppUrl(phone, message);
  currentMessage = message;
  selectedWhatsappUrl = waMeUrl;
  document.querySelector("#whatsappMessage").value = message;
  await supabase.from("message_logs").insert({
    job_id: job.id,
    client_id: job.client_id,
    message_type: "R2_TEACHER_PREVIEW",
    message_text: message,
    wa_me_url: waMeUrl
  });
  await supabase.from("jobs").update({ status: "WAITING_APPROVAL" }).eq("id", job.id);
  await loadJob();
  showToast("WhatsApp de galería generado.");
  openInNewTab(waMeUrl);
}

async function sendPrintItemWhatsapp(itemId) {
  const item = printItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const isCatalogSelection = ["DIPLOMA", "PHOTO_PACKAGE", "FOLDER_OPTION"].includes(item.item_type) && !item.selected_file_id;
  const hasPreviewFiles = r2Files.some((file) => file.print_item_id === item.id && file.file_type === "TEACHER_PREVIEW");
  if (!hasPreviewFiles && !isCatalogSelection) {
    showToast("Primero suba previews para esta pieza.", "error");
    return;
  }
  const school = job.clients.school_profiles?.[0] || {};
  const group = schoolGroups.find((entry) => entry.id === item.group_id);
  const phone = group?.teacher_phone || document.querySelector("#whatsappPhone")?.value || job.clients.phone;
  const contactName = group?.teacher_name || school.teacher_name || school.principal_name || job.clients.name;
  const groupLine = group?.group_name ? `Grupo: ${group.group_name}\n` : "";
  let message = "";
  if (isCatalogSelection) {
    const catalogName = item.item_type === "DIPLOMA" ? "diplomas" : item.item_type === "FOLDER_OPTION" ? "carpetas" : "paquetes de fotos";
    const followUpText = item.item_type === "PHOTO_PACKAGE"
      ? "Cuando elija el paquete y nos indique la cantidad, quedará registrada su selección para calcular el total de paquetes del grupo."
      : "Cuando elija una opción, quedará registrada su selección para este grupo.";
    message = `Hola ${contactName} 👋

Ya está listo el catálogo de ${catalogName} para que pueda elegir la opción que más le guste.

Escuela: ${school.school_name || job.clients.name}
${groupLine}Trabajo: ${job.title}

Puede revisar y seleccionar aquí:
${printItemApprovalUrl(item)}

${followUpText}

Muchas gracias.
Clarisa Rojas Fotografia`;
  } else {
    const expiresAt = new Date(defaultR2Expiry(7)).toISOString();
    const link = await createR2ShareLink(jobId, "TEACHER_PREVIEW", expiresAt, item.id);
    const previewUrl = r2ShareUrl(link);
    message = `Hola ${contactName} 👋

Ya está lista la revisión de: ${item.title}

Puede revisar los archivos aquí:
${previewUrl}

Cuando esté correcto, por favor autorice esta pieza para impresión:
${printItemApprovalUrl(item)}

IMPORTANTE:
Una vez autorizada esta pieza para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá costo extra.

Muchas gracias.
Clarisa Rojas Fotografia`;
  }
  const waMeUrl = buildWhatsAppUrl(phone, message);
  currentMessage = message;
  selectedWhatsappUrl = waMeUrl;
  document.querySelector("#whatsappMessage").value = message;
  await updatePrintItem(item.id, { status: "SENT_FOR_APPROVAL", sent_at: new Date().toISOString() });
  await supabase.from("message_logs").insert({
    job_id: job.id,
    client_id: job.client_id,
    message_type: "PRINT_ITEM_APPROVAL",
    message_text: message,
    wa_me_url: waMeUrl
  });
  await loadJob();
  openInNewTab(waMeUrl);
}

function renderDeposits() {
  const generalDeposits = deposits.filter((deposit) => !deposit.group_id).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const teacherDeposits = deposits.filter((deposit) => deposit.group_id).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const summary = `<div class="deposit-summary"><div><span>Abonos generales</span><strong>${formatMoney(generalDeposits)}</strong></div><div><span>Abonos por maestra</span><strong>${formatMoney(teacherDeposits)}</strong></div><div><span>Total abonado</span><strong>${formatMoney(generalDeposits + teacherDeposits)}</strong></div></div>`;
  document.querySelector("#depositsList").innerHTML = deposits.length ? `${summary}<table class="table"><thead><tr><th>Fecha</th><th>Asignado a</th><th>Monto</th><th>Nota</th><th>Acciones</th></tr></thead><tbody>${deposits.map((deposit) => {
    const assignee = deposit.group_id ? `${deposit.school_groups?.group_name || "Grupo"}${deposit.school_groups?.teacher_name ? ` · ${deposit.school_groups.teacher_name}` : ""}` : "General del trabajo";
    return `<tr><td>${formatDate(deposit.deposit_date)}</td><td>${escapeHtml(assignee)}</td><td>${formatMoney(deposit.amount)}</td><td>${escapeHtml(deposit.notes)}</td><td><button class="btn btn-danger" data-delete-deposit="${deposit.id}">Eliminar</button></td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty-state">No hay abonos registrados.</div>`;
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
  const groupOptions = schoolGroups.map((group) => `<option value="${group.id}">${escapeHtml(group.group_name)}${group.teacher_name ? ` · ${escapeHtml(group.teacher_name)}` : ""}</option>`).join("");
  form.innerHTML = `<div class="form-grid"><div class="form-group"><label>Asignar abono a</label><select class="select" name="group_id"><option value="">General del trabajo</option>${groupOptions}</select></div><div class="form-group"><label>Monto abonado</label><input class="input" type="number" min="0.01" step="0.01" name="amount" required></div><div class="form-group"><label>Fecha del abono</label><input class="input" type="date" name="deposit_date" value="${today()}" required></div></div><div class="form-group"><label>Nota</label><textarea class="textarea" name="notes"></textarea></div><input type="hidden" name="form_type" value="deposit"><button class="btn btn-primary" type="submit">Guardar abono</button>`;
  modal.classList.remove("hidden");
}

function openGroupForm(group = null) {
  document.querySelector("#detailModalTitle").textContent = group ? "Editar grupo" : "Agregar grupo";
  const eventPackageType = SCHOOL_EVENT_PACKAGE_TYPES[job.event_type] || "SCHOOL_GRADUATION";
  const packageOptions = packages
    .filter((pkg) => pkg.package_type === eventPackageType || pkg.package_type === "GENERAL")
    .map((pkg) => `<option value="${pkg.id}" data-price="${pkg.price}" ${pkg.id === group?.selected_package_id ? "selected" : ""}>${escapeHtml(pkg.name)} - ${formatMoney(pkg.price)}</option>`)
    .join("");
  form.innerHTML = `<div class="form-grid"><div class="form-group"><label>Grupo</label><input class="input" name="group_name" required value="${escapeHtml(group?.group_name || "")}" placeholder="6to A"></div><div class="form-group"><label>Maestra</label><input class="input" name="teacher_name" value="${escapeHtml(group?.teacher_name || "")}"></div><div class="form-group"><label>WhatsApp maestra</label><input class="input" name="teacher_phone" value="${escapeHtml(group?.teacher_phone || "")}"></div><div class="form-group"><label>Paquete</label><select class="select" name="selected_package_id"><option value="">Pendiente</option>${packageOptions}</select></div><div class="form-group"><label>Cantidad de paquetes</label><input class="input" type="number" min="0" name="package_quantity" value="${group?.package_quantity || 0}"></div><div class="form-group"><label>Total grupo</label><input class="input" type="number" min="0" step="0.01" name="price" value="${group?.price || 0}"></div></div><div class="form-group"><label>Notas</label><textarea class="textarea" name="notes">${escapeHtml(group?.notes || "")}</textarea></div><input type="hidden" name="group_id" value="${group?.id || ""}"><input type="hidden" name="form_type" value="school_group"><button class="btn btn-primary" type="submit">Guardar grupo</button>`;
  const updateGroupPrice = () => {
    const selected = form.selected_package_id.selectedOptions[0];
    const packagePrice = Number(selected?.dataset.price || 0);
    const quantity = Number(form.package_quantity.value || 0);
    if (packagePrice && quantity >= 0) form.price.value = packagePrice * quantity;
  };
  form.selected_package_id.addEventListener("change", updateGroupPrice);
  form.package_quantity.addEventListener("input", updateGroupPrice);
  modal.classList.remove("hidden");
}

function openR2FileForm() {
  document.querySelector("#detailModalTitle").textContent = "Registrar archivo R2";
  const itemOptions = printItems.length ? `<div class="form-group"><label>Pieza de impresión</label><select class="select" name="print_item_id"><option value="">Sin pieza</option>${printItems.map((item) => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join("")}</select></div>` : "";
  form.innerHTML = `<div class="alert alert-warning">Suba primero el archivo al bucket privado de Cloudflare R2. Aquí registre la ruta exacta del objeto, por ejemplo <code>trabajos/${escapeHtml(jobId)}/preview/foto-001.jpg</code> o <code>trabajos/${escapeHtml(jobId)}/print/final.zip</code>.</div><div class="form-grid">${itemOptions}<div class="form-group"><label>Tipo de archivo</label><select class="select" name="file_type">${Object.entries(R2_FILE_TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><div class="form-group"><label>Nombre visible</label><input class="input" name="file_name" placeholder="foto-001.jpg" required></div></div><div class="form-group"><label>R2 key</label><input class="input" name="r2_key" placeholder="trabajos/${escapeHtml(jobId)}/preview/foto-001.jpg" required></div><div class="form-grid"><div class="form-group"><label>Content type</label><input class="input" name="content_type" placeholder="image/jpeg o application/zip"></div><div class="form-group"><label>Tamaño en bytes</label><input class="input" type="number" min="0" step="1" name="size_bytes"></div></div><div class="form-group"><label>Notas</label><textarea class="textarea" name="notes"></textarea></div><input type="hidden" name="form_type" value="r2_file"><button class="btn btn-primary" type="submit">Registrar archivo</button>`;
  modal.classList.remove("hidden");
}

function openR2ShareLinkForm() {
  document.querySelector("#detailModalTitle").textContent = "Generar link R2";
  const previewCount = r2Files.filter((file) => file.file_type === "TEACHER_PREVIEW").length;
  const printCount = r2Files.filter((file) => file.file_type === "PRINT_HIGH_RES").length;
  form.innerHTML = `<div class="alert alert-warning">Antes de generar el link confirme que ya existen archivos del tipo correcto. Preview maestra: ${previewCount}. Alta calidad imprenta: ${printCount}.</div><div class="form-grid"><div class="form-group"><label>Tipo de link</label><select class="select" name="link_type"><option value="TEACHER_PREVIEW">Preview para maestra</option><option value="PRINT_DOWNLOAD">Descarga para imprenta</option></select></div><div class="form-group"><label>Expira</label><input class="input" type="datetime-local" name="expires_at" value="${defaultR2Expiry(3)}" required></div></div><input type="hidden" name="form_type" value="r2_share_link"><button class="btn btn-primary" type="submit">Generar link</button>`;
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
    if (data.form_type === "deposit") await createDeposit(jobId, { group_id: data.group_id || null, amount: Number(data.amount), deposit_date: data.deposit_date, notes: data.notes || null });
    if (data.form_type === "school_group") {
      const payload = {
        group_name: data.group_name.trim(),
        teacher_name: data.teacher_name || null,
        teacher_phone: data.teacher_phone || null,
        selected_package_id: data.selected_package_id || null,
        package_quantity: Number(data.package_quantity || 0),
        price: Number(data.price || 0),
        notes: data.notes || null,
        sort_order: schoolGroups.length + 1
      };
      const group = data.group_id ? await updateSchoolGroup(data.group_id, payload) : await createSchoolGroup(jobId, payload);
      await ensureDefaultPrintItems(jobId, group.id);
      await recalculateJobFromGroups();
    }
    if (data.form_type === "r2_file") await createR2File(jobId, { print_item_id: data.print_item_id || null, file_type: data.file_type, r2_key: data.r2_key.trim(), file_name: data.file_name.trim(), content_type: data.content_type || null, size_bytes: data.size_bytes ? Number(data.size_bytes) : null, notes: data.notes || null });
    if (data.form_type === "r2_share_link") {
      const requiredFileType = data.link_type === "PRINT_DOWNLOAD" ? "PRINT_HIGH_RES" : "TEACHER_PREVIEW";
      const hasRequiredFiles = r2Files.some((file) => file.file_type === requiredFileType);
      if (!hasRequiredFiles) {
        showToast(data.link_type === "PRINT_DOWNLOAD" ? "Primero suba un archivo como Alta calidad imprenta." : "Primero suba un archivo como Preview maestra.", "error");
        return;
      }
      const expiresAt = new Date(data.expires_at).toISOString();
      const link = await createR2ShareLink(jobId, data.link_type, expiresAt);
      const url = r2ShareUrl(link);
      let copied = true;
      try {
        await copyToClipboard(url);
      } catch {
        copied = false;
        console.warn("No se pudo copiar automáticamente el link R2.");
      }
      showToast(copied ? "Link generado y copiado." : "Link generado.");
    }
    modal.classList.add("hidden");
    if (data.form_type !== "r2_share_link") showToast(data.form_type === "deposit" ? "Abono registrado." : data.form_type === "r2_file" ? "Archivo R2 registrado." : data.form_type === "school_group" ? "Grupo guardado." : "Galería guardada.");
    loadJob();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo guardar la información.", "error");
  }
});

document.addEventListener("click", async (event) => {
  try {
    const catalogButton = event.target.closest("[data-open-catalog-file]");
    if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
    if (event.target.matches("#newSchoolGroupBtn")) openGroupForm();
    if (event.target.dataset.editGroup) openGroupForm(schoolGroups.find((group) => group.id === event.target.dataset.editGroup));
    if (event.target.dataset.deleteGroup && confirm("¿Eliminar este grupo y sus validaciones?")) {
      await deleteSchoolGroup(event.target.dataset.deleteGroup);
      await recalculateJobFromGroups();
      showToast("Grupo eliminado.");
      await loadJob();
      return;
    }
    if (event.target.matches("#newGalleryBtn")) openGalleryForm();
    if (event.target.matches("#sendTeacherPreviewWhatsappBtn")) await sendTeacherPreviewWhatsapp();
    if (event.target.dataset.sendPrintItem) await sendPrintItemWhatsapp(event.target.dataset.sendPrintItem);
    if (catalogButton) {
      const [table, fileId] = catalogButton.dataset.openCatalogFile.split(":");
      openInNewTab(await getCatalogFileUrl(table, fileId));
    }
    if (event.target.matches("#newDepositBtn")) openDepositForm();
    if (event.target.matches("#newR2FileBtn")) openR2FileForm();
    if (event.target.matches("#newR2ShareLinkBtn")) openR2ShareLinkForm();
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
    if (event.target.dataset.deleteR2File && confirm("¿Eliminar este archivo? Se borrará del panel y también de Cloudflare R2.")) {
      await deleteR2File(event.target.dataset.deleteR2File);
      showToast("Archivo eliminado de R2.");
      loadJob();
    }
    if (event.target.dataset.copyR2Link) {
      await copyToClipboard(event.target.dataset.copyR2Link);
      showToast("Link copiado.");
    }
    const previewButton = event.target.closest("[data-preview-r2-file]");
    if (previewButton) {
      openInNewTab(await getAdminFileUrl(previewButton.dataset.previewR2File));
    }
    if (event.target.dataset.openR2File) {
      openInNewTab(await getAdminFileUrl(event.target.dataset.openR2File, true));
    }
    if (event.target.dataset.revokeR2Link && confirm("¿Revocar este link?")) {
      await revokeR2ShareLink(event.target.dataset.revokeR2Link);
      showToast("Link revocado.");
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

document.addEventListener("change", async (event) => {
  try {
    if (event.target.dataset.itemFileInput) {
      await uploadPrintItemFiles(event.target.dataset.itemFileInput, event.target.dataset.fileType || "TEACHER_PREVIEW", Array.from(event.target.files || []));
      event.target.value = "";
      return;
    }
    if (event.target.dataset.printItemStatus) {
      await updatePrintItem(event.target.dataset.printItemStatus, { status: event.target.value });
      showToast("Pieza actualizada.");
      await loadJob();
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo actualizar la pieza.", "error");
  }
});

if (!jobId) {
  document.querySelector(".container").innerHTML = `<div class="alert alert-error">No se encontró el trabajo.</div>`;
} else {
  loadJob().catch((error) => { console.error(error); showToast("No se pudo cargar la información.", "error"); });
}
