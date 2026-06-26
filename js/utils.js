import { APP_CONFIG } from "./config.js";

export function generateToken(length = 40) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function showToast(message, type = "success") {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast alert alert-${type}`;
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

export function confirmAction(message) {
  return window.confirm(message);
}

export function setLoading(element, isLoading) {
  if (!element) return;
  element.disabled = isLoading;
  element.dataset.originalText ||= element.textContent;
  element.textContent = isLoading ? "Guardando..." : element.dataset.originalText;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

export function normalizePhone(phone, defaultCountryCode = APP_CONFIG.defaultCountryCode) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith(defaultCountryCode) && digits.length > 10) return digits;
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  return digits;
}

export function isValidGooglePhotosUrl(url) {
  try {
    const parsed = new URL(url);
    return ["photos.app.goo.gl", "photos.google.com"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function calculateTotalDeposited(deposits = []) {
  return deposits.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

export function calculateRemainingBalance(price, totalDeposited) {
  return Math.max(Number(price || 0) - Number(totalDeposited || 0), 0);
}

export function calculateOverpaidAmount(price, totalDeposited) {
  return Math.max(Number(totalDeposited || 0) - Number(price || 0), 0);
}

export function calculateJobPrice(packagePrice, quantity, jobType) {
  const price = Number(packagePrice || 0);
  return jobType === "SCHOOL_GRADUATION" ? price * Number(quantity || 1) : price;
}

export function calculateTotals(price, deposits = []) {
  const totalDeposited = calculateTotalDeposited(deposits);
  return {
    totalDeposited,
    remainingBalance: calculateRemainingBalance(price, totalDeposited),
    overpaidAmount: calculateOverpaidAmount(price, totalDeposited)
  };
}

export function openInNewTab(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
  showToast("Copiado correctamente.");
}

export function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
