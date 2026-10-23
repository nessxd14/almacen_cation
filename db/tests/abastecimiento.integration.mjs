import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testAbastecimiento(db,{login,uid}) {
  const fixture=JSON.parse(await fs.readFile(new URL('./abastecimiento.fixture.json',import.meta.url),'utf8'));
  for(const f of fixture.functions)await db.exec(f);
  await db.exec(`create or replace function public.guardar_version_pedido(bigint,text,text) returns void language sql as $$select$$;
    alter table public.pedido_evento add column if not exists pedido_linea_id bigint;
    insert into producto(id,nombre,unidad_base,sku_interno) values(22,'Material QA abastecimiento','UNIDAD','QA-22');
    insert into presentacion(id,producto_id,nombre,factor_unidad_base,es_base) values(22,22,'Unidad',1,true);
    insert into ubicacion(id,codigo_zona,sucursal_id,es_recepcion,excluye_disponible) values(22,'QA ABASTECIMIENTO',1,true,false),(23,'TIENDA QA',2,true,false);
    select registrar_entrada(22,22,4,'QA','QA');select registrar_entrada(22,23,100,'QA','QA');
    insert into pedido(id,categoria,numero) values(920,'TIENDA','QA-ABASTECIMIENTO'),(921,'TIENDA','QA-PERSONALIZADO-PARCIAL'),(922,'TIENDA','QA-SALDO-RAPIDA'),(923,'TIENDA','QA-SOLO-PENDIENTE'),(924,'TIENDA','QA-CONTRATO-ANTERIOR');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id)
      values(9201,920,22,22,10,10,1,1),(9221,922,22,22,6,6,1,1),(9241,924,22,22,1,1,1,1);
    insert into pedido_linea(id,pedido_id,es_personalizado,descripcion,unidad_medida,cantidad_base,estado,sucursal_origen_id)
      values(9211,921,true,'Escobas QA parciales','unidad',10,'ESPECIAL',1),(9231,923,true,'Sin material QA','unidad',2,'ESPECIAL',1);
    update evidencia_operacion.configuracion set pedidos_dos_actores=false;
    insert into almacen_preparacion(pedido_id,sucursal_id,preparador_id,preparador_nombre,revisor_id,revisor_nombre,estado)
      values(924,1,'${uid(1)}','Prepara QA','${uid(2)}','Verifica QA','VERIFICADO');
    insert into almacen_preparacion_linea(preparacion_id,pedido_linea_id,snapshot,confirmada,preparada_base,revisada_base)
      select t.id,9241,a.datos,true,1,1 from almacen_preparacion t cross join almacen_operaciones.lineas_actuales(924,1)a where t.pedido_id=924;
    update evidencia_operacion.configuracion set pedidos_dos_actores=true;`);
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261023171501_abastecimiento_entregas_parciales.sql',import.meta.url),'utf8'));
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261023172049_reservas_abastecimiento_acceso.sql',import.meta.url),'utf8'));
  // El motor de conteo tiene su propia suite; aquí se inspecciona su bloqueo de ubicación.
  await db.exec('create schema if not exists inventario_control;create table if not exists inventario_control.sesion(id bigint,ubicacion_id bigint,sucursal_id bigint,estado text);');
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261023214916_resolver_bloqueos_despacho.sql',import.meta.url),'utf8'));
  await db.exec("update evidencia_operacion.configuracion set abastecimiento_pedidos=true;select setval(pg_get_serial_sequence('public.pedido_linea','id'),(select max(id)+100 from public.pedido_linea));");
  assert.equal((await db.query('select count(*) n from almacen_preparacion where modo_abastecimiento')).rows[0].n,0,'Las preparaciones previas conservan su contrato');
  const stock=async ubic=>Number((await db.query('select coalesce(sum(cantidad_base),0) n from stock_actual where producto_id=22 and ubicacion_id=$1',[ubic])).rows[0].n);
  let r,pedido=920;
  const op=async(accion='consultar',datos={},version=r?.tarea.version,tarea=null)=>
    (await db.query('select operar_preparacion_pedido($1,1,$2,$3,$4,$5) r',[pedido,tarea,accion,version||null,JSON.stringify(datos)])).rows[0].r;
  const foto=async()=>{
    const id=randomUUID();const e=(await db.query("select operar_evidencia_operacion('PEDIDO',$1,$2,'crear',$3) r",[pedido,r.tarea.id,JSON.stringify({id,version:r.tarea.version,cantidad:1})])).rows[0].r;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[e.rutas[0]]);return id;
  };
  const preparar=async()=>{const datos={evidencia_id:await foto()},v=r.tarea.version;r=await op('preparado',datos);await op('preparado',datos,v);await login(2);r=await op('escanear');r=await op('confirmar_resto_revision');};
  const retirar=async()=>{const datos={destino:'Obra QA',evidencia_id:await foto(),plan:r.plan_salida},v=r.tarea.version;r=await op('confirmar_retiro',datos);await op('confirmar_retiro',datos,v);return r;};
  await login(1);await db.exec('set role authenticated');r=await op('escanear');assert.equal(r.abastecimiento,true);
  assert.ok(r.bloqueos_despacho.some(b=>b.codigo==='CANTIDAD'));
  await assert.rejects(()=>db.query("select comprar_directo(9221,'Proveedor',1,'QA')"),/miniapp/);
  await assert.rejects(()=>op('registrar_abastecimiento',{id:randomUUID(),linea_id:9211,tipo:'COMPRA_RAPIDA',cantidad_base:1,referencia:'Tercero'}),/no pertenece/);
  const tienda={id:randomUUID(),linea_id:9201,tipo:'TIENDA',cantidad_base:3,referencia:'Tienda QA',sucursal_tienda_id:2};
  const v=r.tarea.version;r=await op('registrar_abastecimiento',tienda);await op('registrar_abastecimiento',tienda,v);
  await assert.rejects(()=>op('registrar_abastecimiento',{...tienda,cantidad_base:4},v),/otra recepción/);
  await assert.rejects(()=>op('declarar_pendiente',{linea_id:9201,pendiente_tipo:'TIENDA',observacion:'QA'},v),/cambió/);
  await login(2);await assert.rejects(()=>op('registrar_abastecimiento',{id:randomUUID(),linea_id:9201,tipo:'COMPRA_RAPIDA',cantidad_base:1,referencia:'Tercero'}),/Sólo el alistador/);await login(1);
  assert.equal(await stock(23),100,'Declarar Tienda no mueve su stock');
  r=await op('registrar_abastecimiento',{id:randomUUID(),linea_id:9201,tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Tercero'});
  assert.equal(Number((await db.query('select pendiente from v_pedido_linea_reserva where linea_id=9201')).rows[0].pendiente),5,'Vista accesible sin dar acceso a recibos privados');
  assert.equal(await stock(22),4,'Compra rápida no entra al inventario');
  r=await op('gestionar_compra',{linea_id:9201,cantidad_base:1,observacion:'No se consiguió localmente'});
  const formal=r.lineas.find(l=>l.snapshot.estado==='POR_COMPRAR');assert.ok(formal);assert.notEqual(formal.pedido_linea_id,9201);
  r=await op('guardar_preparacion',{linea_id:9201,cantidad_base:9});r=await op('confirmar_resto');
  const origenes=r.lineas.find(l=>l.pedido_linea_id===9201).origenes_preparacion;
  assert.deepEqual(origenes.map(x=>[x.tipo,Number(x.cantidad_base)]),[['TIENDA',3],['COMPRA_RAPIDA',2],['ALMACEN',4]]);
  await preparar();assert.equal(r.plan_salida[0].asignaciones.reduce((n,a)=>n+Number(a.cantidad_base),0),4);
  const bad=structuredClone(r.plan_salida);bad[0].origenes[0].cantidad_base=4;
  await assert.rejects(async()=>op('confirmar_retiro',{destino:'Obra QA',evidencia_id:await foto(),plan:bad}),/plan de salida/);
  const reubicados=[{tipo:'ALMACEN',cantidad_base:9}];await assert.rejects(()=>op('guardar_revision',{linea_id:9201,cantidad_base:9,origenes:reubicados,metodo:'visual'}),/Devuelve/);
  // Simular un corte lógico después del stock y antes de persistir el consumo.
  await db.exec("reset role;create function public.qa_corte_consumo() returns trigger language plpgsql as $$begin raise exception 'QA corte transaccional';end$$;create trigger qa_corte before insert on almacen_operaciones.consumo_recepcion for each row execute function public.qa_corte_consumo();set role authenticated;");
  await assert.rejects(async()=>op('confirmar_retiro',{destino:'Obra QA',evidencia_id:await foto(),plan:r.plan_salida}),/corte transaccional/);assert.equal(await stock(22),4,'Rollback restaura stock si falla el consumo documental');
  await db.exec('reset role;drop trigger qa_corte on almacen_operaciones.consumo_recepcion;drop function public.qa_corte_consumo();set role authenticated;');
  r=await op('consultar');assert.equal(Number(r.lineas.find(l=>l.pedido_linea_id===9201).snapshot.cantidad_despachada),0);assert.equal(r.retiro,null);
  await retirar();assert.equal(r.pedido.estado,'ABIERTO');assert.equal(r.resumen_pedido.estado,'PARCIAL');assert.equal(await stock(22),0);assert.equal(await stock(23),100);
  const primera=r.tarea.id;await login(1);r=await op('escanear');assert.notEqual(r.tarea.id,primera,'Mismo QR abre la siguiente entrega');
  assert.equal(r.numero_entrega,2);assert.equal(r.lineas.filter(l=>l.vigente).length,1);
  const compra=(await db.query('select id from compra_solicitud where pedido_linea_id=$1',[formal.pedido_linea_id])).rows[0].id;
  await db.query('select recibir_compra($1,22,1,$2)',[compra,'Prepara QA']);
  r=await op('consultar');assert.ok(r.cambios.length);r=await op('sincronizar');
  await assert.rejects(()=>op('registrar_abastecimiento',{id:randomUUID(),linea_id:formal.pedido_linea_id,tipo:'COMPRA_RAPIDA',cantidad_base:1,referencia:'Tercero'}),/compra recibida/);
  r=await op('confirmar_resto');await preparar();await retirar();assert.equal(r.pedido.estado,'COMPLETADO');assert.equal(await stock(22),0);
  assert.equal(r.resumen_pedido.entregas.length,2);
  await db.exec('reset role');const mensajes=(await db.query("select etapa,mensajes from evidencia_operacion.lote where documento_id=920 and estado<>'BORRADOR' order by creado_en")).rows;
  assert.equal(mensajes.length,4);assert.match(mensajes[1].mensajes.join('\n'),/Parcial/);assert.match(mensajes[1].mensajes.join('\n'),/Compra rápida para este pedido/);assert.match(mensajes[3].mensajes.join('\n'),/Final/);

  // Personalizado 6+4: no producto artificial, inventario ni cierre anticipado.
  pedido=921;await login(1);await db.exec('set role authenticated');r=await op('escanear');
  r=await op('registrar_abastecimiento',{id:randomUUID(),linea_id:9211,tipo:'COMPRA_RAPIDA',cantidad_base:6,referencia:'Tercero'});
  assert.equal(Number((await db.query("select cantidad_base from compra_solicitud where pedido_linea_id=9211 and estado='SOLICITADA'")).rows[0].cantidad_base),4,'Reduce solicitud pendiente sin duplicarla');
  r=await op('guardar_preparacion',{linea_id:9211,cantidad_base:6,observacion:'Faltan cuatro',pendiente_tipo:'COMPRA_RAPIDA'});
  await preparar();await retirar();assert.equal(r.pedido.estado,'ABIERTO');assert.equal((await db.query('select estado from pedido_linea where id=9211')).rows[0].estado,'ESPECIAL');
  await login(1);r=await op('escanear');await db.exec("reset role;update compra_solicitud set estado='COMPRADA' where pedido_linea_id=9211 and estado='SOLICITADA';set role authenticated;");
  await assert.rejects(()=>op('registrar_abastecimiento',{id:randomUUID(),linea_id:9211,tipo:'COMPRA_RAPIDA',cantidad_base:4,referencia:'Tercero'}),/compra comprometida/);
  await db.exec("reset role;update compra_solicitud set estado='SOLICITADA' where pedido_linea_id=9211 and estado='COMPRADA';set role authenticated;");
  r=await op('registrar_abastecimiento',{id:randomUUID(),linea_id:9211,tipo:'COMPRA_RAPIDA',cantidad_base:4,referencia:'Tercero'});
  r=await op('confirmar_resto');await preparar();await retirar();assert.equal(r.pedido.estado,'COMPLETADO');assert.equal(Number((await db.query('select cantidad_despachada from pedido_linea where id=9211')).rows[0].cantidad_despachada),10);

  // Compra rápida recibida por seis; el verificador retira cuatro y quedan dos asignadas.
  pedido=922;await login(1);r=await op('escanear');
  r=await op('registrar_abastecimiento',{id:randomUUID(),linea_id:9221,tipo:'COMPRA_RAPIDA',cantidad_base:6,referencia:'Marca QA'});
  r=await op('confirmar_resto');r=await op('preparado',{evidencia_id:await foto()});await login(2);r=await op('escanear');
  r=await op('guardar_revision',{linea_id:9221,cantidad_base:4,metodo:'visual',observacion:'Dos se retiran después'});await retirar();
  await login(1);r=await op('escanear');assert.equal(r.lineas[0].recepciones[0].saldo,2);
  r=await op('confirmar_resto');await preparar();await retirar();assert.equal(r.pedido.estado,'COMPLETADO');assert.equal(await stock(22),0);
  pedido=923;await login(1);r=await op('escanear');r=await op('guardar_preparacion',{linea_id:9231,cantidad_base:0,pendiente_tipo:'COMPRA_GESTIONADA',observacion:'Esperando recepción'});
  await assert.rejects(async()=>op('preparado',{evidencia_id:await foto()}),/al menos un producto/);assert.equal(r.resumen_pedido.estado,'PENDIENTE');
  r=await op('registrar_abastecimiento',{id:randomUUID(),linea_id:9231,tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Tercero'});const receipt=r.lineas[0].recepciones[0].id;
  r=await op('reabrir',{observacion:'Volver a contar'});assert.equal(r.lineas[0].recepciones.find(x=>x.id===receipt).saldo,2,'Reabrir conserva lo recibido');
  pedido=924;await login(2);r=await op('consultar');assert.equal(r.abastecimiento,false);assert.equal(r.salida_qr_legada,true);
  await db.exec("reset role;select registrar_entrada(22,22,1,'QA recepción para legado','QA');set role authenticated;");r=await op('consultar');
  const legacyPlan=r.plan_salida,legacyVersion=r.tarea.version;
  await assert.rejects(()=>db.query('select despachar_linea(9241,$1,$2)',[JSON.stringify([{ubicacion_id:22,cantidad_base:1}]),'QA']),/miniapp/);assert.equal(await stock(22),1);
  r=await op('confirmar_salida_legada',{plan:legacyPlan});await op('confirmar_salida_legada',{plan:legacyPlan},legacyVersion);assert.equal(r.tarea.estado,'DESPACHADO');assert.equal(r.abastecimiento,false);assert.equal(await stock(22),0);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*) n from almacen_operaciones.consumo_recepcion where recepcion_id=$1',[tienda.id])).rows[0].n,1);
  const evento=(await db.query('select id from pedido_despacho_evento where pedido_linea_id=9221 order by id limit 1')).rows[0].id;
  const correccion={id:randomUUID(),motivo:'Material devuelto completo al pedido'};
  await db.exec('set role authenticated');await assert.rejects(()=>db.query('select corregir_salida_documental($1,$2,$3)',[evento,correccion.motivo,correccion.id]),/Sólo un encargado/);
  await db.exec(`reset role;insert into perfil(id,nombre,email,rol,sucursal_id) values('${uid(20)}','Admin QA','admin@qa.invalid','admin',1);set role authenticated;`);await login(20);
  const corregir=()=>db.query('select corregir_salida_documental($1,$2,$3)',[evento,correccion.motivo,correccion.id]);await corregir();await corregir();
  pedido=922;r=await op('consultar');assert.equal(r.resumen_pedido.estado,'PARCIAL');assert.equal(await stock(22),0);assert.equal(await stock(23),100);assert.equal(r.lineas[0].recepciones[0].saldo,4,'Corrección documental devuelve la asignación sin Kardex');
  await db.exec('reset role');
  // Nuevos personalizados no nacen como compras. El origen se declara explícitamente.
  await db.exec("insert into pedido(id,categoria,numero) values(925,'TIENDA','QA-ORIGEN-EXPLICITO');insert into pedido_linea(id,pedido_id,es_personalizado,descripcion,unidad_medida,cantidad_base,estado,sucursal_origen_id) values(9251,925,true,'Personalizado disponible','unidad',10,'ESPECIAL',1);insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id) values(9252,925,22,22,144,144,1,1);");
  assert.equal((await db.query('select count(*) n from compra_solicitud where pedido_linea_id=9251')).rows[0].n,0);
  pedido=925;await login(1);await db.exec('set role authenticated');r=await op('escanear');
  await assert.rejects(()=>op('guardar_preparacion',{linea_id:9251,cantidad_base:10}),/Declara el origen/);
  await assert.rejects(()=>op('confirmar_resto'),/Declara el origen/);
  r=await op('guardar_preparacion',{linea_id:9251,cantidad_base:10,origenes:[{tipo:'EXISTENCIA_PERSONALIZADA',cantidad_base:10}]});
  r=await op('guardar_preparacion',{linea_id:9251,cantidad_base:6,observacion:'Cuatro después',pendiente_tipo:'POR_COMPLETAR'});
  assert.equal(Number(r.lineas.find(l=>l.pedido_linea_id===9251).origenes_preparacion[0].cantidad_base),6,'Conserva el origen ya declarado al reducir cantidades');
  r=await op('guardar_preparacion',{linea_id:9251,cantidad_base:10,origenes:[{tipo:'EXISTENCIA_PERSONALIZADA',cantidad_base:10}]});
  r=await op('guardar_preparacion',{linea_id:9252,cantidad_base:144});
  assert.equal(r.bloqueos_despacho.find(b=>b.linea_id===9252).codigo,'STOCK','Stock insuficiente visible antes de revisión');
  assert.equal(r.lineas.find(l=>l.pedido_linea_id===9252).stock_almacen[0].cantidad_base,0);
  r=await op('guardar_preparacion',{linea_id:9252,cantidad_base:0,observacion:'Se enviará después'});
  assert.equal(r.lineas.find(l=>l.pedido_linea_id===9252).pendiente_tipo,'POR_COMPLETAR');
  assert.ok(!r.bloqueos_despacho.some(b=>b.linea_id===9252),'El cero no exige stock ni origen de esta entrega');
  r=await op('registrar_abastecimiento',{id:randomUUID(),linea_id:9251,tipo:'COMPRA_RAPIDA',cantidad_base:10,referencia:'Tercero'});
  await assert.rejects(()=>op('guardar_preparacion',{linea_id:9251,cantidad_base:10,origenes:[{tipo:'EXISTENCIA_PERSONALIZADA',cantidad_base:10}]}),/Reutiliza primero/);
  r=await op('guardar_preparacion',{linea_id:9251,cantidad_base:10});
  assert.equal(r.lineas.find(l=>l.pedido_linea_id===9251).origenes_preparacion[0].tipo,'COMPRA_RAPIDA');
  await preparar();
  await db.exec(`reset role;update almacen_preparacion_linea set origenes_preparacion='[{"tipo":"EXISTENCIA_PERSONALIZADA","cantidad_base":10}]',origenes_revision='[{"tipo":"EXISTENCIA_PERSONALIZADA","cantidad_base":10}]' where preparacion_id=${r.tarea.id} and pedido_linea_id=9251;set role authenticated;`);
  r=await op('consultar');assert.equal(r.bloqueos_despacho.find(b=>b.linea_id===9251).codigo,'RECEPCION');assert.match(r.plan_salida[0].error,/Reutiliza primero/);
  await assert.rejects(async()=>op('confirmar_retiro',{destino:'Obra QA',evidencia_id:await foto(),plan:r.plan_salida}),/resuelve|Corrige|stock|origen|Reutiliza/i);
  await db.exec(`reset role;update almacen_preparacion_linea set origenes_preparacion=jsonb_build_array(jsonb_build_object('tipo','COMPRA_RAPIDA','recepcion_id',(select id from almacen_operaciones.recepcion_pedido where pedido_linea_id=9251),'cantidad_base',10)),origenes_revision=jsonb_build_array(jsonb_build_object('tipo','COMPRA_RAPIDA','recepcion_id',(select id from almacen_operaciones.recepcion_pedido where pedido_linea_id=9251),'cantidad_base',10)) where preparacion_id=${r.tarea.id} and pedido_linea_id=9251;set role authenticated;`);
  r=await op('consultar');await retirar();assert.equal(r.resumen_pedido.estado,'PARCIAL');
  await login(1);r=await op('escanear');assert.equal(r.lineas.filter(l=>l.vigente).length,1);
  await db.exec('reset role');
  await db.exec("insert into pedido(id,categoria,numero) values(926,'TIENDA','QA-COMPRA-RECIBIDA-CUSTOM');insert into pedido_linea(id,pedido_id,es_personalizado,descripcion,unidad_medida,cantidad_base,estado,sucursal_origen_id) values(9261,926,true,'Material personalizado comprado','unidad',6,'ESPECIAL',1);");
  pedido=926;await login(1);await db.exec('set role authenticated');r=await op('escanear');r=await op('gestionar_compra',{linea_id:9261,cantidad_base:6,observacion:'Compra explícita'});
  const solicitudPersonal=(await db.query('select id from compra_solicitud where pedido_linea_id=9261')).rows[0].id;
  await db.query('select recibir_compra($1,null,6,$2)',[solicitudPersonal,'Prepara QA']);
  r=await op('consultar');if(r.cambios.length)r=await op('sincronizar');assert.equal(r.lineas[0].compra_recibida_base,6);
  r=await op('guardar_preparacion',{linea_id:9261,cantidad_base:6});assert.equal(r.lineas[0].origenes_preparacion[0].tipo,'EXISTENCIA_PERSONALIZADA');
  await assert.rejects(()=>op('registrar_abastecimiento',{id:randomUUID(),linea_id:9261,tipo:'COMPRA_RAPIDA',cantidad_base:6,referencia:'Tercero'}),/compra recibida/);
  await preparar();await retirar();assert.equal(r.pedido.estado,'COMPLETADO');assert.equal(r.lineas[0].compra_recibida_base,0);await db.exec('reset role');
  console.log('OK: abastecimiento 4+3+2+1, mismo QR y dos entregas, Tienda sin stock, compras sin duplicar, personalizados 6+4 y saldo rápido 4+2');
}
