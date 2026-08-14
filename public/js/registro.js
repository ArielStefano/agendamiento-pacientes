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

  document.getElementById("registro-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    alertEl.classList.remove("show");
    okEl.classList.remove("show");
    okEl.innerHTML = "";
    btn.disabled = true;
    btn.textContent = "Creando cuenta...";

    try {
      const { data, error } = await supabase.rpc("registrar_paciente", {
        p_nombre: document.getElementById("nombre").value,
        p_documento: document.getElementById("documento").value || null,
        p_email: document.getElementById("email").value,
        p_telefono: document.getElementById("telefono").value || null,
        p_fecha_nacimiento: document.getElementById("fecha_nacimiento").value || null,
        p_direccion: document.getElementById("direccion").value || null,
        p_alergias: document.getElementById("alergias").value || null,
        p_contrasena: document.getElementById("contrasena").value,
      });
      if (error) throw new Error(error.message);

      okEl.innerHTML =
        "Cuenta creada correctamente. Ya puede iniciar sesión con su correo y contraseña. " +
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
