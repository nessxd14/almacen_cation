-- Mantener RLS de las tablas del catálogo en la vista de reservas. El saldo
-- documental se consulta mediante un helper privado que sólo devuelve cantidad.
create function almacen_operaciones.asignado_linea_reserva(p_linea bigint) returns numeric
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then
    if session_user not in ('postgres','supabase_admin','hermes_app') and coalesce(current_setting('role',true),'none') not in ('service_role','hermes_app') then
      raise exception 'Inicia sesión para consultar las reservas.' using errcode='42501';
    end if;
  elsif not exists(select 1 from public.perfil where id=auth.uid() and activo) then
    raise exception 'Tu perfil no está activo.' using errcode='42501';
  end if;
  return coalesce((select sum(almacen_operaciones.saldo_recepcion(r.id)) from almacen_operaciones.recepcion_pedido r where r.pedido_linea_id=p_linea),0);
end $$;
revoke all on function almacen_operaciones.asignado_linea_reserva(bigint) from public,anon;
grant execute on function almacen_operaciones.asignado_linea_reserva(bigint) to authenticated,service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='hermes_app') then
    grant usage on schema almacen_operaciones to hermes_app;
    grant execute on function almacen_operaciones.asignado_linea_reserva(bigint) to hermes_app;
  end if;
end $$;

create or replace view public.v_pedido_linea_reserva with(security_invoker=true) as
with lineas as (
  select pl.id as linea_id,pl.pedido_id,pl.producto_id,
    greatest(pl.cantidad_base-coalesce(pl.cantidad_despachada,0)-almacen_operaciones.asignado_linea_reserva(pl.id),0) as pendiente,
    p.creado_en,p.referencia,p.categoria::text as categoria,p.categoria::text<>'TIENDA' as reserva
  from public.pedido_linea pl join public.pedido p on p.id=pl.pedido_id
  where pl.estado in ('POR_DESPACHAR','PENDIENTE') and p.estado='ABIERTO' and pl.producto_id is not null
    and greatest(pl.cantidad_base-coalesce(pl.cantidad_despachada,0)-almacen_operaciones.asignado_linea_reserva(pl.id),0)>0
), fisico as (
  select sa.producto_id,sum(sa.cantidad_base) as stock from public.stock_actual sa
    join public.ubicacion u on u.id=sa.ubicacion_id join public.sucursal s on s.id=u.sucursal_id
  where s.tipo<>'virtual' and not u.excluye_disponible group by sa.producto_id
), acum as (
  select l.*,coalesce(sum(l.pendiente) over(partition by l.producto_id order by l.reserva desc,l.creado_en,l.linea_id rows between unbounded preceding and 1 preceding),0) as consumido_antes from lineas l
)
select a.linea_id,a.pedido_id,a.producto_id,a.referencia,a.categoria,a.creado_en,a.pendiente,a.reserva,
  greatest(coalesce(f.stock,0),0) as stock_producto,
  least(a.pendiente,greatest(greatest(coalesce(f.stock,0),0)-a.consumido_antes,0)) as cubierto,
  a.pendiente-least(a.pendiente,greatest(greatest(coalesce(f.stock,0),0)-a.consumido_antes,0)) as en_espera,
  row_number() over(partition by a.producto_id order by a.reserva desc,a.creado_en,a.linea_id) as turno
from acum a left join fisico f on f.producto_id=a.producto_id;
notify pgrst,'reload schema';
