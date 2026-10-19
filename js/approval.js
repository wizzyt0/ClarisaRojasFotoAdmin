import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";
import { GALLERY_TYPES, getGalleryTypeLabel } from "./constants.js";
import { formatDate, formatMoney } from "./formatters.js";
import { escapeHtml, getQueryParam, openInNewTab, showToast } from "./utils.js";

const token = getQueryParam("token");
const itemToken = getQueryParam("item_token");
const content = document.querySelector("#approvalContent");
let approvalData = null;
let printItemData = null;
let catalogOptions = [];
let schoolCatalog = null;
let pendingCatalogSelection = null;
let selectedPackageTier = null;
let catalogClientNotes = "";
let pendingSchoolCatalogSelection = null;

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
      ${job.job_type === "SCHOOL_GRADUATION" ? `<p><strong>Nivel:</strong><br>${escapeHtml({ KINDER: "Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[school?.school_level] || "")}</p><p><strong>Directora:</strong><br>${escapeHtml(school?.principal_name)}</p><p><strong>Cantidad de paquetes:</strong><br>${Number(job.package_quantity || 0) > 0 ? job.package_quantity : "Pendiente de selección por grupo"}</p>` : `<p><strong>Tipo de sesión:</strong><br>${escapeHtml(job.event_type || "Sesión de fotos")}</p>`}
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
  const { print_item: item, job, client, school_profile: school, school_group: group, preview_files: previewFiles = [] } = printItemData;
  if (item.approved_at) {
    content.innerHTML = `<h1>Esta pieza ya fue aprobada para impresión.</h1><p class="muted">Fecha de aprobación: ${new Date(item.approved_at).toLocaleString("es-MX")}</p>`;
    return;
  }
  if (item.status === "CATALOG_SELECTED" && item.item_type === "PHOTO_PACKAGE") {
    renderSavedPackageSelection();
    return;
  }
  const needsCatalogSelection = ["DIPLOMA", "PHOTO_PACKAGE", "FOLDER_OPTION"].includes(item.item_type) && !item.selected_file_id;
  if (needsCatalogSelection) {
    renderCatalogSelection();
    return;
  }
  const teacherName = group?.teacher_name || school?.contact_name || school?.teacher_name || school?.principal_name || client.name;
  const schoolName = school?.school_name || client.name;
  content.innerHTML = `
    <h1 class="approval-title">Revisión: ${escapeHtml(item.title)}</h1>
    <p class="muted"><strong>Maestra:</strong> ${escapeHtml(teacherName)} · <strong>Escuela:</strong> ${escapeHtml(schoolName)} · <strong>Grupo:</strong> ${escapeHtml(group?.group_name || school?.grade_or_class || "No indicado")}</p>
    <div class="grid">
      <p><strong>Trabajo:</strong><br>${escapeHtml(job.title)}</p>
      <p><strong>Tipo:</strong><br>${escapeHtml(printItemTypeLabel(item.item_type))}</p>
    </div>
    <h2>Archivo para revisar</h2>
    <p class="muted">Toque o haga clic en el preview para abrirlo y revisarlo en tamaño completo.</p>
    ${renderPrintItemPreviewFiles(previewFiles)}
    <form id="printItemApprovalForm">
      <div class="form-group"><label>Nombre de quien confirma o solicita cambios</label><input class="input" name="approval_name" autocomplete="name" required></div>
      <div class="form-group"><label>Observaciones o cambios solicitados</label><textarea class="textarea" name="client_notes" placeholder="Describa aquí los cambios que necesita antes de imprimir."></textarea></div>
      <div class="actions"><button class="btn btn-primary" type="button" data-open-print-confirm>Autorizar esta pieza para impresión</button><button class="btn" type="submit" name="action" value="changes">Solicitar cambios</button></div>
    </form>
    <div id="printApprovalConfirmDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="printApprovalConfirmTitle">
      <div class="modal-content compact-modal"><div class="page-header"><h2 id="printApprovalConfirmTitle">Confirmar autorización</h2><button class="btn" type="button" data-cancel-print-confirm>Cerrar</button></div>
        <div class="alert alert-warning"><strong>IMPORTANTE</strong><br>Una vez autorizada esta pieza para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá un costo extra. Confirme que revisó cuidadosamente el diseño y sus datos.</div>
        <div class="actions"><button class="btn btn-primary" type="button" data-confirm-print-approval>Confirmar y autorizar impresión</button><button class="btn" type="button" data-cancel-print-confirm>Volver a revisar</button></div>
      </div>
    </div>`;
}

function renderSavedPackageSelection() {
  const { print_item: item, job, client, school_group: group } = printItemData;
  const option = catalogOptions.find((entry) => entry.id === item.selected_file_id);
  const imageUrl = option ? catalogFileUrl(option) : "";
  const unitPrice = Number(option?.price ?? printItemData.school_group?.unit_package_price ?? 0);
  const groupTotal = Number(group?.price || 0);
  const deposited = Number(group?.total_deposited || 0);
  const remaining = Number(group?.remaining_balance ?? Math.max(groupTotal - deposited, 0));
  const photoFormat = option?.photo_presentation === "BASTIDOR" ? "Foto del alumno en bastidor" : option?.photo_presentation === "GROUP_INDIVIDUAL" ? "Foto grupal e individual" : group?.photo_format === "GROUP" ? "Foto grupal" : group?.photo_format === "INDIVIDUAL" ? "Foto individual" : "Formato no disponible";
  const packageTier = option?.package_tier === "SMALL" ? "Paquete chico" : option?.package_tier === "LARGE" ? "Paquete grande" : "";
  content.innerHTML = `<h1 class="approval-title">Su selección está registrada</h1>
    <p class="muted">${escapeHtml(client.name)} · ${escapeHtml(group?.group_name || "")} · ${escapeHtml(job.title)}</p>
    <div class="alert alert-success"><strong>Esta es la opción que eligió:</strong>
      ${imageUrl ? `<div class="catalog-preview-large"><span><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(option.name)}"></span></div>` : ""}
      <p><strong>Paquete:</strong> ${escapeHtml(packageTier ? `${packageTier} · ${option?.name || ""}` : option?.name || "Selección guardada")}</p>
      <p><strong>Formato:</strong> ${photoFormat}<br><strong>Cantidad:</strong> ${Number(group?.package_quantity || 0)} paquete(s)</p>
    </div>
    <h2>Resumen de su grupo</h2><div class="grid">
      <p><strong>Precio por paquete:</strong><br>${formatMoney(unitPrice)}</p>
      <p><strong>Total del grupo:</strong><br>${formatMoney(groupTotal)}</p>
      <p><strong>Abonado a este grupo:</strong><br>${formatMoney(deposited)}</p>
      <p><strong>Fecha del último abono:</strong><br>${group?.last_deposit_date ? formatDate(group.last_deposit_date) : "Sin abonos registrados"}</p>
      <p><strong>Pendiente del grupo:</strong><br>${formatMoney(remaining)}</p>
    </div>
    <p class="muted">Gracias. Clarisa recibió su selección y continuará con el pedido.</p>
    <div class="alert"><strong>¿Requiere algún cambio?</strong><br>Comuníquese directamente con Clarisa Rojas.</div>`;
}

function printItemFileUrl(file) {
  return `${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/print-item-file/${file.id}?item_token=${encodeURIComponent(itemToken)}`;
}

function renderPrintItemPreviewFiles(files) {
  if (!files.length) return `<div class="empty-state">No hay preview registrado para esta pieza.</div>`;
  return `<div class="catalog-grid">${files.map((file) => {
    const url = printItemFileUrl(file);
    const isImage = String(file.content_type || "").startsWith("image/");
    return `<article class="catalog-card"><button class="catalog-preview-large" data-open-url="${escapeHtml(url)}" type="button"><span>${isImage ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(file.file_name)}">` : escapeHtml(file.file_name)}</span></button><div><h3>${escapeHtml(file.file_name)}</h3></div></article>`;
  }).join("")}</div>`;
}

function catalogFileUrl(option) {
  return `${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/catalog-file/${option.table}/${option.id}?item_token=${encodeURIComponent(itemToken)}`;
}

function renderCatalogSelection() {
  const { print_item: item, job, client, school_profile: school, school_group: group } = printItemData;
  if (item.item_type === "PHOTO_PACKAGE") {
    const tiers = ["SMALL", "LARGE"];
    const tierLabels = { SMALL: "Paquete chico", LARGE: "Paquete grande" };
    const formatLabels = { BASTIDOR: "Foto del alumno en bastidor", GROUP_INDIVIDUAL: "Foto grupal e individual" };
    const packageOptions = Array.from(new Map(catalogOptions.filter((option) => option.package_tier && option.photo_presentation).map((option) => [option.package_id, option])).values());
    const legacyOptions = catalogOptions.filter((option) => !option.package_tier || !option.photo_presentation);
    const tierCards = tiers.map((tier) => {
      const options = packageOptions.filter((option) => option.package_tier === tier);
      const price = options[0]?.price;
      const previews = options.map((option) => `<div class="catalog-tier-preview"><img src="${escapeHtml(catalogFileUrl(option))}" alt="${escapeHtml(formatLabels[option.photo_presentation] || option.name)}"><span>${escapeHtml(formatLabels[option.photo_presentation])}</span></div>`).join("");
      return `<button type="button" class="catalog-card package-tier-card ${selectedPackageTier === tier ? "is-selected" : ""}" data-select-package-tier="${tier}" ${options.length < 2 || options.some((option) => Number(option.price) !== Number(price)) ? "disabled" : ""}><span class="badge">${escapeHtml(tierLabels[tier])}</span><strong class="package-tier-price">${price == null ? "Precio pendiente" : formatMoney(price)}</strong><span class="catalog-tier-previews">${previews || "Opciones no configuradas"}</span></button>`;
    }).join("");
    const selectedTierOptions = packageOptions.filter((option) => option.package_tier === selectedPackageTier);
    const presentationChoices = selectedTierOptions.map((option) => `<article class="catalog-card package-presentation-card"><button class="catalog-preview-large" data-open-url="${escapeHtml(catalogFileUrl(option))}" type="button"><span><img src="${escapeHtml(catalogFileUrl(option))}" alt="${escapeHtml(formatLabels[option.photo_presentation] || option.name)}"></span></button><h3>${escapeHtml(formatLabels[option.photo_presentation] || option.name)}</h3><p class="muted">${formatMoney(option.price)}</p><button class="btn btn-primary" data-select-catalog="package_images:${option.id}">Elegir esta presentación</button></article>`).join("");
    const validCatalog = tiers.every((tier) => {
      const options = packageOptions.filter((option) => option.package_tier === tier);
      return options.length === 2 && new Set(options.map((option) => option.photo_presentation)).size === 2 && options.every((option) => Number(option.price) === Number(options[0].price));
    });
    const legacyCatalog = !packageOptions.length && legacyOptions.length > 0;
    const legacyCards = legacyOptions.map((option) => `<article class="catalog-card"><button class="catalog-preview-large" data-open-url="${escapeHtml(catalogFileUrl(option))}" type="button"><span><img src="${escapeHtml(catalogFileUrl(option))}" alt="${escapeHtml(option.name)}"></span></button><h3>${escapeHtml(option.name)}</h3><p class="muted">${formatMoney(option.price)}</p><button class="btn btn-primary" data-select-catalog="package_images:${option.id}">Elegir paquete</button></article>`).join("");
    content.innerHTML = `<h1 class="approval-title">Seleccione el paquete de fotos</h1><p class="muted">${escapeHtml(school?.school_name || client.name)} · ${escapeHtml(group?.group_name || "")} · ${escapeHtml(job.title)}</p><p>Primero elija el tamaño del paquete y después la presentación de las fotos. Ambas presentaciones tienen el mismo precio dentro de cada paquete.</p>${validCatalog ? `<div class="catalog-grid package-tier-grid">${tierCards}</div>${selectedPackageTier ? `<section class="catalog-section"><h2>Presentación de ${escapeHtml(tierLabels[selectedPackageTier])}</h2><div class="catalog-grid">${presentationChoices}</div><button class="btn" type="button" data-back-package-tiers>Elegir otro paquete</button></section>` : ""}` : legacyCatalog ? `<div class="catalog-grid">${legacyCards}</div>` : `<div class="alert alert-error">El catálogo todavía no está completo. Clarisa debe configurar los dos precios y las dos presentaciones para cada nivel de paquete antes de enviar el link.</div>`}<div class="form-group"><label>Dudas sobre el paquete</label><textarea id="catalogClientNotes" class="textarea" placeholder="Si tiene alguna duda sobre este paquete o sobre lo que incluye, escríbala aquí.">${escapeHtml(catalogClientNotes)}</textarea></div>${renderPackageQuantityDialog()}`;
    return;
  }
  const title = item.item_type === "DIPLOMA" ? "Seleccione el diseño de diploma" : item.item_type === "FOLDER_OPTION" ? "Seleccione la carpeta" : "Seleccione el paquete de fotos";
  const notesLabel = item.item_type === "PHOTO_PACKAGE" ? "Dudas sobre el paquete" : "Comentario para Clarisa";
  const notesPlaceholder = item.item_type === "PHOTO_PACKAGE"
    ? "Si tiene alguna duda sobre este paquete o sobre lo que incluye, escríbala aquí."
    : "Si necesita aclarar algún dato de su selección, escríbalo aquí.";
  content.innerHTML = `
    <h1 class="approval-title">${title}</h1>
    <p class="muted">${escapeHtml(school?.school_name || client.name)} · ${escapeHtml(group?.group_name || "")} · ${escapeHtml(job.title)}</p>
    <div class="catalog-grid">${catalogOptions.length ? catalogOptions.map((option) => `<article class="catalog-card"><button class="catalog-preview-large" data-open-url="${escapeHtml(catalogFileUrl(option))}" type="button"><span><img src="${escapeHtml(catalogFileUrl(option))}" alt="${escapeHtml(option.name)}"></span></button><div><h3>${escapeHtml(option.name)}</h3>${option.price != null ? `<p class="muted">${formatMoney(option.price)}</p>` : ""}${option.description ? `<p>${escapeHtml(option.description)}</p>` : ""}</div><button class="btn btn-primary" data-select-catalog="${option.table}:${option.id}">Elegir esta opción</button></article>`).join("") : `<div class="empty-state">No hay opciones disponibles para este catálogo.</div>`}</div>
    <div class="form-group"><label>${notesLabel}</label><textarea id="catalogClientNotes" class="textarea" placeholder="${notesPlaceholder}"></textarea></div>
    `;
}

function renderSchoolCatalog() {
  const { job, client, school_profile: school, school_group: group } = printItemData;
  const catalogSection = (kind, title, options, selectedId) => `<section class="catalog-section"><div class="page-header"><h2>${title}</h2><span class="badge">${selectedId ? "Selección guardada" : "Pendiente de elegir"}</span></div><div class="catalog-grid">${options.length ? options.map((option) => {
    const chosen = option.id === selectedId;
    const url = catalogFileUrl(option);
    return `<article class="catalog-card"><button class="catalog-preview-large" data-open-url="${escapeHtml(url)}" type="button"><span><img src="${escapeHtml(url)}" alt="${escapeHtml(option.name)}"></span></button><div><h3>${escapeHtml(option.name)}</h3></div>${chosen ? `<span class="badge badge-success">Seleccionado</span>` : `<button class="btn btn-primary" data-select-school-catalog="${kind}:${option.id}">Elegir este diseño</button>`}</article>`;
  }).join("") : `<div class="empty-state">No hay diseños disponibles para este nivel escolar.</div>`}</div></section>`;
  const bothSelected = Boolean(schoolCatalog.diploma_selected_id && schoolCatalog.folder_selected_id);
  const selectedSummary = (title, options, selectedId) => {
    const selected = options.find((option) => option.id === selectedId);
    if (!selected) return "";
    const url = catalogFileUrl(selected);
    return `<article class="catalog-card"><div class="catalog-preview-large"><span><img src="${escapeHtml(url)}" alt="${escapeHtml(selected.name)}"></span></div><h3>${escapeHtml(title)}: ${escapeHtml(selected.name)}</h3></article>`;
  };
  const hasSelection = Boolean(schoolCatalog.diploma_selected_id || schoolCatalog.folder_selected_id);
  const selectedCards = `${selectedSummary("Diploma elegido", schoolCatalog.diploma_options, schoolCatalog.diploma_selected_id)}${selectedSummary("Carpeta elegida", schoolCatalog.folder_options, schoolCatalog.folder_selected_id)}`;
  const pendingCatalogs = `${!schoolCatalog.diploma_selected_id ? catalogSection("DIPLOMA", "Elija un diploma", schoolCatalog.diploma_options, null) : ""}${!schoolCatalog.folder_selected_id ? catalogSection("FOLDER", "Elija una carpeta", schoolCatalog.folder_options, null) : ""}`;
  content.innerHTML = `<h1 class="approval-title">Elija diploma y carpeta</h1><p class="muted">${escapeHtml(school?.school_name || client.name)} · ${escapeHtml(group?.group_name || "")} · ${escapeHtml(job.title)}</p><p>Las opciones corresponden a ${escapeHtml({ KINDER: "preescolar", PRIMARY: "primaria", SECONDARY: "secundaria" }[schoolCatalog.school_level] || "su nivel escolar")}.</p>${hasSelection ? `<section class="catalog-section"><h2>${bothSelected ? "Sus diseños elegidos" : "Selección guardada"}</h2><div class="catalog-grid">${selectedCards}</div>${bothSelected ? `<div class="alert alert-success"><strong>Sus elecciones de diploma y carpeta quedaron registradas.</strong></div><div class="alert"><strong>¿Requiere algún cambio?</strong><br>Comuníquese directamente con Clarisa Rojas.</div>` : `<p class="muted">Su elección está guardada. Ahora puede elegir la opción pendiente.</p>`}</section>` : ""}${pendingCatalogs}${renderSchoolCatalogConfirmDialog()}`;
}

function renderSchoolCatalogConfirmDialog() {
  return `<div id="schoolCatalogConfirmDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="schoolCatalogConfirmTitle">
    <div class="modal-content compact-modal"><div class="page-header"><h2 id="schoolCatalogConfirmTitle">Confirmar elección</h2><button class="btn" data-cancel-school-catalog type="button">Cancelar</button></div>
      <p id="schoolCatalogConfirmText">Confirme el diseño elegido.</p>
      <div class="actions"><button class="btn btn-primary" data-confirm-school-catalog type="button">Sí, confirmar elección</button><button class="btn" data-cancel-school-catalog type="button">Revisar opciones</button></div>
    </div>
  </div>`;
}

function requestSchoolCatalogSelection(kind, optionId) {
  const option = [...schoolCatalog.diploma_options, ...schoolCatalog.folder_options].find((item) => item.id === optionId);
  if (!option) return;
  pendingSchoolCatalogSelection = { kind, optionId };
  document.querySelector("#schoolCatalogConfirmText").textContent = `¿Desea confirmar ${kind === "DIPLOMA" ? "el diploma" : "la carpeta"} "${option.name}"? Después podrá pedir cambios comunicándose directamente con Clarisa Rojas.`;
  document.querySelector("#schoolCatalogConfirmDialog").classList.remove("hidden");
}

async function saveSchoolCatalogSelection() {
  if (!pendingSchoolCatalogSelection) return;
  const { kind, optionId } = pendingSchoolCatalogSelection;
  const { data, error } = await supabase.rpc("select_school_catalog_option_by_token", {
    token: itemToken,
    catalog_kind: kind,
    option_id: optionId,
    client_notes: null
  });
  if (error || !data?.ok) {
    console.error(error || data);
    showToast(data?.message || error?.message || "No se pudo guardar la selección.", "error");
    return;
  }
  pendingSchoolCatalogSelection = null;
  if (kind === "DIPLOMA") schoolCatalog.diploma_selected_id = optionId;
  else schoolCatalog.folder_selected_id = optionId;
  showToast(`${kind === "DIPLOMA" ? "Diploma" : "Carpeta"} seleccionado y guardado.`);
  renderSchoolCatalog();
}

function renderPackageQuantityDialog() {
  const quantityOptions = Array.from({ length: 99 }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}">${value}</option>`;
  }).join("");
  return `<div id="packageQuantityDialog" class="modal hidden" role="dialog" aria-modal="true">
    <div class="modal-content compact-modal">
      <div class="page-header"><h2>Opciones del paquete</h2><button class="btn" data-cancel-package-selection type="button">Cerrar</button></div>
      <p id="packageSelectionSummary" class="muted"></p>
      <p class="muted">Seleccione cuántos paquetes necesita para este grupo.</p>
      <div class="form-group"><label>Cantidad</label><select id="catalogPackageQuantity" class="select">${quantityOptions}</select></div>
      <div class="actions"><button class="btn btn-primary" data-confirm-package-selection type="button">Continuar</button><button class="btn" data-cancel-package-selection type="button">Cancelar</button></div>
    </div>
  </div>`;
}

function selectedCatalogOption(optionId) {
  return catalogOptions.find((option) => option.id === optionId);
}

async function saveCatalogSelection(optionTable, optionId, packageQuantity = null, photoFormat = null) {
  const notes = document.querySelector("#catalogClientNotes")?.value || "";
  const rpc = photoFormat ? "select_package_option_by_token" : "select_catalog_option_by_token";
  const args = photoFormat
    ? { token: itemToken, option_id: optionId, client_notes: notes, package_quantity: packageQuantity, photo_format: photoFormat }
    : { token: itemToken, option_table: optionTable, option_id: optionId, client_notes: notes };
  const { data, error } = await supabase.rpc(rpc, args);
  if (error || !data?.ok) {
    console.error(error || data);
    showToast(data?.message || error?.message || "No se pudo guardar la selección.", "error");
    return;
  }
  const selectedOption = selectedCatalogOption(optionId);
  const photoFormatLabel = selectedOption?.photo_presentation === "BASTIDOR" ? "Foto del alumno en bastidor" : selectedOption?.photo_presentation === "GROUP_INDIVIDUAL" ? "Foto grupal e individual" : data.photo_format === "GROUP" ? "Foto grupal" : data.photo_format === "INDIVIDUAL" ? "Foto individual" : "";
  const selectedPackageImage = optionTable === "package_images"
    ? `<div class="catalog-preview-large"><span><img src="${escapeHtml(catalogFileUrl({ table: optionTable, id: optionId }))}" alt="${escapeHtml(data.selected_name || "Paquete seleccionado")}"></span></div>`
    : "";
  content.innerHTML = `<div class="alert alert-success"><h1>Selección guardada.</h1><p>Gracias. Clarisa recibirá su selección para continuar con el pedido.</p>${selectedPackageImage}<p><strong>Selección:</strong> ${escapeHtml(data.selected_name || "")}${photoFormatLabel ? ` · ${photoFormatLabel}` : ""}</p>${data.package_quantity ? `<p><strong>Cantidad:</strong> ${data.package_quantity}<br><strong>Total:</strong> ${formatMoney(data.price || 0)}</p>` : ""}</div>`;
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
    const hasPersonalizedPreview = (data.preview_files || []).length > 0;
    if (["DIPLOMA", "FOLDER_OPTION"].includes(data.print_item?.item_type) && !hasPersonalizedPreview) {
      const combinedResult = await supabase.rpc("get_public_school_catalog_by_print_item_token", { token: itemToken });
      if (combinedResult.error) {
        console.error(combinedResult.error);
        content.innerHTML = `<div class="alert alert-error">No se pudo cargar el catálogo conjunto. Falta aplicar la migración de catálogo escolar en Supabase.</div>`;
        return;
      }
      if (combinedResult.data) {
        schoolCatalog = combinedResult.data;
        renderSchoolCatalog();
        return;
      }
    }
    if (["DIPLOMA", "PHOTO_PACKAGE", "FOLDER_OPTION"].includes(data.print_item?.item_type) && (!data.print_item?.selected_file_id || data.print_item?.item_type === "PHOTO_PACKAGE")) {
      const catalogRpc = data.print_item?.item_type === "PHOTO_PACKAGE" ? "get_public_school_package_options_by_token" : "get_public_catalog_by_print_item_token";
      const catalogResult = await supabase.rpc(catalogRpc, { token: itemToken });
      if (catalogResult.error && data.print_item?.item_type === "PHOTO_PACKAGE") {
        console.error(catalogResult.error);
        content.innerHTML = `<div class="alert alert-error">No se pudo cargar el catálogo de paquetes. Falta ejecutar en Supabase la migración <code>sql/school-package-presentation-options.sql</code>.</div>`;
        return;
      }
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

document.addEventListener("input", (event) => {
  if (event.target.id === "catalogClientNotes") catalogClientNotes = event.target.value;
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-select-school-catalog]");
  if (button && schoolCatalog) {
    const [kind, optionId] = button.dataset.selectSchoolCatalog.split(":");
    requestSchoolCatalogSelection(kind, optionId);
    return;
  }
  if (event.target.closest("[data-cancel-school-catalog]")) {
    pendingSchoolCatalogSelection = null;
    document.querySelector("#schoolCatalogConfirmDialog")?.classList.add("hidden");
    return;
  }
  if (event.target.closest("[data-confirm-school-catalog]")) {
    await saveSchoolCatalogSelection();
  }
});

document.addEventListener("click", async (event) => {
  const tierButton = event.target.closest("[data-select-package-tier]");
  if (tierButton) {
    selectedPackageTier = tierButton.dataset.selectPackageTier;
    renderCatalogSelection();
    return;
  }
  if (event.target.closest("[data-back-package-tiers]")) {
    selectedPackageTier = null;
    renderCatalogSelection();
    return;
  }
  const selectionButton = event.target.closest("[data-select-catalog]");
  if (!selectionButton) return;
  const [optionTable, optionId] = selectionButton.dataset.selectCatalog.split(":");
  if (optionTable === "package_images") {
    pendingCatalogSelection = { optionTable, optionId };
    document.querySelector("#catalogPackageQuantity").value = "1";
    const option = selectedCatalogOption(optionId);
    const formatLabel = option?.photo_presentation === "BASTIDOR" ? "Foto del alumno en bastidor" : "Foto grupal e individual";
    document.querySelector("#packageSelectionSummary").textContent = `${option?.name || "Paquete"} · ${formatLabel} · ${formatMoney(option?.price || 0)}`;
    document.querySelector("#packageQuantityDialog").classList.remove("hidden");
    return;
  }
  const confirmed = confirm("¿Confirmar esta selección?");
  if (!confirmed) return;
  await saveCatalogSelection(optionTable, optionId);
});

document.addEventListener("click", async (event) => {
  if (event.target.dataset.cancelPackageSelection !== undefined) {
    pendingCatalogSelection = null;
    document.querySelector("#packageQuantityDialog")?.classList.add("hidden");
    return;
  }
  if (event.target.dataset.confirmPackageSelection === undefined || !pendingCatalogSelection) return;
  const packageQuantity = Number(document.querySelector("#catalogPackageQuantity")?.value || 0);
  const option = selectedCatalogOption(pendingCatalogSelection.optionId);
  const optionName = option?.name || "este paquete";
  const photoFormat = option?.photo_presentation === "BASTIDOR" ? "INDIVIDUAL" : "GROUP";
  const photoFormatLabel = option?.photo_presentation === "BASTIDOR" ? "Foto del alumno en bastidor" : "Foto grupal e individual";
  const confirmed = confirm(`¿Confirmar ${option?.package_tier === "SMALL" ? "paquete chico" : "paquete grande"}, ${photoFormatLabel} y ${packageQuantity} paquete${packageQuantity === 1 ? "" : "s"}? Precio por paquete: ${formatMoney(option?.price || 0)}.`);
  if (!confirmed) return;
  const selection = pendingCatalogSelection;
  pendingCatalogSelection = null;
  document.querySelector("#packageQuantityDialog")?.classList.add("hidden");
  await saveCatalogSelection(selection.optionTable, selection.optionId, packageQuantity, photoFormat);
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-open-print-confirm]")) {
    const nameInput = document.querySelector('#printItemApprovalForm [name="approval_name"]');
    if (!nameInput.value.trim()) {
      nameInput.focus();
      return showToast("Escriba el nombre de quien autoriza.", "error");
    }
    document.querySelector("#printApprovalConfirmDialog")?.classList.remove("hidden");
    return;
  }
  if (event.target.closest("[data-cancel-print-confirm]")) {
    document.querySelector("#printApprovalConfirmDialog")?.classList.add("hidden");
    return;
  }
  const confirmButton = event.target.closest("[data-confirm-print-approval]");
  if (!confirmButton) return;
  const approvalName = document.querySelector('#printItemApprovalForm [name="approval_name"]')?.value.trim();
  if (!approvalName) return showToast("Escriba el nombre de quien autoriza.", "error");
  confirmButton.disabled = true;
  const { data, error } = await supabase.rpc("approve_print_item_by_token", { token: itemToken, approval_name: approvalName });
  confirmButton.disabled = false;
  if (error || !data?.ok) {
    console.error(error || data);
    showToast(data?.message || "No se pudo aprobar la pieza.", "error");
    return;
  }
  content.innerHTML = `<div class="alert alert-success"><h1>Pieza autorizada para impresión.</h1><p>Gracias. La aprobación fue registrada correctamente.</p></div>`;
});

document.addEventListener("submit", async (event) => {
  if (event.target.matches("#printItemApprovalForm")) {
    event.preventDefault();
    const action = event.submitter?.value || "changes";
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
