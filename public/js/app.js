"use strict";

if (!window.supabaseLib) {
  window.location.href = "index.html";
  throw new Error("supabase-js no cargó");
}

const supabase = window.supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

    // Pacientes van directo al calendario para agendar
    if (perfil.rol === "paciente" && window.location.pathname.endsWith("dashboard.html")) {
      window.location.href = "calendario.html";
      return;
    }

    this.renderSidebar();
    this.renderUser();
    this.setupBell();
    this.loadNotifications();
    this.setupMobileMenu();
  },

  async logout() {
    await supabase.auth.signOut();
    window.location.href = "index.html";
  },

  renderSidebar() {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    const links = [
      { href: this.user.rol === "paciente" ? "calendario.html" : "dashboard.html", icon: "📊", label: "Inicio", show: true },
      { href: "citas.html", icon: "🗓️", label: "Citas", show: true },
      { href: "calendario.html", icon: "📅", label: "Calendario", show: true },
      { href: "pacientes.html", icon: "🧑‍🤝‍🧑", label: "Pacientes", show: this.isAdminOrRecepcion },
      { href: "medicos.html", icon: "🩺", label: "Médicos", show: this.user.rol === "admin" },
      { href: "recordatorios.html", icon: "🔔", label: "Recordatorios", show: this.user.rol === "admin" },
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
      const dd = document.getElementById("bell-dropdown");
      dd.classList.toggle("open");
      bell.setAttribute("aria-expanded", dd.classList.contains("open"));
    });
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("bell-dropdown");
      if (dd && !dd.contains(e.target) && !bell.contains(e.target)) {
        dd.classList.remove("open");
        bell.setAttribute("aria-expanded", "false");
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
        .or(`dirigido_a.is.null,dirigido_a.eq.${this.user.id}`)
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
          (n) => {
            const esPaciente = this.user && this.user.rol === "paciente";
            const esMiNotif = esPaciente && n.pacientes && n.pacientes.id === this.user.paciente_id;
            const nombrePaciente = esPaciente && !esMiNotif ? "Un paciente" : esc((n.pacientes && n.pacientes.nombre) || "");
            return `
          <div class="notif">
            <div>🔔 ${esc(n.mensaje)}</div>
            <div class="when">${this.formatDate(n.fecha_programada)} · Paciente: ${nombrePaciente}</div>
          </div>`;
          }
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
      .eq("estado", "pendiente")
      .or(`dirigido_a.is.null,dirigido_a.eq.${this.user.id}`);
    this.loadNotifications();
    toast("Notificaciones marcadas como leídas", "success");
  },

  setupMobileMenu() {
    const toggle = document.getElementById("menu-toggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!toggle || !sidebar) return;

    const close = () => {
      sidebar.classList.remove("open");
      if (overlay) overlay.classList.remove("show");
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      if (overlay) overlay.classList.toggle("show");
      toggle.setAttribute("aria-expanded", sidebar.classList.contains("open"));
    });

    if (overlay) {
      overlay.addEventListener("click", close);
    }

    sidebar.querySelectorAll("nav a").forEach((a) => {
      a.addEventListener("click", close);
    });
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
  const icons = { success: "\u2705", error: "\u274C", warning: "\u26A0\uFE0F", info: "\u2139\uFE0F" };
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || ""}</span><span class="toast-msg">${escapeHTML(message)}</span><button class="toast-close" aria-label="Cerrar">&times;</button><div class="toast-bar"></div>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  t.querySelector(".toast-close").addEventListener("click", () => removeToast(t));
  const timer = setTimeout(() => removeToast(t), type === "error" ? 6000 : 3500);
  t._timer = timer;
}

function removeToast(el) {
  clearTimeout(el._timer);
  el.classList.remove("show");
  el.classList.add("toast-exit");
  setTimeout(() => el.remove(), 300);
}

document.addEventListener("DOMContentLoaded", () => {
  window.appReady = app.init();
});
