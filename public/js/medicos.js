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
  return `${esc(dias.join(", "))}<br>${principal}${sabado} · ${m.duracion_cita_min} min${buffer}${descanso}`;
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
});
