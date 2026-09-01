"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const alertEl = document.getElementById("alert");
  const okEl = document.getElementById("ok");
  const btn = document.getElementById("btn-registro");

  if (!window.supabaseLib) {
    alertEl.textContent = "Error al cargar la librería de Supabase. Recargue la página (Ctrl+F5).";
    alertEl.classList.add("show");
    return;
  }

  const supabase = window.supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) window.location.href = "dashboard.html";
    } catch (e) {}
  })();

  const tipoCuenta = document.getElementById("tipo_cuenta");
  const repField = document.getElementById("rep-field");
  const repNombre = document.getElementById("nombre_cuenta");

  function toggleRepresentante() {
    repField.classList.toggle("hidden", tipoCuenta.value !== "representante");
    repNombre.required = tipoCuenta.value === "representante";
  }
  tipoCuenta.addEventListener("change", toggleRepresentante);
  toggleRepresentante();

  document.getElementById("registro-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    alertEl.classList.remove("show");
    okEl.classList.remove("show");
    okEl.innerHTML = "";
    btn.disabled = true;
    btn.textContent = "Creando cuenta...";

    const esRepresentante = tipoCuenta.value === "representante";

    try {
      const { data, error } = await supabase.rpc("registrar_paciente", {
        p_nombre_paciente: document.getElementById("nombre").value,
        p_es_representante: esRepresentante,
        p_nombre_cuenta: esRepresentante ? repNombre.value : null,
        p_documento: null,
        p_email: null,
        p_telefono: document.getElementById("telefono").value || null,
        p_fecha_nacimiento: null,
        p_direccion: null,
        p_alergias: null,
        p_contrasena: document.getElementById("contrasena").value,
        p_username: document.getElementById("username").value,
      });
      if (error) throw new Error(error.message);

      okEl.innerHTML =
        "Cuenta creada correctamente. Ya puede iniciar sesión con su nombre de usuario. " +
        '<a href="index.html" class="small">Ir a iniciar sesión →</a>';
      okEl.classList.add("show");
      document.getElementById("registro-form").reset();
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.classList.add("show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Crear cuenta";
    }
  });
});
