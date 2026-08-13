"use strict";

const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
let semanaInicio = inicioSemana(new Date());
let listaMedicos = [];

function inicioSemana(d) {
  const date = new Date(d);
  const dia = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dia);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function initCalendario() {
  const res = await supabase.from("medicos").select("*").order("nombre");
  if (res.error) return toast(res.error.message, "error");
  listaMedicos = res.data || [];

  const sel = document.getElementById("sel-medico");
  sel.innerHTML =
    `<option value="">Seleccione un médico...</option>` +
    listaMedicos.map((m) => `<option value="${m.id}">${esc(m.nombre)} — ${esc(m.especialidad)}</option>`).join("");

  if (app.isMedico && app.user.medico_id) {
    sel.value = app.user.medico_id;
    sel.disabled = true;
  } else if (listaMedicos.length) {
    sel.value = listaMedicos[0].id;
  }

  cargarSemana();
}

async function cargarSemana() {
  const sel = document.getElementById("sel-medico");
  const medicoId = sel.value;
  if (!medicoId) {
    document.getElementById("calendario").innerHTML = `<div class="empty-state"><div class="icon">📅</div>Seleccione un médico para ver su calendario.</div>`;
    return;
  }

  const medico = listaMedicos.find((m) => m.id === medicoId);
  if (!medico) return;

  const inicio = toISO(semanaInicio);
  const finD = new Date(semanaInicio);
  finD.setDate(finD.getDate() + 6);
  const fin = toISO(finD);

  document.getElementById("semana-label").textContent =
    `${inicio.slice(8, 10)}/${inicio.slice(5, 7)}/${inicio.slice(0, 4)} — ` +
    `${fin.slice(8, 10)}/${fin.slice(5, 7)}/${fin.slice(0, 4)}`;

  const res = await supabase
    .from("citas")
    .select("id, fecha, hora, motivo, estado, pacientes(id, nombre, telefono)")
    .eq("medico_id", medicoId)
    .gte("fecha", inicio)
    .lte("fecha", fin)
    .order("hora");

  if (res.error) return toast(res.error.message, "error");
  renderCalendario(medico, res.data || []);
}

function renderCalendario(medico, citas) {
  const fechas = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(semanaInicio);
    d.setDate(d.getDate() + i);
    fechas.push(toISO(d));
  }

  const diasAtencion = (medico.dias_atencion || []).map((d) => d.toLowerCase());

  const horaIni = Number(medico.hora_inicio.slice(0, 2));
  const minIni = Number(medico.hora_inicio.slice(3, 5));
  const horaFin = Number(medico.hora_fin.slice(0, 2));
  const minFin = Number(medico.hora_fin.slice(3, 5));

  const horas = [];
  for (let h = horaIni; h <= horaFin; h++) {
    for (const m of h === horaIni ? [minIni, 30] : [0, 30]) {
      if (h === horaFin && m > minFin) continue;
      if (h * 60 + m >= horaIni * 60 + minIni && h * 60 + m < horaFin * 60 + minFin) {
        horas.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
  }

  const porDia = (fecha) => citas.filter((c) => c.fecha === fecha).sort((a, b) => a.hora.localeCompare(b.hora));

  let html = `<div class="cal-cell cal-head">Hora</div>`;
  for (let i = 0; i < 7; i++) {
    const esHoy = fechas[i] === app.hoyISO();
    html += `<div class="cal-cell cal-head" style="${esHoy ? "color:var(--primary);" : ""}">${DIAS[i]}<br><span class="small muted">${fechas[i].slice(8, 10)}/${fechas[i].slice(5, 7)}</span></div>`;
  }

  for (const hora of horas) {
    html += `<div class="cal-cell cal-time">${hora}</div>`;
    for (let i = 0; i < 7; i++) {
      const fecha = fechas[i];
      const eventos = porDia(fecha).filter((c) => app.hhmm(c.hora) === hora);
      let cellHtml = "";
      for (const c of eventos) {
        cellHtml += `<div class="cal-event ${c.estado}" onclick='verDetalle(${JSON.stringify(c).replace(/'/g, "\\u0027")})' title="${esc((c.pacientes && c.pacientes.nombre) || "")} — ${esc(c.motivo || "")}">${app.hhmm(c.hora)} · ${esc((c.pacientes && c.pacientes.nombre) || "")}</div>`;
      }
      if (!cellHtml && !diasAtencion.includes(DIAS[i].toLowerCase())) {
        html += `<div class="cal-cell" style="background:#f8fafc"></div>`;
      } else {
        html += `<div class="cal-cell">${cellHtml}</div>`;
      }
    }
  }

  document.getElementById("calendario").innerHTML = html;
}

function cambiarSemana(n) {
  semanaInicio.setDate(semanaInicio.getDate() + n * 7);
  cargarSemana();
}

function irHoy() {
  semanaInicio = inicioSemana(new Date());
  cargarSemana();
}

function verDetalle(cita) {
  const paciente = cita.pacientes || {};
  document.getElementById("detalle-body").innerHTML = `
    <div class="grid grid-2">
      <div class="field"><label>Paciente</label><div><strong>${esc(paciente.nombre || "")}</strong></div></div>
      <div class="field"><label>Teléfono</label><div>${esc(paciente.telefono || "-")}</div></div>
      <div class="field"><label>Fecha</label><div>${app.formatFechaLarga(cita.fecha)}</div></div>
      <div class="field"><label>Hora</label><div>${app.hhmm(cita.hora)}</div></div>
      <div class="field"><label>Motivo</label><div>${esc(cita.motivo || "-")}</div></div>
      <div class="field"><label>Estado</label><div><span class="badge ${cita.estado}">${cita.estado}</span></div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cerrarDetalle()">Cerrar</button>
      <a class="btn" href="citas.html">Ir a gestión de citas</a>
    </div>
  `;
  document.getElementById("modal-detalle").classList.add("open");
}

function cerrarDetalle() {
  document.getElementById("modal-detalle").classList.remove("open");
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!app.user) return;
  initCalendario().catch((e) => toast(e.message, "error"));
  document.getElementById("modal-detalle").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-detalle")) cerrarDetalle();
  });
});
