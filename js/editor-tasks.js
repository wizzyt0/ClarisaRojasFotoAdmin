import { requireAuth } from "./auth.js";
import { APP_CONFIG } from "./config.js";
import { getMyAssignments, ASSIGNMENT_STATUSES, updateMyAssignment } from "./work-assignments.js";
import { escapeHtml, showToast } from "./utils.js";

const currentUser = await requireAuth(["editor"]);

const list = document.querySelector("#taskList");
const welcomeName = currentUser?.staffName?.trim() || currentUser?.email || "Editor";
document.querySelector("#editorWelcome").textContent = `Bienvenido, ${welcomeName}`;
document.querySelector("#editorEmail").textContent = currentUser?.email || "";

async function authHeader() {
  const { supabase } = await import("./supabase.js");
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("La sesión expiró.");
  return { authorization: `Bearer ${data.session.access_token}` };
}

async function uploadPreview(assignmentId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/editor/tasks/${assignmentId}/upload`, {
    method: "POST", headers: await authHeader(), body: formData
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "No se pudo subir el preview.");
}

async function hydratePreviews() {
  for (const target of document.querySelectorAll("[data-task-preview]")) {
    try {
      const response = await fetch(`${APP_CONFIG.r2WorkerUrl.replace(/\/$/, "")}/editor/tasks/${target.dataset.taskPreview}/preview`, {
        headers: await authHeader()
      });
      if (!response.ok) continue;
      const url = URL.createObjectURL(await response.blob());
      target.innerHTML = `<img class="task-preview" src="${url}" alt="Preview de la tarea">`;
    } catch (error) {
      console.warn("No se pudo cargar el preview de la tarea.", error);
    }
  }
}

function render(tasks) {
  list.innerHTML = tasks.length ? tasks.map((task) => `<article class="card editor-task">
    <div class="page-header"><div><h2>${escapeHtml(task.display_label)}</h2><span class="badge">${escapeHtml(ASSIGNMENT_STATUSES[task.status] || task.status)}</span></div></div>
    ${task.internal_brief ? `<p><strong>Indicaciones:</strong><br>${escapeHtml(task.internal_brief)}</p>` : ""}
    ${task.editor_note ? `<p><strong>Tu nota anterior:</strong><br>${escapeHtml(task.editor_note)}</p>` : ""}
    <div class="task-preview-frame" data-task-preview="${task.id}"></div>
    <div class="form-group"><label>Nota para revisión interna</label><textarea class="textarea" data-editor-note="${task.id}" placeholder="Describe lo que preparaste o responde a las observaciones."></textarea></div>
    <div class="actions">
      ${["ASSIGNED", "CHANGES_REQUESTED"].includes(task.status) ? `<button class="btn" data-start-task="${task.id}">Marcar en proceso</button>` : ""}
      ${!["COMPLETED", "CANCELLED", "SENT_TO_CLIENT"].includes(task.status) ? `<label class="btn btn-primary">Subir preview<input hidden type="file" data-task-upload="${task.id}"></label><button class="btn btn-secondary" data-ready-task="${task.id}">Listo para revisión interna</button>` : ""}
    </div>
  </article>`).join("") : `<div class="empty-state">No tienes tareas asignadas. Cuando una propietaria te asigne una pieza, aparecerá aquí.</div>`;
}

async function load() {
  render(await getMyAssignments());
  await hydratePreviews();
}

document.addEventListener("click", async (event) => {
  const assignmentId = event.target.dataset.startTask || event.target.dataset.readyTask;
  if (!assignmentId) return;
  try {
    const note = document.querySelector(`[data-editor-note="${assignmentId}"]`)?.value.trim();
    await updateMyAssignment(assignmentId, event.target.dataset.startTask ? "IN_PROGRESS" : "READY_FOR_OWNER_REVIEW", note);
    showToast("Tarea actualizada.");
    await load();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo actualizar la tarea.", "error");
  }
});

document.addEventListener("change", async (event) => {
  const assignmentId = event.target.dataset.taskUpload;
  const file = event.target.files?.[0];
  if (!assignmentId || !file) return;
  try {
    await uploadPreview(assignmentId, file);
    showToast("Preview enviado para revisión interna.");
    await load();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No se pudo subir el preview.", "error");
  }
});

load().catch((error) => {
  console.error(error);
  list.innerHTML = `<div class="alert alert-error">No se pudieron cargar tus tareas.</div>`;
});
