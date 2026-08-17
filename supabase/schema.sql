-- ============================================================
--  Sistema de Agendamiento de Pacientes — Supabase
--  Ejecutar este archivo en: Supabase Dashboard > SQL Editor
-- ============================================================

grant usage on schema public to authenticated;

-- ---------- Tablas ----------

create table if not exists public.medicos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  especialidad text not null,
  telefono text,
  email text,
  dias_atencion jsonb not null default '["Lunes","Martes","Miercoles","Jueves","Viernes"]',
  hora_inicio time not null default '08:00:00',
  hora_fin time not null default '17:00:00',
  duracion_cita_min int not null default 30,
  created_at timestamptz not null default now()
);

create table if not exists public.perfiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('admin', 'medico', 'recepcion', 'paciente')),
  medico_id uuid references public.medicos (id) on delete set null,
  paciente_id uuid references public.pacientes (id) on delete cascade,
  representante boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pacientes (
  id uuid primary key default gen_random_uuid(),
  documento text unique,
  nombre text not null,
  email text,
  telefono text,
  fecha_nacimiento date,
  direccion text,
  alergias text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  medico_id uuid not null references public.medicos (id) on delete cascade,
  fecha date not null,
  hora time not null,
  duracion_min int not null default 30,
  motivo text,
  lugar text not null default 'consultorio'
    check (lugar in ('consultorio', 'domicilio')),
  estado      text not null default 'programada'
                check (estado in ('solicitada', 'programada', 'confirmada', 'completada', 'cancelada')),
  creada_por uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.recordatorios (
  id uuid primary key default gen_random_uuid(),
  cita_id uuid not null references public.citas (id) on delete cascade,
  paciente_id uuid not null references public.pacientes (id) on delete cascade,
  canal text not null default 'app' check (canal in ('app', 'email')),
  mensaje text not null,
  fecha_programada timestamptz,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido')),
  dirigido_a uuid references auth.users (id) on delete cascade,
  enviado_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_citas_fecha on public.citas (fecha);
create index if not exists idx_citas_medico on public.citas (medico_id);
create index if not exists idx_citas_paciente on public.citas (paciente_id);
create index if not exists idx_recordatorios_estado on public.recordatorios (estado);

-- ---------- Funciones de apoyo ----------

-- Rol del usuario autenticado (lee perfiles sin pasar por RLS)
create or replace function public.rol_usuario()
returns text
language sql stable security definer set search_path = public
as $$
  select p.rol from public.perfiles p where p.user_id = auth.uid()
$$;

-- medico_id del usuario autenticado (si es médico)
create or replace function public.medico_id_usuario()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.medico_id from public.perfiles p where p.user_id = auth.uid()
$$;

-- paciente_id del usuario autenticado (si es paciente/representante)
create or replace function public.paciente_id_usuario()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.paciente_id from public.perfiles p where p.user_id = auth.uid()
$$;

grant execute on function public.rol_usuario() to authenticated;
grant execute on function public.medico_id_usuario() to authenticated;
grant execute on function public.paciente_id_usuario() to authenticated;

-- ---------- Triggers ----------

-- Al crear una cita, genera recordatorios (app + email)
create or replace function public.generar_recordatorios()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_paciente text;
  v_email text;
  v_medico text;
  v_esp text;
  v_msj text;
  v_lugar text;
  v_creador text;
  v_admin record;
begin
  select p.nombre, p.email into v_paciente, v_email
  from public.pacientes p where p.id = new.paciente_id;

  select m.nombre, m.especialidad into v_medico, v_esp
  from public.medicos m where m.id = new.medico_id;

  v_msj := 'Recordatorio de cita: ' || v_paciente || ' con ' || v_medico ||
           ' (' || v_esp || ') el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
           ' a las ' || to_char(new.hora, 'HH24:MI') || '.';

  insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
  values (new.id, new.paciente_id, 'app', v_msj, new.fecha + new.hora, 'pendiente');

  if v_email is not null and v_email <> '' then
    insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
    values (new.id, new.paciente_id, 'email', v_msj, new.fecha + new.hora, 'pendiente');
  end if;

  -- Alerta inmediata para los admins cuando la cita es de la psicóloga
  if exists (select 1 from public.medicos m where m.id = new.medico_id and m.email = 'jtoaquiza@clinica.com') then
    v_lugar := case when new.lugar = 'domicilio' then 'a domicilio' else 'en consultorio' end;

    select p.nombre into v_creador from public.perfiles p where p.user_id = new.creada_por;

    for v_admin in select user_id from public.perfiles where rol = 'admin' loop
      insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
      values (
        new.id,
        new.paciente_id,
        'app',
        'Nueva cita para ' || v_medico || ' (' || v_esp || '): ' || v_paciente ||
          ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
          ' a las ' || to_char(new.hora, 'HH24:MI') ||
          ' ' || v_lugar ||
          '. Agendada por ' || coalesce(v_creador, 'el sistema') || '.',
        now(),
        'pendiente',
        v_admin.user_id
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generar_recordatorios on public.citas;
create trigger trg_generar_recordatorios
after insert on public.citas
for each row execute function public.generar_recordatorios();

-- ---------- RPC: crear cita (valida disponibilidad) ----------

create or replace function public.crear_cita(
  p_paciente uuid,
  p_medico uuid,
  p_fecha date,
  p_hora time,
  p_motivo text default null,
  p_lugar text default 'consultorio'
)
returns public.citas
language plpgsql security definer set search_path = public
as $$
declare
  v_medico public.medicos%rowtype;
  v_dia text;
  v_dur int;
  v_conflicto int;
  v_cita public.citas;
  v_rol text;
  v_estado text;
begin
  v_rol := public.rol_usuario();
  if v_rol is null then
    raise exception 'Debe iniciar sesión';
  end if;
  if v_rol not in ('admin', 'recepcion', 'medico', 'paciente') then
    raise exception 'Sin permisos para crear citas';
  end if;

  if v_rol = 'paciente' then
    p_paciente := public.paciente_id_usuario();
    if p_paciente is null then
      raise exception 'Su perfil de paciente no está completo';
    end if;
    v_estado := 'solicitada';
  else
    v_estado := 'programada';
  end if;

  if p_lugar is null then p_lugar := 'consultorio'; end if;
  if p_lugar not in ('consultorio', 'domicilio') then
    raise exception 'Lugar inválido (debe ser consultorio o domicilio)';
  end if;

  select * into v_medico from public.medicos where id = p_medico for update;
  if not found then
    raise exception 'Médico no encontrado';
  end if;

  if p_fecha < current_date then
    raise exception 'No se pueden agendar citas en el pasado';
  end if;

  v_dia := case extract(isodow from p_fecha)
    when 1 then 'Lunes' when 2 then 'Martes' when 3 then 'Miercoles'
    when 4 then 'Jueves' when 5 then 'Viernes' when 6 then 'Sabado'
    when 7 then 'Domingo' end;

  if not (v_medico.dias_atencion ? v_dia) then
    raise exception 'El médico no atiende ese día (%)', v_dia;
  end if;

  v_dur := v_medico.duracion_cita_min;

  if p_hora < v_medico.hora_inicio
     or p_hora + v_dur * interval '1 minute' > v_medico.hora_fin then
    raise exception 'La cita debe estar dentro del horario del médico (%)',
      v_medico.hora_inicio || ' - ' || v_medico.hora_fin;
  end if;

  select count(*) into v_conflicto
  from public.citas
  where medico_id = p_medico and fecha = p_fecha and estado <> 'cancelada'
    and hora < (p_hora + v_dur * interval '1 minute')
    and p_hora < (hora + duracion_min * interval '1 minute');

  if v_conflicto > 0 then
    raise exception 'Horario no disponible: el médico ya tiene una cita en ese rango';
  end if;

  insert into public.citas (paciente_id, medico_id, fecha, hora, duracion_min, motivo, lugar, estado, creada_por)
  values (p_paciente, p_medico, p_fecha, p_hora, v_dur, p_motivo, p_lugar, v_estado, auth.uid())
  returning * into v_cita;

  return v_cita;
end;
$$;

grant execute on function public.crear_cita(uuid, uuid, date, time, text, text) to authenticated;
revoke all on function public.crear_cita(uuid, uuid, date, time, text, text) from public;

-- ---------- RPC: reprogramar cita (valida disponibilidad) ----------

create or replace function public.actualizar_cita(
  p_id uuid,
  p_paciente uuid,
  p_medico uuid,
  p_fecha date,
  p_hora time,
  p_motivo text default null,
  p_lugar text default 'consultorio'
)
returns public.citas
language plpgsql security definer set search_path = public
as $$
declare
  v_cita_actual public.citas%rowtype;
  v_medico public.medicos%rowtype;
  v_dia text;
  v_dur int;
  v_conflicto int;
  v_cita public.citas;
begin
  if public.rol_usuario() not in ('admin', 'recepcion') then
    raise exception 'Sin permisos para reprogramar citas';
  end if;

  if p_lugar is null then p_lugar := 'consultorio'; end if;
  if p_lugar not in ('consultorio', 'domicilio') then
    raise exception 'Lugar inválido (debe ser consultorio o domicilio)';
  end if;

  select * into v_cita_actual from public.citas where id = p_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;

  select * into v_medico from public.medicos where id = p_medico for update;
  if not found then
    raise exception 'Médico no encontrado';
  end if;

  if p_fecha < current_date then
    raise exception 'No se pueden agendar citas en el pasado';
  end if;

  v_dia := case extract(isodow from p_fecha)
    when 1 then 'Lunes' when 2 then 'Martes' when 3 then 'Miercoles'
    when 4 then 'Jueves' when 5 then 'Viernes' when 6 then 'Sabado'
    when 7 then 'Domingo' end;

  if not (v_medico.dias_atencion ? v_dia) then
    raise exception 'El médico no atiende ese día (%)', v_dia;
  end if;

  v_dur := v_medico.duracion_cita_min;

  if p_hora < v_medico.hora_inicio
     or p_hora + v_dur * interval '1 minute' > v_medico.hora_fin then
    raise exception 'La cita debe estar dentro del horario del médico (%)',
      v_medico.hora_inicio || ' - ' || v_medico.hora_fin;
  end if;

  select count(*) into v_conflicto
  from public.citas
  where medico_id = p_medico and fecha = p_fecha and estado <> 'cancelada'
    and id <> p_id
    and hora < (p_hora + v_dur * interval '1 minute')
    and p_hora < (hora + duracion_min * interval '1 minute');

  if v_conflicto > 0 then
    raise exception 'Horario no disponible: el médico ya tiene una cita en ese rango';
  end if;

  update public.citas
  set paciente_id = p_paciente, medico_id = p_medico, fecha = p_fecha, hora = p_hora,
      duracion_min = v_dur, motivo = p_motivo, lugar = p_lugar, updated_at = now()
  where id = p_id
  returning * into v_cita;

  return v_cita;
end;
$$;

grant execute on function public.actualizar_cita(uuid, uuid, uuid, date, time, text, text) to authenticated;
revoke all on function public.actualizar_cita(uuid, uuid, uuid, date, time, text, text) from public;

-- ---------- RPC: cambiar estado ----------

create or replace function public.cambiar_estado_cita(p_id uuid, p_estado text)
returns public.citas
language plpgsql security definer set search_path = public
as $$
declare
  v_cita public.citas;
  v_rol text;
begin
  if p_estado not in ('solicitada', 'programada', 'confirmada', 'completada', 'cancelada') then
    raise exception 'Estado inválido';
  end if;

  v_rol := public.rol_usuario();
  select * into v_cita from public.citas where id = p_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;

  if v_rol not in ('admin', 'recepcion')
     and not (v_rol = 'medico' and v_cita.medico_id = public.medico_id_usuario()) then
    raise exception 'Sin permisos para cambiar el estado de esta cita';
  end if;

  update public.citas set estado = p_estado, updated_at = now()
  where id = p_id
  returning * into v_cita;

  return v_cita;
end;
$$;

grant execute on function public.cambiar_estado_cita(uuid, text) to authenticated;
revoke all on function public.cambiar_estado_cita(uuid, text) from public;

-- ---------- Row Level Security ----------

alter table public.medicos enable row level security;
alter table public.perfiles enable row level security;
alter table public.pacientes enable row level security;
alter table public.citas enable row level security;
alter table public.recordatorios enable row level security;

-- medicos: lectura para autenticados; escritura solo admin
create policy "medicos_sel" on public.medicos for select to authenticated using (true);
create policy "medicos_ins" on public.medicos for insert to authenticated with check (public.rol_usuario() = 'admin');
create policy "medicos_upd" on public.medicos for update to authenticated using (public.rol_usuario() = 'admin');
create policy "medicos_del" on public.medicos for delete to authenticated using (public.rol_usuario() = 'admin');

-- perfiles: cada usuario ve su perfil; admin ve todo
create policy "perfiles_sel_own" on public.perfiles for select to authenticated using (user_id = auth.uid() or public.rol_usuario() = 'admin');
create policy "perfiles_ins" on public.perfiles for insert to authenticated with check (public.rol_usuario() = 'admin');
create policy "perfiles_upd" on public.perfiles for update to authenticated using (public.rol_usuario() = 'admin');
create policy "perfiles_del" on public.perfiles for delete to authenticated using (public.rol_usuario() = 'admin');

-- pacientes: lectura todos; escritura admin/recepcion
create policy "pacientes_sel" on public.pacientes for select to authenticated using (true);
create policy "pacientes_ins" on public.pacientes for insert to authenticated with check (public.rol_usuario() in ('admin', 'recepcion'));
create policy "pacientes_upd" on public.pacientes for update to authenticated using (public.rol_usuario() in ('admin', 'recepcion'));
create policy "pacientes_del" on public.pacientes for delete to authenticated using (public.rol_usuario() in ('admin', 'recepcion'));

-- citas: admin/recepcion ven todas; medico ve las suyas.
-- La creación/edición SOLO por RPC (crear_cita / actualizar_cita / cambiar_estado_cita)
create policy "citas_sel" on public.citas for select to authenticated
  using (
    public.rol_usuario() in ('admin', 'recepcion')
    or (public.rol_usuario() = 'medico' and medico_id = public.medico_id_usuario())
  );
create policy "citas_del" on public.citas for delete to authenticated
  using (public.rol_usuario() in ('admin', 'recepcion'));

create policy "citas_sel_paciente" on public.citas for select to authenticated
  using (public.rol_usuario() = 'paciente' and public.paciente_id_usuario() = paciente_id);

-- recordatorios: lectura y marcado como leído según destinatario
-- (dirigido_a NULL = visible para todos; no NULL = solo ese usuario; admin ve todo)
create policy "recordatorios_sel" on public.recordatorios for select to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid() or public.rol_usuario() = 'admin');
create policy "recordatorios_upd" on public.recordatorios for update to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid() or public.rol_usuario() = 'admin');

-- ---------- Grants ----------

grant select on public.medicos, public.pacientes, public.citas, public.recordatorios to authenticated;
grant select, insert, update, delete on public.pacientes to authenticated;
grant select, insert, update, delete on public.recordatorios to authenticated;
grant select, insert, update, delete on public.medicos to authenticated;
grant select, insert, update, delete on public.perfiles to authenticated;
grant select, delete on public.citas to authenticated;

-- ---------- Admin: gestión de médicos (crea usuario de acceso) ----------

create extension if not exists pgcrypto;

-- Crea médico: fila en medicos + usuario auth + perfil (solo admin)
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

-- Edita médico (puede cambiar email y contraseña de acceso)
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

-- Elimina médico (solo si no tiene citas) junto con su usuario de acceso
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

-- Genera recordatorios de una cita si no existen (app + email)
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

-- ---------- Pacientes: autorregistro (página pública) ----------

create or replace function public.registrar_paciente(
  p_nombre_paciente text,
  p_es_representante boolean,
  p_nombre_cuenta text,
  p_documento text,
  p_email text,
  p_telefono text,
  p_fecha_nacimiento date,
  p_direccion text,
  p_alergias text,
  p_contrasena text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_user_id uuid;
  v_paciente_id uuid;
  v_nombre_cuenta text;
begin
  v_email := lower(trim(p_email));
  if p_nombre_paciente is null or trim(p_nombre_paciente) = '' then
    raise exception 'El nombre del paciente es obligatorio';
  end if;
  if coalesce(p_es_representante, false) then
    if p_nombre_cuenta is null or trim(p_nombre_cuenta) = '' then
      raise exception 'El nombre del representante es obligatorio';
    end if;
    v_nombre_cuenta := trim(p_nombre_cuenta);
  else
    v_nombre_cuenta := trim(p_nombre_paciente);
  end if;
  if v_email is null or v_email = '' then raise exception 'El email es obligatorio'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'El email no es válido'; end if;
  if p_contrasena is null or length(p_contrasena) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Ya existe una cuenta con ese email';
  end if;
  if p_documento is not null and trim(p_documento) <> ''
     and exists (select 1 from public.pacientes pa where lower(pa.documento) = lower(trim(p_documento))) then
    raise exception 'Ya existe un paciente registrado con ese documento';
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

  insert into public.pacientes (documento, nombre, email, telefono, fecha_nacimiento, direccion, alergias)
  values (nullif(trim(p_documento), ''), trim(p_nombre_paciente), v_email, p_telefono, p_fecha_nacimiento, p_direccion, p_alergias)
  returning id into v_paciente_id;

  insert into public.perfiles (user_id, nombre, rol, paciente_id, representante)
  values (v_user_id, v_nombre_cuenta, 'paciente', v_paciente_id, coalesce(p_es_representante, false));

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- Accesible por cualquiera (página pública de registro) y por usuarios autenticados
grant execute on function public.registrar_paciente(text, boolean, text, text, text, text, date, text, text, text) to anon, authenticated;
revoke all on function public.registrar_paciente(text, boolean, text, text, text, text, date, text, text, text) from public;
