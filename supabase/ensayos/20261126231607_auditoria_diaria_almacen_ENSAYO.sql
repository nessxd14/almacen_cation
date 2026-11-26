-- Ensayo de dependencias para 20261126231607_auditoria_diaria_almacen.
-- Ejecutar en una sesión antes de la migración y revisar el mensaje de excepción.
begin;
do $$
declare
  v_preexistente text := to_regnamespace('auditoria_almacen')::text;
  v_candidatos text := to_regprocedure('reportes_almacen.candidatos(bigint,timestamp with time zone,timestamp with time zone)')::text;
  v_candado boolean;
  v_sucursales integer;
  v_dia date := (clock_timestamp() at time zone 'America/La_Paz')::date;
begin
  select exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'public.kardex_transacciones'::regclass
      and t.tgname = 'conteo_proteger_kardex' and t.tgenabled in ('O','A')
      and n.nspname = 'inventario_control' and p.proname = 'proteger_movimiento'
      and pg_get_functiondef(p.oid) ilike '%for update%'
  ) into v_candado;
  select count(*) into v_sucursales from public.sucursal where activo and tipo <> 'virtual';
  raise exception 'Ensayo auditoría: esquema existente=%, candidatos=%, candado kardex=%, sucursales físicas=%, inicio=%, corte siguiente=%',
    coalesce(v_preexistente, 'ninguno'), coalesce(v_candidatos, 'falta'),
    v_candado, v_sucursales, v_dia::timestamp at time zone 'America/La_Paz',
    (v_dia + 1)::timestamp at time zone 'America/La_Paz';
end;
$$;
rollback;
