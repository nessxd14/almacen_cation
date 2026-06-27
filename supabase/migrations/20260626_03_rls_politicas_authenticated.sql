-- ─────────────────────────────────────────────────────────────────────────
-- Políticas para el rol `authenticated`: misma superficie que dev_anon_all
-- pero exigiendo sesión válida. ADITIVAS: dev_anon_all sigue activa hasta que
-- se aplique 20260626_04_rls_cerrar_anon.sql tras desplegar el login en prod.
-- Aplicado en Supabase Cloud el 2026-06-26.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'identificador','producto_atributo','atributo','kardex_transacciones',
    'atributo_valor','conteo_fisico_inicial','conciliacion_linea','presentacion',
    'familia','sesion_conteo','stock_actual','producto','producto_ubicacion','ubicacion'
  ] loop
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format(
      'create policy auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
