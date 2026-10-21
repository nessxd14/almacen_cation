import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { crearEsquemaConteo } from './conteo-schema.mjs';

// PostgreSQL en memoria; sin credenciales ni conexión a la base del negocio.
const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let serial = 100;
const nextUuid = () => uid(++serial);
const device = uid(90);
let user = 1;
const asRoot = async fn => { await db.exec('reset role'); try { return await fn(); } finally { await db.exec('set role authenticated'); } };
const login = async n => { user=n; await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]); await db.exec('set role authenticated'); };
const rpc = async (action,id=null,data={}) => (await db.query('select public.operar_conteo($1,$2,$3::jsonb) r',[action,id,JSON.stringify(data)])).rows[0].r;
const capture = async (s,pres,q,description=null) => {
  const id=nextUuid(),photo=`sesion_${s}/${id}.jpg`;
  await asRoot(()=>db.query("insert into storage.objects(bucket_id,name,owner_id) values('conteos_controlados',$1,$2)",[photo,uid(user)]));
  const data={uuid:id,dispositivo:device,presentacion_id:pres,cantidad:q,foto_ref:photo,descripcion:description};
  return {id,data,result:await rpc('capturar',s,data)};
};
const create = async (extra={}) => rpc('crear',null,{solicitud:nextUuid(),nombre:'QA Conteo',ubicacion_id:1,tipo:'VERIFICACION',metodo:'SIMPLE',alcance:'PARCIAL',producto_ids:[1],...extra});
const take = (s,n=1) => rpc('tomar_ronda',s,{ronda:n,dispositivo:device});
const finish = async s => {
  const d=await rpc('detalle',s);
  return rpc('finalizar_ronda',s,{dispositivo:device,confirmo_sin_pendientes:true,capturas:d.capturas.filter(c=>!c.anulada).map(c=>c.uuid)});
};
const approve = async (s,qty,p=1) => {
  const d=await rpc('detalle',s);
  return rpc('resolver',s,{version:d.sesion.version,producto_id:p,cantidad_base:qty,motivo:'QA reconteo físico confirmado',reconteo_confirmado:true});
};
const apply = async s => {const d=await rpc('detalle',s);return rpc('aplicar',s,{version:d.sesion.version});};
const stock = async (p=1,u=1) => asRoot(async()=>Number((await db.query('select cantidad_base from stock_actual where producto_id=$1 and ubicacion_id=$2',[p,u])).rows[0]?.cantidad_base??0));
try {
  await crearEsquemaConteo(db);
  await db.exec(`
    insert into sucursal(id,nombre,tipo) values(1,'Almacén QA','fisica'),(2,'Tienda QA','fisica');
    insert into ubicacion(id,sucursal_id,codigo_zona) values(1,1,'QA-U1'),(2,1,'QA-U2'),(3,2,'QA-U3');
    insert into producto(id,nombre,unidad_base) values(1,'Bolígrafos QA','unidad'),(2,'Cuadernos QA','unidad');
    insert into presentacion(id,producto_id,nombre,factor_unidad_base,es_base) values(1,1,'Unidad',1,true),(2,1,'Caja x12',12,false),(3,2,'Unidad',1,true);
    insert into producto_sucursal(producto_id,sucursal_id,se_vende,control_stock) values(1,1,true,'LIBRE');
  `);
  for(const [n,role,branch] of [[1,'operario',1],[2,'almacenero',1],[3,'admin',null],[4,'cajero',1],[5,'operario',2],[6,'operario',1]]) {
    await db.query('insert into perfil(id,nombre,email,rol,sucursal_id) values($1,$2,$3,$4,$5)',[uid(n),`Persona QA ${n}`,`persona${n}@qa.invalid`,role,branch]);
  }
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261019152652_conteo_fisico_controlado.sql',import.meta.url),'utf8'));
  await login(1);
  let d=await create(),s=d.sesion.id;
  assert.equal(d.productos[0].teorico,null,'El esperado no se filtra al contador');
  await assert.rejects(()=>create(),/Ya hay un conteo/);
  await assert.rejects(()=>db.query("select * from inventario_control.producto"),/permission denied/);
  await assert.rejects(()=>db.query("update sesion_conteo set nombre='alterado' where id=$1",[s]),/operaciones autorizadas/);
  await take(s);
  const first=await capture(s,2,2); await capture(s,1,3);
  const retry=await rpc('capturar',s,first.data);
  assert.equal(retry.capturas.length,2,'Reintento no duplica la captura');
  await assert.rejects(()=>rpc('capturar',s,{...first.data,cantidad:9}),/otro contenido/);
  await assert.rejects(()=>rpc('finalizar_ronda',s,{dispositivo:device,confirmo_sin_pendientes:true,capturas:[first.id]}),/no coinciden/);
  await assert.rejects(()=>db.exec("insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento) values(1,1,2,'ENTRADA')"),/Ubicación en conteo/);
  await assert.rejects(()=>db.exec('insert into stock_actual(producto_id,ubicacion_id,cantidad_base) values(1,1,100)'),/Ubicación en conteo/);
  await assert.rejects(()=>db.exec('truncate stock_actual'),/Hay ubicaciones en conteo/);
  d=await finish(s);assert.equal(d.sesion.estado,'REVISION');
  await assert.rejects(()=>capture(s,1,5),/ronda ya está cerrada/);
  await assert.rejects(()=>apply(s),/Solo supervisión/);
  await login(3);d=await rpc('detalle',s);
  assert.equal(Number(d.productos[0].conteo_1),27,'Cajas y unidades se suman en base');
  await assert.rejects(()=>apply(s),/pendientes de aprobar/);
  await assert.rejects(()=>rpc('resolver',s,{version:d.sesion.version,producto_id:1,cantidad_base:27,motivo:'Falta reconteo'}),/Confirma el reconteo/);
  await approve(s,27);d=await apply(s);
  assert.equal(d.sesion.estado,'APLICADA');assert.equal(await stock(),27);
  await apply(s);assert.equal(await stock(),27,'Reintento de aplicar no duplica ajuste');
  let trace=await asRoot(()=>db.query('select origen_conciliacion_id,origen_sesion_id from kardex_transacciones where origen_sesion_id=$1',[s]));
  assert.ok(trace.rows[0].origen_conciliacion_id);assert.equal(trace.rows[0].origen_sesion_id,s);
  await assert.rejects(()=>db.exec('update conciliacion_linea set cantidad_conciliada=99'),/operaciones autorizadas/);
  await login(2);assert.equal((await db.query('select * from conciliacion_linea where sesion_id=$1',[s])).rows.length,0,'El espejo no filtra cantidades por la API de tablas');
  await login(5);assert.equal((await db.query('select * from sesion_conteo where id=$1',[s])).rows.length,0,'El espejo respeta la sucursal');
  console.log('OK: presentaciones, revisión, corte, permisos, idempotencia y trazabilidad');

  await login(1);d=await create({metodo:'DOBLE_CIEGO'});s=d.sesion.id;await take(s);await capture(s,2,2);await capture(s,1,3);
  await assert.rejects(()=>take(s,2),/otra ronda/);
  d=await finish(s);assert.equal(d.sesion.estado,'CAPTURA');
  await login(3);assert.equal((await rpc('detalle',s)).productos[0].conteo_1,null,'Ni supervisión ve resultados durante captura');
  await assert.rejects(()=>apply(s),/Termina las rondas/);
  await login(2);await take(s,2);d=await rpc('detalle',s);assert.equal(d.capturas.length,0,'Segunda persona no ve las capturas ajenas');
  await capture(s,1,27);d=await finish(s);assert.equal(d.sesion.estado,'REVISION');
  await login(3);d=await rpc('detalle',s);assert.equal(Number(d.productos[0].conteo_2),27,'Rondas con presentaciones diferentes comparables');
  await approve(s,27);const before=await asRoot(()=>db.query('select count(*) n from kardex_transacciones'));
  await apply(s);const after=await asRoot(()=>db.query('select count(*) n from kardex_transacciones'));assert.equal(before.rows[0].n,after.rows[0].n,'Delta cero no inventa movimiento');
  const verification=await rpc('ultimo',null,{sucursal_id:1,producto_id:1});assert.equal(verification.sesion_id,s,'Verificación sin ajuste aparece en ficha');
  console.log('OK: doble ciego real, distinta presentación y verificación sin ajuste');

  await login(1);d=await create({producto_ids:[1,2]});s=d.sesion.id;await take(s);await capture(s,1,0);
  await assert.rejects(()=>finish(s),/Faltan productos/);
  await capture(s,3,0);await finish(s);
  await login(3);await approve(s,0);await approve(s,0,2);await apply(s);assert.equal(await stock(),0,'Cero observado se aplica');
  await login(1);d=await create();s=d.sesion.id;await take(s);
  const unknown=await capture(s,null,4,'Artículo QA sin catálogo');await assert.rejects(()=>finish(s),/sin catálogo/);
  await login(3);await rpc('catalogar',s,{uuid:unknown.id,presentacion_id:1});
  await login(1);await finish(s);await login(3);await approve(s,4);await apply(s);
  console.log('OK: ausencia distinta de cero y artículos sin catálogo');

  await login(1);d=await create();s=d.sesion.id;await take(s);
  const bad=await capture(s,1,8);await rpc('anular_captura',s,{uuid:bad.id,dispositivo:device,motivo:'Cantidad digitada incorrecta'});await capture(s,1,4);await finish(s);
  await login(3);await approve(s,4);
  const stale=(await rpc('detalle',s)).sesion.version;await approve(s,4);
  await assert.rejects(()=>rpc('aplicar',s,{version:stale}),/actualiza/);
  // Simula daño externo que el servidor detecta aunque coincidiera el saldo.
  await asRoot(()=>db.query('update inventario_control.producto set ultimo_movimiento=-1 where sesion_id=$1',[s]));
  await assert.rejects(()=>apply(s),/Hubo movimientos/);
  await rpc('cancelar',s,{motivo:'Repetir conteo por corte alterado'});
  await db.exec("insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia) values(1,1,1,'ENTRADA','QA entrada')");
  assert.equal(await stock(),5,'Cancelar libera la ubicación sin ajustar existencias');
  console.log('OK: corrección auditada, versión, corte alterado y cancelación');

  await login(4);await assert.rejects(()=>create(),/No autorizado/);
  await login(5);await assert.rejects(()=>create(),/Sucursal no autorizada/);
  await login(3);
  await assert.rejects(()=>db.query('select conciliar_sesion(1)'),/sesiones anteriores|permission denied/);
  await assert.rejects(()=>db.query('select inyectar_conciliacion_sesion(1)'),/Conteo controlado|permission denied/);
  await assert.rejects(()=>db.query('select marcar_inventariado(1,1)'),/permission denied/);
  await db.exec('set role anon');await assert.rejects(()=>rpc('listar',null,{sucursal_id:1}),/permission denied/);
  await login(1);d=await create();s=d.sesion.id;await take(s);
  const photo=`sesion_${s}/${nextUuid()}.jpg`;
  await db.query("insert into storage.objects values('conteos_controlados',$1,$2)",[photo,uid(1)]);
  await login(2);assert.equal((await db.query('select * from storage.objects where name=$1',[photo])).rows.length,0,'Las fotos también respetan el ciego');
  await login(1);assert.equal((await db.query('select * from storage.objects where name=$1',[photo])).rows.length,1);
  assert.equal((await db.query('update storage.objects set owner_id=$1 where name=$2 returning *',[uid(2),photo])).rows.length,0,'Foto inmutable');
  await rpc('cancelar',s,{motivo:'Fin prueba de permisos'});
  console.log('OK: roles, sucursales, fotos privadas y cierre de APIs anteriores');

  await asRoot(()=>db.exec("insert into stock_actual(producto_id,ubicacion_id,cantidad_base) values(1,2,3);update producto_sucursal set control_stock='LIBRE' where producto_id=1"));
  d=await create();s=d.sesion.id;await take(s);await capture(s,1,5);await finish(s);await login(3);await approve(s,5);await apply(s);
  assert.equal((await asRoot(()=>db.query('select control_stock from producto_sucursal where producto_id=1 and sucursal_id=1'))).rows[0].control_stock,'LIBRE','Una ubicación no valida toda la sucursal');
  await login(1);d=await create({ubicacion_id:2});s=d.sesion.id;await take(s);await capture(s,1,3);await finish(s);await login(3);await approve(s,3);
  await db.exec('begin'); await apply(s); await db.exec('savepoint operacion_obsoleta');
  await assert.rejects(()=>db.exec("insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia) values(1,2,-3,'SALIDA','QA validación anterior')"),/saldo cambió/);
  await db.exec('rollback to savepoint operacion_obsoleta;commit');
  assert.equal((await asRoot(()=>db.query('select control_stock from producto_sucursal where producto_id=1 and sucursal_id=1'))).rows[0].control_stock,'ESTRICTO');
  console.log('OK: control estricto sólo después de aplicar y cubrir las ubicaciones');
  console.log('OK: una transacción que cruza la aplicación debe volver a leer disponibilidad');
  await login(1);d=await create({alcance:'UBICACION'});s=d.sesion.id;await take(s);await capture(s,1,5);await capture(s,3,2);
  await finish(s);await login(3);d=await rpc('detalle',s);assert.equal(d.productos.length,2,'Ubicación completa incorpora productos descubiertos');
  await approve(s,5);await approve(s,2,2);await apply(s);assert.equal(await stock(2),2);
  console.log('OK: alcance completo con productos descubiertos durante el recorrido');
} catch(e) {
  console.error(JSON.stringify({message:e.message,code:e.code,where:e.where,position:e.position,internalPosition:e.internalPosition,internalQuery:e.internalQuery,context:e.query?.slice(Math.max(0,Number(e.position)-150),Number(e.position)+150)},null,2));process.exitCode=1;
} finally {await db.close();}
