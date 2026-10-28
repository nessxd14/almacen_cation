import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testActivarTarjetas(db,{login,uid}) {
  const recepcion=randomUUID(),soloCompra=randomUUID();
  await db.exec(`insert into producto(id,nombre,unidad_base,sku_interno) values(24,'Producto QA con existencia','UNIDAD','QA-24');
    insert into presentacion(id,producto_id,nombre,factor_unidad_base,es_base) values(24,24,'Unidad',1,true);
    insert into ubicacion(id,codigo_zona,sucursal_id,es_recepcion,excluye_disponible) values(24,'QA ORIGEN CONSERVADO',1,false,false);
    select registrar_entrada(24,24,10,'QA existencia','QA');
    insert into pedido(id,categoria,numero) values(960,'TIENDA','QA-ACTIVAR-SIN-AVANCE'),(961,'TIENDA','QA-ACTIVAR-EN-REVISION'),(962,'TIENDA','QA-ACTIVAR-CANCELADO'),(963,'TIENDA','QA-ACTIVAR-ORIGEN'),(964,'TIENDA','QA-ACTIVAR-COMPRA');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id)
      values(9601,960,22,22,10,10,15,1),(9611,961,22,22,10,10,15,1),(9621,962,22,22,10,10,15,1),(9631,963,24,24,6,6,15,1),(9641,964,22,22,2,2,15,1);
    insert into almacen_preparacion(pedido_id,sucursal_id,preparador_id,preparador_nombre,revisor_id,revisor_nombre,estado,version)
      values(960,1,'${uid(1)}','Prepara QA',null,null,'PREPARANDO',1),
      (961,1,'${uid(1)}','Prepara QA','${uid(2)}','Verifica QA','REVISANDO',7),
      (962,1,'${uid(1)}','Prepara QA',null,null,'PREPARANDO',1),
      (963,1,'${uid(1)}','Prepara QA','${uid(2)}','Verifica QA','REVISANDO',5),
      (964,1,'${uid(1)}','Prepara QA',null,null,'PREPARANDO',4);
    update almacen_preparacion set modo_flexible=false,modo_abastecimiento=(pedido_id in (961,963,964)),flujo_dos_actores=(pedido_id in (961,963,964)) where pedido_id in (960,961,962,963,964);
    insert into almacen_preparacion_linea(preparacion_id,pedido_linea_id,snapshot)
      select t.id,a.linea_id,a.datos from almacen_preparacion t cross join lateral almacen_operaciones.lineas_actuales(t.pedido_id,1)a where t.pedido_id in (960,961,962,963,964);
    insert into almacen_operaciones.recepcion_pedido(id,pedido_linea_id,tipo,cantidad_base,referencia,actor_id,actor_nombre)
      values('${recepcion}',9611,'COMPRA_RAPIDA',2,'Proveedor QA heredado','${uid(1)}','Prepara QA'),('${soloCompra}',9641,'COMPRA_RAPIDA',2,'Proveedor QA conservado','${uid(1)}','Prepara QA');
    update almacen_preparacion_linea set confirmada=true,preparada_base=6,revisada_base=6,metodo_revision='visual',origenes_preparacion='[{"tipo":"ALMACEN","cantidad_base":6}]',origenes_revision='[{"tipo":"ALMACEN","cantidad_base":6}]' where pedido_linea_id=9631;
    update almacen_preparacion_linea set confirmada=true,preparada_base=2,origenes_preparacion=jsonb_build_array(jsonb_build_object('tipo','COMPRA_RAPIDA','cantidad_base',2,'recepcion_id','${soloCompra}')) where pedido_linea_id=9641;
    update almacen_preparacion_linea set confirmada=true,preparada_base=6,revisada_base=6,metodo_revision='visual',observacion='Cuatro en otra tanda',pendiente_tipo='POR_COMPLETAR',
      origenes_preparacion=jsonb_build_array(jsonb_build_object('tipo','ALMACEN','cantidad_base',4),jsonb_build_object('tipo','COMPRA_RAPIDA','cantidad_base',2,'recepcion_id','${recepcion}')),
      origenes_revision=jsonb_build_array(jsonb_build_object('tipo','ALMACEN','cantidad_base',4),jsonb_build_object('tipo','COMPRA_RAPIDA','cantidad_base',2,'recepcion_id','${recepcion}'))
      where pedido_linea_id=9611;
    update pedido set estado='CANCELADO' where id=962;`);
  const tarea=(await db.query('select id from almacen_preparacion where pedido_id=961')).rows[0].id;
  const hashLineas=async()=>(await db.query("select md5(jsonb_agg(to_jsonb(l)-'origenes_declarados' order by l.preparacion_id,l.pedido_linea_id)::text) h from almacen_preparacion_linea l where l.pedido_linea_id in (9601,9611,9621,9631,9641)")).rows[0].h;
  const hashHistorico=async()=>(await db.query("select md5(jsonb_agg(to_jsonb(t) order by t.id)::text) h from almacen_preparacion t join pedido p on p.id=t.pedido_id where p.estado<>'ABIERTO' or t.estado in ('DESPACHADO','ANULADO')")).rows[0].h;
  const lineasAntes=await hashLineas(),historicoAntes=await hashHistorico();
  await login(2);await db.exec('set role authenticated');
  const foto=randomUUID();const lote=(await db.query("select operar_evidencia_operacion('PEDIDO',961,$1,'crear',$2) r",[tarea,JSON.stringify({id:foto,version:7,cantidad:1})])).rows[0].r;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[lote.rutas[0]]);
  await db.exec('reset role');
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261028144609_activar_tarjetas_pedidos_pendientes.sql',import.meta.url),'utf8'));
  assert.equal(await hashLineas(),lineasAntes,'Conserva cantidades, revisiones, responsables y fuentes anteriores');
  assert.equal(await hashHistorico(),historicoAntes,'Conserva intactos los pedidos cerrados y cancelados');
  assert.equal((await db.query('select modo_flexible from almacen_preparacion where pedido_id=960')).rows[0].modo_flexible,true);
  assert.deepEqual((await db.query('select origenes_declarados from almacen_preparacion_linea where pedido_linea_id=9631')).rows[0].origenes_declarados,[{tipo:'ALMACEN',cantidad_base:6,ubicacion_id:24}],'Conserva el origen y la ubicación de una revisión ya resuelta');
  assert.equal((await db.query('select origenes_declarados from almacen_preparacion_linea where pedido_linea_id=9641')).rows[0].origenes_declarados[0].recepcion_id,soloCompra,'Conserva la compra ya recibida');
  assert.equal((await db.query('select version from evidencia_operacion.lote where id=$1',[foto])).rows[0].version,7,'La foto en borrador conserva su versión');
  const stock=async()=>Number((await db.query('select cantidad_base from stock_actual where producto_id=22 and ubicacion_id=22')).rows[0]?.cantidad_base||0);
  const saldo=async()=>{await db.exec('reset role');try{return Number((await db.query('select almacen_operaciones.saldo_recepcion($1) q',[recepcion])).rows[0].q);}finally{await db.exec('set role authenticated');}};
  const stockAntes=await stock();
  let r;const op=async(accion='consultar',datos={},version=r?.tarea.version)=>(await db.query('select operar_preparacion_pedido(961,1,$1,$2,$3,$4) r',[tarea,accion,version||null,JSON.stringify(datos)])).rows[0].r;
  await db.exec('set role authenticated');r=await op();assert.equal(r.pedido_flexible,true);assert.equal(r.tarea.version,7);assert.equal(r.lineas[0].revisada_base,6);
  r=await op('confirmar_retiro',{evidencia_id:foto,destino:'Destino QA',plan:r.plan_salida});assert.equal(r.tarea.estado,'DESPACHADO');assert.equal(await stock(),stockAntes);assert.equal(await saldo(),2);
  await login(1);r=await op();const origen={linea_id:9611,origenes:[{tipo:'ALMACEN',cantidad_base:4,ubicacion_id:22},{tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Proveedor QA heredado'}]};
  const version=r.tarea.version;r=await op('declarar_origen',origen);await op('declarar_origen',origen,version);
  assert.equal(await stock(),stockAntes-4,'La conversión no duplica salidas de Almacén');assert.equal(await saldo(),0,'La recepción anterior se consume una sola vez');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from almacen_operaciones.consumo_recepcion where recepcion_id=$1',[recepcion])).rows[0].n,1);
  assert.equal((await db.query("select has_function_privilege('authenticated','almacen_operaciones.consumir_recepciones_flexible(bigint,bigint,bigint,jsonb)','execute') permitido")).rows[0].permitido,false);
  await db.exec('reset role');
  console.log('OK: tarjetas para todas las tandas abiertas, cantidades/revisión/fotos conservadas, históricos intactos y recepción heredada consumida sin duplicar stock');
}
