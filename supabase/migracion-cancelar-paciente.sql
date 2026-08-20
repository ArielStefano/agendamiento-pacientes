-- Migracion: Permitir a pacientes cancelar sus propias citas
-- Modifica cambiar_estado_cita para que pacientes puedan cancelar

CREATE OR REPLACE FUNCTION public.cambiar_estado_cita(p_id uuid, p_estado text)
RETURNS public.citas
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  -- Pacientes solo pueden cancelar sus propias citas y solo si están solicitada o confirmada
  if v_rol = 'paciente' then
    if v_cita.paciente_id != public.paciente_id_usuario() then
      raise exception 'Sin permisos para modificar esta cita';
    end if;
    if p_estado != 'cancelada' then
      raise exception 'Solo puede cancelar citas';
    end if;
    if v_cita.estado not in ('solicitada', 'confirmada') then
      raise exception 'No se puede cancelar una cita en estado %', v_cita.estado;
    end if;
  elsif v_rol not in ('admin', 'recepcion')
     and not (v_rol = 'medico' and v_cita.medico_id = public.medico_id_usuario()) then
    raise exception 'Sin permisos para cambiar el estado de esta cita';
  end if;

  update public.citas set estado = p_estado, updated_at = now()
  where id = p_id
  returning * into v_cita;

  return v_cita;
end;
$$;
