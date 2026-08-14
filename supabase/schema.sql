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
  rol text not null check (rol in ('admin', 'medico', 'recepcion')),
  medico_id uuid references public.medicos (id) on delete set null,
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
  estado text not null default 'programada'
    check (estado in ('programada', 'confirmada', 'completada', 'cancelada')),
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

grant execute on function public.rol_usuario() to authenticated;
grant execute on function public.medico_id_usuario() to authenticated;

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
begin
  if public.rol_usuario() is null then
    raise exception 'Debe iniciar sesión';
  end if;
  if public.rol_usuario() not in ('admin', 'recepcion', 'medico') then
    raise exception 'Sin permisos para crear citas';
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

  insert into public.citas (paciente_id, medico_id, fecha, hora, duracion_min, motivo, lugar, creada_por)
  values (p_paciente, p_medico, p_fecha, p_hora, v_dur, p_motivo, p_lugar, auth.uid())
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
  if p_estado not in ('programada', 'confirmada', 'completada', 'cancelada') then
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

-- recordatorios: lectura y marcado como leído según destinatario
-- (dirigido_a NULL = visible para todos; no NULL = solo ese usuario)
create policy "recordatorios_sel" on public.recordatorios for select to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid());
create policy "recordatorios_upd" on public.recordatorios for update to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid());

-- ---------- Grants ----------

grant select on public.medicos, public.pacientes, public.citas, public.recordatorios to authenticated;
grant select, insert, update, delete on public.pacientes to authenticated;
grant select, insert, update, delete on public.recordatorios to authenticated;
grant select, insert, update, delete on public.medicos to authenticated;
grant select, insert, update, delete on public.perfiles to authenticated;
grant select, delete on public.citas to authenticated;
