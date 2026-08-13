"use strict";

if (!window.supabase) {
  window.location.href = "index.html";
  throw new Error("supabase-js no cargó");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = {
  user: null,
  isMedico: false,
  isAdminOrRecepcion: false,

  async init() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      if (!window.location.pathname.endsWith("index.html")) {
        window.location.href = "index.html";
      }
      return;
    }

    const { data: perfil, error: perr } = await supabase
      .from("perfiles")
      .select("*")
      .eq("user_id", data.session.user.id)
      .maybeSingle();

    if (perr || !perfil) {
      await supabase.auth.signOut();
      window.location.href = "index.html";
      return;
    }

    this.user = perfil;
    this.isMedico = perfil.rol === "medico";
    this.isAdminOrRecepcion = ["admin", "recepcion"].includes(perfil.rol);

    this.renderSidebar();
    this.renderUser();
    this.setupBell();
    this.loadNotifications();
  },

  async logout() {
    await supabase.auth.signOut();
    window.location.href = "index.html";
  },

  renderSidebar() {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    const links = [
      { href: "dashboard.html", icon: "📊", label: "Inicio", show: true },
      { href: "citas.html", icon: "🗓️", label: "Citas", show: true },
      { href: "calendario.html", icon: "📅", label: "Calendario", show: true },
      { href: "pacientes.html", icon: "🧑‍🤝‍🧑", label: "Pacientes", show: this.isAdminOrRecepcion },
    ];

    const current = window.location.pathname.split("/").pop();
    nav.innerHTML = links
      .filter((l) => l.show)
      .map(
        (l) =>
          `<a href="${l.href}" class="${current === l.href ? "active" : ""}"><span>${l.icon}</span><span>${l.label}</span></a>`
      )
      .join("");
  },

  renderUser() {
    const box = document.getElementById("user-box");
    if (!box) return;
    box.innerHTML = `
      <div class="info">
        <div class="name">${esc(this.user.nombre)}</div>
        <div class="role">${this.user.rol}</div>
      </div>
      <button class="logout" onclick="app.logout()"><span>🚪</span><span>Cerrar sesión</span></button>
    `;
    const topUser = document.getElementById("top-user");
    if (topUser) topUser.textContent = this.user.nombre;
  },

  setupBell() {
    const bell = document.getElementById("bell");
    if (!bell) return;
    bell.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("bell-dropdown").classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("bell-dropdown");
      if (dd && !dd.contains(e.target) && !bell.contains(e.target)) {
        dd.classList.remove("open");
      }
    });
  },

  async loadNotifications() {
    const bell = document.getElementById("bell");
    if (!bell) return;
    try {
      const { data, error } = await supabase
        .from("recordatorios")
        .select("id, mensaje, fecha_programada, pacientes(nombre)")
        .eq("canal", "app")
        .eq("estado", "pendiente")
        .order("fecha_programada", { ascending: true })
        .limit(50);

      if (error) throw error;

      const badge = document.getElementById("bell-badge");
      badge.textContent = (data || []).length;
      badge.classList.toggle("show", (data || []).length > 0);

      const list = document.getElementById("notif-list");
      if (!data || !data.length) {
        list.innerHTML = `<div class="notif empty">No tiene notificaciones pendientes</div>`;
        return;
      }
      list.innerHTML = data
        .map(
          (n) => `
          <div class="notif">
            <div>🔔 ${esc(n.mensaje)}</div>
            <div class="when">${this.formatDate(n.fecha_programada)} · Paciente: ${esc((n.pacientes && n.pacientes.nombre) || "")}</div>
          </div>`
        )
        .join("");
    } catch (e) {
      /* silencioso */
    }
  },

  async markAllRead() {
    await supabase
      .from("recordatorios")
      .update({ estado: "enviado", enviado_at: new Date().toISOString() })
      .eq("canal", "app")
      .eq("estado", "pendiente");
    this.loadNotifications();
    toast("Notificaciones marcadas como leídas", "success");
  },

  formatDate(value) {
    if (!value) return "-";
    return String(value).replace("T", " ").slice(0, 16);
  },

  formatFechaLarga(value) {
    if (!value) return "-";
    const [y, m, d] = value.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  },

  hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  addDaysISO(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  hhmm(t) {
    return String(t || "").slice(0, 5);
  },
};

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

function toast(message, type = "") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

document.addEventListener("DOMContentLoaded", () => app.init());
