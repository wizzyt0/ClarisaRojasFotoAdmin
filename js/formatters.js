import { APP_CONFIG } from "./config.js";

export function formatMoney(value = 0) {
  return new Intl.NumberFormat(APP_CONFIG.locale, {
    style: "currency",
    currency: APP_CONFIG.currency
  }).format(Number(value || 0));
}

export function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat(APP_CONFIG.locale).format(new Date(`${date}T00:00:00`));
}

export function formatDateTime(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat(APP_CONFIG.locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(date));
}

export function formatPhone(phone) {
  return phone || "";
}
