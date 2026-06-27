-- ─────────────────────────────────────────────────────────────────────────
-- Fase 5: costos (valuación por promedio ponderado móvil) y analítica de reorden
-- Aplicado en Supabase Cloud el 2026-06-26.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.producto
  add column if not exists stock_min      numeric,
  add column if not exists punto_reorden  numeric;

comment on column public.producto.stock_min     is 'Stock mínimo deseado (unidad base). Referencia para alertas.';
comment on column public.producto.punto_reorden is 'Nivel que dispara reposición (unidad base).';

-- Valuación: promedio ponderado móvil por producto. Recorre el Kardex en orden
-- cronológico; el promedio solo se actualiza en entradas (cantidad > 0), las
-- salidas reducen la cantidad sin alterar el costo unitario promedio.
create or replace function public.f_valuacion_inventario()
returns table (
  producto_id      bigint,
  cantidad_actual  numeric,
  costo_promedio   numeric,
  valor_inventario numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  r      record;
  v_pid  bigint  := null;
  v_qty  numeric := 0;
  v_avg  numeric := 0;
  v_cost numeric;
begin
  for r in
    select k.producto_id as pid, k.cantidad as cant, k.costo_unitario_base as costo
    from kardex_transacciones k
    order by k.producto_id, k.fecha_efectiva, k.id
  loop
    if v_pid is distinct from r.pid then
      if v_pid is not null then
        producto_id := v_pid; cantidad_actual := v_qty; costo_promedio := round(v_avg, 4);
        valor_inventario := round(v_qty * v_avg, 2); return next;
      end if;
      v_pid := r.pid; v_qty := 0; v_avg := 0;
    end if;

    if r.cant > 0 then
      v_cost := coalesce(r.costo, v_avg);
      if v_qty + r.cant > 0 then
        v_avg := (v_qty * v_avg + r.cant * v_cost) / (v_qty + r.cant);
      end if;
      v_qty := v_qty + r.cant;
    else
      v_qty := v_qty + r.cant;  -- r.cant es negativo
    end if;
  end loop;

  if v_pid is not null then
    producto_id := v_pid; cantidad_actual := v_qty; costo_promedio := round(v_avg, 4);
    valor_inventario := round(v_qty * v_avg, 2); return next;
  end if;
end;
$$;

create or replace view public.v_valuacion_inventario
with (security_invoker = true) as
  select
    p.id            as producto_id,
    p.nombre        as producto_nombre,
    p.sku_interno,
    p.unidad_base,
    coalesce(v.cantidad_actual, 0)  as cantidad_actual,
    coalesce(v.costo_promedio, 0)   as costo_promedio,
    coalesce(v.valor_inventario, 0) as valor_inventario,
    p.precio_base
  from public.producto p
  left join public.f_valuacion_inventario() v on v.producto_id = p.id
  where p.activo;

create or replace view public.v_analitica_reorden
with (security_invoker = true) as
with ventas as (
  select
    producto_id,
    sum(case when fecha_efectiva >= current_date - 30 then -cantidad else 0 end) as vendido_30d,
    sum(case when fecha_efectiva >= current_date - 90 then -cantidad else 0 end) as vendido_90d
  from public.kardex_transacciones
  where tipo_movimiento = 'SALIDA'
  group by producto_id
)
select
  p.id           as producto_id,
  p.nombre       as producto_nombre,
  p.sku_interno,
  p.unidad_base,
  coalesce(s.stock_total, 0) as stock_actual,
  p.stock_min,
  p.punto_reorden,
  coalesce(v.vendido_30d, 0) as vendido_30d,
  coalesce(v.vendido_90d, 0) as vendido_90d,
  round(coalesce(v.vendido_30d, 0) / 30.0, 3) as velocidad_diaria,
  case when coalesce(v.vendido_30d, 0) > 0
       then round(coalesce(s.stock_total, 0) / (v.vendido_30d / 30.0), 1)
  end as dias_cobertura,
  (p.punto_reorden is not null and coalesce(s.stock_total, 0) <= p.punto_reorden) as necesita_reorden
from public.producto p
left join public.v_producto_stock s on s.producto_id = p.id
left join ventas v on v.producto_id = p.id
where p.activo;
