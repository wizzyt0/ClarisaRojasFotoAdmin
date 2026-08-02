import { requireAuth } from "./auth.js";
import { getCatalogFileUrl, getDiplomaTemplates, getFolderTemplates, updateDiplomaTemplate, uploadDiplomaTemplate, uploadFolderTemplate } from "./catalog.js";
import { escapeHtml, showToast } from "./utils.js";
import { formatDateTime } from "./formatters.js";

await requireAuth();

let templates = [];
let folderTemplates = [];
const modal = document.querySelector("#diplomaModal");
const form = document.querySelector("#diplomaForm");
const schoolLevelLabel = (value) => ({ KINDER: "Preescolar / Kinder", PRIMARY: "Primaria", SECONDARY: "Secundaria" }[value] || "Sin nivel");

function render() {
  document.querySelector("#diplomaTemplates").innerHTML = `
    <section class="catalog-section"><div class="page-header"><h2>Diplomas</h2></div>${renderCatalogGroup(templates, "diploma_templates", "DIPLOMA")}</section>
    <section class="catalog-section"><div class="page-header"><h2>Carpetas</h2></div>${renderCatalogGroup(folderTemplates, "folder_templates", "CARPETA")}</section>
  `;
  hydrateThumbs();
}

function renderCatalogGroup(rows, table, label) {
  return `
    ${renderSection("Preescolar / Kinder", "KINDER", rows, table, label)}
    ${renderSection("Primaria", "PRIMARY", rows, table, label)}
    ${renderSection("Sin nivel asignado", "", rows, table, label)}
  `;
}

function renderSection(title, schoolLevel, sourceRows, table, label) {
  const rows = schoolLevel ? sourceRows.filter((template) => template.school_level === schoolLevel) : sourceRows.filter((template) => !template.school_level || !["KINDER", "PRIMARY"].includes(template.school_level));
  return `<section class="catalog-subsection"><div class="page-header"><h3>${title}</h3><span class="badge">${rows.length}</span></div>${rows.length ? `<div class="catalog-grid">${rows.map((template) => renderTemplateCard(template, table, label)).join("")}</div>` : `<div class="empty-state">No hay diseños en esta sección.</div>`}</section>`;
}

function renderTemplateCard(template, table, label) {
  const canvaField = table === "diploma_templates" ? `<div class="form-group private-catalog-field"><label>Link privado de Canva</label><input class="input" type="url" data-canva-url="${template.id}" value="${escapeHtml(template.canva_url || "")}" placeholder="https://www.canva.com/design/..."><button class="btn" type="button" data-save-canva="${template.id}">Guardar link</button></div>` : "";
  return `<article class="catalog-card"><div class="catalog-card-header"><div><h3>${escapeHtml(template.name)}</h3><p class="muted">${schoolLevelLabel(template.school_level)} · ${escapeHtml(template.file_name)} · ${formatDateTime(template.created_at)}</p></div><span class="badge">${template.is_active ? "Activo" : "Inactivo"}</span></div><button class="catalog-preview-large" data-open-catalog-file="${table}:${template.id}" type="button"><span data-catalog-thumb="${table}:${template.id}">${label}</span></button>${canvaField}<div class="actions"><button class="btn" data-open-catalog-file="${table}:${template.id}">Abrir</button><button class="btn" data-set-level="${template.id}" data-table="${table}" data-level="KINDER">Mover a preescolar</button><button class="btn" data-set-level="${template.id}" data-table="${table}" data-level="PRIMARY">Mover a primaria</button><button class="btn ${template.is_active ? "btn-danger" : ""}" data-toggle-template="${template.id}" data-table="${table}" data-active="${template.is_active ? "false" : "true"}">${template.is_active ? "Desactivar" : "Activar"}</button></div></article>`;
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
  [templates, folderTemplates] = await Promise.all([getDiplomaTemplates(), getFolderTemplates()]);
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
  if (event.target.dataset.toggleTemplate) {
    await updateDiplomaTemplate(event.target.dataset.toggleTemplate, { is_active: event.target.dataset.active === "true" }, event.target.dataset.table);
    showToast("Diseño actualizado.");
    await load();
  }
  if (event.target.dataset.setLevel) {
    await updateDiplomaTemplate(event.target.dataset.setLevel, { school_level: event.target.dataset.level }, event.target.dataset.table);
    showToast("Diseño movido de sección.");
    await load();
  }
  if (event.target.dataset.saveCanva) {
    const templateId = event.target.dataset.saveCanva;
    const input = document.querySelector(`[data-canva-url="${templateId}"]`);
    try {
      await updateDiplomaTemplate(templateId, { canva_url: input?.value.trim() || "" });
      showToast("Link de Canva guardado.");
      await load();
    } catch (error) {
      console.error(error);
      showToast(error.message || "No se pudo guardar el link de Canva.", "error");
    }
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = form.file.files?.[0];
  if (!file) return showToast("Seleccione un archivo.", "error");
  try {
    if (form.catalog_kind.value === "FOLDER") await uploadFolderTemplate(form.name.value.trim(), form.school_level.value, file);
    else await uploadDiplomaTemplate(form.name.value.trim(), form.school_level.value, file, form.canva_url.value);
    showToast("Diseño subido al catálogo.");
    form.reset();
    modal.classList.add("hidden");
    await load();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo subir el diseño.", "error");
  }
});

load().catch((error) => {
  console.error(error);
  showToast("No se pudo cargar el catálogo de diplomas.", "error");
});
