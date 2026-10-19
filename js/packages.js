import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { getCatalogFileUrl, getPackageImages, uploadPackageImage } from "./catalog.js";
import { PACKAGE_TYPES } from "./constants.js";
import { bindFileDropzone, escapeHtml, formToObject, showToast } from "./utils.js";
import { formatMoney } from "./formatters.js";
import { PACKAGE_LEVELS } from "./package-levels.js";

await requireAuth(["owner"]);
let packages = [];
let packageImages = [];
let editingPackage = null;
let packageOffers = [];
let editingOffer = null;
const modal = document.querySelector("#packageModal");
const form = document.querySelector("#packageForm");
const options = (selected = "") => Object.entries(PACKAGE_TYPES).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
const packageSections = [
  { type: "SCHOOL_GRADUATION", title: "Graduaciones escolares", description: "Solo se mostrarán a los grupos de trabajos de graduación." },
  { type: "SCHOOL_MEMORY", title: "Fotografía de recuerdo", description: "Solo se mostrarán a los grupos de trabajos de fotografía de recuerdo." },
  { type: "SCHOOL_CHRISTMAS", title: "Fotografía navideña", description: "Paquete único que se asigna automáticamente a cada grupo navideño." },
  { type: "PHOTO_SESSION", title: "Sesiones particulares", description: "Catálogo reservado para trabajos particulares." },
  { type: "GENERAL", title: "Sin clasificar", description: "Estos paquetes no se muestran a escuelas. Edítelos y asígneles una categoría para utilizarlos." }
];

function renderForm(item = {}) {
  form.innerHTML = `
    <div class="form-grid">
      <div class="form-group"><label>Nombre</label><input class="input" name="name" required value="${escapeHtml(item.name)}"></div>
      <div class="form-group"><label>Tipo de paquete</label><select class="select" name="package_type" required>${options(item.package_type || "GENERAL")}</select></div>
      <div class="form-group" id="packageLevelField"><label>Nivel escolar</label><select class="select" name="school_level"><option value="">Seleccione</option>${Object.entries(PACKAGE_LEVELS).map(([value, label]) => `<option value="${value}" ${item.school_level === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="form-group" id="packageTierField"><label>Paquete que verá la maestra</label><select class="select" name="package_tier"><option value="">No aplica</option><option value="SMALL" ${item.package_tier === "SMALL" ? "selected" : ""}>Paquete 1</option><option value="LARGE" ${item.package_tier === "LARGE" ? "selected" : ""}>Paquete 2</option></select></div>
      <div class="form-group" id="packagePresentationField"><label>Formato que verá la maestra</label><select class="select" name="photo_presentation"><option value="">Seleccione</option><option value="BASTIDOR" ${item.photo_presentation === "BASTIDOR" ? "selected" : ""}>Foto individual</option><option value="GROUP_INDIVIDUAL" ${item.photo_presentation === "GROUP_INDIVIDUAL" ? "selected" : ""}>Foto grupal</option></select></div>
      <div class="form-group"><label>Precio</label><input class="input" type="number" min="0" step="0.01" name="price" required value="${item.price ?? 0}"></div>
      <div class="form-group"><label>Activo</label><select class="select" name="is_active"><option value="true" ${item.is_active !== false ? "selected" : ""}>Sí</option><option value="false" ${item.is_active === false ? "selected" : ""}>No</option></select></div>
    </div>
    <div class="form-group"><label>Descripción</label><textarea class="textarea" name="description">${escapeHtml(item.description)}</textarea></div>
    <button class="btn btn-primary" type="submit">Guardar paquete</button>`;
  const updateLevel = () => {
    const graduation = form.package_type.value === "SCHOOL_GRADUATION";
    const schoolCatalog = ["SCHOOL_GRADUATION", "SCHOOL_MEMORY"].includes(form.package_type.value);
    form.school_level.required = graduation;
    document.querySelector("#packageLevelField").hidden = !graduation;
    document.querySelector("#packageTierField").hidden = !schoolCatalog;
    document.querySelector("#packagePresentationField").hidden = !schoolCatalog;
    form.package_tier.required = schoolCatalog;
    form.photo_presentation.required = schoolCatalog;
  };
  form.package_type.addEventListener("change", updateLevel);
  updateLevel();
}

function renderPackageCard(item) {
  const images = packageImages.filter((image) => image.package_id === item.id);
  const tierLabel = { SMALL: "Paquete 1", LARGE: "Paquete 2" }[item.package_tier];
  const presentationLabel = { BASTIDOR: "Foto individual", GROUP_INDIVIDUAL: "Foto grupal" }[item.photo_presentation];
  return `<article class="catalog-card"><div class="catalog-card-header"><div><h3>${escapeHtml(item.name)}</h3><p class="muted">${formatMoney(item.price)}</p></div><span class="badge">${item.is_active ? "Activo" : "Inactivo"}</span></div>${tierLabel ? `<p><strong>${tierLabel}</strong><br>${escapeHtml(presentationLabel || "Presentación pendiente")}</p>` : ""}<p>${escapeHtml(item.description || "")}</p><div class="catalog-thumbs">${images.length ? images.map((image) => `<button class="catalog-thumb" data-open-catalog-file="package_images:${image.id}" type="button"><span data-catalog-thumb="package_images:${image.id}">IMG</span></button>`).join("") : `<div class="empty-state compact-empty">Sin imágenes</div>`}</div><div class="mini-dropzone package-image-dropzone" tabindex="0" data-package-dropzone="${item.id}"><strong>Subir imagen(es)</strong><span>Arrastre aquí o haga clic</span><input type="file" accept="image/*" multiple hidden data-package-upload="${item.id}"></div><div class="actions"><button class="btn" data-edit="${item.id}">Editar</button><button class="btn btn-danger" data-deactivate="${item.id}">Desactivar</button></div></article>`;
}

function renderOfferCard(offer) {
  const variants = packages.filter((pkg) => pkg.package_offer_id === offer.id);
  const formatLabels = { BASTIDOR: "Foto individual", GROUP_INDIVIDUAL: "Foto grupal" };
  const variantCards = ["BASTIDOR", "GROUP_INDIVIDUAL"].map((format) => {
    const variant = variants.find((pkg) => pkg.photo_presentation === format);
    if (!variant) return `<div class="empty-state compact-empty">${formatLabels[format]} · variante pendiente</div>`;
    const images = packageImages.filter((image) => image.package_id === variant.id);
    return `<section class="package-offer-variant"><div class="catalog-card-header"><h4>${formatLabels[format]}</h4><span class="badge">${images.length} imágenes</span></div><div class="catalog-thumbs">${images.length ? images.map((image) => `<button class="catalog-thumb" data-open-catalog-file="package_images:${image.id}" type="button"><span data-catalog-thumb="package_images:${image.id}">IMG</span></button>`).join("") : '<div class="empty-state compact-empty">Suba la imagen de esta presentación</div>'}</div><div class="mini-dropzone package-image-dropzone" tabindex="0" data-package-dropzone="${variant.id}"><strong>Subir imagen(es)</strong><span>Arrastre aquí o haga clic</span><input type="file" accept="image/*" multiple hidden data-package-upload="${variant.id}"></div></section>`;
  }).join("");
  return `<article class="catalog-card package-offer-card"><div class="catalog-card-header"><div><h3>${escapeHtml(offer.name)}</h3><p class="muted">${formatMoney(offer.price)}</p></div><span class="badge">${offer.is_active ? "Activo" : "Inactivo"}</span></div><div class="package-offer-variants">${variantCards}</div><div class="actions"><button class="btn" data-edit-offer="${offer.id}">Editar paquete</button></div></article>`;
}

function openOfferModal(packageType, schoolLevel = "", offer = null) {
  editingOffer = offer;
  editingPackage = null;
  document.querySelector("#packageModalTitle").textContent = offer ? "Editar paquete" : "Nuevo paquete";
  const type = offer?.package_type || packageType;
  form.innerHTML = `<input type="hidden" name="package_type" value="${escapeHtml(type)}"><div class="form-grid"><div class="form-group"><label>Nombre del paquete</label><input class="input" name="name" required value="${escapeHtml(offer?.name || "")}" placeholder="Paquete mediano"></div><div class="form-group"><label>Tipo de paquete</label><input class="input" value="${escapeHtml(PACKAGE_TYPES[type] || type)}" readonly></div>${type === "SCHOOL_GRADUATION" ? `<div class="form-group"><label>Nivel escolar</label><select class="select" name="school_level"><option value="">Seleccione</option>${Object.entries(PACKAGE_LEVELS).map(([value, label]) => `<option value="${value}" ${(offer?.school_level || schoolLevel) === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>` : ""}<div class="form-group"><label>Precio del paquete</label><input class="input" type="number" min="0" step="0.01" name="price" required value="${offer?.price ?? 0}"></div><div class="form-group"><label>Activo</label><select class="select" name="is_active"><option value="true" ${offer?.is_active !== false ? "selected" : ""}>Sí</option><option value="false" ${offer?.is_active === false ? "selected" : ""}>No</option></select></div></div><p class="muted">El paquete tendrá dos presentaciones: foto individual y foto grupal. Cada una conserva su propia imagen y ambas usan este precio.</p><button class="btn btn-primary" type="submit">Guardar paquete</button>`;
  form.dataset.creatingOffer = offer ? "" : "true";
  form.dataset.offerType = type;
  modal.classList.remove("hidden");
}

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const active = document.querySelector("#activeFilter").value;
  const visiblePackages = packages.filter((item) => (!search || item.name.toLowerCase().includes(search)) && (active === "" || String(item.is_active) === active));
  const sections = packageSections.map((section) => {
    const items = visiblePackages.filter((item) => item.package_type === section.type);
    if (section.type === "SCHOOL_GRADUATION") {
      return `<section class="package-category"><h2>Graduaciones escolares</h2>${[...Object.entries(PACKAGE_LEVELS), ["", "Sin nivel asignado"]].map(([level, label]) => {
        const levelItems = items.filter((item) => (item.school_level || "") === level);
        const offers = packageOffers.filter((offer) => offer.package_type === "SCHOOL_GRADUATION" && (offer.school_level || "") === level && (active === "" || String(offer.is_active) === active) && (!search || offer.name.toLowerCase().includes(search)));
        return `<section class="catalog-subsection"><div class="page-header"><h3>${label}</h3>${level ? `<button class="btn" data-new-offer-type="SCHOOL_GRADUATION" data-level="${level}">Agregar paquete</button>` : ""}</div>${offers.length ? `<div class="catalog-grid">${offers.map(renderOfferCard).join("")}</div>` : '<div class="empty-state compact-empty">Sin paquetes agrupados</div>'}${levelItems.filter((item) => !item.package_offer_id).length ? `<h4>Paquetes sin agrupar</h4><div class="catalog-grid">${levelItems.filter((item) => !item.package_offer_id).map(renderPackageCard).join("")}</div>` : ""}</section>`;
      }).join("")}</section>`;
    }
    if (section.type === "SCHOOL_MEMORY") {
      const offers = packageOffers.filter((offer) => offer.package_type === section.type && (active === "" || String(offer.is_active) === active) && (!search || offer.name.toLowerCase().includes(search)));
      return `<section class="package-category"><div class="package-category-header"><div><h2>${section.title}</h2><p class="muted">${section.description}</p></div><button class="btn" data-new-offer-type="${section.type}">Agregar paquete</button></div>${offers.length ? `<div class="catalog-grid">${offers.map(renderOfferCard).join("")}</div>` : '<div class="empty-state compact-empty">Sin paquetes agrupados</div>'}${items.filter((item) => !item.package_offer_id).length ? `<h3>Paquetes sin agrupar</h3><div class="catalog-grid">${items.filter((item) => !item.package_offer_id).map(renderPackageCard).join("")}</div>` : ""}</section>`;
    }
    return `<section class="package-category" data-package-category="${section.type}"><div class="package-category-header"><div><h2>${section.title}</h2><p class="muted">${section.description}</p></div><button class="btn" type="button" data-new-package-type="${section.type}">Agregar paquete</button></div>${items.length ? `<div class="catalog-grid">${items.map(renderPackageCard).join("")}</div>` : `<div class="empty-state compact-empty">No hay paquetes en esta categoría.</div>`}</section>`;
  }).join("");
  document.querySelector("#packagesTable").innerHTML = `<div class="package-categories">${sections}</div>`;
  bindPackageDropzones();
  hydrateCatalogThumbs();
}

function bindPackageDropzones() {
  document.querySelectorAll("[data-package-dropzone]").forEach((dropzone) => {
    const packageId = dropzone.dataset.packageDropzone;
    const input = dropzone.querySelector("[data-package-upload]");
    bindFileDropzone(dropzone, input, (files) => uploadPackageFiles(packageId, files, input));
  });
}

async function uploadPackageFiles(packageId, files, input) {
  if (!files.length) return;
  try {
    for (const file of files) await uploadPackageImage(packageId, file);
    showToast(files.length === 1 ? "Imagen del paquete subida." : "Imágenes del paquete subidas.");
    await load();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo subir la imagen.", "error");
  } finally {
    if (input) input.value = "";
  }
}

async function load() {
  const [packageResult, offerResult] = await Promise.all([supabase.from("packages").select("*").order("created_at", { ascending: false }), supabase.from("package_offers").select("*").order("sort_order").order("created_at")]);
  const { data, error } = packageResult;
  if (error) throw error;
  if (offerResult.error) throw offerResult.error;
  packages = data || [];
  packageOffers = offerResult.data || [];
  packageImages = await getPackageImages();
  render();
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

function openModal(item = null, packageType = "SCHOOL_GRADUATION", schoolLevel = "") {
  editingPackage = item;
  editingOffer = null;
  form.dataset.creatingOffer = "";
  document.querySelector("#packageModalTitle").textContent = item ? "Editar paquete" : "Nuevo paquete";
  renderForm(item || { is_active: true, price: 0, package_type: packageType, school_level: schoolLevel });
  modal.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.creatingOffer === "true") return;
  const data = formToObject(form);
  if (Number(data.price) < 0) return showToast("El precio debe ser mayor o igual a 0.", "error");
  if (editingOffer) {
    const updateOffer = await supabase.from("package_offers").update({ name: data.name.trim(), price: Number(data.price), is_active: data.is_active === "true", updated_at: new Date().toISOString() }).eq("id", editingOffer.id);
    if (updateOffer.error) return showToast("No se pudo actualizar el paquete.", "error");
    editingOffer = null;
    form.dataset.creatingOffer = "";
    modal.classList.add("hidden");
    showToast("Paquete actualizado.");
    return load();
  }
  if (data.package_type === "SCHOOL_CHRISTMAS" && data.is_active === "true") {
    const { data: activeChristmasPackages, error } = await supabase.from("packages").select("id").eq("package_type", "SCHOOL_CHRISTMAS").eq("is_active", true);
    if (error) return showToast("No se pudo validar el paquete navideño.", "error");
    if (activeChristmasPackages.some((item) => item.id !== editingPackage?.id)) {
      return showToast("Solo puede existir un paquete navideño activo. Desactive o edite el paquete actual.", "error");
    }
  }
  const payload = { name: data.name.trim(), package_type: data.package_type, description: data.description || null, price: Number(data.price), is_active: data.is_active === "true", package_tier: ["SCHOOL_GRADUATION", "SCHOOL_MEMORY"].includes(data.package_type) ? data.package_tier : null, photo_presentation: ["SCHOOL_GRADUATION", "SCHOOL_MEMORY"].includes(data.package_type) ? data.photo_presentation : null };
  payload.school_level = data.package_type === "SCHOOL_GRADUATION" ? data.school_level : null;
  if (data.package_type === "SCHOOL_GRADUATION" && !PACKAGE_LEVELS[data.school_level]) return showToast("Seleccione el nivel escolar.", "error");
  const { error } = editingPackage ? await supabase.from("packages").update(payload).eq("id", editingPackage.id) : await supabase.from("packages").insert(payload);
  if (error) { console.error(error); return showToast("No se pudo guardar el paquete.", "error"); }
  modal.classList.add("hidden");
  showToast("Paquete guardado correctamente.");
  load();
});

async function saveOffer(data, packageType, schoolLevel) {
  const { error } = await supabase.rpc("create_package_offer", {
    offer_name: data.name.trim(), package_type: packageType,
    school_level: schoolLevel || null, offer_price: Number(data.price),
    offer_active: data.is_active === "true"
  });
  if (error) throw error;
}

document.addEventListener("click", async (event) => {
  const catalogButton = event.target.closest("[data-open-catalog-file]");
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("#newPackageBtn")) openModal();
  if (button.dataset.newPackageType) openModal(null, button.dataset.newPackageType, button.dataset.level);
  if (button.dataset.newOfferType) openOfferModal(button.dataset.newOfferType, button.dataset.level || "");
  if (button.matches("[data-close-modal]")) { modal.classList.add("hidden"); form.dataset.creatingOffer = ""; editingOffer = null; }
  if (button.dataset.edit) openModal(packages.find((item) => item.id === button.dataset.edit));
  if (button.dataset.editOffer) openOfferModal("", "", packageOffers.find((offer) => offer.id === button.dataset.editOffer));
  if (catalogButton) {
    const [table, fileId] = catalogButton.dataset.openCatalogFile.split(":");
    window.open(await getCatalogFileUrl(table, fileId), "_blank", "noopener");
  }
  if (button.dataset.deactivate && confirm("¿Desactivar este paquete?")) {
    await supabase.from("packages").update({ is_active: false }).eq("id", button.dataset.deactivate);
    showToast("Paquete desactivado.");
    load();
  }
});

form.addEventListener("submit", async (event) => {
  if (form.dataset.creatingOffer !== "true") return;
  event.preventDefault();
  const data = formToObject(form);
  const type = form.dataset.offerType;
  const level = data.school_level || "";
  if (!data.name.trim() || Number(data.price) < 0) return showToast("Revise el nombre y el precio.", "error");
  if (type === "SCHOOL_GRADUATION" && !PACKAGE_LEVELS[level]) return showToast("Seleccione el nivel escolar.", "error");
  try {
    await saveOffer(data, type, level);
    form.dataset.creatingOffer = "";
    modal.classList.add("hidden");
    showToast("Paquete y sus dos presentaciones guardados.");
    await load();
  } catch (error) {
    console.error(error);
    showToast("No se pudo crear el paquete y sus presentaciones.", "error");
  }
});
["searchInput", "activeFilter"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", render));
load().catch((error) => { console.error(error); showToast("No se pudo cargar la información.", "error"); });
