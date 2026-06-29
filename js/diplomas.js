import { requireAuth } from "./auth.js";
import { getCatalogFileUrl, getDiplomaTemplates, toggleDiplomaTemplate, uploadDiplomaTemplate } from "./catalog.js";
import { escapeHtml, showToast } from "./utils.js";
import { formatDateTime } from "./formatters.js";

await requireAuth();

let templates = [];
const modal = document.querySelector("#diplomaModal");
const form = document.querySelector("#diplomaForm");
const schoolLevelLabel = (value) => ({ KINDER: "Preescolar / Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[value] || "Sin nivel");

function render() {
  document.querySelector("#diplomaTemplates").innerHTML = templates.length ? `<div class="catalog-grid">${templates.map((template) => `<article class="catalog-card"><div class="catalog-card-header"><div><h3>${escapeHtml(template.name)}</h3><p class="muted">${schoolLevelLabel(template.school_level)} · ${escapeHtml(template.file_name)} · ${formatDateTime(template.created_at)}</p></div><span class="badge">${template.is_active ? "Activo" : "Inactivo"}</span></div><button class="catalog-preview-large" data-open-catalog-file="diploma_templates:${template.id}" type="button"><span data-catalog-thumb="diploma_templates:${template.id}">DIPLOMA</span></button><div class="actions"><button class="btn" data-open-catalog-file="diploma_templates:${template.id}">Abrir</button><button class="btn ${template.is_active ? "btn-danger" : ""}" data-toggle-diploma="${template.id}" data-active="${template.is_active ? "false" : "true"}">${template.is_active ? "Desactivar" : "Activar"}</button></div></article>`).join("")}</div>` : `<div class="empty-state">Aún no hay diplomas en el catálogo.</div>`;
  hydrateThumbs();
}

async function hydrateThumbs() {
  const thumbs = Array.from(document.querySelectorAll("[data-catalog-thumb]"));
  await Promise.all(thumbs.map(async (thumb) => {
    const [table, fileId] = thumb.dataset.catalogThumb.split(":");
    try {
      const url = await getCatalogFileUrl(table, fileId);
      thumb.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
    } catch {
      thumb.textContent = "DIPLOMA";
    }
  }));
}

async function load() {
  templates = await getDiplomaTemplates();
  render();
}

document.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-catalog-file]");
  if (event.target.matches("#newDiplomaBtn")) modal.classList.remove("hidden");
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (openButton) {
    const [table, fileId] = openButton.dataset.openCatalogFile.split(":");
    window.open(await getCatalogFileUrl(table, fileId), "_blank", "noopener");
  }
  if (event.target.dataset.toggleDiploma) {
    await toggleDiplomaTemplate(event.target.dataset.toggleDiploma, event.target.dataset.active === "true");
    showToast("Diploma actualizado.");
    await load();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = form.file.files?.[0];
  if (!file) return showToast("Seleccione un archivo.", "error");
  try {
    await uploadDiplomaTemplate(form.name.value.trim(), form.school_level.value, file);
    showToast("Diploma subido al catálogo.");
    form.reset();
    modal.classList.add("hidden");
    await load();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo subir el diploma.", "error");
  }
});

load().catch((error) => {
  console.error(error);
  showToast("No se pudo cargar el catálogo de diplomas.", "error");
});
