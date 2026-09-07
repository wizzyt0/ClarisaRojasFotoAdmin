import { supabase } from "./supabase.js";
import { showToast } from "./utils.js";

export const AUTH_ENABLED = true;
const STAFF_ROLES = new Set(["owner", "editor"]);
let rolePromise = null;

export async function login(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function logout() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("sb-") && key.includes("auth-token"))
      .forEach((key) => localStorage.removeItem(key));
    window.location.replace("index.html");
  }
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

async function getStaffProfile(userId) {
  if (!rolePromise) {
    rolePromise = supabase
      .from("staff_roles")
      .select("role, display_name")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        return data || null;
      });
  }
  return rolePromise;
}

export function isOwner(user) {
  return user?.staffRole === "owner";
}

function applyRoleVisibility(role) {
  document.documentElement.dataset.staffRole = role;
  document.querySelectorAll("[data-owner-only]").forEach((element) => {
    element.hidden = role !== "owner";
  });
}

export async function requireAuth(allowedRoles = STAFF_ROLES) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.replace("index.html");
    return null;
  }
  let staffProfile;
  try {
    staffProfile = await getStaffProfile(data.session.user.id);
  } catch (error) {
    console.error(error);
    await supabase.auth.signOut();
    window.location.replace("index.html");
    return null;
  }
  if (!STAFF_ROLES.has(staffProfile?.role)) {
    await supabase.auth.signOut();
    window.location.replace("index.html");
    return null;
  }
  if (!allowedRoles.includes(staffProfile.role)) {
    window.location.replace("dashboard.html");
    return null;
  }
  if (staffProfile.role === "editor" && !window.location.pathname.endsWith("/editor-tasks.html")) {
    window.location.replace("editor-tasks.html");
    return null;
  }
  applyRoleVisibility(staffProfile.role);
  wireLogout();
  return { ...data.session.user, staffRole: staffProfile.role, staffName: staffProfile.display_name };
}

export async function redirectIfAuthenticated() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  try {
    const profile = await getStaffProfile(data.session.user.id);
    window.location.href = profile?.role === "editor" ? "editor-tasks.html" : "dashboard.html";
  } catch {
    window.location.href = "index.html";
  }
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
