import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { crearEsquemaConteo } from './conteo-schema.mjs';

const db = new PGlite();
const uid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const rpc = async (accion, datos = {}, sucursal = 1) =>
  (await db.query('select public.operar_auditoria_almacen($1,$2,$3::jsonb) as resultado',
    [accion, sucursal, JSON.stringify(datos)])).rows[0].resultado;
const root = async fn => {
  await db.exec('reset role');
  try { return await fn(); }
  finally { await db.exec('set role authenticated'); }
};
async function login(id) {
  await root(() => db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(id)]));
}
async function cargarMigracion(archivo) {
  await db.exec(await readFile(new URL('../../supabase/migrations/' + archivo, import.meta.url), 'utf8'));
}
const semilla = "((clock_timestamp() at time zone 'America/La_Paz')::date::timestamp at time zone 'America/La_Paz')";
const guardar = (item, cantidad, id) => rpc('contar', {
  item_id: item.id, captura_id: item.captura_id, version_movimiento: item.version_movimiento,
  cantidad, solicitud: uid(id),
});
const movimiento = (producto, ubicacion, cantidad, tipo) => root(() => db.query(
  "insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia) values ($1,$2,$3,$4,'Movimiento QA')",
  [producto, ubicacion, cantidad, tipo],
));

try {
  await crearEsquemaConteo(db);
  await db.exec("create role service_role");
  await cargarMigracion('20261019152652_conteo_fisico_controlado.sql');
  await cargarMigracion('20261021155549_reportes_turno_almacen.sql');
  await db.exec(`
    insert into sucursal(id,nombre,tipo) values (1,'Almacén QA','fisica'), (2,'Otra sucursal QA','fisica');
    insert into ubicacion(id,sucursal_id,codigo_zona,excluye_disponible) values
      (1,1,'PB',false),(2,1,'Garaje',false),(3,2,'Otra',false),(4,1,'Virtual',true);
    insert into producto(id,nombre,unidad_base,sku_interno) values
      (1,'Tajador QA','unidad','TAJ-001'),(2,'Cero QA','unidad','CER-002'),
      (3,'Arrastrado QA','unidad','ARR-003'),(4,'Otra fecha QA','unidad','OTR-004');
    insert into presentacion(id,producto_id,nombre,factor_unidad_base) values (1,1,'Caja x10',10);
    insert into perfil(id,nombre,email,rol,sucursal_id) values
      ('${uid(1)}','Operario QA','operario@qa.invalid','operario',1),
      ('${uid(2)}','Almacenero QA','almacenero@qa.invalid','almacenero',1),
      ('${uid(3)}','Operario otra QA','otra@qa.invalid','operario',2),
      ('${uid(4)}','Caja QA','caja@qa.invalid','cajero',1);
    insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,creado_en) values
      (1,1,100,'ENTRADA','Desde medianoche',${semilla}),
      (1,2,20,'ENTRADA','Otra ubicación',${semilla}),
      (1,3,5,'ENTRADA','Otra sucursal',${semilla}),
      (1,4,3,'ENTRADA','Excluida',${semilla}),
      (4,1,1,'ENTRADA','Antes del corte',${semilla} - interval '1 second');
    insert into producto_ubicacion(producto_id,ubicacion_id) values(2,1);
    insert into reportes_almacen.plan(producto_id,ubicacion_id,frecuencia_dias,actualizado_por) values
      (4,1,365,'${uid(1)}');
    insert into reportes_almacen.turno(solicitud,sucursal_id,fecha,turno,inicio,fin,creado_por,estado)
    values ('${uid(20)}',1,(${semilla} at time zone 'America/La_Paz')::date - 1,'TARDE',
      ${semilla} - interval '10 hours',${semilla} - interval '2 hour','${uid(1)}','ENTREGADO');
    insert into reportes_almacen.linea(reporte_id,numero,producto_id,ubicacion_id,nombre,unidad,ubicacion,empaque,factor,origen,empaques,sueltas,contado_en,esperado)
    values (1,1,4,1,'Otra fecha','unidad','PB','Unidad',1,'MOVIMIENTO',0,1,${semilla} - interval '4 hours',1);
  `);
  await cargarMigracion('20261126231607_auditoria_diaria_almacen.sql');
  await db.exec(`
    insert into auditoria_almacen.jornada(sucursal_id,fecha)
    values (1,(${semilla} at time zone 'America/La_Paz')::date - 1);
    insert into auditoria_almacen.item(sucursal_id,fecha,producto_id,ubicacion_id,origen,pendiente_desde)
    values (1,(${semilla} at time zone 'America/La_Paz')::date - 1,3,1,2,
      (${semilla} at time zone 'America/La_Paz')::date - 3);
  `);

  await db.exec('set role anon');
  await assert.rejects(() => rpc('listar'), /permission denied/);
  await login(4);
  await assert.rejects(() => rpc('listar'), /no tiene acceso/);
  await login(1);
  await assert.rejects(() => rpc('listar', {}, 2), /Sucursal no disponible/);
  await assert.rejects(() => db.exec('select * from auditoria_almacen.captura'), /permission denied/);

  const jornada = await rpc('listar');
  assert.equal(jornada.resumen.total, 4);
  assert.equal(jornada.resumen.arrastrados, 1);
  assert.equal(jornada.resumen.movimientos, 2);
  assert.equal(jornada.resumen.ciclicos, 1);
  assert.equal(jornada.items[0].producto_id, 3);
  assert.equal((new Date(jornada.fecha) - new Date(jornada.items[0].pendiente_desde)) / 86400000, 3);
  assert(jornada.items.every(item => item.esperado === null));
  const tajador = jornada.items.find(i => i.producto_id === 1 && i.ubicacion_id === 1);
  const otraUbicacion = jornada.items.find(i => i.producto_id === 1 && i.ubicacion_id === 2);
  const cero = jornada.items.find(i => i.producto_id === 2);
  assert.equal(tajador.factor, 10);
  assert.equal((await rpc('listar', { busqueda: 'TAJ-001' })).items.length, 2);
  await assert.rejects(() => guardar(cero, null, 11), /cantidad válida/);
  assert.equal((await guardar(cero, 0, 11)).items[0].estado, 'VERIFICADO');
  assert.equal((await guardar(tajador, 100, 12)).items[0].estado, 'VERIFICADO');
  assert.equal((await guardar(otraUbicacion, 20, 14)).items[0].estado, 'VERIFICADO');
  const reintento = await guardar(tajador, 100, 12);
  assert.equal(reintento.items[0].captura_id, uid(12));
  await assert.rejects(() => guardar(tajador, 90, 12), /otra captura/);
  await assert.rejects(() => guardar(tajador, 90, 15), /cambió mientras/);
  await login(3);
  await assert.rejects(() => rpc('detalle', { item_id: tajador.id }, 2), /no está en la jornada/);
  await login(2);

  await movimiento(1, 1, -10, 'SALIDA');
  await movimiento(1, 1, 10, 'ENTRADA');
  const reabierto = (await rpc('detalle', { item_id: tajador.id })).items[0];
  assert.equal(reabierto.estado, 'RECONTEO');
  assert.equal(reabierto.cantidad, 100);
  assert.equal((await rpc('detalle', { item_id: otraUbicacion.id })).items[0].estado, 'VERIFICADO');
  await movimiento(1, 1, -10, 'SALIDA');
  await assert.rejects(() => guardar(reabierto, 90, 16), /cambió mientras/);
  const vigente = (await rpc('detalle', { item_id: tajador.id })).items[0];
  const diferencia = await guardar(vigente, 88, 16);
  assert.equal(diferencia.items[0].esperado, 90);
  assert.equal(diferencia.items[0].estado, 'DIFERENCIA');
  const revision = (await rpc('listar', { filtro: 'diferencias' })).items;
  assert.deepEqual(revision.map(i => i.id), [tajador.id]);
  assert.equal((await root(() => db.query('select cantidad_base from stock_actual where producto_id=1 and ubicacion_id=1'))).rows[0].cantidad_base, '90.0000');

  await root(() => db.exec(`
    insert into producto(id,nombre,unidad_base) select id,'Producto QA ' || id,'unidad' from generate_series(100,152) id;
    insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia)
    select id,1,1,'ENTRADA','Paginación QA' from generate_series(100,152) id;
  `));
  const primera = await rpc('listar');
  const segunda = await rpc('listar', { cursor: primera.siguiente });
  const ids = [...primera.items, ...segunda.items].map(i => i.id);
  assert.equal(primera.items.length, 50);
  assert.equal(ids.length, jornada.resumen.total + 53);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(segunda.siguiente, null);
  console.log('Auditoría: medianoche, arrastre, lista paginada, captura ciega, cero, idempotencia, sucursal y reconteo OK.');
} finally {
  await db.close();
}
