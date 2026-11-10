-- Restringe AJUSTE directo en Kardex y valida la RPC manual por rol y sucursal.
-- Requiere 20261021220732_traslados_qr_entrega_dos_personas y 20261109213544_proteger_escritura_directa_stock,
-- ambas aplicadas en Almacén. Esta versión se aplicó desde el SQL Editor y quedó registrada.
-- La recepción interna de traslados conserva su ajuste compensatorio mediante el núcleo privado.
-- El resto de tipos de movimiento se migra por separado para preservar los flujos compartidos.

alter function public.registrar_ajuste(bigint,bigint,numeric,text,text,character varying,date)
  set schema traslado_qr;
alter function traslado_qr.registrar_ajuste(bigint,bigint,numeric,text,text,character varying,date)
  set search_path to pg_catalog, public, pg_temp;
revoke all on function traslado_qr.registrar_ajuste(bigint,bigint,numeric,text,text,character varying,date)
  from anon, public, authenticated, service_role;

alter function traslado_qr.recepcion_anterior(bigint,text,jsonb)
  set search_path to pg_catalog, traslado_qr, public, pg_temp;

create function public.registrar_ajuste(
  p_producto_id bigint,
  p_ubicacion_id bigint,
  p_cantidad_base_objetivo numeric,
  p_motivo text,
  p_referencia text default null,
  p_usuario character varying default null,
  p_fecha date default current_date
) returns bigint
language plpgsql
security definer
set search_path to ''
as $ajuste$
begin
  if current_setting('role', true) is distinct from 'service_role'
    and not (current_setting('role', true) = 'none' and session_user in ('postgres', 'supabase_admin'))
    and not exists (
      select 1
      from public.perfil p
      join public.ubicacion u on u.id = p_ubicacion_id and u.activo
      join public.sucursal s on s.id = u.sucursal_id and s.activo and s.tipo = 'fisica'
      where p.id = auth.uid() and p.activo
        and p.rol in ('admin', 'gerente', 'almacenero')
        and (p.sucursal_id is null or p.sucursal_id = u.sucursal_id)
    )
  then
    raise exception 'No tienes permiso para ajustar existencias en esta ubicación.' using errcode = '42501';
  end if;

  if p_cantidad_base_objetivo is null or p_cantidad_base_objetivo::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Indica una cantidad de ajuste finita.' using errcode = '22023';
  end if;

  return traslado_qr.registrar_ajuste(
    p_producto_id, p_ubicacion_id, p_cantidad_base_objetivo, p_motivo,
    p_referencia, p_usuario, p_fecha
  );
end
$ajuste$;
revoke all on function public.registrar_ajuste(bigint,bigint,numeric,text,text,character varying,date)
  from anon, public;
grant execute on function public.registrar_ajuste(bigint,bigint,numeric,text,text,character varying,date)
  to authenticated, service_role;

create policy kardex_sin_ajuste_directo
  on public.kardex_transacciones
  as restrictive for insert to anon, authenticated
  with check (tipo_movimiento::text <> 'AJUSTE');

notify pgrst, 'reload schema';
