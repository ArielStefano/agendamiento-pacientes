"use strict";

document.addEventListener("DOMContentLoaded", () => {
  if (!app.user) return;
  const hoy = app.hoyISO();
  const en7 = app.addDaysISO(7);

  let citasQuery = supabase
    .from("citas")
    .select("id, fecha, hora, estado, pacientes(nombre), medicos(nombre, especialidad)")
    .gte("fecha", hoy)
    .lte("fecha", en7);

  if (app.isMedico) {
    citasQuery = citasQuery.eq("medico_id", app.user.medico_id);
  }

  const tareaPacientes = app.isAdminOrRecepcion
    ? supabase.from("pacientes").select("id", { count: "exact", head: true })
    : Promise.resolve({ count: 0 });

  const tareaMedicos = supabase.from("medicos").select("id", { count: "exact", head: true });

  Promise.all([citasQuery, tareaPacientes, tareaMedicos])
    .then(([resCitas, resPacientes, resMedicos]) => {
      if (resCitas.error) throw resCitas.error;
      const citas = resCitas.data || [];

      const hoyCitas = citas.filter((c) => c.fecha === hoy && c.estado !== "cancelada");
      const proximas = citas.filter((c) => c.estado === "programada" || c.estado === "confirmada");

      document.getElementById("dashboard-content").innerHTML = `
        <div class="grid grid-4 mb-16">
          <div class="card stat-card">
            <div class="icon">🗓️</div>
            <div class="value">${hoyCitas.length}</div>
            <div class="label">Citas de hoy</div>
          </div>
          <div class="card stat-card">
            <div class="icon">📅</div>
            <div class="value">${proximas.length}</div>
            <div class="label">Próximas citas (7 días)</div>
          </div>
          <div class="card stat-card">
            <div class="icon">🧑‍🤝‍🧑</div>
            <div class="value">${resPacientes.count || 0}</div>
            <div class="label">Pacientes registrados</div>
          </div>
          <div class="card stat-card">
            <div class="icon">🩺</div>
            <div class="value">${resMedicos.count || 0}</div>
            <div class="label">Médicos en la clínica</div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-header">
              <h3>${app.isMedico ? "Sus citas de hoy" : "Citas de hoy"}</h3>
              <a href="citas.html" class="small">Ver todas →</a>
            </div>
            ${tablaCitas(hoyCitas, true)}
          </div>
          <div class="card">
            <div class="card-header">
              <h3>Próximas citas (7 días)</h3>
              <a href="calendario.html" class="small">Ver calendario →</a>
            </div>
            ${tablaCitas(proximas.slice(0, 8), false)}
          </div>
        </div>
      `;
    })
    .catch((e) => toast(e.message, "error"));
});

function tablaCitas(citas, mostrarFecha) {
  if (!citas.length) {
    return `<div class="empty-state"><div class="icon">🌤️</div>Sin citas para este período</div>`;
  }
  const filas = citas
    .map(
      (c) => `
      <tr>
        <td>${mostrarFecha ? app.formatFechaLarga(c.fecha) : ""}</td>
        <td><strong>${app.hhmm(c.hora)}</strong></td>
        <td>${esc((c.pacientes && c.pacientes.nombre) || "")}</td>
        <td>${esc((c.medicos && c.medicos.nombre) || "")}</td>
        <td><span class="badge ${c.estado}">${c.estado}</span></td>
      </tr>`
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${mostrarFecha ? "<th>Fecha</th>" : ""}
            <th>Hora</th>
            <th>Paciente</th>
            <th>Médico</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}
