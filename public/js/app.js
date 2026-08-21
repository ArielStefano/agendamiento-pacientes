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
  config: {},

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
    this.loadConfig();
    this.setupFAB();
    this.setupPullToRefresh();
    this.setupPushSubscription();
  },

  async loadConfig() {
    try {
      const { data } = await supabase.rpc("leer_configuracion");
      if (data) {
        for (const row of data) {
          this.config[row.clave] = row.valor;
        }
      }
    } catch (e) { /* silencioso */ }
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
      { href: "configuracion.html", icon: "⚙️", label: "Configuración", show: this.user.rol === "admin" },
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
            const debeAnonimizar = this.config.anonimizar_pacientes !== false && this.user && this.user.rol === "paciente";
            const esMiNotif = debeAnonimizar && n.pacientes && n.pacientes.id === this.user.paciente_id;
            const nombrePaciente = debeAnonimizar && !esMiNotif ? "Un paciente" : esc((n.pacientes && n.pacientes.nombre) || "");
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

  setupFAB() {
    if (this.isAdminOrRecepcion) {
      const fab = document.createElement("button");
      fab.className = "fab";
      fab.id = "fab-nueva-cita";
      fab.setAttribute("aria-label", "Nueva cita");
      fab.textContent = "+";
      fab.addEventListener("click", () => {
        window.location.href = "citas.html?nueva=true";
      });
      document.body.appendChild(fab);
    } else if (this.user && this.user.rol === "paciente") {
      const fab = document.createElement("button");
      fab.className = "fab";
      fab.id = "fab-agendar";
      fab.setAttribute("aria-label", "Agendar cita");
      fab.textContent = "+";
      fab.addEventListener("click", () => {
        window.location.href = "calendario.html";
      });
      document.body.appendChild(fab);
    }
  },

  setupPullToRefresh() {
    const content = document.querySelector(".content");
    if (!content) return;

    let startY = 0;
    let pulling = false;
    let indicator = null;

    content.addEventListener("touchstart", (e) => {
      if (content.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    content.addEventListener("touchmove", (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 40 && !indicator) {
        indicator = document.createElement("div");
        indicator.className = "pull-indicator show";
        indicator.textContent = "↑ Actualizar";
        document.body.appendChild(indicator);
      }
    }, { passive: true });

    content.addEventListener("touchend", () => {
      if (indicator) {
        indicator.textContent = "Actualizando...";
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
      pulling = false;
    }, { passive: true });
  },

  // ── Push notifications ───────────────────────────────────────
  async setupPushSubscription() {
    const btn = document.getElementById("btn-push-toggle");
    if (!btn) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      btn.textContent = "No soportado";
      btn.disabled = true;
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.updatePushButton(sub);
      btn.addEventListener("click", () => this.togglePush());
    } catch (e) {
      btn.textContent = "Error";
      btn.disabled = true;
    }
  },

  async togglePush() {
    const btn = document.getElementById("btn-push-toggle");
    if (btn) btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await this.unsubscribePush(sub);
      } else {
        await this.subscribePush(reg);
      }
    } catch (e) {
      toast("Error al configurar notificaciones", "error");
    }
    if (btn) btn.disabled = false;
  },

  async subscribePush(reg) {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast("Permiso de notificaciones denegado", "warning");
      this.updatePushButton(null);
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const p = sub.toJSON();
    const { error } = await supabase.rpc("registrar_push_suscripcion", {
      p_endpoint: p.endpoint,
      p_p256dh: p.keys.p256dh,
      p_auth: p.keys.auth,
    });
    if (error) throw error;
    this.updatePushButton(sub);
    toast("Notificaciones push activadas", "success");
  },

  async unsubscribePush(sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await supabase.rpc("eliminar_push_suscripcion", { p_endpoint: endpoint });
    this.updatePushButton(null);
    toast("Notificaciones push desactivadas", "info");
  },

  updatePushButton(sub) {
    const btn = document.getElementById("btn-push-toggle");
    if (!btn) return;
    if (sub) {
      btn.textContent = "Desactivar notificaciones";
      btn.classList.add("active");
    } else {
      btn.textContent = "Activar notificaciones";
      btn.classList.remove("active");
    }
  },

  urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
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

function escapeHTML(str) {
  return esc(str);
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
