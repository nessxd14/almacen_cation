import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// Base en memoria: no lee .env ni admite URL de conexión externa.
const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = await fs.readFile(new URL('../../supabase/migrations/20261117004040_historial_global_paginado.sql', import.meta.url), 'utf8');
const login = async n => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [n == null ? '' : uid(n)]);
  await db.exec('set role authenticated');
};
const rpc = async ({ sucursal = 1, tipo = null, busqueda = null, limit = 50, cursor = null } = {}) =>
  (await db.query('select * from public.obtener_historial_global($1,$2,$3,$4,$5,$6)',
    [sucursal, tipo, busqueda, limit, cursor?.creado_en ?? null, cursor?.id ?? null])).rows;
const denied = error => error.code === '42501';
const invalid = error => error.code === '22023';

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    revoke all on function auth.uid() from anon, public;
    grant execute on function auth.uid() to authenticated, service_role;
    grant usage on schema auth to authenticated, service_role;
    create type public.tipo_movimiento as enum ('INV_INICIAL','ENTRADA','SALIDA','AJUSTE','TRASLADO');
    create table perfil(id uuid primary key, activo boolean, sucursal_id bigint);
    create table producto(id bigint primary key, nombre varchar, sku_interno varchar, marca varchar, imagen_url varchar, unidad_base varchar);
    create table ubicacion(id bigint primary key, sucursal_id bigint, codigo_zona varchar, estante varchar, nivel varchar, compartimiento varchar, excluye_disponible boolean);
    create table presentacion(id bigint primary key, nombre varchar);
    create table kardex_transacciones(
      id bigint primary key, producto_id bigint not null references producto,
      ubicacion_id bigint not null references ubicacion, presentacion_id bigint references presentacion,
      cantidad numeric not null, tipo_movimiento public.tipo_movimiento not null,
      cantidad_origen numeric, factor_a_base_snap numeric, referencia varchar, motivo varchar,
      creado_por varchar, fecha_efectiva date, creado_en timestamptz not null, traslado_grupo_id bigint
    );
    create table stock_actual(producto_id bigint, ubicacion_id bigint, cantidad_base numeric, primary key(producto_id,ubicacion_id));
    create index idx_kardex_prod_ubic on kardex_transacciones(producto_id,ubicacion_id);
    create index idx_kardex_reporte_hora on kardex_transacciones(creado_en,producto_id,ubicacion_id);
    create index idx_kardex_tipo_fecha on kardex_transacciones(tipo_movimiento,fecha_efectiva);
    grant usage on schema public to authenticated, service_role;
    grant select on all tables in schema public to authenticated, service_role;
    alter table perfil enable row level security;
    create policy propio on perfil for select to authenticated using (id = auth.uid());
    insert into perfil values ('${uid(1)}',true,1),('${uid(2)}',true,2),('${uid(3)}',true,null),('${uid(4)}',false,1);
    insert into producto values (1,'Bolígrafos QA','BOL-01','Marca QA',null,'unidad'),
      (2,'Cuaderno 100%_QA','CUA-02','Otra',null,'unidad'),(3,'Fondo QA','FON-03','Otra',null,'unidad');
    insert into ubicacion values (1,1,'PB','A','1',null,false),(2,1,'PA','B','2','3',false),
      (3,1,'VTD','V','1',null,true),(4,2,'OTRA','C','1',null,false);
    insert into stock_actual values (1,1,105),(1,2,40),(1,3,900),(1,4,500),(2,1,7);
    insert into kardex_transacciones(id,producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,creado_en,fecha_efectiva) values
      (1,1,1,100,'INV_INICIAL','Antes del período','2026-11-01 10:00Z','2026-11-01'),
      (2,1,1,-10,'SALIDA','Venta #100','2026-11-16 12:00Z','2026-11-16'),
      (3,1,1,-5,'AJUSTE','Ajuste sin presentación','2026-11-16 12:00Z','2026-11-16'),
      (4,1,1,20,'ENTRADA','Fecha efectiva anterior','2026-11-16 13:00Z','2026-10-01'),
      (5,1,2,40,'ENTRADA','Otra ubicación','2026-11-16 14:00Z','2026-11-16'),
      (6,1,3,900,'ENTRADA','Ubicación excluida','2026-11-16 15:00Z','2026-11-16'),
      (7,1,4,500,'ENTRADA','Otra sucursal','2026-11-16 16:00Z','2026-11-16'),
      (8,2,1,7,'ENTRADA','Documento 100%_QA','2026-10-01 10:00Z','2026-10-01');
    insert into kardex_transacciones(id,producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,creado_en)
      select 100+n,3,1,1,'ENTRADA','Fondo '||n,
        '2026-11-10 10:00Z'::timestamptz + ((n/3)||' seconds')::interval from generate_series(1,1105) n;
    analyze;
  `);
  await db.exec(await fs.readFile(new URL('../migrations/2026-07-09_fix_saldo_kardex_movimientos.sql', import.meta.url), 'utf8'));
  await db.exec('grant select on v_kardex_movimientos to authenticated, service_role');

  // El ensayo debe terminar con excepción y deshacer la función creada.
  const ensayo = await fs.readFile(new URL('../../supabase/ensayos/20261117004040_historial_global_paginado_ENSAYO.sql', import.meta.url), 'utf8');
  await assert.rejects(() => db.exec(ensayo), /ENSAYO OK/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regprocedure('public.obtener_historial_global(bigint,text,text,integer,timestamptz,bigint)') as f")).rows[0].f, null);
  await db.exec(migration);

  await login(1);
  const snapshot = await db.query('select * from stock_actual order by producto_id,ubicacion_id');
  const salidas = await rpc({ tipo: 'SALIDA', limit: 1 });
  assert.deepEqual(salidas.map(r => [r.id, Number(r.saldo_base)]), [[2, 90]]);
  assert.equal(Number(salidas[0].stock_disponible_actual), 145, 'Stock vigente suma ubicaciones disponibles de la misma sucursal');
  const ajustes = await rpc({ tipo: 'AJUSTE' });
  assert.equal(Number(ajustes[0].saldo_base), 85, 'Incluye salida anterior en empate de fecha e id, y ajuste sin presentación');
  const retroactivo = await rpc({ busqueda: 'fecha efectiva anterior' });
  assert.equal(Number(retroactivo[0].saldo_base), 105, 'El saldo se ordena por registro, no fecha efectiva');
  assert.equal((await rpc({ busqueda: '  BOL-01  ' })).length, 6);
  assert.equal((await rpc({ busqueda: 'marca qa' })).length, 6);
  assert.deepEqual((await rpc({ busqueda: '100%_QA' })).map(r => r.id), [8], 'Busca más allá de 500 y trata % y _ literalmente');
  assert.equal((await rpc({ busqueda: 'no-existe' })).length, 0);

  const expected = (await db.query(`select v.id,v.saldo_base from v_kardex_movimientos v
    join ubicacion u on u.id=v.ubicacion_id where u.sucursal_id=1 order by v.creado_en desc,v.id desc`)).rows;
  let cursor = null;
  const actual = [];
  do {
    const page = await rpc({ limit: 200, cursor });
    actual.push(...page.map(r => ({ id: r.id, saldo_base: r.saldo_base })));
    cursor = page.length === 200 ? page.at(-1) : null;
  } while (cursor);
  assert.equal(actual.length, 1112, 'Pagina más de 1000 filas sin truncar');
  assert.deepEqual(actual, expected, 'Todos los saldos coinciden con la vista, con empates, tipos y ubicaciones');
  const primera = await rpc({ limit: 2 });
  await db.exec('reset role');
  await db.exec("insert into kardex_transacciones(id,producto_id,ubicacion_id,cantidad,tipo_movimiento,creado_en) values(99999,2,1,1,'ENTRADA','2026-11-17 01:00Z')");
  await login(1);
  const segunda = await rpc({ limit: 2, cursor: primera.at(-1) });
  assert.deepEqual([...primera,...segunda].map(r => r.id), expected.slice(0,4).map(r => r.id), 'Una inserción reciente no desplaza ni duplica la página siguiente');
  assert.deepEqual(await db.query('select * from stock_actual order by producto_id,ubicacion_id'), snapshot, 'La lectura no escribe stock');

  await assert.rejects(() => rpc({ sucursal: 2 }), denied);
  await assert.rejects(() => rpc({ sucursal: null }), invalid);
  await assert.rejects(() => rpc({ limit: null }), invalid);
  await assert.rejects(() => rpc({ limit: 201 }), invalid);
  await assert.rejects(() => rpc({ cursor: { id: 2 } }), invalid);
  await assert.rejects(() => rpc({ cursor: { creado_en: '2026-11-16T12:00Z' } }), invalid);
  await assert.rejects(() => rpc({ tipo: 'INVALIDO' }), error => error.code === '22P02');
  await login(2);
  assert.deepEqual((await rpc({ sucursal: 2 })).map(r => r.id), [7]);
  await login(3);
  assert.equal((await rpc({ sucursal: 2 })).length, 1, 'Perfil sin sucursal puede elegir');
  await login(4); await assert.rejects(() => rpc(), denied);
  await login(5); await assert.rejects(() => rpc(), denied);
  await login(null); await assert.rejects(() => rpc(), denied);
  await db.exec('reset role; set role anon'); await assert.rejects(() => rpc(), denied);
  await db.exec('reset role; set role service_role');
  assert.equal((await rpc({ sucursal: 2 })).length, 1);
  await db.exec('reset role');
  assert.equal((await db.query("select prosecdef from pg_proc where oid='public.obtener_historial_global(bigint,text,text,integer,timestamptz,bigint)'::regprocedure")).rows[0].prosecdef, false);
  await db.exec('revoke select on kardex_transacciones from authenticated');
  await login(1); await assert.rejects(() => rpc(), denied, 'INVOKER no amplía privilegios de tablas');
  await db.exec(`reset role; grant select on kardex_transacciones to authenticated;
    alter table kardex_transacciones enable row level security;
    create policy lectura_qa on kardex_transacciones for select to authenticated using (producto_id <> 2);`);
  await login(1);
  assert.equal((await rpc({ busqueda: '100%_QA' })).length, 0, 'INVOKER conserva también RLS');
  await db.exec('reset role; alter table kardex_transacciones disable row level security');

  // Comparación de planes con el mismo tamaño de página y poca memoria.
  // Muchos pares ajenos a la página fuerzan la ordenación global de la vista.
  await db.exec(`insert into producto(id,nombre,sku_interno,unidad_base)
      select 100+n,'Producto de fondo '||n,'F-'||n,'unidad' from generate_series(1,400) n;
    insert into kardex_transacciones(id,producto_id,ubicacion_id,cantidad,tipo_movimiento,creado_en)
      select 100000+n,101+(n%400),1,1,'ENTRADA','2026-09-01'::timestamptz + (n||' seconds')::interval
      from generate_series(1,20000) n;
    analyze; set work_mem='64kB';`);
  await login(1);
  const ids = (await rpc({ limit: 50 })).map(r => r.id);
  const oldPlan = (await db.query('explain (analyze,buffers,format json) select * from v_kardex_movimientos where id=any($1::bigint[])', [ids])).rows[0]['QUERY PLAN'][0];
  const newPlan = (await db.query('explain (analyze,buffers,format json) select * from public.obtener_historial_global(1,null,null,50)')).rows[0]['QUERY PLAN'][0];
  assert(oldPlan.Plan['Temp Written Blocks'] > 0, 'La referencia derrama temporales en el escenario de control');
  assert.equal(newPlan.Plan['Temp Written Blocks'], 0, 'La RPC evita la ordenación global y los temporales');
  console.log(JSON.stringify({ comparacion_local: {
    filas_kardex: 21114, pagina: 50, work_mem: '64kB',
    anterior: { ms: oldPlan['Execution Time'], temporales_escritos: oldPlan.Plan['Temp Written Blocks'], temporales_leidos: oldPlan.Plan['Temp Read Blocks'] },
    nueva: { ms: newPlan['Execution Time'], temporales_escritos: newPlan.Plan['Temp Written Blocks'], temporales_leidos: newPlan.Plan['Temp Read Blocks'] },
  } }));
  console.log('OK: equivalencia de saldos, búsqueda, cursor, >1000 filas, sucursal, permisos, ensayo reversible y temporales.');
} finally {
  await db.close();
}
