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

function renderTabla() {
  const el = document.getElementById("tabla-medicos");
  if (!listaMedicos.length) {
    el.innerHTML = `<div class="card empty-state"><div class="icon">🩺</div>No se encontraron médicos</div>`;
    return;
  }

  const filas = listaMedicos
    .map((m) => {
      const totalCitas = (m.citas && m.citas.length && m.citas[0].count) || 0;
      const dias = (m.dias_atencion || []).join(", ");
      return `
      <tr>
        <td><strong>${esc(m.nombre)}</strong></td>
        <td>${esc(m.especialidad)}</td>
        <td>${esc(m.telefono || "-")}</td>
        <td>${esc(m.email || "-")}</td>
        <td class="small muted">${esc(dias || "-")}<br>${fmtHorario(m.hora_inicio, m.hora_fin)} · ${m.duracion_cita_min} min</td>
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
            <th>Nombre</th><th>Especialidad</th><th>Teléfono</th><th>Email</th>
            <th>Agenda</th><th>Citas</th><th>Acciones</th>
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
  document.getElementById("m-inicio").value = medico ? app.hhmm(medico.hora_inicio) : "08:00";
  document.getElementById("m-fin").value = medico ? app.hhmm(medico.hora_fin) : "17:00";
  document.getElementById("m-pass-label").textContent = medico
    ? "Nueva contraseña (dejar vacío para no cambiar)"
    : "Contraseña de acceso *";

  document.querySelectorAll(".dias-grid input[type=checkbox]").forEach((cb) => {
    cb.checked = medico ? (medico.dias_atencion || []).includes(cb.value) : false;
  });

  document.getElementById("modal").classList.add("open");
}

function cerrarModal() {
  document.getElementById("modal").classList.remove("open");
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
  const inicio = document.getElementById("m-inicio").value + ":00";
  const fin = document.getElementById("m-fin").value + ":00";
  const dias = diasSeleccionados();

  if (!nombre) return toast("El nombre es obligatorio", "error");
  if (!especialidad) return toast("La especialidad es obligatoria", "error");
  if (!email) return toast("El email es obligatorio", "error");
  if (!dias.length) return toast("Seleccione al menos un día de atención", "error");
  if (inicio >= fin) return toast("La hora de inicio debe ser anterior a la de fin", "error");

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
