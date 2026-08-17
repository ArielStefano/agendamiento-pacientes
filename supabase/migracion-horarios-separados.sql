-- ============================================================
--  Migración: Horarios separados (Lun-Vie / Sábado) + RPCs pacientes admin
--  Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1) Columnas de horario sábado en médicos
ALTER TABLE public.medicos
  ADD COLUMN IF NOT EXISTS hora_inicio_sabado time,
  ADD COLUMN IF NOT EXISTS hora_fin_sabado time;

-- Migrar datos existentes: si Josselyn atiende sábado, copiar horas principales
UPDATE public.medicos
SET hora_inicio_sabado = hora_inicio,
    hora_fin_sabado    = hora_fin
WHERE dias_atencion ? 'Sabado'
  AND hora_inicio_sabado IS NULL;

-- 2) RPC: crear paciente (solo admin)
CREATE OR REPLACE FUNCTION public.crear_paciente_admin(
  p_nombre text,
  p_documento text,
  p_email text,
  p_telefono text,
  p_fecha_nacimiento date,
  p_direccion text,
  p_alergias text,
  p_notas text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare
  v_id uuid;
begin
  if public.rol_usuario() <> 'admin' then
    raise exception 'Solo el administrador puede crear pacientes';
  end if;

  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  if p_documento is not null and trim(p_documento) <> ''
     and exists (select 1 from public.pacientes where lower(documento) = lower(trim(p_documento))) then
    raise exception 'Ya existe un paciente con ese documento';
  end if;

  insert into public.pacientes (nombre, documento, email, telefono, fecha_nacimiento, direccion, alergias, notas)
  values (trim(p_nombre), nullif(trim(p_documento), ''), nullif(trim(p_email), ''), p_telefono,
          p_fecha_nacimiento, p_direccion, p_alergias, p_notas)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

GRANT EXECUTE ON FUNCTION public.crear_paciente_admin(text, text, text, text, date, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_paciente_admin(text, text, text, text, date, text, text, text) FROM PUBLIC;

-- 3) RPC: actualizar paciente (solo admin)
CREATE OR REPLACE FUNCTION public.actualizar_paciente_admin(
  p_id uuid,
  p_nombre text,
  p_documento text,
  p_email text,
  p_telefono text,
  p_fecha_nacimiento date,
  p_direccion text,
  p_alergias text,
  p_notas text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
begin
  if public.rol_usuario() <> 'admin' then
    raise exception 'Solo el administrador puede editar pacientes';
  end if;

  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  if p_documento is not null and trim(p_documento) <> ''
     and exists (select 1 from public.pacientes where lower(documento) = lower(trim(p_documento)) and id <> p_id) then
    raise exception 'Ya existe otro paciente con ese documento';
  end if;

  update public.pacientes
  set nombre = trim(p_nombre),
      documento = nullif(trim(p_documento), ''),
      email = nullif(trim(p_email), ''),
      telefono = p_telefono,
      fecha_nacimiento = p_fecha_nacimiento,
      direccion = p_direccion,
      alergias = p_alergias,
      notas = p_notas,
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'Paciente no encontrado';
  end if;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_paciente_admin(uuid, text, text, text, text, date, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_paciente_admin(uuid, text, text, text, text, date, text, text, text) FROM PUBLIC;

-- 4) RPC: crear médico admin — con horarios sábado
CREATE OR REPLACE FUNCTION public.crear_medico_admin(
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time,
  p_hora_fin time,
  p_duracion int,
  p_contrasena text,
  p_hora_inicio_sabado time default null,
  p_hora_fin_sabado time default null
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_dias text[];
  v_user_id uuid;
  v_medico_id uuid;
BEGIN
  IF public.rol_usuario() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear médicos';
  END IF;

  v_email := lower(trim(p_email));
  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_especialidad IS NULL OR trim(p_especialidad) = '' THEN RAISE EXCEPTION 'La especialidad es obligatoria'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'El email es obligatorio'; END IF;
  IF p_contrasena IS NULL OR length(p_contrasena) < 6 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres'; END IF;
  IF p_duracion IS NULL OR p_duracion <= 0 THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  IF p_hora_inicio >= p_hora_fin THEN RAISE EXCEPTION 'El horario de inicio debe ser anterior al de fin'; END IF;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN RAISE EXCEPTION 'Seleccione al menos un día de atención'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_dias) d WHERE d NOT IN ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) THEN
    RAISE EXCEPTION 'Día de atención inválido';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese email';
  END IF;
  IF EXISTS (SELECT 1 FROM public.medicos m WHERE lower(m.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un médico con ese email';
  END IF;

  -- Validar horario sábado si se proporciona
  IF p_hora_inicio_sabado IS NOT NULL AND p_hora_fin_sabado IS NOT NULL THEN
    IF p_hora_inicio_sabado >= p_hora_fin_sabado THEN
      RAISE EXCEPTION 'El horario de sábado: inicio debe ser anterior a fin';
    END IF;
    IF NOT ('Sabado'::text = ANY(v_dias)) THEN
      RAISE EXCEPTION 'Si configura horario de sábado, debe incluir el sábado en los días de atención';
    END IF;
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
    hora_inicio, hora_fin, duracion_cita_min, hora_inicio_sabado, hora_fin_sabado)
  VALUES (trim(p_nombre), trim(p_especialidad), p_telefono, v_email, p_dias,
    p_hora_inicio, p_hora_fin, p_duracion, p_hora_inicio_sabado, p_hora_fin_sabado)
  RETURNING id INTO v_medico_id;

  INSERT INTO public.perfiles (user_id, nombre, rol, medico_id)
  VALUES (v_user_id, trim(p_nombre), 'medico', v_medico_id);

  RETURN jsonb_build_object('medico_id', v_medico_id, 'user_id', v_user_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text, time, time) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text, time, time) FROM PUBLIC;

-- 5) RPC: actualizar médico admin — con horarios sábado
CREATE OR REPLACE FUNCTION public.actualizar_medico_admin(
  p_id uuid,
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time,
  p_hora_fin time,
  p_duracion int,
  p_contrasena text default null,
  p_hora_inicio_sabado time default null,
  p_hora_fin_sabado time default null
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_antiguo text;
  v_user_id uuid;
  v_dias text[];
BEGIN
  IF public.rol_usuario() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede editar médicos';
  END IF;

  v_email := lower(trim(p_email));
  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_especialidad IS NULL OR trim(p_especialidad) = '' THEN RAISE EXCEPTION 'La especialidad es obligatoria'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'El email es obligatorio'; END IF;
  IF p_duracion IS NULL OR p_duracion <= 0 THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  IF p_hora_inicio >= p_hora_fin THEN RAISE EXCEPTION 'El horario de inicio debe ser anterior al de fin'; END IF;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN RAISE EXCEPTION 'Seleccione al menos un día de atención'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_dias) d WHERE d NOT IN ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) THEN
    RAISE EXCEPTION 'Día de atención inválido';
  END IF;

  -- Validar horario sábado si se proporciona
  IF p_hora_inicio_sabado IS NOT NULL AND p_hora_fin_sabado IS NOT NULL THEN
    IF p_hora_inicio_sabado >= p_hora_fin_sabado THEN
      RAISE EXCEPTION 'El horario de sábado: inicio debe ser anterior a fin';
    END IF;
    IF NOT ('Sabado'::text = ANY(v_dias)) THEN
      RAISE EXCEPTION 'Si configura horario de sábado, debe incluir el sábado en los días de atención';
    END IF;
  END IF;

  SELECT m.email, p.user_id INTO v_antiguo, v_user_id
  FROM public.medicos m LEFT JOIN public.perfiles p ON p.medico_id = m.id
  WHERE m.id = p_id;
  IF v_antiguo IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  IF v_email <> lower(v_antiguo) THEN
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email AND u.id <> coalesce(v_user_id, uuid_nil())) THEN
      RAISE EXCEPTION 'Ya existe un usuario con ese email';
    END IF;
    IF EXISTS (SELECT 1 FROM public.medicos m WHERE lower(m.email) = v_email AND m.id <> p_id) THEN
      RAISE EXCEPTION 'Ya existe un médico con ese email';
    END IF;
    UPDATE auth.users SET email = v_email, updated_at = now() WHERE id = v_user_id;
    UPDATE auth.identities
      SET identity_data = jsonb_build_object('sub', v_user_id, 'email', v_email),
          provider_id = v_user_id, email = v_email, updated_at = now()
      WHERE user_id = v_user_id;
  END IF;

  IF p_contrasena IS NOT NULL AND p_contrasena <> '' THEN
    IF length(p_contrasena) < 6 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres'; END IF;
    UPDATE auth.users SET encrypted_password = extensions.crypt(p_contrasena, extensions.gen_salt('bf')), updated_at = now()
    WHERE id = v_user_id;
  END IF;

  UPDATE public.medicos
  SET nombre = trim(p_nombre), especialidad = trim(p_especialidad), telefono = p_telefono,
      email = v_email, dias_atencion = p_dias, hora_inicio = p_hora_inicio, hora_fin = p_hora_fin,
      duracion_cita_min = p_duracion,
      hora_inicio_sabado = p_hora_inicio_sabado, hora_fin_sabado = p_hora_fin_sabado
  WHERE id = p_id;

  UPDATE public.perfiles SET nombre = trim(p_nombre) WHERE medico_id = p_id;

  RETURN jsonb_build_object('ok', true, 'medico_id', p_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text, time, time) TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text, time, time) FROM PUBLIC;

-- 6) RPC: crear cita — usar horario de sábado cuando aplique
CREATE OR REPLACE FUNCTION public.crear_cita(
  p_paciente uuid,
  p_medico uuid,
  p_fecha date,
  p_hora time,
  p_motivo text default null,
  p_lugar text default 'consultorio'
)
RETURNS public.citas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_medico public.medicos%ROWTYPE;
  v_dia text;
  v_dur int;
  v_conflicto int;
  v_cita public.citas;
  v_rol text;
  v_estado text;
  v_hora_inicio time;
  v_hora_fin time;
BEGIN
  v_rol := public.rol_usuario();
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  IF v_rol NOT IN ('admin', 'recepcion', 'medico', 'paciente') THEN
    RAISE EXCEPTION 'Sin permisos para crear citas';
  END IF;

  IF v_rol = 'paciente' THEN
    p_paciente := public.paciente_id_usuario();
    IF p_paciente IS NULL THEN
      RAISE EXCEPTION 'Su perfil de paciente no está completo';
    END IF;
    v_estado := 'solicitada';
  ELSE
    v_estado := 'programada';
  END IF;

  IF p_lugar IS NULL THEN p_lugar := 'consultorio'; END IF;
  IF p_lugar NOT IN ('consultorio', 'domicilio') THEN
    RAISE EXCEPTION 'Lugar inválido (debe ser consultorio o domicilio)';
  END IF;

  SELECT * INTO v_medico FROM public.medicos WHERE id = p_medico FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Médico no encontrado';
  END IF;

  IF p_fecha < current_date THEN
    RAISE EXCEPTION 'No se pueden agendar citas en el pasado';
  END IF;

  v_dia := CASE extract(isodow FROM p_fecha)
    WHEN 1 THEN 'Lunes' WHEN 2 THEN 'Martes' WHEN 3 THEN 'Miercoles'
    WHEN 4 THEN 'Jueves' WHEN 5 THEN 'Viernes' WHEN 6 THEN 'Sabado'
    WHEN 7 THEN 'Domingo' END;

  IF NOT (v_medico.dias_atencion ? v_dia) THEN
    RAISE EXCEPTION 'El médico no atiende ese día (%)', v_dia;
  END IF;

  v_dur := v_medico.duracion_cita_min;

  -- Usar horario de sábado si aplica
  IF v_dia = 'Sabado' AND v_medico.hora_inicio_sabado IS NOT NULL AND v_medico.hora_fin_sabado IS NOT NULL THEN
    v_hora_inicio := v_medico.hora_inicio_sabado;
    v_hora_fin    := v_medico.hora_fin_sabado;
  ELSE
    v_hora_inicio := v_medico.hora_inicio;
    v_hora_fin    := v_medico.hora_fin;
  END IF;

  IF p_hora < v_hora_inicio
     OR p_hora + v_dur * interval '1 minute' > v_hora_fin THEN
    RAISE EXCEPTION 'La cita debe estar dentro del horario del médico (%)',
      v_hora_inicio || ' - ' || v_hora_fin;
  END IF;

  SELECT count(*) INTO v_conflicto
  FROM public.citas
  WHERE medico_id = p_medico AND fecha = p_fecha AND estado <> 'cancelada'
    AND hora < (p_hora + v_dur * interval '1 minute')
    AND p_hora < (hora + duracion_min * interval '1 minute');

  IF v_conflicto > 0 THEN
    RAISE EXCEPTION 'Horario no disponible: el médico ya tiene una cita en ese rango';
  END IF;

  INSERT INTO public.citas (paciente_id, medico_id, fecha, hora, duracion_min, motivo, lugar, estado, creada_por)
  VALUES (p_paciente, p_medico, p_fecha, p_hora, v_dur, p_motivo, p_lugar, v_estado, auth.uid())
  RETURNING * INTO v_cita;

  RETURN v_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_cita(uuid, uuid, date, time, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_cita(uuid, uuid, date, time, text, text) FROM PUBLIC;

-- 7) RPC: actualizar cita — usar horario de sábado cuando aplique
CREATE OR REPLACE FUNCTION public.actualizar_cita(
  p_id uuid,
  p_paciente uuid,
  p_medico uuid,
  p_fecha date,
  p_hora time,
  p_motivo text default null,
  p_lugar text default 'consultorio'
)
RETURNS public.citas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cita_actual public.citas%ROWTYPE;
  v_medico public.medicos%ROWTYPE;
  v_dia text;
  v_dur int;
  v_conflicto int;
  v_cita public.citas;
  v_hora_inicio time;
  v_hora_fin time;
BEGIN
  IF public.rol_usuario() NOT IN ('admin', 'recepcion') THEN
    RAISE EXCEPTION 'Sin permisos para reprogramar citas';
  END IF;

  IF p_lugar IS NULL THEN p_lugar := 'consultorio'; END IF;
  IF p_lugar NOT IN ('consultorio', 'domicilio') THEN
    RAISE EXCEPTION 'Lugar inválido (debe ser consultorio o domicilio)';
  END IF;

  SELECT * INTO v_cita_actual FROM public.citas WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada';
  END IF;

  SELECT * INTO v_medico FROM public.medicos WHERE id = p_medico FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Médico no encontrado';
  END IF;

  IF p_fecha < current_date THEN
    RAISE EXCEPTION 'No se pueden agendar citas en el pasado';
  END IF;

  v_dia := CASE extract(isodow FROM p_fecha)
    WHEN 1 THEN 'Lunes' WHEN 2 THEN 'Martes' WHEN 3 THEN 'Miercoles'
    WHEN 4 THEN 'Jueves' WHEN 5 THEN 'Viernes' WHEN 6 THEN 'Sabado'
    WHEN 7 THEN 'Domingo' END;

  IF NOT (v_medico.dias_atencion ? v_dia) THEN
    RAISE EXCEPTION 'El médico no atiende ese día (%)', v_dia;
  END IF;

  v_dur := v_medico.duracion_cita_min;

  -- Usar horario de sábado si aplica
  IF v_dia = 'Sabado' AND v_medico.hora_inicio_sabado IS NOT NULL AND v_medico.hora_fin_sabado IS NOT NULL THEN
    v_hora_inicio := v_medico.hora_inicio_sabado;
    v_hora_fin    := v_medico.hora_fin_sabado;
  ELSE
    v_hora_inicio := v_medico.hora_inicio;
    v_hora_fin    := v_medico.hora_fin;
  END IF;

  IF p_hora < v_hora_inicio
     OR p_hora + v_dur * interval '1 minute' > v_hora_fin THEN
    RAISE EXCEPTION 'La cita debe estar dentro del horario del médico (%)',
      v_hora_inicio || ' - ' || v_hora_fin;
  END IF;

  SELECT count(*) INTO v_conflicto
  FROM public.citas
  WHERE medico_id = p_medico AND fecha = p_fecha AND estado <> 'cancelada'
    AND id <> p_id
    AND hora < (p_hora + v_dur * interval '1 minute')
    AND p_hora < (hora + duracion_min * interval '1 minute');

  IF v_conflicto > 0 THEN
    RAISE EXCEPTION 'Horario no disponible: el médico ya tiene una cita en ese rango';
  END IF;

  UPDATE public.citas
  SET paciente_id = p_paciente, medico_id = p_medico, fecha = p_fecha, hora = p_hora,
      duracion_min = v_dur, motivo = p_motivo, lugar = p_lugar, updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_cita;

  RETURN v_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_cita(uuid, uuid, uuid, date, time, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_cita(uuid, uuid, uuid, date, time, text, text) FROM PUBLIC;
