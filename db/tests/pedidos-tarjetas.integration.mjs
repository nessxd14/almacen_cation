import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testPedidosTarjetas(db,{login,uid}) {
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261028131324_pedidos_tarjetas_origen_posterior.sql',import.meta.url),'utf8'));
  await db.exec(`insert into pedido(id,categoria,numero) values(940,'TIENDA','QA-TARJETAS'),(941,'TIENDA','QA-REEMPLAZO'),(942,'TIENDA','QA-COMPRA-TARJETA');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id)
      values(9401,940,22,22,10,10,15,1),(9421,942,22,22,10,10,15,1);
    insert into pedido_linea(id,pedido_id,es_personalizado,descripcion,unidad_medida,cantidad_base,estado,sucursal_origen_id)
      values(9402,940,true,'Personalizado disponible','unidad',2,'ESPECIAL',1),(9411,941,true,'Material a cambiar','unidad',2,'ESPECIAL',1);`);
  let pedido=940,r;
  const op=async(accion='consultar',datos={},version=r?.tarea.version,tarea=null)=>(await db.query('select operar_preparacion_pedido($1,1,$2,$3,$4,$5) r',[pedido,tarea,accion,version||null,JSON.stringify(datos)])).rows[0].r;
  const guardar=async(accion,datos={})=>r=await op(accion,datos);
  const foto=async()=>{
    const id=randomUUID();const e=(await db.query("select operar_evidencia_operacion('PEDIDO',$1,$2,'crear',$3) r",[pedido,r.tarea.id,JSON.stringify({id,version:r.tarea.version,cantidad:1})])).rows[0].r;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[e.rutas[0]]);return id;
  };
  const stock=async()=>Number((await db.query('select cantidad_base from stock_actual where producto_id=22 and ubicacion_id=22')).rows[0]?.cantidad_base||0);
  const antes=await stock();
  await login(1);await db.exec('set role authenticated');r=await op('escanear');assert.equal(r.pedido_flexible,true);
  await guardar('guardar_preparacion',{linea_id:9402,cantidad_base:2});assert.equal(r.bloqueos_despacho.length,0,'Personalizado completo sin stock ni origen previo');
  await guardar('registrar_incidencia',{linea_id:9401,cantidad_base:6,observacion:'Solo hay una parte'});assert.equal(r.lineas.find(l=>l.pedido_linea_id===9401).incidencia_pendiente,true);
  await assert.rejects(()=>op('preparado'),/Resuelve los pendientes/);
  await guardar('guardar_preparacion',{linea_id:9401,cantidad_base:6,observacion:'Cuatro para otra tanda',pendiente_tipo:'POR_COMPLETAR'});
  await assert.rejects(()=>op('preparado'),/evidencia|fotos|lote/i);
  const prep={evidencia_id:await foto()},prepVersion=r.tarea.version;await guardar('preparado',prep);await op('preparado',prep,prepVersion);
  assert.equal(r.origenes_pendientes.length,2);assert.equal(r.tarea.origenes_pendientes,2);assert.equal(await stock(),antes);
  const primera=r.tarea.id;
  const origenPersonal={linea_id:9402,origenes:[{tipo:'ALMACEN',cantidad_base:2}]};
  await guardar('declarar_origen',origenPersonal);assert.equal(r.origenes_pendientes.length,1);
  await assert.rejects(()=>op('tomar_revision'),/otra persona/);
  await login(2);r=await op('escanear');assert.equal(r.tarea.revisor_id,uid(2));
  await assert.rejects(()=>op('declarar_origen',{linea_id:9401,origenes:[{tipo:'COMPRA_RAPIDA',cantidad_base:6,referencia:'Proveedor'}]}),/alistador/);
  // Llega más material después del alistado: el revisor puede incluirlo.
  await guardar('guardar_revision',{linea_id:9401,cantidad_base:8,observacion:'Llegaron dos más',metodo:'visual'});
  await guardar('guardar_revision',{linea_id:9402,cantidad_base:2,metodo:'visual'});
  const salida={destino:'Obra QA',evidencia_id:await foto(),plan:r.plan_salida},salidaVersion=r.tarea.version;
  await guardar('confirmar_retiro',salida);await op('confirmar_retiro',salida,salidaVersion);
  assert.equal(r.tarea.estado,'DESPACHADO');assert.equal(r.pedido.estado,'ABIERTO');assert.equal(r.resumen_pedido.estado,'PARCIAL');assert.equal(await stock(),antes,'La salida con origen pendiente no inventa su procedencia');
  assert.equal(r.origenes_pendientes[0].cantidad_base,8);
  assert.equal((await db.query('select listar_origenes_pendientes_pedido(1) r')).rows[0].r.length,0,'El revisor no recibe la tarea del alistador');
  await login(1);r=await op('consultar',{},null,primera);
  assert.ok((await db.query('select listar_origenes_pendientes_pedido(1) r')).rows[0].r.some(t=>t.id===primera),'La tarea sigue visible aunque la tanda salió');
  await assert.rejects(()=>op('declarar_origen',{linea_id:9401,origenes:[{tipo:'ALMACEN',cantidad_base:6,ubicacion_id:22}]}),/sumar/);
  const mixto={linea_id:9401,origenes:[{tipo:'ALMACEN',cantidad_base:4,ubicacion_id:22},{tipo:'TIENDA',cantidad_base:2,sucursal_tienda_id:2,referencia:'Tienda QA'},{tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Proveedor QA',costo:5}]};
  await assert.rejects(()=>op('declarar_origen',{...mixto,origenes:mixto.origenes.map(o=>o.tipo==='ALMACEN'?{...o,ubicacion_id:23}:o)}),/ubicación de Almacén/);
  const versionOrigen=r.tarea.version;await guardar('declarar_origen',mixto);await op('declarar_origen',mixto,versionOrigen,primera);
  assert.equal(await stock(),antes-4,'Sólo Almacén se descuenta y permite quedar negativo');assert.equal(r.origenes_pendientes.length,0);assert.equal(r.tarea.origenes_pendientes,0);
  assert.ok(await stock()<0,'El saldo efectivamente puede quedar negativo');
  assert.ok(!(await db.query('select listar_origenes_pendientes_pedido(1) r')).rows[0].r.some(t=>t.id===primera),'Completar el origen retira la tarea de pendientes');
  assert.equal((await db.query('select count(*)::int n from pedido_despacho_movimiento where evento_id=$1',[r.lineas.find(l=>l.pedido_linea_id===9401).despacho_evento_id])).rows[0].n,1,'Reintentos no duplican stock');
  await assert.rejects(()=>op('declarar_origen',{...mixto,origenes:[{tipo:'ALMACEN',cantidad_base:8,ubicacion_id:22}]}),/ya se aplicó/);
  r=await op('escanear');assert.equal(r.numero_entrega,2);assert.notEqual(r.tarea.id,primera);assert.equal(r.lineas.filter(l=>l.vigente).length,1);assert.equal(r.lineas[0].snapshot.pendiente_base,2);
  await guardar('guardar_preparacion',{linea_id:9401,cantidad_base:2});await guardar('preparado',{evidencia_id:await foto()});
  await guardar('declarar_origen',{linea_id:9401,origenes:[{tipo:'ALMACEN',cantidad_base:2,ubicacion_id:22}]});assert.equal(await stock(),antes-4,'Declarar antes de retirar no descuenta');
  await login(2);r=await op('escanear');await guardar('guardar_revision',{linea_id:9401,cantidad_base:2,metodo:'visual'});await guardar('confirmar_retiro',{destino:'Obra QA',evidencia_id:await foto(),plan:r.plan_salida});
  assert.equal(r.pedido.estado,'COMPLETADO');assert.equal(await stock(),antes-6);
  pedido=941;await login(1);r=await op('escanear');
  await guardar('registrar_incidencia',{linea_id:9411,cantidad_base:0,observacion:'Cambiar producto'});
  await guardar('reemplazar_material',{linea_id:9411,cantidad_base:2,producto_id:22,factor:2,observacion:'Reemplazo autorizado por Almacén'});
  assert.equal(r.lineas[0].reemplazo.producto_id,22);assert.equal(r.lineas[0].reemplazo.factor,2);
  const precio=(await db.query('select precio_unitario from pedido_linea where id=9411')).rows[0].precio_unitario;assert.equal(Number(precio),0,'El reemplazo conserva los importes del vendedor');
  await guardar('preparado',{evidencia_id:await foto()});assert.equal(r.origenes_pendientes[0].cantidad_base,4,'El origen usa la cantidad física del reemplazo');
  pedido=942;r=await op('escanear');await guardar('registrar_incidencia',{linea_id:9421,cantidad_base:6,observacion:'Faltan cuatro'});
  await guardar('gestionar_compra',{linea_id:9421,cantidad_base:4,observacion:'Comprar el faltante'});assert.equal(r.lineas[0].preparada_base,6);assert.equal(r.lineas[0].incidencia_pendiente,false);
  assert.equal(Number((await db.query('select cantidad_base from pedido_linea where id=9421')).rows[0].cantidad_base),10,'Comprar no divide ni altera la venta');
  await db.exec("reset role;update pedido set estado='CANCELADO' where id=942;set role authenticated;");
  await assert.rejects(()=>op('guardar_preparacion',{linea_id:9421,cantidad_base:10}),/cancelado o completado/);
  await login(3);await assert.rejects(()=>op('consultar'),/perfil no tiene acceso/);
  await login(5);await assert.rejects(()=>op('consultar'),/sucursal física autorizada/);
  await login(1);
  await db.exec('reset role');
  assert.equal((await db.query("select has_function_privilege('anon','public.operar_preparacion_pedido(bigint,bigint,bigint,text,integer,jsonb)','execute') ok")).rows[0].ok,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','almacen_operaciones.aplicar_origen_flexible(bigint,bigint)','execute') ok")).rows[0].ok,false);
  console.log('OK: tarjetas, origen posterior mixto 4+2+2, stock negativo sin duplicar, dos responsables/fotos, llegada posterior, reemplazo y tanda 2 con el mismo QR');
}
