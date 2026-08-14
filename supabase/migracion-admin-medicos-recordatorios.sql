-- ============================================================
--  Migración: gestión de médicos y recordatorios desde el panel
--  de administrador (usuarios de acceso creados por SQL RPC)
--  Ejecutar DESPUÉS de migracion-alertas-lugar.sql
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- RPC: crear médico (medicos + usuario + perfil) ----------

create or replace function public.crear_medico_admin(
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time,
  p_hora_fin time,
  p_duracion int,
  p_contrasena text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_dias text[];
  v_user_id uuid;
  v_medico_id uuid;
begin
  if public.rol_usuario() <> 'admin' then
    raise exception 'Solo el administrador puede crear médicos';
  end if;

  v_email := lower(trim(p_email));
  if p_nombre is null or trim(p_nombre) = '' then raise exception 'El nombre es obligatorio'; end if;
  if p_especialidad is null or trim(p_especialidad) = '' then raise exception 'La especialidad es obligatoria'; end if;
  if v_email is null or v_email = '' then raise exception 'El email es obligatorio'; end if;
  if p_contrasena is null or length(p_contrasena) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;
  if p_duracion is null or p_duracion <= 0 then raise exception 'Duración inválida'; end if;
  if p_hora_inicio >= p_hora_fin then raise exception 'El horario de inicio debe ser anterior al de fin'; end if;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  if v_dias is null or array_length(v_dias, 1) is null then raise exception 'Seleccione al menos un día de atención'; end if;
  if exists (select 1 from unnest(v_dias) d where d not in ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) then
    raise exception 'Día de atención inválido (Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo)';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Ya existe un usuario con ese email';
  end if;
  if exists (select 1 from public.medicos m where lower(m.email) = v_email) then
    raise exception 'Ya existe un médico con ese email';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
    email_change, is_sso_user, is_anonymous, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, now(), now())
  returning id into v_user_id;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_user_id, v_user_id, v_user_id,
          jsonb_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now(), now());

  insert into public.medicos (nombre, especialidad, telefono, email, dias_atencion, hora_inicio, hora_fin, duracion_cita_min)
  values (trim(p_nombre), trim(p_especialidad), p_telefono, v_email, p_dias, p_hora_inicio, p_hora_fin, p_duracion)
  returning id into v_medico_id;

  insert into public.perfiles (user_id, nombre, rol, medico_id)
  values (v_user_id, trim(p_nombre), 'medico', v_medico_id);

  return jsonb_build_object('medico_id', v_medico_id, 'user_id', v_user_id, 'email', v_email);
end;
$$;

grant execute on function public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text) to authenticated;
revoke all on function public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text) from public;

-- ---------- RPC: editar médico ----------

create or replace function public.actualizar_medico_admin(
  p_id uuid,
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time,
  p_hora_fin time,
  p_duracion int,
  p_contrasena text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_antiguo text;
  v_user_id uuid;
  v_dias text[];
begin
  if public.rol_usuario() <> 'admin' then
    raise exception 'Solo el administrador puede editar médicos';
  end if;

  v_email := lower(trim(p_email));
  if p_nombre is null or trim(p_nombre) = '' then raise exception 'El nombre es obligatorio'; end if;
  if p_especialidad is null or trim(p_especialidad) = '' then raise exception 'La especialidad es obligatoria'; end if;
  if v_email is null or v_email = '' then raise exception 'El email es obligatorio'; end if;
  if p_duracion is null or p_duracion <= 0 then raise exception 'Duración inválida'; end if;
  if p_hora_inicio >= p_hora_fin then raise exception 'El horario de inicio debe ser anterior al de fin'; end if;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  if v_dias is null or array_length(v_dias, 1) is null then raise exception 'Seleccione al menos un día de atención'; end if;
  if exists (select 1 from unnest(v_dias) d where d not in ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) then
    raise exception 'Día de atención inválido';
  end if;

  select m.email, p.user_id into v_antiguo, v_user_id
  from public.medicos m left join public.perfiles p on p.medico_id = m.id
  where m.id = p_id;
  if v_antiguo is null then raise exception 'Médico no encontrado'; end if;

  if v_email <> lower(v_antiguo) then
    if exists (select 1 from auth.users u where lower(u.email) = v_email and u.id <> coalesce(v_user_id, uuid_nil())) then
      raise exception 'Ya existe un usuario con ese email';
    end if;
    if exists (select 1 from public.medicos m where lower(m.email) = v_email and m.id <> p_id) then
      raise exception 'Ya existe un médico con ese email';
    end if;
    update auth.users set email = v_email, updated_at = now() where id = v_user_id;
    update auth.identities
      set identity_data = jsonb_build_object('sub', v_user_id, 'email', v_email),
          provider_id = v_user_id,
          email = v_email,
          updated_at = now()
      where user_id = v_user_id;
  end if;

  if p_contrasena is not null and p_contrasena <> '' then
    if length(p_contrasena) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;
    update auth.users set encrypted_password = extensions.crypt(p_contrasena, extensions.gen_salt('bf')), updated_at = now()
    where id = v_user_id;
  end if;

  update public.medicos
  set nombre = trim(p_nombre), especialidad = trim(p_especialidad), telefono = p_telefono,
      email = v_email, dias_atencion = p_dias, hora_inicio = p_hora_inicio, hora_fin = p_hora_fin,
      duracion_cita_min = p_duracion
  where id = p_id;

  update public.perfiles set nombre = trim(p_nombre) where medico_id = p_id;

  return jsonb_build_object('ok', true, 'medico_id', p_id, 'email', v_email);
end;
$$;

grant execute on function public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text) to authenticated;
revoke all on function public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text) from public;

-- ---------- RPC: eliminar médico (solo si no tiene citas) ----------

create or replace function public.eliminar_medico_admin(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if public.rol_usuario() <> 'admin' then
    raise exception 'Solo el administrador puede eliminar médicos';
  end if;

  if exists (select 1 from public.citas c where c.medico_id = p_id) then
    raise exception 'No se puede eliminar: el médico tiene citas registradas';
  end if;

  select user_id into v_user_id from public.perfiles where medico_id = p_id;

  delete from public.medicos where id = p_id;
  if v_user_id is not null then
    delete from auth.users where id = v_user_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.eliminar_medico_admin(uuid) to authenticated;
revoke all on function public.eliminar_medico_admin(uuid) from public;

-- ---------- RPC: generar recordatorios de una cita ----------

create or replace function public.generar_recordatorios_cita(p_cita_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_cita public.citas;
  v_paciente text;
  v_email text;
  v_medico text;
  v_esp text;
  v_msj text;
  v_n int := 0;
begin
  if public.rol_usuario() not in ('admin', 'recepcion') then
    raise exception 'Sin permisos para generar recordatorios';
  end if;

  select * into v_cita from public.citas where id = p_cita_id;
  if not found then raise exception 'Cita no encontrada'; end if;

  select p.nombre, p.email into v_paciente, v_email from public.pacientes p where p.id = v_cita.paciente_id;
  select m.nombre, m.especialidad into v_medico, v_esp from public.medicos m where m.id = v_cita.medico_id;

  v_msj := 'Recordatorio de cita: ' || v_paciente || ' con ' || v_medico ||
           ' (' || v_esp || ') el ' || to_char(v_cita.fecha, 'DD/MM/YYYY') ||
           ' a las ' || to_char(v_cita.hora, 'HH24:MI') || '.';

  if not exists (select 1 from public.recordatorios where cita_id = v_cita.id and canal = 'app') then
    insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
    values (v_cita.id, v_cita.paciente_id, 'app', v_msj, v_cita.fecha + v_cita.hora, 'pendiente');
    v_n := v_n + 1;
  end if;

  if v_email is not null and v_email <> ''
     and not exists (select 1 from public.recordatorios where cita_id = v_cita.id and canal = 'email') then
    insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
    values (v_cita.id, v_cita.paciente_id, 'email', v_msj, v_cita.fecha + v_cita.hora, 'pendiente');
    v_n := v_n + 1;
  end if;

  return v_n;
end;
$$;

grant execute on function public.generar_recordatorios_cita(uuid) to authenticated;
revoke all on function public.generar_recordatorios_cita(uuid) from public;

-- ---------- RLS: el admin ve todos los recordatorios ----------

drop policy if exists "recordatorios_sel" on public.recordatorios;
create policy "recordatorios_sel" on public.recordatorios for select to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid() or public.rol_usuario() = 'admin');

drop policy if exists "recordatorios_upd" on public.recordatorios;
create policy "recordatorios_upd" on public.recordatorios for update to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid() or public.rol_usuario() = 'admin');
