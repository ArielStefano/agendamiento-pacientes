"use strict";

function setupLayout(title) {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand"><span class="logo">🏥</span><span>CliniAgenda</span></div>
      <nav id="sidebar-nav"></nav>
      <div class="user-box" id="user-box"></div>
    `;
  }

  // Overlay for mobile sidebar
  if (!document.getElementById("sidebar-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "sidebar-overlay";
    overlay.className = "sidebar-overlay";
    document.body.appendChild(overlay);
  }

  const topbar = document.getElementById("topbar");
  if (topbar) {
    topbar.innerHTML = `
      <div class="topbar-left">
        <button class="menu-toggle" id="menu-toggle" aria-label="Abrir menú de navegación" aria-expanded="false">☰</button>
        <h1>${title}</h1>
      </div>
      <div class="actions">
        <button class="theme-toggle" id="theme-toggle" title="Cambiar tema" aria-label="Cambiar modo claro/oscuro"></button>
        <button class="refresh-btn" onclick="location.reload()" title="Actualizar" aria-label="Actualizar página">🔄</button>
        <div class="bell-wrap" style="position:relative">
          <button class="bell" id="bell" title="Notificaciones" aria-label="Notificaciones" aria-expanded="false" aria-haspopup="true">🔔<span class="badge" id="bell-badge" aria-hidden="true">0</span></button>
          <div class="bell-dropdown" id="bell-dropdown" role="menu" aria-label="Lista de notificaciones">
            <div class="header">
              <span>Notificaciones</span>
              <button onclick="app.markAllRead()">Marcar leídas</button>
            </div>
            <div id="notif-list"></div>
            <div class="push-actions">
              <button id="btn-push-toggle" class="btn btn-sm btn-secondary">Activar notificaciones</button>
            </div>
          </div>
        </div>
        <span id="top-user" class="muted small"></span>
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  const title = document.body.dataset.title || "Inicio";
  setupLayout(title);
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    updateToggleIcon(saved);
    toggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      updateToggleIcon(next);
    });
  }
});

function updateToggleIcon(theme) {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
