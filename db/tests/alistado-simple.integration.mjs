import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testAlistadoSimple(db,{login}) {
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261028215041_alistado_origen_automatico.sql',import.meta.url),'utf8'));
  await db.exec(`select registrar_ajuste(22,22,6,'QA alistado simple','QA','QA');
    insert into pedido(id,categoria,numero) values(950,'TIENDA','QA-SIMPLE'),(951,'TIENDA','QA-EXTERNO-PARCIAL'),(952,'TIENDA','QA-CERO');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id)
      values(9501,950,22,22,10,10,15,1),(9511,951,22,22,10,10,15,1),(9521,952,22,22,10,10,15,1);
    insert into pedido_linea(id,pedido_id,es_personalizado,descripcion,unidad_medida,cantidad_base,estado,sucursal_origen_id)
      values(9502,950,true,'Pendiente QA','unidad',2,'ESPECIAL',1);`);
  let pedido=950,r;
  const op=async(accion='consultar',datos={},version=r?.tarea.version,tarea=null)=>(await db.query('select operar_preparacion_pedido($1,1,$2,$3,$4,$5) r',[pedido,tarea,accion,version??null,JSON.stringify(datos)])).rows[0].r;
  const guardar=async(accion,datos={})=>r=await op(accion,datos);
  const compras=async linea=>(await db.query("select * from compra_solicitud where pedido_linea_id=$1 and estado in ('SOLICITADA','COMPRADA')",[linea])).rows;
  const stock=async()=>Number((await db.query('select cantidad_base from stock_actual where producto_id=22 and ubicacion_id=22')).rows[0]?.cantidad_base||0);
  const foto=async()=>{
    const id=randomUUID();const e=(await db.query("select operar_evidencia_operacion('PEDIDO',$1,$2,'crear',$3) r",[pedido,r.tarea.id,JSON.stringify({id,version:r.tarea.version,cantidad:1})])).rows[0].r;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[e.rutas[0]]);return id;
  };
  await login(1);await db.exec('set role authenticated');r=await op('escanear');
  assert.equal(r.alistado_simple,true);assert.equal(r.lineas[0].propuesta_almacen_base,6);assert.equal(r.lineas[0].propuesta_compra_base,4);
  assert.equal(Number((await compras(9501))[0].cantidad_base),4);await op('escanear');assert.equal((await compras(9501)).length,1,'Escanear de nuevo no duplica la solicitud');
  await assert.rejects(()=>op('guardar_preparacion',{linea_id:9501,cantidad_base:10}),/cantidades y origen/);
  await assert.rejects(()=>op('guardar_alistado',{linea_id:9501,almacen_base:7,externa_base:0}),/stock de Almacén cambió/);
  await guardar('guardar_alistado',{linea_id:9501,almacen_base:6,externa_base:2,referencia:'Proveedor QA'});
  assert.equal(r.lineas[0].preparada_base,8);assert.equal(Number((await compras(9501))[0].cantidad_base),2,'La compra automática conserva sólo el faltante sin conseguir');
  assert.deepEqual(r.lineas[0].origenes_declarados.map(o=>[o.tipo,o.cantidad_base]),[['ALMACEN',6],['COMPRA_RAPIDA',2]]);
  await guardar('guardar_alistado',{linea_id:9502,almacen_base:0,externa_base:0});
  assert.equal(r.lineas[1].preparada_base,0);assert.equal(r.lineas[1].snapshot.estado,'ESPECIAL','Cero no rechaza la línea');assert.equal(await stock(),6);
  await guardar('preparado',{evidencia_id:await foto()});assert.equal(r.origenes_pendientes.length,0);
  await assert.rejects(()=>op('declarar_origen',{linea_id:9501,origenes:[]}),/cantidades y origen/);
  await login(2);r=await op('escanear');
  await guardar('guardar_revision',{linea_id:9502,cantidad_base:0,metodo:'visual'});
  await assert.rejects(()=>op('guardar_revision',{linea_id:9501,cantidad_base:7,observacion:'Falta uno',metodo:'visual'}),/Devuelve la línea/);
  await guardar('devolver_linea',{linea_id:9501,observacion:'La distribución física es cinco y tres'});
  assert.equal(r.tarea.estado,'PREPARANDO');assert.equal(r.lineas[0].confirmada,false);assert.equal(r.lineas[1].revisada_base,0,'La devolución conserva la otra línea verificada');assert.equal(await stock(),6);
  await assert.rejects(()=>op('guardar_alistado',{linea_id:9501,almacen_base:5,externa_base:3,referencia:'Proveedor QA'}),/alistador asignado/);
  await login(1);await guardar('guardar_alistado',{linea_id:9501,almacen_base:5,externa_base:3,referencia:'Proveedor QA'});
  await guardar('preparado',{evidencia_id:await foto()});
  await login(2);r=await op('escanear');await guardar('guardar_revision',{linea_id:9501,cantidad_base:8,metodo:'visual'});
  if(r.lineas[1].revisada_base==null)await guardar('guardar_revision',{linea_id:9502,cantidad_base:0,metodo:'visual'});
  const salida={destino:'Obra QA',evidencia_id:await foto(),plan:r.plan_salida},version=r.tarea.version;
  await guardar('confirmar_retiro',salida);await op('confirmar_retiro',salida,version);
  assert.equal(await stock(),1,'Sólo descuenta las cinco de Almacén, una vez');assert.equal(r.resumen_pedido.estado,'PARCIAL');assert.equal(Number((await compras(9501))[0].cantidad_base),2);
  assert.equal((await db.query('select cantidad_despachada from pedido_linea where id=9501')).rows[0].cantidad_despachada,'8');
  await login(1);r=await op('escanear');assert.equal(r.numero_entrega,2);assert.equal(r.lineas[0].snapshot.pendiente_base,2,'El segundo envío toma únicamente el saldo del mismo pedido');
  await guardar('guardar_alistado',{linea_id:9501,almacen_base:1,externa_base:1,referencia:'Proveedor QA'});assert.equal((await compras(9501)).length,0);
  await db.exec("reset role;select registrar_ajuste(22,22,0,'QA sin Almacén','QA','QA');set role authenticated");
  pedido=951;r=await op('escanear');assert.equal(r.lineas[0].propuesta_almacen_base,0);assert.equal(Number((await compras(9511))[0].cantidad_base),10);
  await guardar('guardar_alistado',{linea_id:9511,almacen_base:0,externa_base:8,referencia:'Proveedor parcial QA'});
  assert.equal(r.lineas[0].preparada_base,8);assert.equal(Number((await compras(9511))[0].cantidad_base),2);
  await guardar('preparado',{evidencia_id:await foto()});await login(2);r=await op('escanear');await guardar('guardar_revision',{linea_id:9511,cantidad_base:8,metodo:'visual'});
  await guardar('confirmar_retiro',{destino:'Obra parcial QA',evidencia_id:await foto(),plan:r.plan_salida});
  assert.equal(await stock(),0);assert.equal(r.pedido.estado,'ABIERTO');assert.equal(Number((await compras(9511))[0].cantidad_base),2,'Enviar ocho mantiene las dos por comprar');
  pedido=952;await login(1);r=await op('escanear');await guardar('guardar_alistado',{linea_id:9521,almacen_base:0,externa_base:0});
  await assert.rejects(()=>op('preparado',{evidencia_id:randomUUID()}),/al menos un producto/);
  assert.equal((await db.query('select estado::text from pedido_linea where id=9521')).rows[0].estado,'POR_DESPACHAR');assert.equal(Number((await compras(9521))[0].cantidad_base),10);
  await db.exec(`reset role;select registrar_ajuste(22,22,12,'QA dos líneas','QA','QA');
    insert into pedido(id,categoria,numero) values(953,'TIENDA','QA-MISMO-PRODUCTO');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id)
      values(9531,953,22,22,10,10,15,1),(9532,953,22,22,10,10,15,1);set role authenticated;`);
  pedido=953;r=await op('escanear');
  assert.deepEqual(r.lineas.map(l=>l.propuesta_almacen_base),[10,2],'No propone el mismo stock dos veces');
  assert.equal((await compras(9531)).length,0);assert.equal(Number((await compras(9532))[0].cantidad_base),8);
  await guardar('guardar_alistado',{linea_id:9532,almacen_base:2,externa_base:0});await guardar('guardar_alistado',{linea_id:9531,almacen_base:10,externa_base:0});
  assert.equal(await stock(),12,'Alistar ambas líneas no mueve inventario');
  await login(3);await assert.rejects(()=>op('consultar'),/perfil no tiene acceso/);await login(5);await assert.rejects(()=>op('consultar'),/sucursal física autorizada/);
  await db.exec('reset role');
  assert.equal((await db.query("select has_function_privilege('authenticated','almacen_operaciones.operar_flexible(bigint,bigint,bigint,text,integer,jsonb)','execute') ok")).rows[0].ok,false,'No se puede saltar el nuevo contrato');
  assert.equal((await db.query("select has_function_privilege('authenticated','almacen_operaciones.sincronizar_compra_simple(bigint,bigint,numeric)','execute') ok")).rows[0].ok,false);
  console.log('OK: prioridad Almacén, compra automática sin duplicar, mixto 5+3, externo parcial 0+8 de 10, cero pendiente, devolución de línea, fotos y salida idempotente');
}
