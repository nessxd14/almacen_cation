import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function testEvidenciaOperaciones(db, { login, call, step, stock, count, uid }) {
  const cajaVtd=(await db.query("select pg_get_functiondef('public.operar_caja_almacen(text,uuid,bigint,jsonb)'::regprocedure) f")).rows[0].f;
  await login(2);await db.exec('set role authenticated');const vtdAntes=await call('VTD',1);await db.exec('reset role');
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261020124326_evidencias_pedidos_traslados_retiro.sql', import.meta.url), 'utf8'));
  await db.exec('set role authenticated');assert.deepEqual(await call('VTD',1),vtdAntes,'VTD mantiene la misma respuesta con el wrapper nuevo');await db.exec('reset role');
  assert.equal((await db.query("select pg_get_functiondef('public.operar_caja_almacen(text,uuid,bigint,jsonb)'::regprocedure) f")).rows[0].f,cajaVtd,'No se cambia el motor de Caja/VTD');
  await db.exec(`update evidencia_operacion.configuracion set activo=true,habilitado_desde='2000-01-01';
    select registrar_entrada(1,1,100,'QA nueva evidencia','QA');
    insert into pedido(id,categoria,numero) values(901,'TIENDA','PED-QA-RETIRO');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id)
      values(901,901,1,2,24,2,10,10,1);`);
  const pedido = async (accion='consultar',datos={},version=null,tarea=null) =>
    (await db.query('select operar_preparacion_pedido(901,1,$1,$2,$3,$4::jsonb) r',[tarea,accion,version,JSON.stringify(datos)])).rows[0].r;
  let r;
  async function preparar(cantidad) {
    await login(1);r=await pedido('crear');
    r=await pedido('guardar_preparacion',{linea_id:901,cantidad_base:cantidad,observacion:'Entrega parcial QA'},r.tarea.version);
    r=await pedido('preparado',{},r.tarea.version);
    await login(2);r=await pedido('escanear');
    r=await pedido('guardar_revision',{linea_id:901,cantidad_base:cantidad,metodo:'visual'},r.tarea.version);
    r=await pedido('verificado',{},r.tarea.version);
    await db.query("select _despachar_linea_nucleo(901,$1::jsonb,'QA',true)",[JSON.stringify([{ubicacion_id:1,cantidad_base:cantidad}])]);
    return pedido();
  }
  r=await preparar(12);const tarea=r.tarea.id;assert.equal(r.tarea.estado,'DESPACHADO');
  const evidencia = async (accion,datos={},tipo='PEDIDO',documento=901,entrega=tarea) =>
    (await db.query('select operar_evidencia_operacion($1,$2,$3,$4,$5::jsonb) r',[tipo,documento,entrega,accion,JSON.stringify(datos)])).rows[0].r;
  const lote='40000000-0000-0000-0000-000000000001';
  const antes=await stock(1), kardex=await count('kardex_transacciones');
  await login(1);await db.exec('set role authenticated');
  await assert.rejects(()=>evidencia('crear',{id:lote,version:r.tarea.version,cantidad:1}),/tercera persona/);
  await login(2);await assert.rejects(()=>evidencia('crear',{id:lote,version:r.tarea.version,cantidad:1}),/tercera persona/);
  await login(5);await assert.rejects(()=>evidencia('consultar'),/otra sucursal/);
  await login(4);
  assert.equal((await pedido('escanear')).tarea.id,tarea,'El tercer escaneo no crea una preparación nueva');
  assert.equal((await pedido()).retiros_pendientes[0].id,tarea,'La entrega pendiente sigue accesible desde el pedido');
  assert.equal((await evidencia('consultar')).contexto.puede_capturar,true);
  await assert.rejects(()=>evidencia('crear',{id:lote,version:r.tarea.version+1,cantidad:1}),/entrega cambió/);
  const fotos=await evidencia('crear',{id:lote,version:r.tarea.version,cantidad:1});
  const retiro={version:r.tarea.version,evidencia_id:lote,destino:'Obra de prueba · puerta 2'};
  await assert.rejects(()=>evidencia('retirar',retiro),/Faltan fotos/);
  await login(1);
  await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[fotos.rutas[0]]),/row-level security/);
  await login(4);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[fotos.rutas[0]]);
  let salida=await evidencia('retirar',retiro);
  assert.equal(salida.retiro.transportista_id,uid(4));assert.equal(salida.retiro.estado,'EN_TRANSPORTE');
  assert.equal(salida.envios[0].estado,'PENDIENTE');
  await evidencia('retirar',retiro);
  await assert.rejects(()=>evidencia('retirar',{...retiro,destino:'Otro lugar'}),/ya tiene un retiro/);
  assert.equal(await stock(1),antes);assert.equal(await count('kardex_transacciones'),kardex,'Retirar no duplica despacho ni stock');
  await assert.rejects(()=>db.query('select * from evidencia_operacion.configuracion'),/permission denied/);
  await assert.rejects(()=>db.query("select worker_evidencia_operacion('reclamar')"),/permission denied/);
  await db.exec('reset role;set role service_role');
  const worker=async(accion,datos={})=>(await db.query('select worker_evidencia_operacion($1,$2) r',[accion,JSON.stringify(datos)])).rows[0].r;
  let job=await worker('reclamar');assert.equal(Number(job.tema_id),9);assert.equal(job.chat_id,'-1003058173908');
  await worker('confirmar',{id:job.id,lease:job.lease,telegram:[{message_id:23835,file_id:'pedido-qa'}]});
  await db.exec('reset role;set role authenticated');
  assert.equal((await evidencia('consultar')).envios[0].enlace,'https://t.me/c/3058173908/9/23835');
  assert.equal((await pedido('escanear')).retiro.transportista_id,uid(4));
  assert.deepEqual((await pedido()).retiros_pendientes,[]);
  await db.exec('reset role');
  r=await preparar(12);assert.notEqual(r.tarea.id,tarea,'Cada entrega parcial tiene un retiro propio');
  await login(4);assert.equal((await pedido()).retiro,null);assert.equal((await pedido('consultar',{},null,tarea)).retiro.transportista_id,uid(4));

  // Traslado: dos personas, foto del revisor, autorización con el Kardex existente.
  await login(3);let tr=await call('TRASLADO_VIRTUAL',null,'crear',{sucursal_origen_id:1,sucursal_destino_id:2});const id=tr.tarea.id;
  tr=await step('TRASLADO_VIRTUAL',id,tr,'agregar',{producto_id:1,presentacion_id:2,ubicacion_id:1,cantidad_base:12});
  tr=await step('TRASLADO_VIRTUAL',id,tr,'enviar');
  await login(2);tr=await call('TRASLADO_VIRTUAL',id,'escanear');
  tr=await step('TRASLADO_VIRTUAL',id,tr,'guardar_revision',{linea_id:tr.lineas[0].id,cantidad_base:12,metodo:'visual'});
  tr=await step('TRASLADO_VIRTUAL',id,tr,'verificado');
  const loteTraslado='40000000-0000-0000-0000-000000000002';
  await db.exec('set role authenticated');
  await assert.rejects(()=>step('TRASLADO_VIRTUAL',id,tr,'autorizar'),/Adjunta fotos/);
  await assert.rejects(()=>db.query("select almacen_operaciones.operar_documento('TRASLADO_VIRTUAL',$1,'autorizar',$2,'{}')",[id,tr.tarea.version]),/permission denied/);
  await login(4);await assert.rejects(()=>evidencia('crear',{id:loteTraslado,version:tr.tarea.version,cantidad:1},'TRASLADO_VIRTUAL',id,id),/traslado lo confirma su revisor/);
  await login(2);const fotosTr=await evidencia('crear',{id:loteTraslado,version:tr.tarea.version,cantidad:1},'TRASLADO_VIRTUAL',id,id);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[fotosTr.rutas[0]]);
  const stockTr=await stock(1), cantidadTr=await count('solicitud_traslado');
  tr=await step('TRASLADO_VIRTUAL',id,tr,'autorizar',{evidencia_id:loteTraslado});
  await call('TRASLADO_VIRTUAL',id,'autorizar',{},tr.tarea.version);
  assert.equal(tr.tarea.estado,'EN_TRANSITO');assert.equal(await stock(1),stockTr-12);assert.equal(await count('solicitud_traslado'),cantidadTr+1);
  await assert.rejects(()=>evidencia('retirar',{},'TRASLADO_VIRTUAL',id,id),/dos responsables/);
  await db.exec('reset role;set role service_role');job=await worker('reclamar');assert.equal(Number(job.tema_id),17226);
  await worker('incierto',{id:job.id,lease:job.lease});assert.equal(await worker('reclamar'),null,'No repetir Telegram ante resultado incierto');
  await db.exec('reset role');assert.equal(await count('evidencia_operacion.retiro'),1,'Traslado no crea un transportista');
  const nonce='50000000-0000-0000-0000-000000000001';
  await db.query('insert into evidencia_operacion.invocacion(id) values($1)',[nonce]);
  await db.exec('set role service_role');
  assert.equal((await worker('autorizar',{token:nonce})).autorizado,true);
  assert.equal((await worker('autorizar',{token:nonce})).autorizado,false,'La credencial sólo permite una invocación');
  assert.equal((await worker('autorizar',{token:''})).autorizado,false);
  assert.deepEqual(await worker('limpiar'),[],'No se borran fotos antes de las 48 horas ni resultados inciertos');
  await db.exec('reset role');
  await db.exec("update evidencia_operacion.lote set borrar_despues=now()-interval '1 second' where estado='ENVIADO'");
  await db.exec('set role service_role');
  const limpieza=await worker('limpiar');assert.equal(limpieza.length,1);assert.equal(limpieza[0].id,lote);
  await worker('borrado',{id:lote});
  await db.exec('reset role');
  assert.equal((await db.query("select has_function_privilege('anon','public.operar_evidencia_operacion(text,bigint,bigint,text,jsonb)','execute') p")).rows[0].p,false);
  console.log('OK: tercer responsable por entrega, destino, escaneo terminal, fotos privadas, dos personas en traslado, temas 9/17226, sin doble stock ni cobros');
}
