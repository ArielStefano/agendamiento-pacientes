"use strict";

let listaMedicos = [];
let buscando = "";

const DIAS_SEMANA = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];

async function cargarMedicos() {
  let query = supabase
    .from("medicos")
    .select("*, citas(count)")
    .order("nombre");

  if (buscando) {
    query = query.or(`nombre.ilike.*${buscando}*,especialidad.ilike.*${buscando}*,email.ilike.*${buscando}*`);
  }

  const { data, error } = await query;
  if (error) return toast(error.message, "error");
  listaMedicos = data || [];
  renderTabla();
}

function fmtHorario(ini, fin) {
  return `${app.hhmm(ini)} — ${app.hhmm(fin)}`;
}

function fmtAgenda(m) {
  const dias = (m.dias_atencion || []);
  const principal = `${fmtHorario(m.hora_inicio, m.hora_fin)}`;
  const sabado = m.hora_inicio_sabado && m.hora_fin_sabado
    ? ` | Sáb: ${fmtHorario(m.hora_inicio_sabado, m.hora_fin_sabado)}`
    : "";
  const buffer = m.buffer_domicilio_min ? ` · Traslado: ${m.buffer_domicilio_min} min` : "";
  const descanso = m.hora_inicio_descanso && m.hora_fin_descanso
    ? ` · Descanso: ${fmtHorario(m.hora_inicio_descanso, m.hora_fin_descanso)}`
    : "";
  const descansoSab = m.hora_inicio_descanso_sabado && m.hora_fin_descanso_sabado
    ? ` · Desc. sáb: ${fmtHorario(m.hora_inicio_descanso_sabado, m.hora_fin_descanso_sabado)}`
    : "";
  const lugares = m.lugares_atencion && m.lugares_atencion.length
    ? ` · Lugares: ${esc(m.lugares_atencion.join(", "))}`
    : "";
  return `${esc(dias.join(", "))}<br>${principal}${sabado} · ${m.duracion_cita_min} min${buffer}${descanso}${descansoSab}${lugares}`;
}

function renderTabla() {
  const el = document.getElementById("tabla-medicos");
  if (!listaMedicos.length) {
    el.innerHTML = `<div class="card empty-state"><div class="icon">🩺</div>No se encontraron médicos</div>`;
    return;
  }

  const filas = listaMedicos
    .map((m) => {
      const totalCitas = (m.citas && m.citas.length && m.citas[0].count) || 0;
      return `
      <tr>
        <td><strong>${esc(m.nombre)}</strong></td>
        <td>${esc(m.especialidad)}</td>
        <td>${esc(m.telefono || "-")}</td>
        <td>${esc(m.email || "-")}</td>
        <td class="small muted">${fmtAgenda(m)}</td>
        <td><span class="pill">${totalCitas} citas</span></td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm btn-secondary" onclick="editarMedico('${m.id}')">Editar</button>
            <button class="btn btn-sm btn-secondary" onclick="abrirEspeciales('${m.id}','${esc(m.nombre)}')">Especiales</button>
            <button class="btn btn-sm btn-danger" onclick="eliminarMedico('${m.id}')">Eliminar</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Nombre</th><th scope="col">Especialidad</th><th scope="col">Teléfono</th><th scope="col">Email</th>
            <th scope="col">Agenda</th><th scope="col">Citas</th><th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function generarClave() {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let clave = "";
  for (let i = 0; i < 10; i++) clave += abc[Math.floor(Math.random() * abc.length)];
  document.getElementById("m-pass").value = clave;
}

function abrirModalMedico(medico = null) {
  document.getElementById("modal-titulo").textContent = medico ? "Editar médico" : "Nuevo médico";
  document.getElementById("m-id").value = medico ? medico.id : "";
  document.getElementById("m-nombre").value = medico ? medico.nombre : "";
  document.getElementById("m-especialidad").value = medico ? medico.especialidad : "";
  document.getElementById("m-telefono").value = medico ? medico.telefono || "" : "";
  document.getElementById("m-email").value = medico ? medico.email || "" : "";
  document.getElementById("m-pass").value = "";
  document.getElementById("m-duracion").value = medico ? medico.duracion_cita_min : 30;
  document.getElementById("m-buffer").value = medico ? (medico.buffer_domicilio_min || 30) : 30;
  document.getElementById("m-inicio").value = medico ? app.hhmm(medico.hora_inicio) : "08:00";
  document.getElementById("m-fin").value = medico ? app.hhmm(medico.hora_fin) : "17:00";
  document.getElementById("m-pass-label").textContent = medico
    ? "Nueva contraseña (dejar vacío para no cambiar)"
    : "Contraseña de acceso *";

  document.querySelectorAll(".dias-grid input[type=checkbox]").forEach((cb) => {
    cb.checked = medico ? (medico.dias_atencion || []).includes(cb.value) : ["Lunes","Martes","Miercoles","Jueves","Viernes"].includes(cb.value);
  });

  // Horario sábado
  const tieneSabado = medico && medico.hora_inicio_sabado && medico.hora_fin_sabado;
  const sabadoToggle = document.getElementById("m-sabado-toggle");
  const sabadoFields = document.getElementById("m-sabado-fields");
  const chkSabado = document.getElementById("m-chk-sabado");

  if (tieneSabado) {
    sabadoToggle.checked = true;
    sabadoFields.style.display = "";
    chkSabado.checked = true;
    document.getElementById("m-inicio-sabado").value = app.hhmm(medico.hora_inicio_sabado);
    document.getElementById("m-fin-sabado").value = app.hhmm(medico.hora_fin_sabado);
  } else {
    sabadoToggle.checked = false;
    sabadoFields.style.display = "none";
    chkSabado.checked = medico ? (medico.dias_atencion || []).includes("Sabado") : false;
    document.getElementById("m-inicio-sabado").value = "08:00";
    document.getElementById("m-fin-sabado").value = "12:00";
  }

  document.getElementById("m-descanso-inicio").value = medico && medico.hora_inicio_descanso ? app.hhmm(medico.hora_inicio_descanso) : "";
  document.getElementById("m-descanso-fin").value = medico && medico.hora_fin_descanso ? app.hhmm(medico.hora_fin_descanso) : "";

  document.getElementById("m-descanso-sabado-inicio").value = medico && medico.hora_inicio_descanso_sabado ? app.hhmm(medico.hora_inicio_descanso_sabado) : "";
  document.getElementById("m-descanso-sabado-fin").value = medico && medico.hora_fin_descanso_sabado ? app.hhmm(medico.hora_fin_descanso_sabado) : "";

  const lugares = medico && medico.lugares_atencion ? medico.lugares_atencion : ["Consultorio"];
  renderLugares(lugares);

  document.getElementById("modal").classList.add("open");
}

function cerrarModal() {
  document.getElementById("modal").classList.remove("open");
}

function toggleSabado() {
  const on = document.getElementById("m-sabado-toggle").checked;
  document.getElementById("m-sabado-fields").style.display = on ? "" : "none";
  const chk = document.getElementById("m-chk-sabado");
  if (on) {
    chk.checked = true;
    chk.disabled = true;
  } else {
    chk.disabled = false;
  }
}

function renderLugares(lugares) {
  const container = document.getElementById("m-lugares-list");
  container.innerHTML = "";
  (lugares && lugares.length ? lugares : ["Consultorio"]).forEach((l, i) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:4px;";
    row.innerHTML = `<input type="text" class="m-lugar-input" value="${esc(l)}" placeholder="Nombre del lugar" style="flex:1;" />` +
      `<button type="button" class="btn btn-sm btn-danger" onclick="quitarLugar(this)" title="Quitar"${lugares && lugares.length <= 1 ? " disabled" : ""}>✕</button>`;
    container.appendChild(row);
  });
  actualizarBtnAddLugar();
}

function agregarLugar() {
  const container = document.getElementById("m-lugares-list");
  if (container.children.length >= 5) return;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:4px;";
  row.innerHTML = `<input type="text" class="m-lugar-input" value="" placeholder="Nombre del lugar" style="flex:1;" />` +
    `<button type="button" class="btn btn-sm btn-danger" onclick="quitarLugar(this)" title="Quitar">✕</button>`;
  container.appendChild(row);
  row.querySelector("input").focus();
  actualizarBtnAddLugar();
}

function quitarLugar(btn) {
  const container = document.getElementById("m-lugares-list");
  if (container.children.length <= 1) return;
  btn.closest("div").remove();
  actualizarBtnAddLugar();
}

function actualizarBtnAddLugar() {
  const container = document.getElementById("m-lugares-list");
  const btn = document.getElementById("btn-add-lugar");
  btn.disabled = container.children.length >= 5;
  btn.style.display = container.children.length >= 5 ? "none" : "";
}

function leerLugares() {
  const inputs = document.querySelectorAll(".m-lugar-input");
  const lugares = [];
  inputs.forEach((inp) => {
    const v = inp.value.trim();
    if (v) lugares.push(v);
  });
  return lugares.length ? lugares : ["Consultorio"];
}

function editarMedico(id) {
  const m = listaMedicos.find((x) => x.id === id);
  if (m) abrirModalMedico(m);
}

function diasSeleccionados() {
  return Array.from(document.querySelectorAll(".dias-grid input[type=checkbox]:checked")).map((cb) => cb.value);
}

async function guardarMedico() {
  const id = document.getElementById("m-id").value;
  const nombre = document.getElementById("m-nombre").value.trim();
  const especialidad = document.getElementById("m-especialidad").value.trim();
  const telefono = document.getElementById("m-telefono").value.trim();
  const email = document.getElementById("m-email").value.trim();
  const pass = document.getElementById("m-pass").value;
  const duracion = Number(document.getElementById("m-duracion").value);
  const buffer = Number(document.getElementById("m-buffer").value) || 30;
  const inicio = document.getElementById("m-inicio").value + ":00";
  const fin = document.getElementById("m-fin").value + ":00";
  const dias = diasSeleccionados();

  // Horario sábado
  const sabadoOn = document.getElementById("m-sabado-toggle").checked;
  let hora_inicio_sabado = null;
  let hora_fin_sabado = null;
  if (sabadoOn) {
    hora_inicio_sabado = document.getElementById("m-inicio-sabado").value + ":00";
    hora_fin_sabado = document.getElementById("m-fin-sabado").value + ":00";
  }

  const descansoInicio = document.getElementById("m-descanso-inicio").value || null;
  const descansoFin = document.getElementById("m-descanso-fin").value || null;
  const descansoSabInicio = document.getElementById("m-descanso-sabado-inicio").value || null;
  const descansoSabFin = document.getElementById("m-descanso-sabado-fin").value || null;
  const lugares_atencion = leerLugares();

  if (!nombre) return toast("El nombre es obligatorio", "error");
  if (!especialidad) return toast("La especialidad es obligatoria", "error");
  if (!email) return toast("El email es obligatorio", "error");
  if (!dias.length) return toast("Seleccione al menos un día de atención", "error");
  if (inicio >= fin) return toast("La hora de inicio debe ser anterior a la de fin", "error");
  if (sabadoOn && hora_inicio_sabado >= hora_fin_sabado) return toast("Horario sábado: inicio debe ser anterior a fin", "error");

  let error = null;
  let datos = null;

  if (id) {
    const params = {
      p_id: id,
      p_nombre: nombre,
      p_especialidad: especialidad,
      p_telefono: telefono || null,
      p_email: email,
      p_dias: dias,
      p_hora_inicio: inicio,
      p_hora_fin: fin,
      p_duracion: duracion,
      p_hora_inicio_sabado: hora_inicio_sabado,
      p_hora_fin_sabado: hora_fin_sabado,
      p_buffer_domicilio_min: buffer,
      p_hora_inicio_descanso: descansoInicio ? descansoInicio + ":00" : null,
      p_hora_fin_descanso: descansoFin ? descansoFin + ":00" : null,
      p_hora_inicio_descanso_sabado: descansoSabInicio ? descansoSabInicio + ":00" : null,
      p_hora_fin_descanso_sabado: descansoSabFin ? descansoSabFin + ":00" : null,
      p_lugares_atencion: lugares_atencion,
    };
    if (pass) params.p_contrasena = pass;
    ({ data: datos, error } = await supabase.rpc("actualizar_medico_admin", params));
    if (!error) toast("Médico actualizado", "success");
  } else {
    if (pass.length < 6) return toast("La contraseña debe tener al menos 6 caracteres", "error");
    ({ data: datos, error } = await supabase.rpc("crear_medico_admin", {
      p_nombre: nombre,
      p_especialidad: especialidad,
      p_telefono: telefono || null,
      p_email: email,
      p_dias: dias,
      p_hora_inicio: inicio,
      p_hora_fin: fin,
      p_duracion: duracion,
      p_contrasena: pass,
      p_hora_inicio_sabado: hora_inicio_sabado,
      p_hora_fin_sabado: hora_fin_sabado,
      p_buffer_domicilio_min: buffer,
      p_hora_inicio_descanso: descansoInicio ? descansoInicio + ":00" : null,
      p_hora_fin_descanso: descansoFin ? descansoFin + ":00" : null,
      p_hora_inicio_descanso_sabado: descansoSabInicio ? descansoSabInicio + ":00" : null,
      p_hora_fin_descanso_sabado: descansoSabFin ? descansoSabFin + ":00" : null,
      p_lugares_atencion: lugares_atencion,
    }));
    if (!error) {
      toast("Médico creado correctamente", "success");
      mostrarCredenciales(email, pass);
    }
  }

  if (error) return toast(error.message, "error");
  cerrarModal();
  cargarMedicos();
}

function mostrarCredenciales(email, password) {
  document.getElementById("cred-body").innerHTML = `
    <div class="card">
      <div class="small"><strong>Usuario:</strong> <code>${esc(email)}</code></div>
      <div class="small"><strong>Contraseña:</strong> <code>${esc(password)}</code></div>
    </div>`;
  document.getElementById("modal-cred").classList.add("open");
}

function cerrarCred() {
  document.getElementById("modal-cred").classList.remove("open");
}

async function eliminarMedico(id) {
  const m = listaMedicos.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`¿Eliminar a ${m.nombre}? Se eliminará también su usuario de acceso.`)) return;
  const { data, error } = await supabase.rpc("eliminar_medico_admin", { p_id: id });
  if (error) return toast(error.message, "error");
  toast("Médico eliminado", "success");
  cargarMedicos();
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

// ── Horarios Especiales ──────────────────────────────────────
let listaEspeciales = [];
let espMedicoId = "";

function toggleEspFrecuencia() {
  const val = document.getElementById("esp-frecuencia").value;
  document.getElementById("esp-dia-field").style.display = val === "dia_semana" ? "" : "none";
  document.getElementById("esp-fecha-field").style.display = val === "fecha" ? "" : "none";
}

async function abrirEspeciales(medicoId, nombre) {
  espMedicoId = medicoId;
  document.getElementById("esp-medico-id").value = medicoId;
  document.getElementById("esp-medico-nombre").textContent = `Médico: ${nombre}`;
  document.getElementById("modal-especiales").classList.add("open");
  await cargarEspeciales();
}

function cerrarEspeciales() {
  document.getElementById("modal-especiales").classList.remove("open");
}

async function cargarEspeciales() {
  const { data, error } = await supabase
    .from("disponibilidad_especial")
    .select("*")
    .eq("medico_id", espMedicoId)
    .order("created_at", { ascending: false });
  if (error) return toast(error.message, "error");
  listaEspeciales = data || [];
  renderTablaEspeciales();
}

function renderTablaEspeciales() {
  const el = document.getElementById("tabla-especiales");
  if (!listaEspeciales.length) {
    el.innerHTML = `<div class="card empty-state" style="padding:16px"><div class="icon">📅</div>No hay horarios especiales</div>`;
    return;
  }
  const filas = listaEspeciales.map((e) => {
    const cuando = e.fecha
      ? `${e.fecha.slice(8, 10)}/${e.fecha.slice(5, 7)}/${e.fecha.slice(0, 4)}`
      : e.dia_semana;
    const tipo = e.tipo === "extra"
      ? '<span class="badge" style="background:#16a34a;color:#fff">Extra</span>'
      : '<span class="badge" style="background:#dc2626;color:#fff">Bloqueado</span>';
    return `
      <tr>
        <td>${tipo}</td>
        <td>${esc(cuando)}</td>
        <td><strong>${app.hhmm(e.hora_inicio)} — ${app.hhmm(e.hora_fin)}</strong></td>
        <td class="small muted">${esc(e.notas || "-")}</td>
        <td><button class="btn btn-sm btn-danger" onclick="eliminarEspecial('${e.id}')">Eliminar</button></td>
      </tr>`;
  }).join("");
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Tipo</th><th>Cuándo</th><th>Horario</th><th>Notas</th><th>Acciones</th></tr></thead>
    <tbody>${filas}</tbody>
  </table></div>`;
}

async function agregarEspecial() {
  const tipo = document.getElementById("esp-tipo").value;
  const frecuencia = document.getElementById("esp-frecuencia").value;
  const dia = document.getElementById("esp-dia").value;
  const fecha = document.getElementById("esp-fecha").value;
  const inicio = document.getElementById("esp-inicio").value;
  const fin = document.getElementById("esp-fin").value;
  const notas = document.getElementById("esp-notas").value.trim();

  if (!inicio || !fin) return toast("Complete las horas", "error");
  if (inicio >= fin) return toast("Inicio debe ser anterior a fin", "error");
  if (frecuencia === "fecha" && !fecha) return toast("Seleccione una fecha", "error");

  const row = {
    medico_id: espMedicoId,
    tipo,
    hora_inicio: inicio + ":00",
    hora_fin: fin + ":00",
    notas: notas || null,
    fecha: frecuencia === "fecha" ? fecha : null,
    dia_semana: frecuencia === "dia_semana" ? dia : null,
  };

  const { error } = await supabase.from("disponibilidad_especial").insert(row);
  if (error) return toast(error.message, "error");
  toast("Horario especial agregado", "success");
  document.getElementById("esp-notas").value = "";
  cargarEspeciales();
}

async function eliminarEspecial(id) {
  if (!confirm("¿Eliminar este horario especial?")) return;
  const { error } = await supabase.from("disponibilidad_especial").delete().eq("id", id);
  if (error) return toast(error.message, "error");
  toast("Eliminado", "success");
  cargarEspeciales();
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.appReady;
  if (!app.user) return;
  if (app.user.rol !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }
  cargarMedicos();
  const input = document.getElementById("buscar");
  input.addEventListener("input", () => {
    buscando = input.value.trim().toLowerCase();
    cargarMedicos();
  });
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal")) cerrarModal();
  });
  document.getElementById("modal-cred").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-cred")) cerrarCred();
  });
  document.getElementById("modal-especiales").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-especiales")) cerrarEspeciales();
  });
});
