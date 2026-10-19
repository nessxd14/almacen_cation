-- pg_net es asíncrono: dar tiempo al envío del álbum no bloquea la venta.
-- Evita cerrar la conexión al worker un segundo después de despertarlo.
do $$ declare definicion text;
begin
  definicion:=pg_get_functiondef('evidencia_vtd.invocar(text)'::regprocedure);
  if strpos(definicion,'then 20000 else 1000 end')=0 then raise exception 'Revisar el tiempo de espera del worker antes de continuar.'; end if;
  execute replace(definicion,'then 20000 else 1000 end','then 20000 else 120000 end');
end $$;
