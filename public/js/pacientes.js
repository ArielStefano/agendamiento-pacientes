"use strict";

let listaPacientes = [];
let buscando = false;

async function cargarPacientes() {
  let query = supabase.from("pacientes").select("*, citas(count)");
  if (buscando) {
    query = query.or(
      `nombre.ilike.*${buscando}*,documento.ilike.*${buscando}*,email.ilike.*${buscando}*,telefono.ilike.*${buscando}*`
    );
  }

  const { data, error } = await query.order("nombre");
  if (error) {
    toast(error.message, "error");
    return;
  }
  listaPacientes = data || [];
  renderTabla();
}

function renderTabla() {
  const el = document.getElementById("tabla-pacientes");
  if (!listaPacientes.length) {
    el.innerHTML = `<div class="card empty-state"><div class="icon">🧑‍🤝‍🧑</div>No se encontraron pacientes</div>`;
    return;
  }

  const filas = listaPacientes
    .map((p) => {
      const totalCitas = (p.citas && p.citas.length && p.citas[0].count) || 0;
      return `
      <tr>
        <td><strong>${esc(p.nombre)}</strong></td>
        <td class="muted">${esc(p.documento || "-")}</td>
        <td>${esc(p.telefono || "-")}</td>
        <td>${esc(p.email || "-")}</td>
        <td><span class="pill">${totalCitas} citas</span></td>
        <td>${p.alergias ? `<span class="badge cancelada" title="${esc(p.alergias)}">Alergias</span>` : `<span class="muted">Sin alergias</span>`}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm btn-secondary" onclick="verDetalle('${p.id}')">Ver</button>
            <button class="btn btn-sm btn-secondary" onclick="editarPaciente('${p.id}')">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="eliminarPaciente('${p.id}')">Eliminar</button>
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
            <th scope="col">Nombre</th>
            <th scope="col">Documento</th>
            <th scope="col">Teléfono</th>
            <th scope="col">Email</th>
            <th scope="col">Citas</th>
            <th scope="col">Alergias</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function abrirModalPaciente(paciente = null) {
  document.getElementById("modal-titulo").textContent = paciente ? "Editar paciente" : "Nuevo paciente";
  document.getElementById("p-id").value = paciente ? paciente.id : "";
  document.getElementById("p-nombre").value = paciente ? paciente.nombre : "";
  document.getElementById("p-documento").value = paciente ? paciente.documento || "" : "";
  document.getElementById("p-email").value = paciente ? paciente.email || "" : "";
  document.getElementById("p-telefono").value = paciente ? paciente.telefono || "" : "";
  document.getElementById("p-nacimiento").value = paciente ? (paciente.fecha_nacimiento || "").slice(0, 10) : "";
  document.getElementById("p-direccion").value = paciente ? paciente.direccion || "" : "";
  document.getElementById("p-alergias").value = paciente ? paciente.alergias || "" : "";
  document.getElementById("p-notas").value = paciente ? paciente.notas || "" : "";
  document.getElementById("modal").classList.add("open");
}

function cerrarModal() {
  document.getElementById("modal").classList.remove("open");
}

function editarPaciente(id) {
  const p = listaPacientes.find((x) => x.id === id);
  if (p) abrirModalPaciente(p);
}

async function guardarPaciente() {
  const id = document.getElementById("p-id").value;
  const nombre = document.getElementById("p-nombre").value.trim();
  const documento = document.getElementById("p-documento").value.trim() || null;
  const email = document.getElementById("p-email").value.trim() || null;
  const telefono = document.getElementById("p-telefono").value.trim() || null;
  const fecha_nacimiento = document.getElementById("p-nacimiento").value || null;
  const direccion = document.getElementById("p-direccion").value.trim() || null;
  const alergias = document.getElementById("p-alergias").value.trim() || null;
  const notas = document.getElementById("p-notas").value.trim() || null;

  if (!nombre) return toast("El nombre es obligatorio", "error");

  let error = null;
  if (id) {
    ({ error } = await supabase.rpc("actualizar_paciente_admin", {
      p_id: id, p_nombre: nombre, p_documento: documento, p_email: email,
      p_telefono: telefono, p_fecha_nacimiento: fecha_nacimiento,
      p_direccion: direccion, p_alergias: alergias, p_notas: notas,
    }));
    if (!error) toast("Paciente actualizado", "success");
  } else {
    ({ error } = await supabase.rpc("crear_paciente_admin", {
      p_nombre: nombre, p_documento: documento, p_email: email,
      p_telefono: telefono, p_fecha_nacimiento: fecha_nacimiento,
      p_direccion: direccion, p_alergias: alergias, p_notas: notas,
    }));
    if (!error) toast("Paciente creado", "success");
  }

  if (error) return toast(error.message, "error");
  cerrarModal();
  cargarPacientes();
}

async function eliminarPaciente(id) {
  if (!confirm("¿Eliminar este paciente? Sus citas asociadas también se eliminarán.")) return;
  const { error } = await supabase.from("pacientes").delete().eq("id", id);
  if (error) return toast(error.message, "error");
  toast("Paciente eliminado", "success");
  cargarPacientes();
}

async function verDetalle(id) {
  const { data: p, error } = await supabase
    .from("pacientes")
    .select("*, citas(id, fecha, hora, motivo, estado, medicos(nombre, especialidad))")
    .eq("id", id)
    .single();

  if (error) return toast(error.message, "error");

  const citas = (p.citas || [])
    .map(
      (c) => `
      <tr>
        <td>${app.formatFechaLarga(c.fecha)}</td>
        <td>${app.hhmm(c.hora)}</td>
        <td>${esc((c.medicos && c.medicos.nombre) || "")} <span class="muted small">(${esc((c.medicos && c.medicos.especialidad) || "")})</span></td>
        <td>${esc(c.motivo || "-")}</td>
        <td><span class="badge ${c.estado}">${c.estado}</span></td>
      </tr>`
    )
    .join("");

  document.getElementById("detalle-body").innerHTML = `
    <div class="card mb-16">
      <div class="flex-between">
        <div>
          <h4>${esc(p.nombre)}</h4>
          <div class="muted small">
            ${esc(p.documento || "")} · ${esc(p.telefono || "")} · ${esc(p.email || "")}
          </div>
        </div>
        <button class="btn btn-sm" onclick="cerrarDetalle()">✕</button>
      </div>
      <div class="mt-8 grid grid-2">
        <div class="small"><strong>Nacimiento:</strong> ${app.formatFechaLarga(p.fecha_nacimiento)}</div>
        <div class="small"><strong>Dirección:</strong> ${esc(p.direccion || "-")}</div>
        <div class="small"><strong>Alergias:</strong> ${esc(p.alergias || "Ninguna")}</div>
        <div class="small"><strong>Notas:</strong> ${esc(p.notas || "-")}</div>
      </div>
    </div>
    <h4 class="mb-16">Historial de citas</h4>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th scope="col">Fecha</th><th scope="col">Hora</th><th scope="col">Médico</th><th scope="col">Motivo</th><th scope="col">Estado</th></tr>
        </thead>
        <tbody>${citas || `<tr><td colspan="5" class="muted">Sin citas registradas</td></tr>`}</tbody>
      </table>
    </div>
  `;
  document.getElementById("modal-detalle").classList.add("open");
}

function cerrarDetalle() {
  document.getElementById("modal-detalle").classList.remove("open");
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.appReady;
  if (!app.user) return;
  cargarPacientes();
  const input = document.getElementById("buscar");
  input.addEventListener("input", () => {
    buscando = input.value.trim().toLowerCase();
    cargarPacientes();
  });
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal")) cerrarModal();
  });
  document.getElementById("modal-detalle").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-detalle")) cerrarDetalle();
  });
});
