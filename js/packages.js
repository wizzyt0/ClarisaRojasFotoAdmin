import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { PACKAGE_TYPES, getPackageTypeLabel } from "./constants.js";
import { escapeHtml, formToObject, showToast } from "./utils.js";
import { formatMoney } from "./formatters.js";

await requireAuth();
let packages = [];
let editingPackage = null;
const modal = document.querySelector("#packageModal");
const form = document.querySelector("#packageForm");
const options = (selected = "") => Object.entries(PACKAGE_TYPES).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");

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

function render() {
  const search = document.querySelector("#searchInput").value.toLowerCase();
  const type = document.querySelector("#typeFilter").value;
  const active = document.querySelector("#activeFilter").value;
  const rows = packages.filter((item) => (!search || item.name.toLowerCase().includes(search)) && (!type || item.package_type === type) && (active === "" || String(item.is_active) === active));
  document.querySelector("#packagesTable").innerHTML = rows.length ? `<table class="table"><thead><tr><th>Nombre</th><th>Tipo</th><th>Precio</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${escapeHtml(item.name)}<br><span class="muted">${escapeHtml(item.description)}</span></td><td>${getPackageTypeLabel(item.package_type)}</td><td>${formatMoney(item.price)}</td><td><span class="badge">${item.is_active ? "Activo" : "Inactivo"}</span></td><td class="actions"><button class="btn" data-edit="${item.id}">Editar</button><button class="btn btn-danger" data-deactivate="${item.id}">Desactivar</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">No hay paquetes para mostrar.</div>`;
}

async function load() {
  const { data, error } = await supabase.from("packages").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  packages = data || [];
  render();
}

function openModal(item = null) {
  editingPackage = item;
  document.querySelector("#packageModalTitle").textContent = item ? "Editar paquete" : "Nuevo paquete";
  renderForm(item || { is_active: true, price: 0 });
  modal.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  if (Number(data.price) < 0) return showToast("El precio debe ser mayor o igual a 0.", "error");
  const payload = { name: data.name.trim(), package_type: data.package_type, description: data.description || null, price: Number(data.price), is_active: data.is_active === "true" };
  const { error } = editingPackage ? await supabase.from("packages").update(payload).eq("id", editingPackage.id) : await supabase.from("packages").insert(payload);
  if (error) { console.error(error); return showToast("No se pudo guardar el paquete.", "error"); }
  modal.classList.add("hidden");
  showToast("Paquete guardado correctamente.");
  load();
});

document.addEventListener("click", async (event) => {
  if (event.target.matches("#newPackageBtn")) openModal();
  if (event.target.matches("[data-close-modal]")) modal.classList.add("hidden");
  if (event.target.dataset.edit) openModal(packages.find((item) => item.id === event.target.dataset.edit));
  if (event.target.dataset.deactivate && confirm("¿Desactivar este paquete?")) {
    await supabase.from("packages").update({ is_active: false }).eq("id", event.target.dataset.deactivate);
    showToast("Paquete desactivado.");
    load();
  }
});
["searchInput", "typeFilter", "activeFilter"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", render));
load().catch((error) => { console.error(error); showToast("No se pudo cargar la información.", "error"); });
