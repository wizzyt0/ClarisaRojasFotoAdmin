import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";
import { GALLERY_TYPES, getGalleryTypeLabel } from "./constants.js";
import { formatMoney } from "./formatters.js";
import { escapeHtml, getQueryParam, openInNewTab, showToast } from "./utils.js";

const token = getQueryParam("token");
const itemToken = getQueryParam("item_token");
const content = document.querySelector("#approvalContent");
let approvalData = null;
let printItemData = null;
let catalogOptions = [];

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
      ${job.job_type === "SCHOOL_GRADUATION" ? `<p><strong>Nivel:</strong><br>${escapeHtml({ KINDER: "Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[school?.school_level] || "")}</p><p><strong>Curso:</strong><br>${escapeHtml(school?.grade_or_class)}</p><p><strong>Maestra:</strong><br>${escapeHtml(school?.teacher_name)}</p><p><strong>Directora:</strong><br>${escapeHtml(school?.principal_name)}</p><p><strong>Cantidad de paquetes:</strong><br>${Number(job.package_quantity || 0) > 0 ? job.package_quantity : "Pendiente de selección"}</p><p><strong>Estudiantes:</strong><br>${school?.student_count || ""}</p>` : `<p><strong>Tipo de sesión:</strong><br>${escapeHtml(job.event_type || "Sesión de fotos")}</p>`}
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

function printItemTypeLabel(type) {
  return {
    STUDENT_GALLERY: "Galería de niños",
    DIPLOMA: "Diploma",
    FOLDER_OPTION: "Carpeta",
    GROUP_PHOTO: "Foto grupal",
    PHOTO_PACKAGE: "Paquete de fotos",
    OTHER: "Otro"
  }[type] || type || "";
}

function renderPrintItemApproval() {
  const { print_item: item, job, client, school_profile: school, school_group: group } = printItemData;
  if (item.approved_at) {
    content.innerHTML = `<h1>Esta pieza ya fue aprobada para impresión.</h1><p class="muted">Fecha de aprobación: ${new Date(item.approved_at).toLocaleString("es-MX")}</p>`;
    return;
  }
  if (item.status === "CATALOG_SELECTED") {
    content.innerHTML = `<div class="alert alert-success"><h1>Selección recibida.</h1><p>Gracias. Clarisa preparará la versión personalizada y la enviará después para revisión y autorización final.</p></div>`;
    return;
  }
  const needsCatalogSelection = ["DIPLOMA", "PHOTO_PACKAGE"].includes(item.item_type) && !item.selected_file_id;
  if (needsCatalogSelection) {
    renderCatalogSelection();
    return;
  }
  content.innerHTML = `
    <h1 class="approval-title">${escapeHtml(item.title)}</h1>
    <p class="muted">Aprobación por pieza de impresión.</p>
    <div class="grid">
      <p><strong>Trabajo:</strong><br>${escapeHtml(job.title)}</p>
      <p><strong>Tipo:</strong><br>${escapeHtml(printItemTypeLabel(item.item_type))}</p>
      <p><strong>Cliente/Escuela:</strong><br>${escapeHtml(school?.school_name || client.name)}</p>
      <p><strong>Grupo:</strong><br>${escapeHtml(group?.group_name || school?.grade_or_class || "")}</p>
      <p><strong>Contacto:</strong><br>${escapeHtml(group?.teacher_name || school?.contact_name || school?.teacher_name || school?.principal_name || client.name)}</p>
    </div>
    <div class="alert alert-warning"><strong>IMPORTANTE:</strong><br>Una vez aprobada esta pieza para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá un costo extra. Por favor revise cuidadosamente antes de aprobar.</div>
    <form id="printItemApprovalForm">
      <div class="form-group"><label>Nombre de quien aprueba</label><input class="input" name="approval_name" required></div>
      <div class="form-group"><label>Observaciones o cambios solicitados</label><textarea class="textarea" name="client_notes" placeholder="Escriba aquí si algo necesita corrección antes de imprimir."></textarea></div>
      <label class="form-group"><span><input type="checkbox" name="terms"> Confirmo que revisé esta pieza y autorizo enviarla a impresión. Entiendo que cualquier cambio solicitado después de esta aprobación tendrá costo adicional.</span></label>
      <div class="actions"><button class="btn btn-primary" type="submit" name="action" value="approve">Autorizar esta pieza para impresión</button><button class="btn" type="submit" name="action" value="changes">Solicitar cambios</button></div>
    </form>`;
}

function catalogFileUrl(option) {
  return `${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/catalog-file/${option.table}/${option.id}?item_token=${encodeURIComponent(itemToken)}`;
}

function renderCatalogSelection() {
  const { print_item: item, job, client, school_profile: school, school_group: group } = printItemData;
  const title = item.item_type === "DIPLOMA" ? "Seleccione el diseño de diploma" : "Seleccione el paquete de fotos";
  content.innerHTML = `
    <h1 class="approval-title">${title}</h1>
    <p class="muted">${escapeHtml(school?.school_name || client.name)} · ${escapeHtml(group?.group_name || "")} · ${escapeHtml(job.title)}</p>
    <div class="catalog-grid">${catalogOptions.length ? catalogOptions.map((option) => `<article class="catalog-card"><button class="catalog-preview-large" data-open-url="${escapeHtml(catalogFileUrl(option))}" type="button"><span><img src="${escapeHtml(catalogFileUrl(option))}" alt="${escapeHtml(option.name)}"></span></button><div><h3>${escapeHtml(option.name)}</h3>${option.price != null ? `<p class="muted">${formatMoney(option.price)}</p>` : ""}${option.description ? `<p>${escapeHtml(option.description)}</p>` : ""}</div><button class="btn btn-primary" data-select-catalog="${option.table}:${option.id}">Elegir esta opción</button></article>`).join("") : `<div class="empty-state">No hay opciones disponibles para este catálogo.</div>`}</div>
    ${item.item_type === "PHOTO_PACKAGE" ? `<div class="form-group"><label>Cantidad de paquetes</label><input id="catalogPackageQuantity" class="input" type="number" min="1" step="1" value="1" required></div>` : ""}
    <div class="form-group"><label>Observaciones para Clarisa</label><textarea id="catalogClientNotes" class="textarea" placeholder="Ejemplo: nos gusta este diseño, pero queremos usar color azul."></textarea></div>`;
}

async function load() {
  if (itemToken) {
    const { data, error } = await supabase.rpc("get_public_print_item_by_token", { token: itemToken });
    if (error || !data) {
      console.error(error);
      content.innerHTML = `<div class="alert alert-error">El link de aprobación no existe, expiró o falta configurar la aprobación por pieza en Supabase.</div>`;
      return;
    }
    printItemData = data;
    if (["DIPLOMA", "PHOTO_PACKAGE"].includes(data.print_item?.item_type) && !data.print_item?.selected_file_id) {
      const catalogResult = await supabase.rpc("get_public_catalog_by_print_item_token", { token: itemToken });
      if (!catalogResult.error) catalogOptions = catalogResult.data || [];
    }
    renderPrintItemApproval();
    return;
  }
  if (!token) {
    content.innerHTML = `<div class="alert alert-error">El link de aprobación no existe o expiró.</div>`;
    return;
  }
  const { data, error } = await supabase.rpc("get_public_approval_by_token", { token });
  if (error || !data) {
    console.error(error);
    content.innerHTML = `<div class="alert alert-error">El link de aprobación no existe, expiró o todavía falta configurar la función pública de aprobación en Supabase.</div>`;
    return;
  }
  approvalData = data;
  render();
}

document.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-url]");
  if (openButton) openInNewTab(openButton.dataset.openUrl);
});

document.addEventListener("click", async (event) => {
  if (!event.target.dataset.selectCatalog) return;
  const [optionTable, optionId] = event.target.dataset.selectCatalog.split(":");
  const notes = document.querySelector("#catalogClientNotes")?.value || "";
  const quantityInput = document.querySelector("#catalogPackageQuantity");
  const packageQuantity = quantityInput ? Number(quantityInput.value || 0) : null;
  if (quantityInput && packageQuantity < 1) {
    showToast("Indique cuántos paquetes necesita.", "error");
    return;
  }
  const confirmed = confirm("¿Confirmar esta selección?");
  if (!confirmed) return;
  const { data, error } = await supabase.rpc("select_catalog_option_by_token", {
    token: itemToken,
    option_table: optionTable,
    option_id: optionId,
    client_notes: notes,
    package_quantity: packageQuantity
  });
  if (error || !data?.ok) {
    console.error(error || data);
    showToast(data?.message || "No se pudo guardar la selección.", "error");
    return;
  }
  content.innerHTML = `<div class="alert alert-success"><h1>Selección guardada.</h1><p>Gracias. Clarisa recibirá su selección para preparar la versión personalizada y enviarla a revisión final.</p><p><strong>Selección:</strong> ${escapeHtml(data.selected_name || "")}</p>${data.package_quantity ? `<p><strong>Cantidad:</strong> ${data.package_quantity}<br><strong>Total:</strong> ${formatMoney(data.price || 0)}</p>` : ""}</div>`;
});

document.addEventListener("submit", async (event) => {
  if (event.target.matches("#printItemApprovalForm")) {
    event.preventDefault();
    const action = event.submitter?.value || "approve";
    const approvalName = event.target.approval_name.value.trim();
    if (!approvalName) return showToast("Escriba el nombre de quien aprueba.", "error");
    if (action === "changes") {
      const notes = event.target.client_notes.value.trim();
      if (!notes) return showToast("Escriba las observaciones para solicitar cambios.", "error");
      const { data, error } = await supabase.rpc("request_print_item_changes_by_token", { token: itemToken, approval_name: approvalName, client_notes: notes });
      if (error || !data?.ok) {
        console.error(error || data);
        showToast(data?.message || "No se pudieron registrar los cambios.", "error");
        return;
      }
      content.innerHTML = `<div class="alert alert-success"><h1>Observaciones enviadas.</h1><p>Gracias. Registramos los cambios solicitados para revisión.</p></div>`;
      return;
    }
    if (!event.target.terms.checked) return showToast("Debe aceptar las condiciones antes de aprobar.", "error");
    const { data, error } = await supabase.rpc("approve_print_item_by_token", { token: itemToken, approval_name: approvalName });
    if (error || !data?.ok) {
      console.error(error || data);
      showToast(data?.message || "No se pudo aprobar la pieza.", "error");
      return;
    }
    content.innerHTML = `<div class="alert alert-success"><h1>Pieza autorizada para impresión.</h1><p>Gracias. La aprobación fue registrada correctamente.</p></div>`;
    return;
  }
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
