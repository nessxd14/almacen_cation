import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { crearEsquemaConteo } from './conteo-schema.mjs';

const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const rpc = async (a,id=null,d={}) => (await db.query('select public.operar_reporte_almacen($1,$2,$3::jsonb) r',[a,id,JSON.stringify(d)])).rows[0].r;
const login = async n => {await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);await db.exec('set role authenticated');};
const root = async fn => {await db.exec('reset role');try{return await fn();}finally{await db.exec('set role authenticated');}};
const fecha = '2026-10-19';
const momento = hora => `${fecha}T${hora}:00-04:00`;
try {
  await crearEsquemaConteo(db);
  await db.exec(`insert into sucursal(id,nombre,tipo) values(1,'Almacén QA','fisica'),(2,'Otra QA','fisica');
    insert into ubicacion(id,sucursal_id,codigo_zona) values(1,1,'PB'),(2,2,'OTRA');
    insert into producto(id,nombre,unidad_base) values(1,'Bolígrafos QA','unidad'),(2,'Cuadernos QA','unidad');
    insert into presentacion(id,producto_id,nombre,factor_unidad_base,es_base) values(1,1,'Caja x12',12,false),(2,2,'Unidad',1,true);
    insert into producto_ubicacion(producto_id,ubicacion_id) values(1,1),(2,1);
    create schema inventario_control;
    create table inventario_control.sesion(id bigint, sucursal_id bigint, ubicacion_id bigint, estado text,cerrada_en timestamptz);
    create table inventario_control.producto(sesion_id bigint, producto_id bigint);
    insert into perfil(id,nombre,email,rol,sucursal_id) values
      ('${uid(1)}','Cuenta QA','a@qa.invalid','almacenero',1),('${uid(2)}','Recibe QA','b@qa.invalid','operario',1),
      ('${uid(3)}','Admin QA','c@qa.invalid','admin',null),('${uid(4)}','Otra QA','d@qa.invalid','operario',2),
      ('${uid(5)}','Caja QA','e@qa.invalid','cajero',1);
    insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,creado_en)
      values(1,1,120,'ENTRADA','Inicial QA','${fecha}T07:00:00-04:00'),
      (1,1,-13,'SALIDA','Despacho QA','${fecha}T10:00:00-04:00'),
      (1,1,-4,'SALIDA','Después del conteo QA','${fecha}T12:20:00-04:00'),
      (1,1,10,'ENTRADA','Fuera de turno QA','${fecha}T13:00:00-04:00');`);
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261021155549_reportes_turno_almacen.sql',import.meta.url),'utf8'));
  await login(1);
  let d=await rpc('crear',null,{sucursal_id:1,fecha,turno:'MANANA',solicitud:uid(20)});
  const id=d.reporte.id;
  assert.equal(d.lineas.length,2,'Movimiento y producto sin movimiento incluidos');
  assert(d.lineas.every(l=>l.esperado===null),'No filtrar esperado al capturar');
  assert.equal(d.lineas[0].numero,1);
  const retry=await rpc('crear',null,{sucursal_id:1,fecha,turno:'MANANA',solicitud:uid(20)});
  assert.equal(retry.reporte.version,d.reporte.version,'Reintento de creación conserva folio, alcance y versión');
  await root(()=>db.exec("insert into producto(id,nombre,unidad_base) values(3,'Pegamento QA','unidad');insert into producto_ubicacion(producto_id,ubicacion_id) values(3,1)"));
  d=await rpc('actualizar_alcance',id,{version:d.reporte.version});
  assert.equal(d.lineas.length,2,'Actualizar alcance no asigna nuevos bloques cíclicos');
  await assert.rejects(()=>db.exec('select * from reportes_almacen.linea'),/permission denied/);
  await assert.rejects(()=>rpc('guardar',id,{version:0,lineas:[]}),/cambió/);
  await assert.rejects(()=>rpc('guardar',id,{version:d.reporte.version,lineas:[{id:d.lineas[0].id,empaques:0,sueltas:null,contado_en:momento('12:00')}]}),/Completa empaque/);
  const bol=d.lineas.find(l=>l.producto_id===1),cuad=d.lineas.find(l=>l.producto_id===2);
  d=await rpc('guardar',id,{version:d.reporte.version,observacion:'Verificar faltante de bolígrafos.',lineas:[
    {id:bol.id,empaques:8,sueltas:9,contado_en:momento('12:00'),observacion:'Hoja revisada'},
    {id:cuad.id,empaques:0,sueltas:0,contado_en:momento('12:01'),observacion:''}]});
  assert.equal(Number(d.lineas.find(l=>l.id===cuad.id).declarado),0,'Cero explícito');
  d=await rpc('comparar',id,{version:d.reporte.version});
  assert.equal(d.reporte.estado,'REVISION','Permite revisar diferencias antes de redactar la entrega');
  await root(()=>db.exec(`insert into kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,creado_en) values(3,1,1,'ENTRADA','Nuevo movimiento QA','${fecha}T11:00:00-04:00')`));
  await assert.rejects(()=>rpc('entregar',id,{version:d.reporte.version}),/nuevos ítems con movimiento/);
  d=await rpc('reabrir',id,{version:d.reporte.version,observacion:'Completar ítem movido durante el recorrido.'});
  d=await rpc('actualizar_alcance',id,{version:d.reporte.version});
  assert.equal(d.lineas.length,3);assert.equal(d.lineas.find(l=>l.id===bol.id).numero,bol.numero,'Se conservan números impresos');
  const peg=d.lineas.find(l=>l.producto_id===3);
  d=await rpc('guardar',id,{version:d.reporte.version,observacion:'Verificar faltante de bolígrafos.',lineas:[{id:peg.id,empaques:0,sueltas:1,contado_en:momento('12:01')}]});
  d=await rpc('comparar',id,{version:d.reporte.version});
  d=await rpc('entregar',id,{version:d.reporte.version});
  assert.equal(d.reporte.estado,'ENTREGADO');
  const b=d.lineas.find(l=>l.id===bol.id);
  assert.equal(Number(b.esperado),107,'Esperado a hora física, no al digitar (113)');
  assert.equal(Number(b.declarado)-Number(b.esperado),-2);
  await assert.rejects(()=>rpc('guardar',id,{version:d.reporte.version,lineas:[]}),/ya está entregado/);
  await assert.rejects(()=>rpc('recibir',id,{version:d.reporte.version,observacion:'Yo mismo'}),/otra persona/);
  const summary=await rpc('resumen',null,{sucursal_id:1,fecha});
  assert.equal(Number(summary.items[0].inicial),0);
  assert.equal(Number(summary.items[0].sistema),113);
  assert.equal(summary.fuera_turno.length,2,'07:00 y 13:00 son fuera de turno');
  const stockBefore=await root(()=>db.query('select cantidad_base from stock_actual order by producto_id,ubicacion_id'));
  await login(2);
  let tarde=await rpc('crear',null,{sucursal_id:1,fecha,turno:'TARDE',solicitud:uid(21)});
  assert.equal(tarde.anterior.id,id,'El turno siguiente enlaza su entrega anterior');
  tarde=await rpc('guardar',tarde.reporte.id,{version:tarde.reporte.version,lineas:tarde.lineas.map(li=>({id:li.id,empaques:9,sueltas:5,contado_en:momento('21:00')}))});
  tarde=await rpc('comparar',tarde.reporte.id,{version:tarde.reporte.version});
  await assert.rejects(()=>rpc('entregar',tarde.reporte.id,{version:tarde.reporte.version}),/turno anterior debe estar recibido/);
  await assert.rejects(()=>rpc('recibir',id,{version:d.reporte.version,observacion:'Recibido'}),/Verifica cada pendiente/);
  d=await rpc('verificar',id,{version:d.reporte.version,linea_id:bol.id,empaques:9,sueltas:3,contado_en:momento('14:30'),observacion:'Conteo de recepción'});
  const ver=d.lineas.find(l=>l.id===bol.id);
  assert.equal(Number(ver.ver_declarado),111);assert.equal(Number(ver.ver_esperado),113);
  assert.equal(ver.movimientos_antes_verificar,1,'Movimiento de 13:00 posterior al cierre');
  d=await rpc('recibir',id,{version:d.reporte.version,observacion:'Recibo con diferencia abierta.'});
  assert.equal(d.reporte.estado,'RECIBIDO');
  assert.equal(d.lineas.find(l=>l.id===bol.id).pendiente,true,'Recibir no resuelve ni ajusta');
  assert.deepEqual(await root(()=>db.query('select cantidad_base from stock_actual order by producto_id,ubicacion_id')),stockBefore);
  tarde=await rpc('entregar',tarde.reporte.id,{version:tarde.reporte.version});
  assert.equal(tarde.reporte.estado,'ENTREGADO','Se permite entregar una vez recibida la entrega anterior');
  await login(4); await assert.rejects(()=>rpc('detalle',id),/sucursal/);
  await login(5); await assert.rejects(()=>rpc('inicio',null,{sucursal_id:1,fecha}),/No autorizado/);
  await login(3);
  await assert.rejects(()=>rpc('resolver',id,{version:d.reporte.version,linea_id:bol.id,sesion_id:999,observacion:'Sin respaldo'}),/conteo controlado aplicado/);
  await rpc('programar',null,{sucursal_id:1,fecha,producto_id:1,ubicacion_id:1,frecuencia_dias:7});
  const plan=await rpc('plan',null,{sucursal_id:1,fecha});assert.equal(plan.items.find(x=>x.producto_id===1).frecuencia_dias,7);
  const inicio=await rpc('inicio',null,{sucursal_id:1,fecha:'2026-10-20'});assert(inicio.reportes.some(x=>x.id===id),'Pendientes recibidos siguen visibles');
  await root(()=>db.exec(`insert into sesion_conteo(id,nombre) values(999,'Verificación QA aplicada');
    insert into inventario_control.sesion(id,sucursal_id,ubicacion_id,estado,cerrada_en) values(999,1,1,'APLICADA',clock_timestamp());
    insert into inventario_control.producto(sesion_id,producto_id) values(999,1)`));
  d=await rpc('resolver',id,{version:d.reporte.version,linea_id:bol.id,sesion_id:999,observacion:'Verificado y conciliado por el motor de conteo.'});
  assert.equal(d.lineas.find(l=>l.id===bol.id).pendiente,false);
  assert.equal(Number(d.lineas.find(l=>l.id===bol.id).declarado),105,'Resolver conserva la declaración original');
  console.log('Reportes: corte físico, unidades, cero, entrega, recepción, pendientes, plan, permisos, concurrencia y stock intacto verificados.');
} finally {await db.close();}
