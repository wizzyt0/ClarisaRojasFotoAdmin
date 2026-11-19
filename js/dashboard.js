import { requireAuth } from "./auth.js?v=20261119-assistant-role";
import { supabase } from "./supabase.js";
import { formatMoney, formatDate } from "./formatters.js";
import { escapeHtml } from "./utils.js";

const currentUser = await requireAuth();
const isAssistant = currentUser?.staffRole === "assistant";

const metric = (label, value) => `<article class="card"><div class="muted">${label}</div><div class="metric">${value}</div></article>`;
const list = (items, empty = "No hay datos.") => {
  if (!items.length) return `<div class="empty-state">${empty}</div>`;
  return `<div class="table-wrap"><table class="table"><tbody>${items.map((item) => `<tr><td>${item}</td></tr>`).join("")}</tbody></table></div>`;
};

async function loadDashboard() {
  const [clientsResult, jobsResult, followUpsResult, printItemsResult, depositsResult] = await Promise.all([
    supabase.from("clients").select("*"),
    supabase.from(isAssistant ? "assistant_jobs" : "jobs")
      .select(isAssistant ? "*" : "*, clients(name, is_active), packages(name), deposits(amount)")
      .order("created_at", { ascending: false }),
    supabase.from("school_profiles").select("*, clients(name, phone, is_active)").order("next_follow_up_date"),
    supabase.from(isAssistant ? "assistant_print_items" : "print_items")
      .select("id, job_id, title, status, approved_at, updated_at").order("updated_at", { ascending: false }),
    isAssistant ? supabase.from("deposits").select("job_id,amount") : Promise.resolve({ data: [], error: null })
  ]);
  const failed = [clientsResult, jobsResult, followUpsResult, printItemsResult, depositsResult].find((result) => result.error);
  if (failed) throw failed.error;
  const clients = clientsResult.data || [];
  let jobs = jobsResult.data || [];
  const followUps = followUpsResult.data || [];
  const printItems = printItemsResult.data || [];
  if (isAssistant) {
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const depositsByJob = new Map();
    for (const deposit of depositsResult.data || []) {
      const rows = depositsByJob.get(deposit.job_id) || [];
      rows.push(deposit);
      depositsByJob.set(deposit.job_id, rows);
    }
    jobs = jobs.map((job) => ({
      ...job,
      clients: clientsById.get(job.client_id),
      deposits: depositsByJob.get(job.id) || []
    }));
  }

  const allClients = (clients || []).filter((client) => client.is_active);
  const allJobs = (jobs || []).filter((job) => job.clients?.is_active !== false);
  const activeFollowUps = followUps.filter((item) => item.clients?.is_active !== false);
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
  const allPrintItems = printItems;
  const waitingApproval = allPrintItems.filter((item) => item.status === "SENT_FOR_APPROVAL");
  const approvedForPrint = allPrintItems.filter((item) => item.status === "APPROVED_FOR_PRINT");
  const inPrinting = allPrintItems.filter((item) => item.status === "PRINTING");
  const deliveredItems = allPrintItems.filter((item) => item.status === "DELIVERED");

  document.querySelector("#metrics").innerHTML = [
    metric("Total clientes", allClients.length),
    metric("Clientes de sesiones", allClients.filter((c) => c.client_type === "PHOTO_SESSION").length),
    metric("Escuelas", allClients.filter((c) => c.client_type === "SCHOOL_GRADUATION").length),
    metric("Total trabajos", allJobs.length),
    metric("Sesiones activas", allJobs.filter((j) => j.job_type === "PHOTO_SESSION" && j.status !== "DELIVERED").length),
    metric("Graduaciones activas", allJobs.filter((j) => j.job_type === "SCHOOL_GRADUATION" && j.status !== "DELIVERED").length),
    metric("Piezas esperando aprobación", waitingApproval.length),
    metric("Piezas aprobadas para imprimir", approvedForPrint.length),
    metric("Piezas en impresión", inPrinting.length),
    metric("Piezas entregadas", deliveredItems.length),
    metric("Total abonado", formatMoney(totalDeposited)),
    metric("Total pendiente", formatMoney(Math.max(totalPending, 0))),
    metric("Escuelas para contactar este mes", followThisMonth.length)
  ].join("");

  document.querySelector("#upcomingDeliveries").innerHTML = list(allJobs.filter((j) => j.delivery_date).slice(0, 6).map((j) => `<a href="job-detail.html?id=${j.id}">${escapeHtml(j.title)}</a><br><span class="muted">${formatDate(j.delivery_date)}</span>`));
  document.querySelector("#waitingApproval").innerHTML = list(waitingApproval.slice(0, 6).map((item) => {
    const job = allJobs.find((entry) => entry.id === item.job_id);
    return `<a href="job-detail.html?id=${item.job_id}">${escapeHtml(item.title || job?.title || "Pieza")}</a>`;
  }));
  document.querySelector("#recentApproved").innerHTML = list(approvedForPrint.slice(0, 6).map((item) => `<a href="job-detail.html?id=${item.job_id}">${escapeHtml(item.title || "Pieza aprobada")}</a><br><span class="badge badge-status">Aprobada para impresión</span>`));
  document.querySelector("#nearFollowUps").innerHTML = list(activeFollowUps.slice(0, 6).map((f) => `${escapeHtml(f.school_name)}<br><span class="muted">${formatDate(f.next_follow_up_date)}</span>`));
}

loadDashboard().catch((error) => {
  console.error(error);
  document.querySelector("#metrics").innerHTML = `<div class="alert alert-error">No se pudo cargar la información: ${escapeHtml(error.message || "error desconocido")}</div>`;
});
