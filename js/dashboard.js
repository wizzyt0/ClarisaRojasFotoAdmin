import { requireAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import { formatMoney, formatDate } from "./formatters.js";
import { getJobStatusLabel } from "./constants.js";
import { escapeHtml } from "./utils.js";

await requireAuth();

const metric = (label, value) => `<article class="card"><div class="muted">${label}</div><div class="metric">${value}</div></article>`;
const list = (items, empty = "No hay datos.") => {
  if (!items.length) return `<div class="empty-state">${empty}</div>`;
  return `<div class="table-wrap"><table class="table"><tbody>${items.map((item) => `<tr><td>${item}</td></tr>`).join("")}</tbody></table></div>`;
};

async function loadDashboard() {
  const [{ data: clients }, { data: jobs }, { data: followUps }] = await Promise.all([
    supabase.from("clients").select("*"),
    supabase.from("jobs").select("*, clients(name, is_active), packages(name), deposits(amount)").order("created_at", { ascending: false }),
    supabase.from("school_profiles").select("*, clients(name, phone, is_active)").order("next_follow_up_date")
  ]);

  const allClients = (clients || []).filter((client) => client.is_active);
  const allJobs = (jobs || []).filter((job) => job.clients?.is_active !== false);
  const activeFollowUps = (followUps || []).filter((item) => item.clients?.is_active !== false);
  const totalDeposited = allJobs.reduce((sum, job) => {
    return sum + (job.deposits || []).reduce((jobSum, item) => jobSum + Number(item.amount || 0), 0);
  }, 0);
  const totalPending = allJobs.reduce((sum, job) => {
    const jobDeposited = (job.deposits || []).reduce((jobSum, item) => jobSum + Number(item.amount || 0), 0);
    return sum + Math.max(Number(job.price || 0) - jobDeposited, 0);
  }, 0);
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const followThisMonth = activeFollowUps.filter((item) => item.next_follow_up_date?.startsWith(thisMonth));

  document.querySelector("#metrics").innerHTML = [
    metric("Total clientes", allClients.length),
    metric("Clientes de sesiones", allClients.filter((c) => c.client_type === "PHOTO_SESSION").length),
    metric("Escuelas", allClients.filter((c) => c.client_type === "SCHOOL_GRADUATION").length),
    metric("Total trabajos", allJobs.length),
    metric("Sesiones activas", allJobs.filter((j) => j.job_type === "PHOTO_SESSION" && j.status !== "DELIVERED").length),
    metric("Graduaciones activas", allJobs.filter((j) => j.job_type === "SCHOOL_GRADUATION" && j.status !== "DELIVERED").length),
    metric("Esperando aprobación", allJobs.filter((j) => j.status === "WAITING_APPROVAL").length),
    metric("Aprobados para imprimir", allJobs.filter((j) => j.status === "APPROVED_FOR_PRINT").length),
    metric("En impresión", allJobs.filter((j) => j.status === "PRINTING").length),
    metric("Entregados", allJobs.filter((j) => j.status === "DELIVERED").length),
    metric("Total abonado", formatMoney(totalDeposited)),
    metric("Total pendiente", formatMoney(Math.max(totalPending, 0))),
    metric("Escuelas para contactar este mes", followThisMonth.length)
  ].join("");

  document.querySelector("#upcomingDeliveries").innerHTML = list(allJobs.filter((j) => j.delivery_date).slice(0, 6).map((j) => `<a href="job-detail.html?id=${j.id}">${escapeHtml(j.title)}</a><br><span class="muted">${formatDate(j.delivery_date)}</span>`));
  document.querySelector("#waitingApproval").innerHTML = list(allJobs.filter((j) => j.status === "WAITING_APPROVAL").map((j) => `<a href="job-detail.html?id=${j.id}">${escapeHtml(j.title)}</a>`));
  document.querySelector("#recentApproved").innerHTML = list(allJobs.filter((j) => j.approved_at).slice(0, 6).map((j) => `<a href="job-detail.html?id=${j.id}">${escapeHtml(j.title)}</a><br><span class="badge badge-status">${getJobStatusLabel(j.status)}</span>`));
  document.querySelector("#nearFollowUps").innerHTML = list(activeFollowUps.slice(0, 6).map((f) => `${escapeHtml(f.school_name)}<br><span class="muted">${formatDate(f.next_follow_up_date)}</span>`));
}

loadDashboard().catch((error) => {
  console.error(error);
  document.querySelector("#metrics").innerHTML = `<div class="alert alert-error">No se pudo cargar la información.</div>`;
});
