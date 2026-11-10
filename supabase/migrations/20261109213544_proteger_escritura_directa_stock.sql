-- Impide modificar stock_actual desde la API de tablas.
-- Requiere 20261019152652_conteo_fisico_controlado (ya aplicada en Almacén).
-- Aplicada desde el SQL Editor de Almacén y registrada en el historial de Supabase.

-- Los RPC que escriben Kardex con SECURITY INVOKER siguen actualizando el saldo
-- mediante este trigger. El cuerpo existente usa nombres calificados.
alter function public.trg_stock_desde_kardex() security definer;
alter function public.trg_stock_desde_kardex() set search_path to '';
revoke all on function public.trg_stock_desde_kardex() from anon, public, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.stock_actual from anon, public, authenticated;
grant select on table public.stock_actual to authenticated;
alter table public.stock_actual enable row level security;

drop policy if exists auth_all on public.stock_actual;
create policy stock_actual_lectura on public.stock_actual
  for select to authenticated using (true);

-- El recálculo total queda reservado al mantenimiento desde el servidor.
alter function public.recalcular_stock_actual() set search_path to pg_catalog, public, pg_temp;
revoke all on function public.recalcular_stock_actual() from anon, public, authenticated;
grant execute on function public.recalcular_stock_actual() to service_role;
