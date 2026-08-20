-- Migracion: Cláusula administrativa para cancelaciones
-- 1. Agregar columna motivo_cancelacion
-- 2. Actualizar cambiar_estado_cita con lógica <24h

ALTER TABLE public.citas ADD COLUMN IF NOT EXISTS motivo_cancelacion text;

CREATE OR REPLACE FUNCTION public.cambiar_estado_cita(p_id uuid, p_estado text, p_motivo_cancelacion text DEFAULT NULL)
RETURNS public.citas
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_cita public.citas;
  v_rol text;
  v_horas_antes numeric;
begin
  if p_estado not in ('solicitada', 'programada', 'confirmada', 'completada', 'cancelada', 'cancelada_clausula') then
    raise exception 'Estado inválido';
  end if;

  v_rol := public.rol_usuario();
  select * into v_cita from public.citas where id = p_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;

  -- Pacientes: solo cancelar, con validación de tiempo
  if v_rol = 'paciente' then
    if v_cita.paciente_id != public.paciente_id_usuario() then
      raise exception 'Sin permisos para modificar esta cita';
    end if;
    if v_cita.estado not in ('solicitada', 'confirmada') then
      raise exception 'No se puede cancelar una cita en estado %', v_cita.estado;
    end if;

    -- Calcular horas hasta la cita
    v_horas_antes := EXTRACT(EPOCH FROM (v_cita.fecha::timestamp + v_cita.hora - now())) / 3600;

    if p_estado != 'cancelada' and p_estado != 'cancelada_clausula' then
      raise exception 'Solo puede cancelar citas';
    end if;

    -- Si cancela con menos de 24h de anticipación → cláusula administrativa
    if v_horas_antes < 24 then
      p_estado := 'cancelada_clausula';
      if p_motivo_cancelacion is null or trim(p_motivo_cancelacion) = '' then
        p_motivo_cancelacion := 'Cláusula administrativa — cancelación con menos de 24 horas de anticipación';
      else
        p_motivo_cancelacion := 'Cláusula administrativa — ' || trim(p_motivo_cancelacion);
      end if;
    else if p_motivo_cancelacion is null or trim(p_motivo_cancelacion) = '' then
      raise exception 'Debe indicar el motivo de cancelación';
    end if;
    end if;

  elsif v_rol not in ('admin', 'recepcion')
     and not (v_rol = 'medico' and v_cita.medico_id = public.medico_id_usuario()) then
    raise exception 'Sin permisos para cambiar el estado de esta cita';
  end if;

  update public.citas
  set estado = p_estado,
      motivo_cancelacion = coalesce(p_motivo_cancelacion, motivo_cancelacion),
      updated_at = now()
  where id = p_id
  returning * into v_cita;

  return v_cita;
end;
$$;
