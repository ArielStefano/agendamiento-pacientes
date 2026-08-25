"use strict";

let listaCitas = [];
let listaPacientes = [];
let listaMedicos = [];
let slotSeleccionado = null;
let citaACancelar = null;

const ESTADO_NEXT = {
  solicitada: "confirmada",
  programada: "confirmada",
  confirmada: "completada",
};

async function initCitas() {
  const medicos = await supabase.from("medicos").select("id, nombre, especialidad, lugares_atencion").order("nombre");
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
  const buscar = (document.getElementById("f-buscar")?.value || "").trim();
  let query = supabase
    .from("citas")
    .select("id, fecha, hora, motivo, lugar, estado, motivo_cancelacion, pacientes(id, nombre, telefono), medicos(id, nombre, especialidad)")
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

  if (app.user && app.user.rol === "paciente" && app.user.paciente_id) {
    query = query.eq("paciente_id", app.user.paciente_id);
  }

  const { data, error } = await query;
  if (error) return toast(error.message, "error");

  let filtered = data || [];
  if (buscar) {
    const q = buscar.toLowerCase();
    filtered = filtered.filter((c) => {
      const nombre = (c.pacientes && c.pacientes.nombre || "").toLowerCase();
      return nombre.includes(q);
    });
  }

  listaCitas = filtered;
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
      const esPacienteMio = app.user && app.user.rol === "paciente" && c.pacientes && c.pacientes.id === app.user.paciente_id;
      if (ESTADO_NEXT[c.estado] && (puedeEditar || esMiCita)) {
        const next = ESTADO_NEXT[c.estado];
        const label = c.estado === "solicitada" ? "✓ Aprobar" : next === "confirmada" ? "✓ Confirmar" : "✓ Completar";
        botones.push(`<button class="btn btn-sm btn-success" onclick="cambiarEstado('${c.id}', '${next}')">${label}</button>`);
      }
      if (!["cancelada", "cancelada_clausula"].includes(c.estado) && (puedeEditar || esMiCita || esPacienteMio)) {
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
        <td>${c.lugar.toLowerCase() === "domicilio" ? "🏠 Domicilio" : "🏥 " + esc(c.lugar)}</td>
        <td>${esc(c.motivo || "-")}</td>
        <td><span class="badge ${c.estado}">${c.estado === "cancelada_clausula" ? "Cláusula" : c.estado}</span>${c.motivo_cancelacion ? `<br><span class="muted small" title="${esc(c.motivo_cancelacion)}">${esc(c.motivo_cancelacion.length > 40 ? c.motivo_cancelacion.slice(0, 40) + "..." : c.motivo_cancelacion)}</span>` : ""}</td>
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
            <th scope="col">Fecha</th><th scope="col">Hora</th><th scope="col">Paciente</th><th scope="col">Médico</th><th scope="col">Lugar</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col">Acciones</th>
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
  slotSeleccionado = null;

  if (cita) {
    document.getElementById("c-paciente").value = cita.pacientes ? cita.pacientes.id : "";
    document.getElementById("c-medico").value = cita.medicos ? cita.medicos.id : "";
    document.getElementById("c-fecha").value = cita.fecha;
    actualizarLugares(cita.medicos ? cita.medicos.id : "", cita.lugar || "Consultorio");
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
    const medicoDefault = app.isMedico && app.user.medico_id ? app.user.medico_id : listaMedicos[0] ? listaMedicos[0].id : "";
    document.getElementById("c-medico").value = medicoDefault;
    document.getElementById("c-fecha").value = app.hoyISO();
    actualizarLugares(medicoDefault, "Consultorio");
    cargarDisponibilidad();
  }

  document.getElementById("modal-cita").classList.add("open");
}

function cerrarModalCita() {
  document.getElementById("modal-cita").classList.remove("open");
}

function actualizarLugares(medicoId, seleccionar) {
  const medico = listaMedicos.find((m) => m.id === medicoId);
  const sel = document.getElementById("c-lugar");
  const lugares = medico && medico.lugares_atencion && medico.lugares_atencion.length
    ? medico.lugares_atencion
    : ["Consultorio"];
  sel.innerHTML = lugares.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  if (seleccionar && lugares.includes(seleccionar)) sel.value = seleccionar;
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

  const desRes = await supabase
    .from("disponibilidad_especial")
    .select("*")
    .eq("medico_id", medicoId);

  const diaSemana = ["Domingo","Lunes","Martes","Miercoles","Jueves","Viernes","Sabado"][new Date(fecha + "T12:00:00").getDay()];
  const especiales = (desRes.data || []).filter((e) => e.fecha === fecha || e.dia_semana === diaSemana);

  const slots = calcularSlots(medico, fecha, citasRes.data || [], especiales);

  if (!slots.length) {
    slotsEl.innerHTML = `<span class="muted small">No hay horarios disponibles para este día.</span>`;
    return;
  }
  slotsEl.innerHTML = slots
    .map((h) => `<div class="slot" data-hora="${h}" onclick="seleccionarSlot(this)">${h}</div>`)
    .join("");
}

function calcularSlots(medico, fecha, citas, especiales = []) {
  const dias = medico.dias_atencion || [];
  const diaSemana = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][new Date(fecha + "T12:00:00").getDay()];
  if (!dias.includes(diaSemana)) {
    if (!especiales.length) return [];
  }

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
  if (diaSemana === "Sabado" && medico.hora_inicio_descanso_sabado && medico.hora_fin_descanso_sabado) {
    descansoIni = toMin(medico.hora_inicio_descanso_sabado);
    descansoFin = toMin(medico.hora_fin_descanso_sabado);
  } else if (medico.hora_inicio_descanso && medico.hora_fin_descanso) {
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
        o.l.toLowerCase() === "domicilio" && o.e === "completada" && o.f > t - bufferDom && o.f <= t
      );
      if (bloqueado) continue;
    }

    slots.push(toHHMM(t));
  }

  // Horarios especiales: agregar slots extra y quitar bloqueados
  if (especiales.length) {
    for (const esp of especiales) {
      const ei = toMin(esp.hora_inicio);
      const ef = toMin(esp.hora_fin);
      if (esp.tipo === "extra") {
        for (let t = ei; t + dur <= ef; t += dur) {
          const hhmm = toHHMM(t);
          if (slots.includes(hhmm)) continue;
          const conflicto = ocupados.some((o) => t < o.f && o.i < t + dur);
          if (!conflicto) slots.push(hhmm);
        }
      } else if (esp.tipo === "bloqueado") {
        for (let t = ei; t + dur <= ef; t += dur) {
          const idx = slots.indexOf(toHHMM(t));
          if (idx !== -1) slots.splice(idx, 1);
        }
      }
    }
    slots.sort();
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
  const lugar = document.getElementById("c-lugar").value || "Consultorio";

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
    if (!error) {
      queuePush(paciente, "Nueva cita asignada", `Cita: ${fecha} a las ${app.hhmm(hora)}`, "./calendario.html");
    }
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
  if (estado === "cancelada" && app.user && app.user.rol === "paciente") {
    abrirModalCancelar(id);
    return;
  }
  const c = listaCitas.find((x) => x.id === id);
  const { error } = await supabase.rpc("cambiar_estado_cita", { p_id: id, p_estado: estado });
  if (error) return toast(error.message, "error");
  toast(`Cita marcada como ${estado}`, "success");
  // Push: notificar al paciente cuando se aprueba
  if (estado === "confirmada" && c && c.pacientes && c.pacientes.id) {
    const fecha = c.fecha || "";
    const hora = app.hhmm(c.hora || "");
    queuePush(c.pacientes.id, "Cita aprobada", `Su cita del ${fecha} a las ${hora} fue aprobada.`, "./calendario.html");
  }
  aplicarFiltros();
}

function abrirModalCancelar(id) {
  const cita = listaCitas.find((c) => c.id === id);
  if (!cita) return;
  citaACancelar = cita;

  const fechaCita = cita.fecha || "";
  const horaCita = cita.hora || "";

  const now = new Date();
  const citaDate = new Date(fechaCita + "T" + horaCita);
  const horasAntes = (citaDate - now) / (1000 * 60 * 60);

  const aviso = document.getElementById("cancelar-aviso");
  const titulo = document.getElementById("cancelar-titulo");
  const btnConfirmar = document.getElementById("btn-confirmar-cancelar");

  document.getElementById("cancel-motivo").value = "";

  if (horasAntes < 24) {
    aviso.style.display = "block";
    aviso.textContent = "⚠️ La cancelación se realiza con menos de 24 horas de anticipación. Se aplicará cláusula administrativa (cargo del valor de la cita). Si es caso de fuerza mayor, indíquelo en el motivo.";
    titulo.textContent = "Cancelar cita — Cláusula administrativa";
    btnConfirmar.textContent = "Aceptar cláusula y cancelar";
  } else {
    aviso.style.display = "none";
    titulo.textContent = "Cancelar cita";
    btnConfirmar.textContent = "Confirmar cancelación";
  }

  document.getElementById("modal-cancelar").classList.add("open");
}

function cerrarModalCancelar() {
  document.getElementById("modal-cancelar").classList.remove("open");
  citaACancelar = null;
}

async function confirmarModalCancelar() {
  if (!citaACancelar) return;
  const motivo = document.getElementById("cancel-motivo").value.trim();
  const btn = document.getElementById("btn-confirmar-cancelar");

  const fechaCita = citaACancelar.fecha || "";
  const horaCita = citaACancelar.hora || "";
  const now = new Date();
  const citaDate = new Date(fechaCita + "T" + horaCita);
  const horasAntes = (citaDate - now) / (1000 * 60 * 60);

  if (horasAntes >= 24 && !motivo) {
    toast("Debe indicar el motivo de cancelación", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Cancelando...";

  try {
    const { error } = await supabase.rpc("cambiar_estado_cita", {
      p_id: citaACancelar.id,
      p_estado: "cancelada",
      p_motivo_cancelacion: motivo || null,
    });
    if (error) throw new Error(error.message);
    toast("Cita cancelada correctamente", "success");
    cerrarModalCancelar();
    aplicarFiltros();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar cancelación";
  }
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
  document.getElementById("modal-cancelar").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-cancelar")) cerrarModalCancelar();
  });

  // Auto-abrir modal de nueva cita si se llega con ?nueva=true
  if (new URLSearchParams(window.location.search).get("nueva") === "true") {
    setTimeout(() => abrirModalCita(), 300);
  }
});
