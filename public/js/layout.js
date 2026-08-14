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

  const topbar = document.getElementById("topbar");
  if (topbar) {
    topbar.innerHTML = `
      <h1>${title}</h1>
      <div class="actions">
        <div class="bell-wrap" style="position:relative">
          <button class="bell" id="bell" title="Notificaciones">🔔<span class="badge" id="bell-badge">0</span></button>
          <div class="bell-dropdown" id="bell-dropdown">
            <div class="header">
              <span>Notificaciones</span>
              <button onclick="app.markAllRead()">Marcar leídas</button>
            </div>
            <div id="notif-list"></div>
          </div>
        </div>
        <span id="top-user" class="muted small"></span>
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const title = document.body.dataset.title || "Inicio";
  setupLayout(title);
});
