import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { getAdminFileUrl } from "./r2-files.js";
import { getCatalogFileUrl } from "./catalog.js";
import { escapeHtml, showToast } from "./utils.js";
import { formatDate } from "./formatters.js";

const currentUser = await requireAuth(["owner"]);
if (!currentUser) throw new Error("Acceso solo para administradores.");

const physicalTypes = ["DIPLOMA", "FOLDER_OPTION", "GROUP_PHOTO"];
const stages = [
  { id: "pending", label: "Pendientes de imprimir", statuses: ["APPROVED_FOR_PRINT"] },
  { id: "printing", label: "Enviados a imprenta", statuses: ["PRINTING"] },
  { id: "printed", label: "Impresos", statuses: ["PRINTED"] },
  { id: "delivered", label: "Entregados", statuses: ["DELIVERED"] },
  { id: "design", label: "Diseño / aprobación", statuses: ["PENDING", "READY_FOR_REVIEW", "CATALOG_SELECTED", "SENT_FOR_APPROVAL", "CHANGES_REQUESTED"] }
];
const stageForStatus = new Map(stages.flatMap((stage) => stage.statuses.map((status) => [status, stage.id])));
const itemTypeLabels = { DIPLOMA: "Diploma", FOLDER_OPTION: "Carpeta", GROUP_PHOTO: "Foto / bastidor" };
const itemTypeOrder = { DIPLOMA: 0, FOLDER_OPTION: 1, GROUP_PHOTO: 2 };
const levelLabels = { KINDER: "Preescolar", PRIMARY: "Primaria", SECONDARY: "Secundaria" };
const stateLabels = {
  PENDING: "Selección o archivos pendientes",
  READY_FOR_REVIEW: "Pendiente de revisión interna",
  CATALOG_SELECTED: "Diseño seleccionado · pendiente de trabajar",
  SENT_FOR_APPROVAL: "Esperando aprobación de la maestra",
  CHANGES_REQUESTED: "Correcciones solicitadas",
  APPROVED_FOR_PRINT: "Aprobada para imprimir",
  PRINTING: "En impresión",
  PRINTED: "Impresa · pendiente de entrega",
  DELIVERED: "Entregada"
};

let activeStage = "pending";
let jobs = [];
let groups = [];
let items = [];
let files = [];
let catalogNames = new Map();
let previewUrls = new Map();

const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const levelLabel = (key) => levelLabels[key] || "Nivel sin especificar";
const jobClient = (job) => Array.isArray(job?.clients) ? job.clients[0] : job?.clients;
const schoolProfile = (job) => {
  const client = jobClient(job);
  return Array.isArray(client?.school_profiles) ? client.school_profiles[0] : client?.school_profiles;
};
const itemGroup = (item) => groups.find((group) => group.id === item.group_id);
const itemJob = (item) => jobs.find((job) => job.id === item.job_id);
const schoolName = (item) => {
  const job = itemJob(item);
  return schoolProfile(job)?.school_name || jobClient(job)?.name || "Escuela sin nombre";
};
const itemLevel = (item) => levelLabel(schoolProfile(itemJob(item))?.school_level);

function showLoadError(message) {
  const node = document.querySelector("#printLoadError");
  node.hidden = !message;
  node.textContent = message || "";
}

async function loadData() {
  showLoadError("");
  const [jobsResult, groupsResult, itemsResult] = await Promise.all([
    supabase.from("jobs").select("id,title,job_type,event_type,clients(name,school_profiles(school_name,school_level))").eq("job_type", "SCHOOL_GRADUATION").order("created_at", { ascending: false }),
    supabase.from("school_groups").select("id,job_id,group_name,teacher_name,teacher_phone,student_count,package_quantity,photo_format,selected_package_id"),
    supabase.from("print_items").select("id,job_id,group_id,item_type,title,status,selected_file_id,selected_package_id,approved_at,approved_by_name,updated_at").in("item_type", physicalTypes)
  ]);
  const failed = [jobsResult, groupsResult, itemsResult].find((result) => result.error);
  if (failed) throw failed.error;
  jobs = jobsResult.data || [];
  const jobIds = new Set(jobs.map((job) => job.id));
  groups = (groupsResult.data || []).filter((group) => jobIds.has(group.job_id));
  items = (itemsResult.data || []).filter((item) => jobIds.has(item.job_id) && item.status !== "CANCELLED");

  const itemIds = items.map((item) => item.id);
  if (itemIds.length) {
    const filesResult = await supabase.from("job_files").select("id,print_item_id,file_name,file_type,content_type,created_at").in("print_item_id", itemIds).order("created_at", { ascending: false });
    if (filesResult.error) throw filesResult.error;
    files = filesResult.data || [];
  } else files = [];

  const diplomaIds = [...new Set(items.filter((item) => item.item_type === "DIPLOMA" && item.selected_file_id).map((item) => item.selected_file_id))];
  const folderIds = [...new Set(items.filter((item) => item.item_type === "FOLDER_OPTION" && item.selected_file_id).map((item) => item.selected_file_id))];
  const [diplomasResult, foldersResult] = await Promise.all([
    diplomaIds.length ? supabase.from("diploma_templates").select("id,name").in("id", diplomaIds) : Promise.resolve({ data: [], error: null }),
    folderIds.length ? supabase.from("folder_templates").select("id,name").in("id", folderIds) : Promise.resolve({ data: [], error: null })
  ]);
  const catalogError = diplomasResult.error || foldersResult.error;
  if (catalogError) console.warn("No se pudieron cargar algunos nombres del catálogo:", catalogError);
  catalogNames = new Map([...(diplomasResult.data || []), ...(foldersResult.data || [])].map((row) => [row.id, row.name]));
  await loadPreviewUrls();
  populateFilters();
  render();
}

async function loadPreviewUrls() {
  const latestFiles = new Map();
  for (const file of files) {
    if (file.file_type === "TEACHER_PREVIEW" && String(file.content_type || "").startsWith("image/") && !latestFiles.has(file.print_item_id)) {
      latestFiles.set(file.print_item_id, file);
    }
  }
  const requests = items.map(async (item) => {
    const latest = latestFiles.get(item.id);
    try {
      if (latest) return [item.id, await getAdminFileUrl(latest.id)];
      if (item.selected_file_id && item.item_type === "DIPLOMA") return [item.id, await getCatalogFileUrl("diploma_templates", item.selected_file_id)];
      if (item.selected_file_id && item.item_type === "FOLDER_OPTION") return [item.id, await getCatalogFileUrl("folder_templates", item.selected_file_id)];
    } catch (error) {
      console.warn(`No se pudo preparar el preview de ${item.title}:`, error);
    }
    return [item.id, ""];
  });
  previewUrls = new Map(await Promise.all(requests));
}

function populateFilters() {
  const pieceSelect = document.querySelector("#printPieceFilter");
  const selectedPiece = pieceSelect.value;
  const presentTypes = [...new Set(items.map((item) => item.item_type))].sort((a, b) => (itemTypeOrder[a] ?? 9) - (itemTypeOrder[b] ?? 9));
  pieceSelect.innerHTML = `<option value="">Todas las piezas</option>${presentTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(itemTypeLabels[type] || type)}</option>`).join("")}`;
  if (presentTypes.includes(selectedPiece)) pieceSelect.value = selectedPiece;

  const levelSelect = document.querySelector("#printLevelFilter");
  const selectedLevel = levelSelect.value;
  const presentLevels = [...new Set(items.map(itemLevel))].sort((a, b) => a.localeCompare(b, "es"));
  levelSelect.innerHTML = `<option value="">Todos los niveles</option>${presentLevels.map((level) => `<option value="${escapeHtml(level)}">${escapeHtml(level)}</option>`).join("")}`;
  if (presentLevels.includes(selectedLevel)) levelSelect.value = selectedLevel;
}

function visibleItems() {
  const query = normalize(document.querySelector("#printSearch").value.trim());
  const piece = document.querySelector("#printPieceFilter").value;
  const level = document.querySelector("#printLevelFilter").value;
  const stage = stages.find((entry) => entry.id === activeStage);
  return items.filter((item) => {
    const group = itemGroup(item);
    const job = itemJob(item);
    const searchable = normalize([schoolName(item), group?.group_name, group?.teacher_name, job?.title, item.title, catalogNames.get(item.selected_file_id)].join(" "));
    return stage.statuses.includes(item.status)
      && (!query || searchable.includes(query))
      && (!piece || item.item_type === piece)
      && (!level || itemLevel(item) === level);
  });
}

function renderMetrics() {
  const metricData = [
    ["Pendientes de imprimir", items.filter((item) => item.status === "APPROVED_FOR_PRINT").length],
    ["Enviados a imprenta", items.filter((item) => item.status === "PRINTING").length],
    ["Impresos · sin entregar", items.filter((item) => item.status === "PRINTED").length],
    ["Diseño o aprobación pendiente", items.filter((item) => stageForStatus.get(item.status) === "design").length]
  ];
  document.querySelector("#printMetrics").innerHTML = metricData.map(([label, count]) => `<div class="print-metric"><span>${label}</span><strong>${count}</strong></div>`).join("");
}

function renderTabs() {
  document.querySelector("#printTabs").innerHTML = stages.map((stage) => {
    const count = items.filter((item) => stage.statuses.includes(item.status)).length;
    return `<button class="print-tab" type="button" data-print-stage="${stage.id}" aria-pressed="${stage.id === activeStage}">${stage.label}<span class="print-tab-count">${count}</span></button>`;
  }).join("");
  document.querySelectorAll("[data-print-stage]").forEach((button) => button.addEventListener("click", () => {
    activeStage = button.dataset.printStage;
    render();
  }));
}

function quantityFor(item) {
  const group = itemGroup(item);
  const amount = Number(group?.package_quantity || group?.student_count || 0);
  return { amount, unit: item.item_type === "GROUP_PHOTO" ? "copias" : "piezas" };
}

function statusDetail(item) {
  if (item.status === "CHANGES_REQUESTED") return "Revisar observaciones en el trabajo";
  if (item.status === "CATALOG_SELECTED") return catalogNames.get(item.selected_file_id) || "Diseño elegido por la maestra";
  if (item.status === "SENT_FOR_APPROVAL" && item.approved_by_name) return `En revisión · ${item.approved_by_name}`;
  if (item.status === "APPROVED_FOR_PRINT" && item.approved_by_name) return `Autorizó ${item.approved_by_name}`;
  if (item.approved_at) return `Autorizada ${formatDate(item.approved_at.slice(0, 10))}`;
  return stateLabels[item.status] || item.status;
}

function nextAction(item) {
  const actions = {
    APPROVED_FOR_PRINT: ["PRINTING", "Registrar envío a imprenta"],
    PRINTING: ["PRINTED", "Marcar como impreso"],
    PRINTED: ["DELIVERED", "Registrar entrega"]
  };
  return actions[item.status] || null;
}

function renderItem(item) {
  const group = itemGroup(item);
  const job = itemJob(item);
  const quantity = quantityFor(item);
  const preview = previewUrls.get(item.id);
  const photoFormat = item.item_type === "GROUP_PHOTO"
    ? group?.photo_format === "INDIVIDUAL" ? "individual" : group?.photo_format === "GROUP" ? "grupal" : "formato pendiente"
    : "";
  const title = item.item_type === "GROUP_PHOTO"
    ? `Foto / bastidor · ${photoFormat}`
    : item.title || itemTypeLabels[item.item_type] || item.item_type;
  const selectedName = catalogNames.get(item.selected_file_id);
  const details = [group?.group_name, group?.teacher_name, job?.title].filter(Boolean).join(" · ");
  const action = nextAction(item);
  const image = preview
    ? `<a class="print-preview" href="${escapeHtml(preview)}" target="_blank" rel="noopener" aria-label="Abrir preview de ${escapeHtml(title)}"><img src="${escapeHtml(preview)}" alt="Preview: ${escapeHtml(title)}" loading="lazy"></a>`
    : `<span class="print-preview" aria-label="Sin preview disponible">Sin preview</span>`;
  return `<article class="print-item">
    ${image}
    <div><strong class="print-item-title">${escapeHtml(title)}</strong><span class="print-item-detail">${escapeHtml(details || "Sin grupo o maestra registrada")}</span>${selectedName ? `<span class="print-item-detail">Diseño: ${escapeHtml(selectedName)}</span>` : ""}</div>
    <div class="print-item-quantity"><strong>${quantity.amount}</strong><span class="print-item-detail">${escapeHtml(quantity.unit)}</span></div>
    <div class="print-item-state"><span class="badge badge-status ${escapeHtml(item.status)}">${escapeHtml(stateLabels[item.status] || item.status)}</span><span class="print-item-detail">${escapeHtml(statusDetail(item))}</span></div>
    <div class="print-item-actions">${action ? `<button class="btn btn-primary" type="button" title="${action[1]}" aria-label="${action[1]}" data-advance-item="${item.id}" data-current-status="${item.status}" data-next-status="${action[0]}">${action[1]}</button>` : `<a class="btn" href="job-detail.html?id=${encodeURIComponent(item.job_id)}">Abrir trabajo</a>`}</div>
  </article>`;
}

function renderSchools(filtered) {
  const root = document.querySelector("#printSchools");
  if (!filtered.length) {
    const label = activeStage === "pending" ? "No hay piezas aprobadas pendientes de imprimir." : "No hay piezas en esta etapa con los filtros seleccionados.";
    root.innerHTML = `<div class="print-empty">${label}</div>`;
    return;
  }

  const bySchool = new Map();
  for (const item of filtered) {
    const name = schoolName(item);
    if (!bySchool.has(name)) bySchool.set(name, []);
    bySchool.get(name).push(item);
  }
  root.innerHTML = [...bySchool.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([name, schoolItems]) => {
    const levels = [...new Set(schoolItems.map(itemLevel))].join(" · ");
    const groupsInSchool = new Set(schoolItems.map((item) => itemGroup(item)?.group_name).filter(Boolean));
    return `<details class="print-school" open>
      <summary class="print-school-summary"><span><span class="print-school-name">${escapeHtml(name)}</span><span class="print-school-meta"><span>${escapeHtml(levels)}</span><span>${groupsInSchool.size} ${groupsInSchool.size === 1 ? "grupo" : "grupos"}</span></span></span><span class="print-school-count">${schoolItems.length} ${schoolItems.length === 1 ? "pieza" : "piezas"}</span></summary>
      <div class="print-school-items">${schoolItems.sort((a, b) => {
        const groupOrder = (itemGroup(a)?.group_name || "").localeCompare(itemGroup(b)?.group_name || "", "es");
        return groupOrder || (itemTypeOrder[a.item_type] ?? 9) - (itemTypeOrder[b.item_type] ?? 9);
      }).map(renderItem).join("")}</div>
    </details>`;
  }).join("");
}

function render() {
  renderMetrics();
  renderTabs();
  renderSchools(visibleItems());
}

async function advanceItem(button) {
  const item = items.find((entry) => entry.id === button.dataset.advanceItem);
  if (!item || item.status !== button.dataset.currentStatus) {
    showToast("La pieza cambió de estado. Actualiza la página antes de continuar.", "error");
    return;
  }
  const messages = {
    PRINTING: "¿Confirmas que enviaste esta pieza a impresión?",
    PRINTED: "¿Confirmas que esta pieza ya quedó impresa?",
    DELIVERED: "¿Confirmas la entrega de esta pieza?"
  };
  if (!window.confirm(messages[button.dataset.nextStatus] || "¿Avanzar esta pieza a la siguiente etapa?")) return;

  button.disabled = true;
  try {
    const { data, error } = await supabase.from("print_items")
      .update({ status: button.dataset.nextStatus })
      .eq("id", item.id)
      .eq("status", button.dataset.currentStatus)
      .select("id,status,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("La pieza cambió de estado en otro dispositivo. Actualiza y verifica su situación.");
    item.status = data.status;
    item.updated_at = data.updated_at;
    showToast("Etapa de producción actualizada.", "success");
    render();
  } catch (error) {
    console.error("No se pudo actualizar la etapa de impresión:", error);
    showToast(error.message || "No se pudo actualizar la pieza.", "error");
    button.disabled = false;
  }
}

document.querySelector("#printSearch").addEventListener("input", render);
document.querySelector("#printPieceFilter").addEventListener("change", render);
document.querySelector("#printLevelFilter").addEventListener("change", render);
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-advance-item]");
  if (button) advanceItem(button);
});

try {
  await loadData();
} catch (error) {
  console.error("No se pudieron cargar las piezas para impresión:", error);
  showLoadError(`No se pudo cargar el módulo: ${error.message || "error desconocido"}`);
  document.querySelector("#printSchools").innerHTML = "";
}
