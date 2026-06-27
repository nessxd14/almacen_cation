-- ─────────────────────────────────────────────────────────────────────────
-- GO-LIVE de Auth: cierra el acceso anónimo. NO aplicada todavía.
-- Aplicar SOLO cuando el frontend con login esté desplegado y verificado,
-- porque a partir de aquí la app exige sesión para leer/escribir.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'identificador','producto_atributo','atributo','kardex_transacciones',
    'atributo_valor','conteo_fisico_inicial','conciliacion_linea','presentacion',
    'familia','sesion_conteo','stock_actual','producto','producto_ubicacion','ubicacion'
  ] loop
    execute format('drop policy if exists dev_anon_all on public.%I', t);
  end loop;
end $$;
