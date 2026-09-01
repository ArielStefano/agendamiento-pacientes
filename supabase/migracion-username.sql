-- Migración: Login por nombre de usuario
-- Agrega columna username a perfiles, función resolver_login y modifica RPCs de creación.

-- 1) Columna username en perfiles
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS perfiles_username_unique
  ON public.perfiles (lower(username)) WHERE username IS NOT NULL;

-- 2) Función: resolver nombre de usuario → email interno (para login)
CREATE OR REPLACE FUNCTION public.resolver_email_por_usuario(p_input text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_input text;
  v_email text;
BEGIN
  v_input := trim(coalesce(p_input, ''));
  IF v_input = '' THEN RETURN NULL; END IF;

  -- Si contiene @, tratar como email directamente
  IF v_input LIKE '%@%' THEN
    RETURN lower(v_input);
  END IF;

  -- Buscar por username en perfiles → auth.users
  SELECT au.email INTO v_email
    FROM public.perfiles pf
    JOIN auth.users au ON au.id = pf.user_id
   WHERE lower(pf.username) = lower(v_input)
   LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolver_email_por_usuario(text) TO anon, authenticated;

-- 3) Redefinir registrar_paciente (la versión de registro.js con representante)
--    - Agrega p_username text (opcional)
--    - Si se provee username sin email, genera email interno <username>@clinica.local
--    - Guarda username en perfiles

DROP FUNCTION IF EXISTS public.registrar_paciente(text, text, text, text, text, text, date, text, text, text, text);

CREATE OR REPLACE FUNCTION public.registrar_paciente(
  p_nombre_paciente text,
  p_es_representante boolean,
  p_nombre_cuenta text,
  p_documento text,
  p_email text,
  p_telefono text,
  p_fecha_nacimiento date,
  p_direccion text,
  p_alergias text,
  p_contrasena text,
  p_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_email text;
  v_user_id uuid;
  v_paciente_id uuid;
  v_nombre_cuenta text;
BEGIN
  v_username := trim(lower(coalesce(p_username, '')));
  v_email := trim(lower(coalesce(p_email, '')));

  IF p_nombre_paciente IS NULL OR trim(p_nombre_paciente) = '' THEN
    RAISE EXCEPTION 'El nombre del paciente es obligatorio';
  END IF;

  IF coalesce(p_es_representante, false) THEN
    IF p_nombre_cuenta IS NULL OR trim(p_nombre_cuenta) = '' THEN
      RAISE EXCEPTION 'El nombre del representante es obligatorio';
    END IF;
    v_nombre_cuenta := trim(p_nombre_cuenta);
  ELSE
    v_nombre_cuenta := trim(p_nombre_paciente);
  END IF;

  -- Resolver email: preferir username si se da, si no, email directo
  IF v_username <> '' THEN
    IF v_username !~ '^[a-z0-9._-]{3,30}$' THEN
      RAISE EXCEPTION 'El nombre de usuario debe tener entre 3 y 30 caracteres (letras, números, puntos, guiones o guion bajo)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfiles WHERE lower(username) = v_username AND username IS NOT NULL) THEN
      RAISE EXCEPTION 'Ese nombre de usuario ya está en uso';
    END IF;
    IF v_email = '' THEN
      v_email := v_username || '@clinica.local';
    END IF;
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Debe ingresar un nombre de usuario o un correo electrónico';
  END IF;

  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El email no es válido';
  END IF;

  IF p_contrasena IS NULL OR length(p_contrasena) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe una cuenta con ese email';
  END IF;

  IF p_documento IS NOT NULL AND trim(p_documento) <> ''
     AND EXISTS (SELECT 1 FROM public.pacientes pa WHERE lower(pa.documento) = lower(trim(p_documento))) THEN
    RAISE EXCEPTION 'Ya existe un paciente registrado con ese documento';
  END IF;

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
    email_change, is_sso_user, is_anonymous, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, now(), now())
  RETURNING id INTO v_user_id;

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (v_user_id, v_user_id, v_user_id,
          jsonb_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now(), now());

  INSERT INTO public.pacientes (documento, nombre, email, telefono, fecha_nacimiento, direccion, alergias)
  VALUES (nullif(trim(p_documento), ''), trim(p_nombre_paciente), v_email, p_telefono, p_fecha_nacimiento, p_direccion, p_alergias)
  RETURNING id INTO v_paciente_id;

  INSERT INTO public.perfiles (user_id, nombre, rol, paciente_id, representante, username)
  VALUES (v_user_id, v_nombre_cuenta, 'paciente', v_paciente_id, coalesce(p_es_representante, false), nullif(v_username, ''));

  RETURN jsonb_build_object('ok', true, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_paciente(text, boolean, text, text, text, text, date, text, text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_paciente(text, boolean, text, text, text, text, date, text, text, text, text) FROM public;

-- 4) Redefinir crear_medico_admin
--    - Agrega p_username text (opcional)
--    - Si se provee username sin email, genera email interno <username>@clinica.local
--    - Guarda username en perfiles

DROP FUNCTION IF EXISTS public.crear_medico_admin(text, text, text, text, jsonb, time without time zone, time without time zone, integer, text, time without time zone, time without time zone, integer, time without time zone, time without time zone, time without time zone, time without time zone, jsonb);

CREATE OR REPLACE FUNCTION public.crear_medico_admin(
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time without time zone,
  p_hora_fin time without time zone,
  p_duracion integer,
  p_contrasena text,
  p_username text DEFAULT NULL,
  p_hora_inicio_sabado time without time zone DEFAULT NULL,
  p_hora_fin_sabado time without time zone DEFAULT NULL,
  p_buffer_domicilio_min integer DEFAULT 30,
  p_hora_inicio_descanso time without time zone DEFAULT NULL,
  p_hora_fin_descanso time without time zone DEFAULT NULL,
  p_hora_inicio_descanso_sabado time without time zone DEFAULT NULL,
  p_hora_fin_descanso_sabado time without time zone DEFAULT NULL,
  p_lugares_atencion jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_email text;
  v_dias text[];
  v_user_id uuid;
  v_medico_id uuid;
BEGIN
  IF public.rol_usuario() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear médicos';
  END IF;

  v_username := trim(lower(coalesce(p_username, '')));
  v_email := trim(lower(coalesce(p_email, '')));

  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_especialidad IS NULL OR trim(p_especialidad) = '' THEN RAISE EXCEPTION 'La especialidad es obligatoria'; END IF;

  -- Resolver email
  IF v_username <> '' THEN
    IF v_username !~ '^[a-z0-9._-]{3,30}$' THEN
      RAISE EXCEPTION 'El nombre de usuario debe tener entre 3 y 30 caracteres (letras, números, puntos, guiones o guion bajo)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfiles WHERE lower(username) = v_username AND username IS NOT NULL) THEN
      RAISE EXCEPTION 'Ese nombre de usuario ya está en uso';
    END IF;
    IF v_email = '' THEN
      v_email := v_username || '@clinica.local';
    END IF;
  END IF;

  IF v_email = '' THEN RAISE EXCEPTION 'El email es obligatorio'; END IF;
  IF p_contrasena IS NULL OR length(p_contrasena) < 6 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres'; END IF;
  IF p_duracion IS NULL OR p_duracion <= 0 THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  IF p_hora_inicio >= p_hora_fin THEN RAISE EXCEPTION 'El horario de inicio debe ser anterior al de fin'; END IF;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN RAISE EXCEPTION 'Seleccione al menos un día de atención'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_dias) d WHERE d NOT IN ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) THEN
    RAISE EXCEPTION 'Día de atención inválido (Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo)';
  END IF;

  IF p_hora_inicio_sabado IS NOT NULL AND p_hora_fin_sabado IS NOT NULL THEN
    IF p_hora_inicio_sabado >= p_hora_fin_sabado THEN
      RAISE EXCEPTION 'El horario de sábado: inicio debe ser anterior a fin';
    END IF;
    IF NOT ('Sabado'::text = any(v_dias)) THEN
      RAISE EXCEPTION 'Si configura horario de sábado, debe incluir el sábado en los días de atención';
    END IF;
  END IF;

  IF (p_hora_inicio_descanso IS NULL) <> (p_hora_fin_descanso IS NULL) THEN
    RAISE EXCEPTION 'Si configura descanso, debe indicar inicio y fin';
  END IF;
  IF p_hora_inicio_descanso IS NOT NULL AND p_hora_fin_descanso IS NOT NULL THEN
    IF p_hora_inicio_descanso >= p_hora_fin_descanso THEN
      RAISE EXCEPTION 'El descanso: inicio debe ser anterior a fin';
    END IF;
  END IF;

  IF (p_hora_inicio_descanso_sabado IS NULL) <> (p_hora_fin_descanso_sabado IS NULL) THEN
    RAISE EXCEPTION 'Si configura descanso sábado, debe indicar inicio y fin';
  END IF;
  IF p_hora_inicio_descanso_sabado IS NOT NULL AND p_hora_fin_descanso_sabado IS NOT NULL THEN
    IF p_hora_inicio_descanso_sabado >= p_hora_fin_descanso_sabado THEN
      RAISE EXCEPTION 'El descanso sábado: inicio debe ser anterior a fin';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese email';
  END IF;
  IF EXISTS (SELECT 1 FROM public.medicos m WHERE lower(m.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un médico con ese email';
  END IF;

  IF p_lugares_atencion IS NULL OR jsonb_array_length(p_lugares_atencion) = 0 THEN
    p_lugares_atencion := '["Consultorio"]'::jsonb;
  END IF;

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
    email_change, is_sso_user, is_anonymous, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, now(), now())
  RETURNING id INTO v_user_id;

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (v_user_id, v_user_id, v_user_id,
          jsonb_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now(), now());

  INSERT INTO public.medicos (nombre, especialidad, telefono, email, dias_atencion,
    hora_inicio, hora_fin, duracion_cita_min, hora_inicio_sabado, hora_fin_sabado,
    buffer_domicilio_min, hora_inicio_descanso, hora_fin_descanso,
    hora_inicio_descanso_sabado, hora_fin_descanso_sabado, lugares_atencion)
  VALUES (trim(p_nombre), trim(p_especialidad), p_telefono, v_email, p_dias,
    p_hora_inicio, p_hora_fin, p_duracion, p_hora_inicio_sabado, p_hora_fin_sabado,
    coalesce(p_buffer_domicilio_min, 30), p_hora_inicio_descanso, p_hora_fin_descanso,
    p_hora_inicio_descanso_sabado, p_hora_fin_descanso_sabado, p_lugares_atencion)
  RETURNING id INTO v_medico_id;

  INSERT INTO public.perfiles (user_id, nombre, rol, medico_id, username)
  VALUES (v_user_id, trim(p_nombre), 'medico', v_medico_id, nullif(v_username, ''));

  RETURN jsonb_build_object('medico_id', v_medico_id, 'user_id', v_user_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time without time zone, time without time zone, integer, text, text, time without time zone, time without time zone, integer, time without time zone, time without time zone, time without time zone, time without time zone, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time without time zone, time without time zone, integer, text, text, time without time zone, time without time zone, integer, time without time zone, time without time zone, time without time zone, time without time zone, jsonb) FROM public;

-- 5) Redefinir actualizar_medico_admin
--    - Agrega p_username text (opcional). Si viene, actualiza username en perfiles
--    - Mantiene p_email por compatibilidad

DROP FUNCTION IF EXISTS public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time without time zone, time without time zone, integer, text, time without time zone, time without time zone, integer, time without time zone, time without time zone, time without time zone, time without time zone, jsonb);

CREATE OR REPLACE FUNCTION public.actualizar_medico_admin(
  p_id uuid,
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time without time zone,
  p_hora_fin time without time zone,
  p_duracion integer,
  p_contrasena text DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_hora_inicio_sabado time without time zone DEFAULT NULL,
  p_hora_fin_sabado time without time zone DEFAULT NULL,
  p_buffer_domicilio_min integer DEFAULT 30,
  p_hora_inicio_descanso time without time zone DEFAULT NULL,
  p_hora_fin_descanso time without time zone DEFAULT NULL,
  p_hora_inicio_descanso_sabado time without time zone DEFAULT NULL,
  p_hora_fin_descanso_sabado time without time zone DEFAULT NULL,
  p_lugares_atencion jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_email text;
  v_actual_username text;
  v_antiguo text;
  v_user_id uuid;
  v_dias text[];
BEGIN
  IF public.rol_usuario() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede editar médicos';
  END IF;

  v_username := trim(lower(coalesce(p_username, '')));
  v_email := trim(lower(coalesce(p_email, '')));

  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_especialidad IS NULL OR trim(p_especialidad) = '' THEN RAISE EXCEPTION 'La especialidad es obligatoria'; END IF;
  IF p_duracion IS NULL OR p_duracion <= 0 THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  IF p_hora_inicio >= p_hora_fin THEN RAISE EXCEPTION 'El horario de inicio debe ser anterior al de fin'; END IF;

  SELECT m.email, p.user_id INTO v_antiguo, v_user_id
  FROM public.medicos m LEFT JOIN public.perfiles p ON p.medico_id = m.id
  WHERE m.id = p_id;
  IF v_antiguo IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  SELECT pf.username INTO v_actual_username
    FROM public.perfiles pf WHERE pf.medico_id = p_id LIMIT 1;

  -- Username nuevo o cambiado: validar
  IF v_username <> '' THEN
    IF v_username !~ '^[a-z0-9._-]{3,30}$' THEN
      RAISE EXCEPTION 'El nombre de usuario debe tener entre 3 y 30 caracteres (letras, números, puntos, guiones o guion bajo)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfiles WHERE lower(username) = v_username AND username IS NOT NULL AND medico_id <> p_id) THEN
      RAISE EXCEPTION 'Ese nombre de usuario ya está en uso';
    END IF;
  END IF;

  -- Derivar email solo si cambió el username y el email actual era interno (@clinica.local)
  IF v_email = '' THEN
    IF v_username <> '' AND v_username <> lower(v_actual_username)
       AND (lower(v_antiguo) LIKE '%@clinica.local' OR lower(v_antiguo) LIKE '%@localhost') THEN
      v_email := v_username || '@clinica.local';
    ELSE
      v_email := v_antiguo;
    END IF;
  END IF;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN RAISE EXCEPTION 'Seleccione al menos un día de atención'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_dias) d WHERE d NOT IN ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) THEN
    RAISE EXCEPTION 'Día de atención inválido';
  END IF;

  IF p_hora_inicio_sabado IS NOT NULL AND p_hora_fin_sabado IS NOT NULL THEN
    IF p_hora_inicio_sabado >= p_hora_fin_sabado THEN
      RAISE EXCEPTION 'El horario de sábado: inicio debe ser anterior a fin';
    END IF;
    IF NOT ('Sabado'::text = any(v_dias)) THEN
      RAISE EXCEPTION 'Si configura horario de sábado, debe incluir el sábado en los días de atención';
    END IF;
  END IF;

  IF (p_hora_inicio_descanso IS NULL) <> (p_hora_fin_descanso IS NULL) THEN
    RAISE EXCEPTION 'Si configura descanso, debe indicar inicio y fin';
  END IF;
  IF p_hora_inicio_descanso IS NOT NULL AND p_hora_fin_descanso IS NOT NULL THEN
    IF p_hora_inicio_descanso >= p_hora_fin_descanso THEN
      RAISE EXCEPTION 'El descanso: inicio debe ser anterior a fin';
    END IF;
  END IF;

  IF (p_hora_inicio_descanso_sabado IS NULL) <> (p_hora_fin_descanso_sabado IS NULL) THEN
    RAISE EXCEPTION 'Si configura descanso sábado, debe indicar inicio y fin';
  END IF;
  IF p_hora_inicio_descanso_sabado IS NOT NULL AND p_hora_fin_descanso_sabado IS NOT NULL THEN
    IF p_hora_inicio_descanso_sabado >= p_hora_fin_descanso_sabado THEN
      RAISE EXCEPTION 'El descanso sábado: inicio debe ser anterior a fin';
    END IF;
  END IF;

  IF v_email <> lower(v_antiguo) THEN
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email AND u.id <> coalesce(v_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
      RAISE EXCEPTION 'Ya existe un usuario con ese email';
    END IF;
    IF EXISTS (SELECT 1 FROM public.medicos m WHERE lower(m.email) = v_email AND m.id <> p_id) THEN
      RAISE EXCEPTION 'Ya existe un médico con ese email';
    END IF;
    UPDATE auth.users SET email = v_email, updated_at = now() WHERE id = v_user_id;
    UPDATE auth.identities
      SET identity_data = jsonb_build_object('sub', v_user_id, 'email', v_email),
          provider_id = v_user_id,
          updated_at = now()
      WHERE user_id = v_user_id;
  END IF;

  IF p_contrasena IS NOT NULL AND p_contrasena <> '' THEN
    IF length(p_contrasena) < 6 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres'; END IF;
    UPDATE auth.users SET encrypted_password = extensions.crypt(p_contrasena, extensions.gen_salt('bf')), updated_at = now()
    WHERE id = v_user_id;
  END IF;

  IF p_lugares_atencion IS NULL OR jsonb_array_length(p_lugares_atencion) = 0 THEN
    p_lugares_atencion := '["Consultorio"]'::jsonb;
  END IF;

  UPDATE public.medicos
  SET nombre = trim(p_nombre), especialidad = trim(p_especialidad), telefono = p_telefono,
      email = v_email, dias_atencion = p_dias, hora_inicio = p_hora_inicio, hora_fin = p_hora_fin,
      duracion_cita_min = p_duracion,
      hora_inicio_sabado = p_hora_inicio_sabado, hora_fin_sabado = p_hora_fin_sabado,
      buffer_domicilio_min = coalesce(p_buffer_domicilio_min, 30),
      hora_inicio_descanso = p_hora_inicio_descanso, hora_fin_descanso = p_hora_fin_descanso,
      hora_inicio_descanso_sabado = p_hora_inicio_descanso_sabado, hora_fin_descanso_sabado = p_hora_fin_descanso_sabado,
      lugares_atencion = p_lugares_atencion
  WHERE id = p_id;

  UPDATE public.perfiles SET nombre = trim(p_nombre)
    WHERE medico_id = p_id;

  IF v_username <> '' THEN
    UPDATE public.perfiles SET username = nullif(v_username, '') WHERE medico_id = p_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'medico_id', p_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time without time zone, time without time zone, integer, text, text, time without time zone, time without time zone, integer, time without time zone, time without time zone, time without time zone, time without time zone, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time without time zone, time without time zone, integer, text, text, time without time zone, time without time zone, integer, time without time zone, time without time zone, time without time zone, time without time zone, jsonb) FROM public;
