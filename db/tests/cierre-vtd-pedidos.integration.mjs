import assert from 'node:assert/strict';

// Usa las RPC y el motor de Kardex reales sobre documentos sintéticos en memoria.
export async function testCierreCaja(db, { login, call, step, stock, count, uid }) {
  await db.exec(`insert into perfil(id,nombre,email,rol,sucursal_id) values
    ('${uid(7)}','Caja QA','caja@qa.invalid','cajero',1),
    ('${uid(8)}','Otra caja QA','otra-caja@qa.invalid','cajero',1);
    insert into sesion_caja(id,caja_id,cajero_id,estado) values(1,1,'${uid(7)}','ABIERTA'),(2,2,'${uid(8)}','ABIERTA');
    select registrar_entrada(1,1,500,'QA circuito','QA');
    insert into pedido(id,categoria,numero) values(100,'TIENDA','PED-QA-DESPACHO'),(101,'TIENDA','PED-QA-PARCIAL');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id) values
      (100,100,1,1,10,10,1,1,1),(101,100,1,1,8,8,1,1,1),(102,101,1,1,10,10,1,1,1);`);
  const pedido = async (id,accion='consultar',datos={},version=null) =>
    (await db.query('select operar_preparacion_pedido($1,1,null,$2,$3,$4::jsonb) result',[id,accion,version,JSON.stringify(datos)])).rows[0].result;
  const preparar = async (id,cantidades) => {
    await login(1);let p=await pedido(id,'escanear');
    for (const [linea_id,cantidad_base] of cantidades) p=await pedido(id,'guardar_preparacion',{linea_id,cantidad_base,observacion:'QA entrega parcial'},p.tarea.version);
    p=await pedido(id,'preparado',{},p.tarea.version);
    await login(2);p=await pedido(id,'escanear');
    for (const [linea_id,cantidad_base] of cantidades) p=await pedido(id,'guardar_revision',{linea_id,cantidad_base,metodo:'visual'},p.tarea.version);
    return pedido(id,'verificado',{},p.tarea.version);
  };
  const despachar = (id,cantidad) => db.query("select _despachar_linea_nucleo($1,$2::jsonb,'Verifica QA',true)",[id,JSON.stringify([{ubicacion_id:1,cantidad_base:cantidad}])]);
  let p=await preparar(100,[[100,10],[101,8]]);
  const stockAntes=await stock(1), kardexAntes=await count('kardex_transacciones');
  await despachar(100,5);assert.equal((await pedido(100)).tarea.estado,'VERIFICADO','Despacho parcial no cierra');
  await despachar(100,5);assert.equal((await pedido(100)).tarea.estado,'VERIFICADO','Debe salir también la segunda línea');
  await despachar(101,8);p=await pedido(100,'escanear');
  assert.equal(p.pedido.estado,'COMPLETADO');assert.equal(p.tarea.estado,'DESPACHADO');assert.equal(p.entregada,true);
  assert.equal(await stock(1),stockAntes-18);assert.equal(await count('kardex_transacciones'),kardexAntes+3);
  const eventos=await db.query("select count(*)::int n from almacen_preparacion_evento where preparacion_id=$1 and accion='DESPACHO_REGISTRADO'",[p.tarea.id]);
  assert.equal(eventos.rows[0].n,1);
  await pedido(100,'consultar');await pedido(100,'escanear');
  assert.equal(await count('kardex_transacciones'),kardexAntes+3,'Consultar no repite salidas');
  assert.equal((await db.query("select count(*)::int n from almacen_preparacion_evento where preparacion_id=$1 and accion='DESPACHO_REGISTRADO'",[p.tarea.id])).rows[0].n,1);
  p=await preparar(101,[[102,4]]);const primerId=p.tarea.id;
  await despachar(102,4);p=await pedido(101);
  assert.equal(p.pedido.estado,'ABIERTO');assert.equal(p.tarea.estado,'DESPACHADO','Cierra la entrega preparada, aunque el pedido tenga saldo');
  await login(1);p=await pedido(101,'escanear');assert.notEqual(p.tarea.id,primerId);
  assert.equal(p.tarea.estado,'PREPARANDO');assert.equal(p.entregada,false);assert.equal(Number(p.lineas[0].snapshot.pendiente_base),6);
  console.log('OK: Pedido parcial, todas las líneas, checklist cerrado, historial único y siguiente entrega');

  const cobrar = async (ids,pagos,key,sesion=1) =>
    (await db.query('select cobrar_vtd($1::bigint[],$2,$3::jsonb,$4) result',[ids,sesion,JSON.stringify(pagos),key])).rows[0].result;
  const pagos = [{metodo:'EFECTIVO',monto:30,recibido:50}];
  await db.exec(`insert into venta(id,ubicacion_id,numero,subtotal,total,cobro_exigible,sesion_caja_id) values
    (100,4,'VTD-QA-100',20,20,true,1),(101,4,'VTD-QA-101',10,10,true,1),
    (102,4,'VTD-QA-102',12,12,true,1),(103,4,'VTD-QA-103',8,8,true,1),
    (104,4,'VTD-QA-104',0,0,true,1),(105,4,'VTD-QA-105',5,5,true,1);
    insert into venta_linea(id,venta_id,producto_id,presentacion_id,cantidad,cantidad_presentacion,precio_lista,precio_unitario) values
      (100,100,1,1,20,20,1,1),(101,101,1,1,10,10,1,1),(102,102,1,1,12,12,1,1),
      (103,103,1,1,8,8,1,1),(104,104,1,1,1,1,0,0),(105,105,1,1,5,5,1,1);`);
  const alistar = async id => {
    await login(1);let v=await call('VTD',id,'escanear');
    for(const l of v.lineas) v=await step('VTD',id,v,'guardar_preparacion',{linea_id:l.id,cantidad_base:Number(l.declarada_base)});
    v=await step('VTD',id,v,'preparado');await login(2);v=await call('VTD',id,'escanear');
    for(const l of v.lineas) v=await step('VTD',id,v,'guardar_revision',{linea_id:l.id,cantidad_base:Number(l.preparada_base),metodo:'visual'});
    return step('VTD',id,v,'verificado');
  };
  let v=await alistar(100);
  await login(7);await db.exec('set role authenticated');
  const stockCobro=await stock(1), kCobro=await count('kardex_transacciones');
  const primera=await cobrar([101,100,100],pagos,'qa_%:cobro');
  assert.deepEqual(primera.ventas.map(v=>v.venta_id),[100,101]);assert.equal(Number(primera.total),30);assert.equal(Number(primera.cambio),20);
  assert.equal(primera.sesion_caja_id,1);assert.equal(primera.pendiente_verificacion,false);
  assert.equal(await stock(1),stockCobro);assert.equal(await count('kardex_transacciones'),kCobro,'Cobrar no entrega');
  assert.equal((await db.query('select estado from venta where id=100')).rows[0].estado,'ABIERTA');
  const counts=await Promise.all(['venta_pago','movimiento_caja','kardex_transacciones'].map(count));
  assert.deepEqual(await cobrar([100,101],pagos,'qa_%:cobro'),{...primera,reintento:true});
  assert.deepEqual(await Promise.all(['venta_pago','movimiento_caja','kardex_transacciones'].map(count)),counts);
  await assert.rejects(()=>cobrar([100,101],[{...pagos[0],recibido:60}],'qa_%:cobro'),/otro cobro/);
  await assert.rejects(()=>cobrar([100,101],pagos,'qa_%:cobro',2),/otro cobro/);
  await assert.rejects(()=>cobrar([100,101],pagos,'qa-new-key'),/ya tiene un cobro/);
  await assert.rejects(()=>db.query("select completar_venta(100,'Caja QA')"),/dos personas/);
  await assert.rejects(()=>db.query('select almacen_operaciones.cobrar_vtd_nucleo(array[100]::bigint[],1,$1::jsonb,$2)',[JSON.stringify(pagos),'bypass']),/permission denied/);
  await assert.rejects(()=>db.query('select * from almacen_operaciones.cobro_vtd_respuesta'),/permission denied/);
  await db.exec('reset role');await login(8);await db.exec('set role authenticated');
  await assert.rejects(()=>cobrar([100,101],pagos,'qa_%:cobro'),/otro cobro/);
  await db.exec('reset role');await login(2);await db.exec('set role authenticated');
  v=await step('VTD',100,v,'autorizar');assert.equal(v.tarea.estado,'DESPACHADO');
  assert.equal(await stock(1),stockCobro-20);assert.equal(await count('kardex_transacciones'),kCobro+1);
  await db.exec('reset role');await login(7);await db.exec('set role authenticated');
  const completada=(await db.query("select completar_venta(100,'Caja QA') result")).rows[0].result;
  assert.equal(completada.reintento,true);assert.equal(Number(completada.total),20);
  assert.equal(await count('kardex_transacciones'),kCobro+1,'Caja reconoce entrega sin repetir Kardex');
  assert.deepEqual(await cobrar([100,101],pagos,'qa_%:cobro'),{...primera,reintento:true},'Recupera el recibo original incluso después de entregar');
  await db.exec('reset role');await login(3);
  await assert.rejects(()=>db.query('select completar_venta(100)'),/perfil no puede/);
  await login(7);await db.exec('set role authenticated');
  const digital=await cobrar([102],[{metodo:'QR',monto:12,referencia:'QA-QR'}],'qa-digital');assert.equal(digital.pendiente_verificacion,true);
  assert.deepEqual(await cobrar([102],[{metodo:'QR',monto:12,referencia:'QA-QR'}],'qa-digital'),{...digital,reintento:true});
  await db.exec('reset role');
  await db.exec("update venta set pago_posterior=true,pago_posterior_motivo='QA paga mañana' where id=103");
  v=await alistar(103);v=await step('VTD',103,v,'autorizar');assert.equal(v.tarea.estado,'DESPACHADO');
  const stockPosterior=await stock(1),kPosterior=await count('kardex_transacciones');
  await login(7);await db.exec('set role authenticated');
  const posterior=await cobrar([103],[{metodo:'TRANSFERENCIA',monto:8,referencia:'QA-POST'}],'qa-posterior');
  assert.equal(posterior.ventas[0].estado,'COMPLETADA');assert.equal(await stock(1),stockPosterior);assert.equal(await count('kardex_transacciones'),kPosterior);
  await db.exec('reset role');v=await alistar(104);v=await step('VTD',104,v,'autorizar');assert.equal(v.tarea.estado,'DESPACHADO','Ticket gratuito no necesita un cobro inexistente');
  await db.exec(`insert into venta(id,ubicacion_id,numero,subtotal,total,cobro_exigible,sesion_caja_id) values
    (106,4,'VTD-QA-106',5,5,true,1),(107,4,'VTD-QA-107',10,10,true,1),
    (108,4,'VTD-QA-108',7,7,true,1),(109,4,'VTD-QA-109',7,7,true,1),(110,4,'VTD-QA-110',6,6,true,1);
    insert into venta_linea(id,venta_id,producto_id,presentacion_id,cantidad,cantidad_presentacion,precio_lista,precio_unitario) values
      (106,106,1,1,5,5,1,1),(107,107,1,1,10,10,1,1),(108,108,1,1,7,7,1,1),
      (109,109,1,1,7,7,1,1),(110,110,1,1,6,6,1,1);`);
  await login(7);
  const legacyPagos=[{metodo:'EFECTIVO',monto:15,recibido:20}];
  await db.query('select almacen_operaciones.cobrar_vtd_nucleo(array[106,107]::bigint[],1,$1::jsonb,$2)',[JSON.stringify(legacyPagos),'qa_legacy%']);
  await db.query('select almacen_operaciones.cobrar_vtd_nucleo(array[108]::bigint[],1,$1::jsonb,$2)',[JSON.stringify([{metodo:'QR',monto:7}]),'qaZlegacy-neighbor']);
  await db.exec('set role authenticated');
  const legacy=await cobrar([106,107],legacyPagos,'qa_legacy%');
  assert.equal(legacy.reintento,true);assert.equal(legacy.sesion_caja_id,1);assert.equal(Number(legacy.total),15);
  assert.deepEqual(legacy.ventas.map(v=>v.venta_id),[106,107],'Los comodines nunca mezclan otro recibo');
  assert.equal(legacy.cambio,null,'No inventa el cambio perdido de un pago antiguo repartido');
  assert.equal(legacy.pendiente_verificacion,false);
  await assert.rejects(()=>cobrar([106,107],[{metodo:'QR',monto:15}],'qa_legacy%'),/otro cobro/);
  await db.exec('reset role;update venta set pago_posterior=true where id=110');
  v=await alistar(110);v=await step('VTD',110,v,'autorizar');
  await login(7);await db.exec('set role authenticated');
  const checkout=async()=> (await db.query("select checkout_caja(p_lineas=>'[]',p_pagos=>$1::jsonb,p_sesion_id=>1,p_idempotencia=>'qa-checkout-conjunto',p_vtd_ids=>array[109,110]::bigint[]) result",[JSON.stringify([{metodo:'EFECTIVO',monto:3,recibido:10},{metodo:'QR',monto:10}])])).rows[0].result;
  const stockCheckout=await stock(1),kCheckout=await count('kardex_transacciones');
  const recibo=await checkout();assert.equal(Number(recibo.total),13);assert.equal(Number(recibo.cambio),7);
  assert.deepEqual(recibo.ventas,[109,110]);assert.equal(await stock(1),stockCheckout);assert.equal(await count('kardex_transacciones'),kCheckout);
  const countsCheckout=await Promise.all(['venta_pago','movimiento_caja','cobro_caja'].map(count));
  assert.deepEqual(await checkout(),{...recibo,reintento:true});
  assert.deepEqual(await Promise.all(['venta_pago','movimiento_caja','cobro_caja'].map(count)),countsCheckout);
  assert.equal(Number((await db.query('select sum(monto) monto from movimiento_caja where venta_id in (109,110)')).rows[0].monto),13);
  await db.exec('reset role');
  await db.exec(`create function test_cobro_rollback() returns trigger language plpgsql as $$begin
    if new.venta_id=105 then raise exception 'Fallo sintético de caja';end if;return new;end;$$;
    create trigger test_cobro_rollback before insert on movimiento_caja for each row execute function test_cobro_rollback();`);
  await login(7);await db.exec('set role authenticated');
  const antesRollback=await Promise.all(['venta_pago','movimiento_caja','kardex_transacciones'].map(count));
  await assert.rejects(()=>cobrar([105],[{metodo:'EFECTIVO',monto:5}],'qa-rollback'),/Fallo sintético/);
  assert.deepEqual(await Promise.all(['venta_pago','movimiento_caja','kardex_transacciones'].map(count)),antesRollback);
  await db.exec('reset role;drop trigger test_cobro_rollback on movimiento_caja;');
  assert.equal((await db.query("select count(*)::int n from almacen_operaciones.cobro_vtd_respuesta where idempotencia='qa-rollback'")).rows[0].n,0);
  await db.exec("update sesion_caja set estado='CERRADA' where id=1");await db.exec('set role authenticated');
  assert.deepEqual(await cobrar([100,101],pagos,'qa_%:cobro'),{...primera,reintento:true},'Respuesta perdida recuperable con turno cerrado');
  assert.deepEqual(await checkout(),{...recibo,reintento:true},'También recupera el recibo conjunto de Caja');
  await assert.rejects(()=>cobrar([105],[{metodo:'EFECTIVO',monto:5}],'qa-new-closed'),/sesión de caja abierta/);
  await db.exec('reset role;');
  for (const signature of ['public.cobrar_vtd(bigint[],bigint,jsonb,text)','almacen_operaciones.cobrar_vtd_seguro(bigint[],bigint,jsonb,text)'])
    assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') permitido",[signature])).rows[0].permitido,false);
  console.log('OK: VTD cobrada/entregada, pago posterior, QR, cambio y reintento exacto, Caja sin doble stock, rollback y permisos');
}
