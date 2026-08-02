import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { getCatalogFileUrl, getPackageImages, uploadPackageImage } from "./catalog.js";
import { PACKAGE_TYPES } from "./constants.js";
import { escapeHtml, formToObject, showToast } from "./utils.js";
import { formatMoney } from "./formatters.js";

await requireAuth();
let packages = [];
let packageImages = [];
let editingPackage = null;
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
      <div class="form-group"><label>Precio</label><input class="input" type="number" min="0" step="0.01" name="price" required value="${item.price ?? 0}"></div>
      <div class="form-group"><label>Activo</label><select class="select" name="is_active"><option value="true" ${item.is_active !== false ? "selected" : ""}>Sí</option><option value="false" ${item.is_active === false ? "selected" : ""}>No</option></select></div>
    </div>
    <div class="form-group"><label>Descripción</label><textarea class="textarea" name="description">${escapeHtml(item.description)}</textarea></div>
    <button class="btn btn-primary" type="submit">Guardar paquete</button>`;
}

function renderPackageCard(item) {
  const images = packageImages.filter((image) => image.package_id === item.id);
  return `<article class="catalog-card"><div class="catalog-card-header"><div><h3>${escapeHtml(item.name)}</h3><p class="muted">${formatMoney(item.price)}</p></div><span class="badge">${item.is_active ? "Activo" : "Inactivo"}</span></div><p>${escapeHtml(item.description || "")}</p><div class="catalog-thumbs">${images.length ? images.map((image) => `<button class="catalog-thumb" data-open-catalog-file="package_images:${image.id}" type="button"><span data-catalog-thumb="package_images:${image.id}">IMG</span></button>`).join("") : `<div class="empty-state compact-empty">Sin imágenes</div>`}</div><div class="actions"><label class="btn">Subir imagen<input type="file" accept="image/*" multiple hidden data-package-upload="${item.id}"></label><button class="btn" data-edit="${item.id}">Editar</button><button class="btn btn-danger" data-deactivate="${item.id}">Desactivar</button></div></article>`;
}

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const active = document.querySelector("#activeFilter").value;
  const visiblePackages = packages.filter((item) => (!search || item.name.toLowerCase().includes(search)) && (active === "" || String(item.is_active) === active));
  const sections = packageSections.map((section) => {
    const items = visiblePackages.filter((item) => item.package_type === section.type);
    return `<section class="package-category" data-package-category="${section.type}"><div class="package-category-header"><div><h2>${section.title}</h2><p class="muted">${section.description}</p></div><button class="btn" type="button" data-new-package-type="${section.type}">Agregar paquete</button></div>${items.length ? `<div class="catalog-grid">${items.map(renderPackageCard).join("")}</div>` : `<div class="empty-state compact-empty">No hay paquetes en esta categoría.</div>`}</section>`;
  }).join("");
  document.querySelector("#packagesTable").innerHTML = `<div class="package-categories">${sections}</div>`;
  hydrateCatalogThumbs();
}

async function load() {
  const { data, error } = await supabase.from("packages").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  packages = data || [];
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

function openModal(item = null, packageType = "SCHOOL_GRADUATION") {
  editingPackage = item;
  document.querySelector("#packageModalTitle").textContent = item ? "Editar paquete" : "Nuevo paquete";
  renderForm(item || { is_active: true, price: 0, package_type: packageType });
  modal.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  if (Number(data.price) < 0) return showToast("El precio debe ser mayor o igual a 0.", "error");
  if (data.package_type === "SCHOOL_CHRISTMAS" && data.is_active === "true") {
    const { data: activeChristmasPackages, error } = await supabase.from("packages").select("id").eq("package_type", "SCHOOL_CHRISTMAS").eq("is_active", true);
    if (error) return showToast("No se pudo validar el paquete navideño.", "error");
    if (activeChristmasPackages.some((item) => item.id !== editingPackage?.id)) {
      return showToast("Solo puede existir un paquete navideño activo. Desactive o edite el paquete actual.", "error");
    }
  }
  const payload = { name: data.name.trim(), package_type: data.package_type, description: data.description || null, price: Number(data.price), is_active: data.is_active === "true" };
  const { error } = editingPackage ? await supabase.from("packages").update(payload).eq("id", editingPackage.id) : await supabase.from("packages").insert(payload);
  if (error) { console.error(error); return showToast("No se pudo guardar el paquete.", "error"); }
  modal.classList.add("hidden");
  showToast("Paquete guardado correctamente.");
  load();
});

document.addEventListener("click", async (event) => {
  const catalogButton = event.target.closest("[data-open-catalog-file]");
  if (event.target.matches("#newPackageBtn")) openModal();
  if (event.target.dataset.newPackageType) openModal(null, event.target.dataset.newPackageType);
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (event.target.dataset.edit) openModal(packages.find((item) => item.id === event.target.dataset.edit));
  if (catalogButton) {
    const [table, fileId] = catalogButton.dataset.openCatalogFile.split(":");
    window.open(await getCatalogFileUrl(table, fileId), "_blank", "noopener");
  }
  if (event.target.dataset.deactivate && confirm("¿Desactivar este paquete?")) {
    await supabase.from("packages").update({ is_active: false }).eq("id", event.target.dataset.deactivate);
    showToast("Paquete desactivado.");
    load();
  }
});
document.addEventListener("change", async (event) => {
  if (!event.target.dataset.packageUpload) return;
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  try {
    for (const file of files) await uploadPackageImage(event.target.dataset.packageUpload, file);
    showToast(files.length === 1 ? "Imagen del paquete subida." : "Imágenes del paquete subidas.");
    await load();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo subir la imagen.", "error");
  } finally {
    event.target.value = "";
  }
});
["searchInput", "activeFilter"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", render));
load().catch((error) => { console.error(error); showToast("No se pudo cargar la información.", "error"); });
