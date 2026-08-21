"use strict";

let listaRecordatorios = [];
let filtroEstado = "";
let filtroCanal = "";
let mapaUsuarios = {};

const ESTADO_LABEL = { pendiente: "Pendiente", enviado: "Enviado", fallido: "Fallido" };

async function cargarMedios() {
  const [{ data: perfiles }, { data: citas }, { data: recs }] = await Promise.all([
    supabase.from("perfiles").select("user_id, nombre"),
    supabase
      .from("citas")
      .select("id, fecha, hora, pacientes(nombre), medicos(nombre, especialidad)")
      .gte("fecha", app.hoyISO())
      .neq("estado", "cancelada")
      .order("fecha")
      .order("hora"),
    supabase.from("recordatorios").select("cita_id"),
  ]);

  perfiles && perfiles.forEach((p) => (mapaUsuarios[p.user_id] = p.nombre));

  const conRecordatorio = new Set((recs || []).map((r) => r.cita_id));
  const sel = document.getElementById("sel-cita");
  sel.innerHTML =
    `<option value="">— Seleccione una cita —</option>` +
    (citas || [])
      .map(
        (c) =>
          `<option value="${c.id}">${app.formatFechaLarga(c.fecha)} ${app.hhmm(c.hora)} · ${
            c.pacientes ? c.pacientes.nombre : ""
          } · ${c.medicos ? c.medicos.nombre : ""}${conRecordatorio.has(c.id) ? " (ya tiene recordatorio)" : ""}</option>`
      )
      .join("");
}

async function cargarRecordatorios() {
  let query = supabase
    .from("recordatorios")
    .select("*, citas(id, fecha, hora, lugar, pacientes(nombre), medicos(nombre, especialidad))")
    .order("created_at", { ascending: false });

  if (filtroEstado) query = query.eq("estado", filtroEstado);
  if (filtroCanal) query = query.eq("canal", filtroCanal);

  const { data, error } = await query;
  if (error) return toast(error.message, "error");
  listaRecordatorios = data || [];
  renderTabla();
}

function aplicarFiltros() {
  filtroEstado = document.getElementById("f-estado").value;
  filtroCanal = document.getElementById("f-canal").value;
  cargarRecordatorios();
}

function renderTabla() {
  const el = document.getElementById("tabla-recordatorios");
  if (!listaRecordatorios.length) {
    el.innerHTML = `<div class="card empty-state"><div class="icon">🔔</div>No hay recordatorios con los filtros seleccionados</div>`;
    return;
  }

  const filas = listaRecordatorios
    .map((r) => {
      const c = r.citas || {};
      const dest = r.dirigido_a ? (mapaUsuarios[r.dirigido_a] || "Usuario específico") : "Todos";
      const acciones =
        r.estado === "pendiente"
          ? `<button class="btn btn-sm btn-secondary" onclick="marcarEnviado('${r.id}')">Marcar enviado</button>
             <button class="btn btn-sm btn-secondary" onclick="enviarPushRecordatorio('${r.id}')">Push</button>`
          : "";
      return `
      <tr>
        <td>${app.formatFechaLarga(c.fecha)}</td>
        <td><strong>${app.hhmm(c.hora)}</strong></td>
        <td>${esc((c.pacientes && c.pacientes.nombre) || "")}</td>
        <td>${esc((c.medicos && c.medicos.nombre) || "")} <span class="muted small">(${esc((c.medicos && c.medicos.especialidad) || "")})</span></td>
        <td>${r.canal === "email" ? "📧 Email" : "📱 App"}</td>
        <td><span class="badge ${r.estado}">${ESTADO_LABEL[r.estado] || r.estado}</span></td>
        <td class="small">${esc(r.mensaje)}</td>
        <td>${esc(dest)}</td>
        <td><div class="row-actions">${acciones}</div></td>
      </tr>`;
    })
    .join("");

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Fecha</th><th scope="col">Hora</th><th scope="col">Paciente</th><th scope="col">Médico</th>
            <th scope="col">Canal</th><th scope="col">Estado</th><th scope="col">Mensaje</th><th scope="col">Destinatario</th><th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

async function generarRecordatorio() {
  const citaId = document.getElementById("sel-cita").value;
  if (!citaId) return toast("Seleccione una cita", "error");
  const { data, error } = await supabase.rpc("generar_recordatorios_cita", { p_cita_id: citaId });
  if (error) return toast(error.message, "error");
  toast(data === 0 ? "La cita ya tenía sus recordatorios" : `Recordatorios generados: ${data}`, data === 0 ? "" : "success");
  cargarMedios();
  cargarRecordatorios();
}

async function marcarEnviado(id) {
  const { error } = await supabase
    .from("recordatorios")
    .update({ estado: "enviado", enviado_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return toast(error.message, "error");
  toast("Recordatorio marcado como enviado", "success");
  cargarRecordatorios();
}

async function enviarPushRecordatorio(id) {
  const rec = listaRecordatorios.find((r) => r.id === id);
  if (!rec) return;
  const c = rec.citas || {};
  const nombrePaciente = c.pacientes ? c.pacientes.nombre : "";
  const nombreMedico = c.medicos ? c.medicos.nombre : "";
  const fecha = c.fecha ? app.formatFechaLarga(c.fecha) : "";
  const hora = c.hora ? app.hhmm(c.hora) : "";
  const titulo = "Recordatorio de cita";
  const mensaje = `${nombrePaciente} — ${fecha} ${hora} con ${nombreMedico}`;
  const url = "./citas.html";

  const { error } = await supabase.from("push_cola").insert({
    user_id: rec.dirigido_a || null,
    titulo,
    mensaje,
    url,
  });
  if (error) return toast(error.message, "error");
  toast("Push encolado — ejecute: node scripts/enviar-push.mjs --cola", "success");
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.appReady;
  if (!app.user) return;
  if (app.user.rol !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }
  cargarMedios();
  cargarRecordatorios();
});
