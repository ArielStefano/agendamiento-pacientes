"use strict";

const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
let semanaInicio = inicioSemana(new Date());
let listaMedicos = [];
let slotSeleccionado = null;

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
    .select("id, fecha, hora, motivo, lugar, estado, pacientes(id, nombre, telefono)")
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

  // Horario principal (Lun-Vie)
  const horaIni = Number(medico.hora_inicio.slice(0, 2));
  const minIni = Number(medico.hora_inicio.slice(3, 5));
  const horaFin = Number(medico.hora_fin.slice(0, 2));
  const minFin = Number(medico.hora_fin.slice(3, 5));

  // Horario sábado (si existe)
  const tieneSabado = medico.hora_inicio_sabado && medico.hora_fin_sabado;
  let horaIniSab = horaIni, minIniSab = minIni, horaFinSab = horaFin, minFinSab = minFin;
  if (tieneSabado) {
    horaIniSab = Number(medico.hora_inicio_sabado.slice(0, 2));
    minIniSab = Number(medico.hora_inicio_sabado.slice(3, 5));
    horaFinSab = Number(medico.hora_fin_sabado.slice(0, 2));
    minFinSab = Number(medico.hora_fin_sabado.slice(3, 5));
  }

  // Slots de tiempo: unir ambos rangos (sin duplicados), usando la duración del médico
  const dur = medico.duracion_cita_min || 30;
  const horasSet = new Set();
  function agregarRango(hIni, mIni, hFin, mFin) {
    let t = hIni * 60 + mIni;
    const fin = hFin * 60 + mFin;
    while (t + dur <= fin) {
      horasSet.add(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
      t += dur;
    }
  }
  agregarRango(horaIni, minIni, horaFin, minFin);
  if (tieneSabado) agregarRango(horaIniSab, minIniSab, horaFinSab, minFinSab);
  const horas = Array.from(horasSet).sort();

  // Para cada celda, determinar si ese día/hora es laboral
  function esLaboralParaFecha(fecha, hora) {
    const diaIdx = fechas.indexOf(fecha);
    const diaNombre = DIAS[diaIdx];
    if (!diasAtencion.includes(diaNombre.toLowerCase())) return false;
    if (diaNombre === "Sabado" && tieneSabado) {
      const hm = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
      return hm >= horaIniSab * 60 + minIniSab && hm < horaFinSab * 60 + minFinSab;
    }
    const hm = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
    return hm >= horaIni * 60 + minIni && hm < horaFin * 60 + minFin;
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
      const esLaboral = esLaboralParaFecha(fecha, hora);
      const esFuturo = fecha >= app.hoyISO();
      const eventos = porDia(fecha).filter((c) => app.hhmm(c.hora) === hora);
      let cellHtml = "";
      for (const c of eventos) {
        cellHtml += `<div class="cal-event ${c.estado}" onclick='verDetalle(${JSON.stringify(c).replace(/'/g, "\\u0027")})' title="${esc((c.pacientes && c.pacientes.nombre) || "")} — ${esc(c.motivo || "")}">${app.hhmm(c.hora)} · ${c.lugar === "domicilio" ? "🏠" : "🏥"} ${esc((c.pacientes && c.pacientes.nombre) || "")}</div>`;
      }
      if (!cellHtml && !esLaboral) {
        html += `<div class="cal-cell" style="background:#f8fafc"></div>`;
      } else if (!cellHtml && esLaboral && esFuturo && app.user && app.user.rol === "paciente") {
        html += `<div class="cal-cell cal-slot" onclick="abrirAgendar('${fecha}','${hora}')" title="Agendar: ${hora}">${hora}</div>`;
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
      <div class="field"><label>Lugar</label><div>${cita.lugar === "domicilio" ? "🏠 A domicilio" : "🏥 En consultorio"}</div></div>
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

function abrirAgendar(fecha, hora) {
  const sel = document.getElementById("sel-medico");
  const medico = listaMedicos.find((m) => m.id === sel.value);
  if (!medico) return;

  slotSeleccionado = { medico_id: medico.id, fecha, hora, medico_nombre: medico.nombre, medico_esp: medico.especialidad };

  document.getElementById("agendar-info").innerHTML = `
    <div class="grid grid-2">
      <div class="field"><label>Médico</label><div><strong>${esc(medico.nombre)}</strong> — ${esc(medico.especialidad)}</div></div>
      <div class="field"><label>Fecha</label><div>${app.formatFechaLarga(fecha)}</div></div>
      <div class="field"><label>Hora</label><div>${hora}</div></div>
      <div class="field"><label>Lugar</label><div>🏥 Consultorio</div></div>
    </div>
  `;
  document.getElementById("ag-motivo").value = "";
  document.getElementById("modal-agendar").classList.add("open");
}

function cerrarAgendar() {
  document.getElementById("modal-agendar").classList.remove("open");
  slotSeleccionado = null;
}

async function confirmarAgendar() {
  if (!slotSeleccionado) return;
  const btn = document.getElementById("btn-agendar");
  btn.disabled = true;
  btn.textContent = "Agendando...";

  try {
    const { error } = await supabase.rpc("crear_cita", {
      p_paciente: null,
      p_medico: slotSeleccionado.medico_id,
      p_fecha: slotSeleccionado.fecha,
      p_hora: slotSeleccionado.hora + ":00",
      p_motivo: document.getElementById("ag-motivo").value || null,
      p_lugar: "consultorio",
    });
    if (error) throw new Error(error.message);
    cerrarAgendar();
    toast("Cita solicitada correctamente. Pendiente de aprobación.", "success");
    cargarSemana();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar cita";
  }
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.appReady;
  if (!app.user) return;
  initCalendario().catch((e) => toast(e.message, "error"));
  document.getElementById("modal-detalle").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-detalle")) cerrarDetalle();
  });
  document.getElementById("modal-agendar").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-agendar")) cerrarAgendar();
  });
});
