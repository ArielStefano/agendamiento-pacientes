"use strict";

const CONFIG_MAP = {
  "cfg-anonimizar":      { clave: "anonimizar_pacientes",      type: "boolean" },
  "cfg-duracion":        { clave: "duracion_default_min",      type: "number" },
  "cfg-buffer":          { clave: "buffer_default_min",        type: "number" },
  "cfg-clinica-nombre":  { clave: "clinica_nombre",            type: "string" },
  "cfg-clinica-telefono":{ clave: "clinica_telefono",          type: "string" },
  "cfg-clinica-direccion":{ clave: "clinica_direccion",        type: "string" },
  "cfg-recordatorios-horas": { clave: "recordatorios_horas_antes", type: "number" },
};

let configData = {};

async function cargarConfig() {
  const { data, error } = await supabase.rpc("leer_configuracion");
  if (error) return toast(error.message, "error");

  configData = {};
  for (const row of data || []) {
    configData[row.clave] = row.valor;
  }

  document.getElementById("cfg-anonimizar").checked = !!configData["anonimizar_pacientes"];
  document.getElementById("cfg-duracion").value = configData["duracion_default_min"] ?? 30;
  document.getElementById("cfg-buffer").value = configData["buffer_default_min"] ?? 30;
  document.getElementById("cfg-clinica-nombre").value = configData["clinica_nombre"] ?? "";
  document.getElementById("cfg-clinica-telefono").value = configData["clinica_telefono"] ?? "";
  document.getElementById("cfg-clinica-direccion").value = configData["clinica_direccion"] ?? "";
  document.getElementById("cfg-recordatorios-horas").value = configData["recordatorios_horas_antes"] ?? 24;
}

async function guardarConfig() {
  const btn = document.getElementById("btn-guardar");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  const claves = [];
  const valores = [];

  for (const [elId, cfg] of Object.entries(CONFIG_MAP)) {
    const el = document.getElementById(elId);
    if (!el) continue;
    claves.push(cfg.clave);
    if (cfg.type === "boolean") {
      valores.push(el.checked);
    } else if (cfg.type === "number") {
      valores.push(Number(el.value));
    } else {
      valores.push(el.value);
    }
  }

  const { error } = await supabase.rpc("guardar_configuracion_batch_admin", {
    p_claves: claves,
    p_valores: valores,
  });

  if (error) {
    toast(error.message, "error");
  } else {
    toast("Configuración guardada correctamente", "success");
  }

  btn.disabled = false;
  btn.textContent = "Guardar configuración";
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.appReady;
  if (!app.user) return;
  if (app.user.rol !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }
  cargarConfig();
});
