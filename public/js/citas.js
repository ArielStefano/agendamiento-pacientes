"use strict";

let listaCitas = [];
let listaPacientes = [];
let listaMedicos = [];
let slotSeleccionado = null;

const ESTADO_NEXT = {
  solicitada: "confirmada",
  programada: "confirmada",
  confirmada: "completada",
};

async function initCitas() {
  const medicos = await supabase.from("medicos").select("id, nombre, especialidad").order("nombre");
  if (medicos.error) return toast(medicos.error.message, "error");
  listaMedicos = medicos.data || [];

  const pacientes = await supabase.from("pacientes").select("id, nombre, documento").order("nombre");
  if (pacientes.error) return toast(pacientes.error.message, "error");
  listaPacientes = pacientes.data || [];

  const selMedico = document.getElementById("f-medico");
  selMedico.innerHTML =
    `<option value="">Todos los médicos</option>` +
    listaMedicos.map((m) => `<option value="${m.id}">${esc(m.nombre)} — ${esc(m.especialidad)}</option>`).join("");

  if (app.isMedico && app.user.medico_id) {
    selMedico.value = app.user.medico_id;
    selMedico.disabled = true;
  }

  document.getElementById("c-medico").innerHTML =
    listaMedicos.map((m) => `<option value="${m.id}">${esc(m.nombre)} — ${esc(m.especialidad)}</option>`).join("");
  document.getElementById("c-paciente").innerHTML =
    `<option value="">Seleccione un paciente...</option>` +
    listaPacientes.map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.documento ? " (" + esc(p.documento) + ")" : ""}</option>`).join("");

  const hoy = app.hoyISO();
  document.getElementById("f-desde").value = hoy;
  document.getElementById("f-hasta").value = app.addDaysISO(7);
  document.getElementById("c-fecha").min = hoy;

  // Pacientes agendan desde el calendario, no desde aquí
  if (app.user && app.user.rol === "paciente") {
    const btnNueva = document.querySelector(".right .btn");
    if (btnNueva) btnNueva.style.display = "none";
  }

  aplicarFiltros();
}

async function aplicarFiltros() {
  let query = supabase
    .from("citas")
    .select("id, fecha, hora, motivo, lugar, estado, pacientes(id, nombre, telefono), medicos(id, nombre, especialidad)")
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  const desde = document.getElementById("f-desde").value;
  const hasta = document.getElementById("f-hasta").value;
  const medico = document.getElementById("f-medico").value;
  const estado = document.getElementById("f-estado").value;

  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);
  if (medico) query = query.eq("medico_id", medico);
  if (estado) query = query.eq("estado", estado);

  if (app.isMedico && app.user.medico_id) {
    query = query.eq("medico_id", app.user.medico_id);
  }

  const { data, error } = await query;
  if (error) return toast(error.message, "error");
  listaCitas = data || [];
  renderTabla();
}

function renderTabla() {
  const el = document.getElementById("tabla-citas");
  if (!listaCitas.length) {
    el.innerHTML = `<div class="card empty-state"><div class="icon">🗓️</div>No hay citas con los filtros seleccionados</div>`;
    return;
  }

  const puedeEditar = app.isAdminOrRecepcion;
  const esMedico = app.user && app.user.rol === "medico";
  const filas = listaCitas
    .map((c) => {
      const botones = [];
      const esMiCita = esMedico && app.user.medico_id && c.medicos && c.medicos.id === app.user.medico_id;
      if (ESTADO_NEXT[c.estado] && (puedeEditar || esMiCita)) {
        const next = ESTADO_NEXT[c.estado];
        const label = c.estado === "solicitada" ? "✓ Aprobar" : next === "confirmada" ? "✓ Confirmar" : "✓ Completar";
        botones.push(`<button class="btn btn-sm btn-success" onclick="cambiarEstado('${c.id}', '${next}')">${label}</button>`);
      }
      if (c.estado !== "cancelada" && (puedeEditar || esMiCita)) {
        botones.push(`<button class="btn btn-sm btn-secondary" onclick="cambiarEstado('${c.id}', 'cancelada')">✕ Cancelar</button>`);
      }
      if (puedeEditar) {
        botones.push(`<button class="btn btn-sm btn-secondary" onclick="editarCita('${c.id}')">Editar</button>`);
        botones.push(`<button class="btn btn-sm btn-danger" onclick="eliminarCita('${c.id}')">Eliminar</button>`);
      }

      return `
      <tr>
        <td><strong>${app.formatFechaLarga(c.fecha)}</strong></td>
        <td><strong>${app.hhmm(c.hora)}</strong></td>
        <td>${esc((c.pacientes && c.pacientes.nombre) || "")}</td>
        <td>${esc((c.medicos && c.medicos.nombre) || "")} <span class="muted small">(${esc((c.medicos && c.medicos.especialidad) || "")})</span></td>
        <td>${c.lugar === "domicilio" ? "🏠 Domicilio" : "🏥 Consultorio"}</td>
        <td>${esc(c.motivo || "-")}</td>
        <td><span class="badge ${c.estado}">${c.estado}</span></td>
        <td>
          <div class="row-actions">${botones.join("")}</div>
        </td>
      </tr>`;
    })
    .join("");

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th><th>Hora</th><th>Paciente</th><th>Médico</th><th>Lugar</th><th>Motivo</th><th>Estado</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

async function abrirModalCita(cita = null) {
  document.getElementById("cita-titulo").textContent = cita ? "Editar cita" : "Nueva cita";
  document.getElementById("c-id").value = cita ? cita.id : "";
  document.getElementById("c-motivo").value = cita ? cita.motivo || "" : "";
  document.getElementById("c-lugar").value = cita ? cita.lugar || "consultorio" : "consultorio";
  slotSeleccionado = null;

  if (cita) {
    document.getElementById("c-paciente").value = cita.pacientes ? cita.pacientes.id : "";
    document.getElementById("c-medico").value = cita.medicos ? cita.medicos.id : "";
    document.getElementById("c-fecha").value = cita.fecha;
    await cargarDisponibilidad();
    const slot = document.querySelector(`.slot[data-hora="${app.hhmm(cita.hora)}"]`);
    if (slot) {
      slot.classList.add("selected");
      slotSeleccionado = app.hhmm(cita.hora);
    } else {
      document.getElementById("slots").innerHTML = `<span class="muted small">El horario ${app.hhmm(cita.hora)} ya no está disponible como opción.</span>`;
    }
  } else {
    document.getElementById("c-paciente").value = "";
    document.getElementById("c-medico").value =
      app.isMedico && app.user.medico_id ? app.user.medico_id : listaMedicos[0] ? listaMedicos[0].id : "";
    document.getElementById("c-fecha").value = app.hoyISO();
    cargarDisponibilidad();
  }

  document.getElementById("modal-cita").classList.add("open");
}

function cerrarModalCita() {
  document.getElementById("modal-cita").classList.remove("open");
}

function toMin(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

async function cargarDisponibilidad() {
  const medicoId = document.getElementById("c-medico").value;
  const fecha = document.getElementById("c-fecha").value;
  const slotsEl = document.getElementById("slots");
  slotSeleccionado = null;

  if (!medicoId || !fecha) {
    slotsEl.innerHTML = `<span class="muted small">Seleccione médico y fecha.</span>`;
    return;
  }

  const medicoRes = await supabase.from("medicos").select("*").eq("id", medicoId).single();
  if (medicoRes.error) {
    slotsEl.innerHTML = `<span class="small" style="color:var(--danger)">${esc(medicoRes.error.message)}</span>`;
    return;
  }
  const medico = medicoRes.data;

  const citasRes = await supabase
    .from("citas")
    .select("hora, duracion_min, lugar, estado")
    .eq("medico_id", medicoId)
    .eq("fecha", fecha)
    .neq("estado", "cancelada");

  const slots = calcularSlots(medico, fecha, citasRes.data || []);

  if (!slots.length) {
    slotsEl.innerHTML = `<span class="muted small">No hay horarios disponibles para este día.</span>`;
    return;
  }
  slotsEl.innerHTML = slots
    .map((h) => `<div class="slot" data-hora="${h}" onclick="seleccionarSlot(this)">${h}</div>`)
    .join("");
}

function calcularSlots(medico, fecha, citas) {
  const dias = medico.dias_atencion || [];
  const diaSemana = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][new Date(fecha + "T12:00:00").getDay()];
  if (!dias.includes(diaSemana)) return [];

  const dur = medico.duracion_cita_min || 30;
  const bufferDom = medico.buffer_domicilio_min || 0;

  let inicio, fin;
  if (diaSemana === "Sabado" && medico.hora_inicio_sabado && medico.hora_fin_sabado) {
    inicio = toMin(medico.hora_inicio_sabado);
    fin = toMin(medico.hora_fin_sabado);
  } else {
    inicio = toMin(medico.hora_inicio);
    fin = toMin(medico.hora_fin);
  }

  // Rango de descanso
  let descansoIni = null, descansoFin = null;
  if (medico.hora_inicio_descanso && medico.hora_fin_descanso) {
    descansoIni = toMin(medico.hora_inicio_descanso);
    descansoFin = toMin(medico.hora_fin_descanso);
  }

  const ocupados = citas.map((c) => ({ i: toMin(c.hora), f: toMin(c.hora) + c.duracion_min, l: c.lugar, e: c.estado }));

  const slots = [];
  for (let t = inicio; t + dur <= fin; t += dur) {
    const conflicto = ocupados.some((o) => t < o.f && o.i < t + dur);
    if (conflicto) continue;

    // Descanso: bloquear slot si cae dentro del rango de descanso
    if (descansoIni !== null && descansoFin !== null) {
      if (t < descansoFin && t + dur > descansoIni) continue;
    }

    // Buffer domicilio: bloquear slot si una cita domicilio termina dentro del buffer antes de este slot
    if (bufferDom > 0) {
      const bloqueado = ocupados.some((o) =>
        o.l === "domicilio" && o.e === "completada" && o.f > t - bufferDom && o.f <= t
      );
      if (bloqueado) continue;
    }

    slots.push(toHHMM(t));
  }
  return slots;
}

function seleccionarSlot(el) {
  document.querySelectorAll(".slot.selected").forEach((s) => s.classList.remove("selected"));
  el.classList.add("selected");
  slotSeleccionado = el.dataset.hora;
}

async function guardarCita() {
  const id = document.getElementById("c-id").value;
  const fecha = document.getElementById("c-fecha").value;
  const paciente = document.getElementById("c-paciente").value;
  const medico = document.getElementById("c-medico").value;
  const motivo = document.getElementById("c-motivo").value || null;
  const lugar = document.getElementById("c-lugar").value || "consultorio";

  if (!paciente) return toast("Seleccione un paciente", "error");
  if (!medico) return toast("Seleccione un médico", "error");
  if (!fecha) return toast("Seleccione una fecha", "error");
  if (!slotSeleccionado) return toast("Seleccione un horario disponible", "error");

  const hora = slotSeleccionado + ":00";

  let error = null;
  if (id) {
    const { error: e } = await supabase.rpc("actualizar_cita", {
      p_id: id,
      p_paciente: paciente,
      p_medico: medico,
      p_fecha: fecha,
      p_hora: hora,
      p_motivo: motivo,
      p_lugar: lugar,
    });
    error = e;
    if (!error) toast("Cita actualizada", "success");
  } else {
    const { error: e } = await supabase.rpc("crear_cita", {
      p_paciente: paciente,
      p_medico: medico,
      p_fecha: fecha,
      p_hora: hora,
      p_motivo: motivo,
      p_lugar: lugar,
    });
    error = e;
    if (!error) toast("Cita creada correctamente", "success");
  }

  if (error) return toast(error.message, "error");
  cerrarModalCita();
  aplicarFiltros();
}

function editarCita(id) {
  const c = listaCitas.find((x) => x.id === id);
  if (c) abrirModalCita(c);
}

async function cambiarEstado(id, estado) {
  const { error } = await supabase.rpc("cambiar_estado_cita", { p_id: id, p_estado: estado });
  if (error) return toast(error.message, "error");
  toast(`Cita marcada como ${estado}`, "success");
  aplicarFiltros();
}

async function eliminarCita(id) {
  if (!confirm("¿Eliminar definitivamente esta cita?")) return;
  const { error } = await supabase.from("citas").delete().eq("id", id);
  if (error) return toast(error.message, "error");
  toast("Cita eliminada", "success");
  aplicarFiltros();
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.appReady;
  if (!app.user) return;
  initCitas().catch((e) => toast(e.message, "error"));
  document.getElementById("modal-cita").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-cita")) cerrarModalCita();
  });

  // Auto-abrir modal de nueva cita si se llega con ?nueva=true
  if (new URLSearchParams(window.location.search).get("nueva") === "true") {
    setTimeout(() => abrirModalCita(), 300);
  }
});
