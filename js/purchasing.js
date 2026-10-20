import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { escapeHtml, showToast } from "./utils.js";
import { formatMoney, formatDate } from "./formatters.js";
import { getCatalogFileUrl } from "./catalog.js";

const user = await requireAuth(["owner"]);
if (!user) throw new Error("Acceso solo para administradores.");

let jobs = [];
let groups = [];
let printItems = [];
let folders = [];
let packages = [];
let costItems = [];
let recipes = [];
let orders = [];
let orderLines = [];
let allocations = [];
let expenses = [];
let deposits = [];
let materialsLoadError = null;
let recipesLoadError = null;
const folderPreviewPromises = new Map();
const jobParam = new URLSearchParams(location.search).get("job_id");
const currency = (value) => formatMoney(Number(value || 0));
const dateToday = new Date().toISOString().slice(0, 10);
const statusLabels = { DRAFT: "Borrador", SENT: "Enviado", RECEIVED: "Recibido", CANCELLED: "Cancelado" };
const orderTypeLabels = { FOLDER: "Carpetas por diseño", MATERIAL: "Materiales" };

function setOptions(select, rows, label, emptyLabel = "Seleccione") {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${emptyLabel}</option>${rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(label(row))}</option>`).join("")}`;
  if (rows.some((row) => row.id === current)) select.value = current;
}

async function loadData() {
  const results = await Promise.all([
    supabase.from("jobs").select("id,title,event_type,job_type,price,clients(name)").order("created_at", { ascending: false }),
    supabase.from("folder_templates").select("id,name,school_level,is_active").order("name"),
    supabase.from("packages").select("*").order("name"),
    supabase.from("cost_items").select("*").order("name"),
    supabase.from("package_material_rules").select("*").order("created_at"),
    supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
    supabase.from("expenses").select("*").order("expense_date", { ascending: false }),
    supabase.from("deposits").select("job_id,amount")
  ]);
  const labels = ["trabajos", "catálogo de carpetas", "paquetes", "costos", "recetas", "pedidos", "gastos", "abonos"];
  const loadErrors = results.flatMap((result, index) => result.error ? [`${labels[index]}: ${result.error.message}`] : []);
  [jobs, folders, packages, costItems, recipes, orders, expenses, deposits] = results.map((result) => result.data || []);
  const materialsError = results[3].error || results[4].error;
  materialsLoadError = materialsError;
  recipesLoadError = results[4].error;
  const materialsErrorNode = document.querySelector("#costItemsLoadError");
  if (materialsErrorNode) {
    materialsErrorNode.hidden = !materialsError;
    materialsErrorNode.textContent = materialsError
      ? `No se pudieron cargar los materiales o sus paquetes: ${materialsError.message}`
      : "";
  }
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length) {
    const linesResult = await supabase.from("purchase_order_lines").select("*").in("purchase_order_id", orderIds);
    if (linesResult.error) { loadErrors.push(`líneas de pedidos: ${linesResult.error.message}`); orderLines = []; }
    else orderLines = linesResult.data || [];
    const lineIds = orderLines.map((line) => line.id);
    if (lineIds.length) {
      const allocationResult = await supabase.from("purchase_order_allocations").select("*").in("purchase_order_line_id", lineIds);
      if (allocationResult.error) { loadErrors.push(`detalle de pedidos: ${allocationResult.error.message}`); allocations = []; }
      else allocations = allocationResult.data || [];
    } else allocations = [];
  } else { orderLines = []; allocations = []; }
  populateSelects();
  render();
  if (loadErrors.length) {
    console.error("Algunos datos de pedidos y finanzas no cargaron:", loadErrors);
    showToast(`Algunos datos no cargaron: ${loadErrors.join(" · ")}`, "error");
  }
}

function populateSelects() {
  setOptions(document.querySelector("#orderJob"), jobs.filter((job) => job.job_type === "SCHOOL_GRADUATION"), (job) => `${job.title} · ${job.clients?.name || "Escuela"}`);
  setOptions(document.querySelector("#expenseJob"), jobs, (job) => `${job.title} · ${job.clients?.name || "Cliente"}`, "Gasto general");
  setOptions(document.querySelector("#folderCostTemplate"), folders.filter((folder) => folder.is_active), (folder) => folder.name, "Sin diseño relacionado");
  setOptions(document.querySelector("#expenseCostItem"), costItems.filter((item) => item.is_active), (item) => item.name, "Otro gasto");
  setOptions(document.querySelector("#financeJobFilter"), jobs, (job) => `${job.title} · ${job.clients?.name || "Cliente"}`, "Todos los trabajos");
  if (jobParam && jobs.some((job) => job.id === jobParam)) document.querySelector("#orderJob").value = jobParam;
  for (const form of [document.querySelector("#expenseForm")]) if (form && !form.expense_date.value) form.expense_date.value = dateToday;
}

function folderName(id) { return folders.find((folder) => folder.id === id)?.name || "Diseño de carpeta eliminado"; }
function jobName(id) { const job = jobs.find((item) => item.id === id); return job ? `${job.title} · ${job.clients?.name || "Cliente"}` : "Trabajo eliminado"; }
function render() {
  const filter = document.querySelector("#orderStatusFilter").value;
  renderOrders(orders.filter((order) => !filter || order.status === filter));
  renderCostItems();
  renderExpenses();
}

function renderOrders(rows) {
  const root = document.querySelector("#ordersList");
  if (!rows.length) { root.innerHTML = '<div class="empty-state">Todavía no hay pedidos.</div>'; return; }
  root.innerHTML = rows.map((order) => {
    const lines = orderLines.filter((line) => line.purchase_order_id === order.id);
    const total = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_cost), 0);
    return `<article class="purchase-order"><div class="purchase-order-head"><div><h3>${escapeHtml(orderTypeLabels[order.order_type] || order.order_type)} · ${escapeHtml(order.supplier)}</h3><div class="purchase-order-meta"><span>${escapeHtml(jobName(order.job_id))}</span><span>${escapeHtml(statusLabels[order.status] || order.status)}</span><span>Creado ${formatDate(order.created_at?.slice(0, 10))}</span><strong>Estimado ${currency(total)}</strong></div></div><div class="purchase-order-actions">${order.status === "DRAFT" ? `<button class="btn btn-primary" data-order-status="SENT" data-order-id="${order.id}">Marcar enviado</button>` : ""}${order.status === "SENT" ? `<button class="btn btn-primary" data-order-status="RECEIVED" data-order-id="${order.id}">Marcar recibido</button>` : ""}${order.status === "DRAFT" ? `<button class="btn" data-order-status="CANCELLED" data-order-id="${order.id}">Cancelar borrador</button>` : ""}<button class="btn" data-record-order-expense="${order.id}">Registrar gasto real</button></div></div>
      <table class="purchase-lines"><thead><tr><th>Artículo</th><th>Cantidad</th><th>Costo unitario estimado</th><th>Importe estimado</th></tr></thead><tbody>${lines.map((line) => {
        const lineAllocations = allocations.filter((item) => item.purchase_order_line_id === line.id);
        const teacherGroups = lineAllocations.map((item) => `<li>${escapeHtml(item.group_name_snapshot)} · ${escapeHtml(item.teacher_name_snapshot || "Sin maestra")}: ${order.status === "DRAFT" ? `<input class="input inline-number" type="number" min="0.001" step="1" value="${Number(item.quantity)}" aria-label="Cantidad para ${escapeHtml(item.group_name_snapshot)}" data-allocation-input="${item.id}"> ${escapeHtml(item.unit)} <button class="btn" data-save-allocation="${item.id}" data-line-id="${line.id}">Guardar cantidad</button>` : `${Number(item.quantity)} ${escapeHtml(item.unit)}`}</li>`).join("");
        const preview = line.folder_template_id ? `<a class="folder-order-preview-link" data-folder-preview-link="${line.folder_template_id}" target="_blank" rel="noopener" aria-label="Abrir preview de ${escapeHtml(line.description)}"><img class="folder-order-preview" data-folder-preview="${line.folder_template_id}" alt="Preview: ${escapeHtml(line.description)}"><span class="folder-order-preview-fallback" hidden>Preview no disponible</span></a>` : "";
        return `<tr><td><div class="folder-order-design">${preview}<div><strong>${escapeHtml(line.description)}</strong><p class="muted">Total consolidado: ${Number(line.quantity)} ${escapeHtml(line.unit)} · ${lineAllocations.length} grupo(s)</p>${lineAllocations.length ? `<strong class="allocation-heading">Solicitado por</strong><ul class="allocation-list">${teacherGroups}</ul>` : ""}</div></div></td><td>${Number(line.quantity)} ${escapeHtml(line.unit)}</td><td>${currency(line.unit_cost)}</td><td>${currency(Number(line.quantity) * Number(line.unit_cost))}</td></tr>`;
      }).join("") || '<tr><td colspan="4">El pedido aún no tiene renglones.</td></tr>'}</tbody></table>${order.notes ? `<p class="muted">${escapeHtml(order.notes)}</p>` : ""}</article>`;
  }).join("");
  hydrateFolderPreviews();
}

function hydrateFolderPreviews() {
  document.querySelectorAll("[data-folder-preview]").forEach(async (image) => {
    const folderId = image.dataset.folderPreview;
    try {
      if (!folderPreviewPromises.has(folderId)) folderPreviewPromises.set(folderId, getCatalogFileUrl("folder_templates", folderId));
      const url = await folderPreviewPromises.get(folderId);
      if (!image.isConnected) return;
      image.addEventListener("error", () => {
        image.hidden = true;
        image.parentElement.querySelector(".folder-order-preview-fallback").hidden = false;
      }, { once: true });
      image.src = url;
      image.closest("[data-folder-preview-link]").href = url;
    } catch (error) {
      image.hidden = true;
      image.parentElement.querySelector(".folder-order-preview-fallback").hidden = false;
      console.warn("No se pudo cargar el preview de carpeta para el pedido", folderId, error);
    }
  });
}

function renderCostItems() {
  const categories = [["MATERIAL", "Material"], ["PRINTING", "Impresión"], ["PRODUCT", "Producto"], ["OTHER", "Otro"]];
  const count = document.querySelector("#costItemCount");
  if (count) count.textContent = `${costItems.length} ${costItems.length === 1 ? "material" : "materiales"}`;
  document.querySelector("#costItemsList").innerHTML = costItems.map((item) => {
    const itemRules = recipes.filter((rule) => rule.cost_item_id === item.id);
    const packageOptions = packages.filter((pkg) => pkg.is_active).map((pkg) => `<option value="${escapeHtml(pkg.id)}">${escapeHtml(pkg.name)} · ${currency(pkg.price)}</option>`).join("");
    const ruleRows = itemRules.map((rule) => {
      const pkg = packages.find((entry) => entry.id === rule.package_id);
      return `<li><span><strong>${escapeHtml(pkg?.name || "Paquete eliminado")}</strong><span class="muted">${Number(rule.units_per_package)} ${escapeHtml(item.unit)} por paquete</span></span><button class="btn btn-danger" type="button" data-delete-material-rule="${rule.id}">Quitar</button></li>`;
    }).join("");
    return `<details class="cost-item-card ${item.is_active ? "" : "is-inactive"}" data-cost-row="${item.id}" data-cost-search="${escapeHtml(`${item.name} ${item.unit} ${item.purchase_unit}`.toLocaleLowerCase())}">
    <summary class="cost-item-summary"><strong>${escapeHtml(item.name)}</strong><span>${currency(item.unit_cost)} por ${escapeHtml(item.purchase_unit)}</span><span>${itemRules.length} ${itemRules.length === 1 ? "paquete" : "paquetes"}</span><span class="badge">${item.is_active ? "Activo" : "Inactivo"}</span></summary>
    <div class="cost-item-content">
    <div class="cost-item-card-head"><label class="form-group"><span>Nombre</span><input class="input" data-cost-field="name" value="${escapeHtml(item.name)}"></label><label class="form-group"><span>Unidad de consumo</span><input class="input" data-cost-field="unit" value="${escapeHtml(item.unit)}"></label><span class="badge">${item.is_active ? "Activo" : "Inactivo"}</span></div>
    <div class="cost-item-edit-grid"><label class="form-group"><span>Unidad de compra</span><input class="input" data-cost-field="purchase_unit" value="${escapeHtml(item.purchase_unit)}"></label><label class="form-group"><span>Unidades que rinde</span><input class="input" data-cost-field="units_per_purchase" type="number" min="0.001" step="0.001" value="${Number(item.units_per_purchase)}"></label><label class="form-group"><span>Costo de compra</span><input class="input" data-cost-field="unit_cost" type="number" min="0" step="0.01" value="${Number(item.unit_cost)}"></label></div>
    <details class="advanced-cost-fields"><summary>Datos opcionales</summary><div class="cost-item-edit-grid"><label class="form-group"><span>Existencia (unidades de consumo)</span><input class="input" data-cost-field="stock_quantity" type="number" min="0" step="0.001" value="${Number(item.stock_quantity)}"></label><label class="form-group"><span>Proveedor</span><input class="input" data-cost-field="supplier" value="${escapeHtml(item.supplier || "")}"></label><label class="form-group"><span>Categoría</span><select class="select" data-cost-field="category">${categories.map(([value, label]) => `<option value="${value}" ${item.category === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="form-group"><span>Diseño de carpeta (solo carpetas)</span><select class="select" data-cost-field="folder_template_id"><option value="">No aplica</option>${folders.map((folder) => `<option value="${folder.id}" ${item.folder_template_id === folder.id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("")}</select></label></div></details>
    <details class="material-package-usage"><summary>Paquetes que incluyen este material <span class="badge">${itemRules.length}</span></summary>
      ${itemRules.length ? `<ul class="material-rule-list">${ruleRows}</ul>` : `<p class="muted">Aún no está agregado a ningún paquete.</p>`}
      ${recipesLoadError ? `<p class="muted">No se puede editar esta asignación hasta que se carguen las reglas de paquetes.</p>` : packages.some((pkg) => pkg.is_active) ? `<form class="material-rule-form" data-material-rule-form="${item.id}"><label class="form-group"><span>Paquete</span><select class="select" name="package_id" required><option value="">Selecciona un paquete</option>${packageOptions}</select></label><label class="form-group"><span>Cuántas ${escapeHtml(item.unit)} incluye cada paquete</span><input class="input" name="units_per_package" type="number" min="0.001" step="0.001" placeholder="Ejemplo: 1" required></label><button class="btn" type="submit">Agregar al paquete</button></form>` : `<p class="muted">No hay paquetes activos disponibles.</p>`}
    </details>
    <div class="actions cost-item-actions"><button class="btn btn-primary" type="button" data-save-cost="${item.id}">Guardar cambios</button>${item.is_active ? `<button class="btn" type="button" data-toggle-cost="${item.id}" data-active="false">Desactivar</button>` : `<button class="btn" type="button" data-toggle-cost="${item.id}" data-active="true">Activar</button>`}</div>
    </div></details>`;
  }).join("") || (materialsLoadError ? '<div class="empty-state">No se pudieron mostrar los materiales. Revisa el aviso de carga que aparece arriba.</div>' : '<div class="empty-state">Todavía no hay materiales registrados. Usa “Agregar insumo o costo” para crear el catálogo; aparecerán aquí.</div>');
  filterCostItems();
}

function filterCostItems() {
  const input = document.querySelector("#costItemSearch");
  if (!input) return;
  const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const query = normalize(input.value.trim());
  let visible = 0;
  document.querySelectorAll("#costItemsList [data-cost-row]").forEach((row) => {
    row.hidden = !normalize(row.dataset.costSearch || "").includes(query);
    if (!row.hidden) visible += 1;
  });
  const count = document.querySelector("#costItemCount");
  if (count) count.textContent = `${visible}${query ? ` de ${costItems.length}` : ""} ${costItems.length === 1 ? "material" : "materiales"}`;
  const noResults = document.querySelector("#costItemNoResults");
  if (noResults) noResults.hidden = !query || visible > 0;
}

function renderExpenses() {
  const selectedJobId = document.querySelector("#financeJobFilter").value;
  const jobExpenses = expenses.filter((expense) => !selectedJobId || expense.job_id === selectedJobId);
  const total = jobExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const monthKey = dateToday.slice(0, 7);
  const monthTotal = jobExpenses.filter((expense) => expense.expense_date?.startsWith(monthKey)).reduce((sum, expense) => sum + Number(expense.amount), 0);
  const revenue = selectedJobId ? Number(jobs.find((job) => job.id === selectedJobId)?.price || 0) : jobs.reduce((sum, job) => sum + Number(job.price || 0), 0);
  const received = deposits.filter((deposit) => !selectedJobId || deposit.job_id === selectedJobId).reduce((sum, deposit) => sum + Number(deposit.amount), 0);
  const due = Math.max(0, revenue - received);
  document.querySelector("#expenseSummary").innerHTML = `<div class="finance-metric"><span>Total vendido</span><strong>${currency(revenue)}</strong></div><div class="finance-metric"><span>Abonado</span><strong>${currency(received)}</strong></div><div class="finance-metric"><span>Pendiente de cobro</span><strong>${currency(due)}</strong></div><div class="finance-metric"><span>Gastos reales</span><strong>${currency(total)}</strong></div><div class="finance-metric"><span>Venta menos gastos</span><strong>${currency(revenue - total)}</strong></div><div class="finance-metric"><span>Gastos este mes</span><strong>${currency(monthTotal)}</strong></div>`;
  document.querySelector("#expensesList").innerHTML = `<table><thead><tr><th>Fecha</th><th>Trabajo</th><th>Proveedor</th><th>Concepto</th><th>Cantidad</th><th>Total pagado</th><th>Referencia</th><th></th></tr></thead><tbody>${jobExpenses.map((expense) => `<tr><td>${formatDate(expense.expense_date)}</td><td>${escapeHtml(expense.job_id ? jobName(expense.job_id) : "General")}</td><td>${escapeHtml(expense.vendor)}</td><td>${escapeHtml(expense.description)}</td><td>${Number(expense.quantity)} ${escapeHtml(expense.unit)}</td><td>${currency(expense.amount)}</td><td>${escapeHtml(expense.reference || "")}</td><td><button class="btn btn-danger" data-delete-expense="${expense.id}">Eliminar</button></td></tr>`).join("") || '<tr><td colspan="8">Sin gastos registrados.</td></tr>'}</tbody></table>`;
}

async function selectedJobData(jobId) {
  const [groupResult, itemResult] = await Promise.all([
    supabase.from("school_groups").select("id,group_name,teacher_name,selected_package_id,package_quantity").eq("job_id", jobId),
    supabase.from("print_items").select("id,group_id,item_type,selected_file_id,status").eq("job_id", jobId)
  ]);
  if (groupResult.error) throw groupResult.error;
  if (itemResult.error) throw itemResult.error;
  return { groups: groupResult.data || [], items: itemResult.data || [] };
}

async function createOrder(jobId, type, supplier, lines, notes) {
  const result = await supabase.from("purchase_orders").insert({ job_id: jobId, order_type: type, supplier, status: "DRAFT", notes, created_by: user.id }).select("*").single();
  if (result.error) throw result.error;
  const orderId = result.data.id;
  try {
    for (const line of lines) {
      const inserted = await supabase.from("purchase_order_lines").insert({ purchase_order_id: orderId, cost_item_id: line.cost_item_id || null, folder_template_id: line.folder_template_id || null, description: line.description, quantity: line.quantity, unit: line.unit, unit_cost: line.unit_cost || 0 }).select("*").single();
      if (inserted.error) throw inserted.error;
      if (line.allocations?.length) {
        const payload = line.allocations.map((allocation) => ({ purchase_order_line_id: inserted.data.id, group_id: allocation.group.id, group_name_snapshot: allocation.group.group_name, teacher_name_snapshot: allocation.group.teacher_name || null, quantity: allocation.quantity, unit: allocation.unit }));
        const saved = await supabase.from("purchase_order_allocations").insert(payload);
        if (saved.error) throw saved.error;
      }
    }
  } catch (error) {
    await supabase.from("purchase_orders").delete().eq("id", orderId);
    throw error;
  }
}

function assertNoDraft(jobId, type) {
  if (orders.some((order) => order.job_id === jobId && order.order_type === type && order.status === "DRAFT")) {
    throw new Error("Ya existe un borrador para este trabajo y tipo de pedido. Revísalo o cancélalo antes de preparar otro.");
  }
}

async function prepareFolderOrder(jobId) {
  assertNoDraft(jobId, "FOLDER");
  const { groups, items } = await selectedJobData(jobId);
  const chosen = new Map(items.filter((item) => item.item_type === "FOLDER_OPTION" && item.selected_file_id).map((item) => [item.group_id, item.selected_file_id]));
  const grouped = new Map();
  let missing = 0;
  for (const group of groups) {
    const folderId = chosen.get(group.id);
    const quantity = Number(group.package_quantity || 0);
    if (!folderId || quantity <= 0) { if (quantity > 0 && !folderId) missing += 1; continue; }
    const line = grouped.get(folderId) || { folder_template_id: folderId, description: folderName(folderId), quantity: 0, unit: "carpeta(s)", unit_cost: 0, allocations: [] };
    line.quantity += quantity;
    line.allocations.push({ group, quantity, unit: "carpeta(s)" });
    const catalogCost = costItems.find((cost) => cost.folder_template_id === folderId);
    line.unit_cost = Number(catalogCost?.unit_cost || 0);
    grouped.set(folderId, line);
  }
  const lines = Array.from(grouped.values());
  if (!lines.length) throw new Error("Ningún grupo tiene carpeta seleccionada y cantidad de paquetes mayor a cero.");
  const note = `${missing ? `${missing} grupo(s) con paquetes aún no tienen diseño de carpeta seleccionado. ` : ""}Las cantidades por grupo parten de un folder por paquete; revisa el borrador con Casa del Folder antes de enviarlo.`;
  await createOrder(jobId, "FOLDER", "Casa del Folder", lines, note);
  return `${lines.length} diseño(s), ${lines.reduce((sum, line) => sum + line.quantity, 0)} carpetas. ${note}`;
}

async function prepareMaterialOrder(jobId) {
  assertNoDraft(jobId, "MATERIAL");
  const { groups } = await selectedJobData(jobId);
  const neededByItem = new Map();
  for (const group of groups) {
    const packageId = group.selected_package_id;
    const quantity = Number(group.package_quantity || 0);
    if (!packageId || !quantity) continue;
    for (const rule of recipes.filter((item) => item.package_id === packageId)) {
      const material = costItems.find((item) => item.id === rule.cost_item_id && item.is_active);
      if (!material) continue;
      const amount = Number(rule.units_per_package) * quantity;
      const line = neededByItem.get(material.id) || { material, required: 0, allocations: [] };
      line.required += amount;
      line.allocations.push({ group, quantity: amount, unit: material.unit });
      neededByItem.set(material.id, line);
    }
  }
  const lines = Array.from(neededByItem.values()).map(({ material, required, allocations: groupAllocations }) => {
    const toBuy = Math.max(0, required - Number(material.stock_quantity || 0));
    const quantity = Math.ceil(toBuy / Number(material.units_per_purchase || 1));
    return { cost_item_id: material.id, description: `${material.name} · requiere ${required} ${material.unit}; hay ${Number(material.stock_quantity || 0)} ${material.unit}`, quantity, unit: material.purchase_unit, unit_cost: Number(material.unit_cost || 0), allocations: groupAllocations };
  }).filter((line) => line.quantity > 0);
  if (!neededByItem.size) throw new Error("No hay recetas configuradas para los paquetes y grupos de este trabajo.");
  if (!lines.length) throw new Error("Las existencias configuradas cubren todos los materiales calculados.");
  await createOrder(jobId, "MATERIAL", "Proveedores varios", lines, "Pedido sugerido según recetas por paquete y existencias capturadas. Verifica cantidades y proveedores antes de comprar.");
  return `${lines.length} insumo(s) sugeridos. Confirma proveedores, costos y existencias antes de comprar.`;
}

document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
}));
document.querySelector("#orderStatusFilter").addEventListener("change", render);
document.querySelector("#financeJobFilter").addEventListener("change", renderExpenses);
document.querySelector("#costItemSearch").addEventListener("input", filterCostItems);
document.addEventListener("change", (event) => {
  const packageSelect = event.target.closest('.material-rule-form select[name="package_id"]');
  if (!packageSelect) return;
  const form = packageSelect.closest(".material-rule-form");
  const existing = recipes.find((rule) => rule.package_id === packageSelect.value && rule.cost_item_id === form.dataset.materialRuleForm);
  form.elements.units_per_package.value = existing ? Number(existing.units_per_package) : "";
  form.querySelector('button[type="submit"]').textContent = existing ? "Actualizar cantidad" : "Agregar al paquete";
});
document.querySelector("#costItemForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const result = await supabase.from("cost_items").insert({ ...values, units_per_purchase: Number(values.units_per_purchase), unit_cost: Number(values.unit_cost), stock_quantity: Number(values.stock_quantity), folder_template_id: values.folder_template_id || null, is_active: true }).select("*").single();
  if (result.error) return showToast(result.error.message, "error");
  form.reset(); form.units_per_purchase.value = "1"; form.unit_cost.value = "0"; form.stock_quantity.value = "0";
  showToast("Costo guardado."); await loadData();
});
document.addEventListener("submit", async (event) => {
  const recipeForm = event.target.closest("[data-material-rule-form]");
  if (!recipeForm) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(recipeForm));
  const costItemId = recipeForm.dataset.materialRuleForm;
  const unitsPerPackage = Number(values.units_per_package);
  if (!values.package_id || !Number.isFinite(unitsPerPackage) || unitsPerPackage <= 0) return showToast("Selecciona un paquete e indica una cantidad mayor que cero.", "error");
  const existing = recipes.find((item) => item.package_id === values.package_id && item.cost_item_id === costItemId);
  const result = existing
    ? await supabase.from("package_material_rules").update({ units_per_package: unitsPerPackage }).eq("id", existing.id)
    : await supabase.from("package_material_rules").insert({ package_id: values.package_id, cost_item_id: costItemId, units_per_package: unitsPerPackage });
  if (result.error) return showToast(result.error.message, "error");
  showToast(existing ? "Cantidad del material actualizada para ese paquete." : "Material agregado al paquete."); await loadData();
});
document.querySelector("#expenseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const result = await supabase.from("expenses").insert({ ...values, job_id: values.job_id || null, cost_item_id: values.cost_item_id || null, purchase_order_id: values.purchase_order_id || null, quantity: Number(values.quantity), amount: Number(values.amount), created_by: user.id });
  if (result.error) return showToast(result.error.message, "error");
  form.reset(); form.expense_date.value = dateToday; form.quantity.value = "1"; form.unit.value = "servicio";
  showToast("Gasto registrado."); await loadData();
});

document.addEventListener("click", async (event) => {
  try {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "createFolderOrder" || button.id === "createMaterialOrder") {
      const jobId = document.querySelector("#orderJob").value;
      if (!jobId) return showToast("Selecciona un trabajo escolar.", "error");
      button.disabled = true;
      const message = button.id === "createFolderOrder" ? await prepareFolderOrder(jobId) : await prepareMaterialOrder(jobId);
      document.querySelector("#orderGenerationStatus").textContent = message;
      showToast("Pedido borrador preparado."); await loadData();
    }
    if (button.dataset.saveCost) {
      const row = document.querySelector(`[data-cost-row="${button.dataset.saveCost}"]`);
      const data = Object.fromEntries(Array.from(row.querySelectorAll("[data-cost-field]")).map((input) => [input.dataset.costField, input.value]));
      for (const key of ["units_per_purchase", "unit_cost", "stock_quantity"]) data[key] = Number(data[key]);
      data.folder_template_id = data.folder_template_id || null;
      const result = await supabase.from("cost_items").update(data).eq("id", button.dataset.saveCost);
      if (result.error) throw result.error;
      showToast("Costo actualizado."); await loadData();
    }
    if (button.dataset.toggleCost) {
      const result = await supabase.from("cost_items").update({ is_active: button.dataset.active === "true" }).eq("id", button.dataset.toggleCost);
      if (result.error) throw result.error;
      await loadData();
    }
    if (button.dataset.deleteMaterialRule && confirm("¿Quitar este material del paquete?")) {
      const result = await supabase.from("package_material_rules").delete().eq("id", button.dataset.deleteMaterialRule);
      if (result.error) throw result.error;
      await loadData();
    }
    if (button.dataset.orderStatus) {
      if (button.dataset.orderStatus === "CANCELLED" && !confirm("¿Cancelar este borrador de pedido?")) return;
      const update = { status: button.dataset.orderStatus };
      if (update.status === "SENT") update.ordered_at = new Date().toISOString();
      if (update.status === "RECEIVED") update.received_at = new Date().toISOString();
      const result = await supabase.from("purchase_orders").update(update).eq("id", button.dataset.orderId);
      if (result.error) throw result.error;
      await loadData();
    }
    if (button.dataset.saveAllocation) {
      const input = document.querySelector(`[data-allocation-input="${button.dataset.saveAllocation}"]`);
      const quantity = Number(input?.value);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("La cantidad debe ser mayor que cero.");
      const savedAllocation = await supabase.from("purchase_order_allocations").update({ quantity }).eq("id", button.dataset.saveAllocation);
      if (savedAllocation.error) throw savedAllocation.error;
      const lineAllocations = allocations.filter((item) => item.purchase_order_line_id === button.dataset.lineId);
      const lineQuantity = lineAllocations.reduce((sum, item) => sum + (item.id === button.dataset.saveAllocation ? quantity : Number(item.quantity)), 0);
      const savedLine = await supabase.from("purchase_order_lines").update({ quantity: lineQuantity }).eq("id", button.dataset.lineId);
      if (savedLine.error) throw savedLine.error;
      showToast("Cantidad por grupo actualizada en el borrador."); await loadData();
    }
    if (button.dataset.recordOrderExpense) {
      const order = orders.find((item) => item.id === button.dataset.recordOrderExpense);
      const form = document.querySelector("#expenseForm");
      form.purchase_order_id.value = order.id;
      form.job_id.value = order.job_id;
      form.vendor.value = order.supplier;
      form.description.value = `${orderTypeLabels[order.order_type]} · ${jobName(order.job_id)}`;
      form.expense_date.value = dateToday;
      document.querySelector('[data-tab="expenses"]').click();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (button.dataset.deleteExpense && confirm("¿Eliminar este registro de gasto?")) {
      const result = await supabase.from("expenses").delete().eq("id", button.dataset.deleteExpense);
      if (result.error) throw result.error;
      await loadData();
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo completar la operación.", "error");
  } finally {
    const createButtons = [document.querySelector("#createFolderOrder"), document.querySelector("#createMaterialOrder")];
    createButtons.forEach((button) => { if (button) button.disabled = false; });
  }
});

loadData().catch((error) => {
  console.error(error);
  document.querySelector(".container").insertAdjacentHTML("beforeend", `<div class="alert alert-error">${escapeHtml(error.message || "No se pudo cargar pedidos y finanzas. Ejecute sql/admin-purchasing-finance.sql en Supabase.")}</div>`);
});
