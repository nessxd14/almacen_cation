begin;
set local lock_timeout = '5s';
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
alter function public.recalcular_stock_actual() set search_path to pg_catalog, public, pg_temp;
revoke all on function public.recalcular_stock_actual() from anon, public, authenticated;
grant execute on function public.recalcular_stock_actual() to service_role;

do $ensayo$
declare
  lectura boolean;
  escritura boolean;
  recalculo boolean;
  trigger_privilegiado boolean;
  servicio_recalcula boolean;
begin
  lectura := has_table_privilege('authenticated', 'public.stock_actual', 'SELECT');
  escritura := has_table_privilege('authenticated', 'public.stock_actual', 'INSERT, UPDATE, DELETE, TRUNCATE')
    or has_any_column_privilege('authenticated', 'public.stock_actual', 'INSERT, UPDATE')
    or has_table_privilege('anon', 'public.stock_actual', 'INSERT, UPDATE, DELETE, TRUNCATE')
    or has_any_column_privilege('anon', 'public.stock_actual', 'INSERT, UPDATE');
  recalculo := has_function_privilege('authenticated', 'public.recalcular_stock_actual()', 'EXECUTE')
    or has_function_privilege('anon', 'public.recalcular_stock_actual()', 'EXECUTE');
  servicio_recalcula := has_function_privilege('service_role', 'public.recalcular_stock_actual()', 'EXECUTE');
  select p.prosecdef and 'search_path=""' = any(p.proconfig)
    into trigger_privilegiado
    from pg_proc p
    join pg_trigger t on t.tgfoid = p.oid
    where p.oid = 'public.trg_stock_desde_kardex()'::regprocedure
      and t.tgrelid = 'public.kardex_transacciones'::regclass
      and t.tgname = 'kardex_mantiene_stock' and t.tgenabled in ('O', 'A');

  if lectura is not true or escritura or recalculo or trigger_privilegiado is not true or not servicio_recalcula then
    raise exception 'ENSAYO FALLÓ. Lectura=%, escritura directa=%, recálculo cliente=%, trigger activo y privilegiado=%, recálculo servidor=%',
      lectura, escritura, recalculo, trigger_privilegiado, servicio_recalcula;
  end if;
  raise exception 'ENSAYO OK. Lectura=%, escritura directa=%, recálculo cliente=%, trigger activo y privilegiado=%, recálculo servidor=%',
    lectura, escritura, recalculo, trigger_privilegiado, servicio_recalcula;
end
$ensayo$;

rollback;
