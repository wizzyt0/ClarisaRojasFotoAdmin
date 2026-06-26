import { supabase } from "./supabase.js";
import { showToast } from "./utils.js";

export const AUTH_ENABLED = true;

export async function login(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return null;
  }
  wireLogout();
  return data.session.user;
}

export async function redirectIfAuthenticated() {
  const { data } = await supabase.auth.getSession();
  if (data.session) window.location.href = "dashboard.html";
}

export function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", logout);
  });
}

export function initLoginPage() {
  redirectIfAuthenticated();
  const form = document.querySelector("#loginForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    const email = form.email.value.trim();
    const password = form.password.value;
    const { error } = await login(email, password);
    button.disabled = false;
    if (error) {
      showToast("No se pudo iniciar sesión. Revise el correo y la contraseña.", "error");
      console.error(error);
      return;
    }
    window.location.href = "dashboard.html";
  });
}
