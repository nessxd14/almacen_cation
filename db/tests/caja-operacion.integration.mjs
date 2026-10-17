import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// Kardex real, presentación x12 y cobro VTD real en PostgreSQL aislado.
export async function testCajaOperacion(db, { login, stock, count }) {
  await login(7);
  await db.exec(`update sesion_caja set estado='ABIERTA' where id=1;
    alter table venta_linea add column if not exists descripcion text;
    insert into venta(id,ubicacion_id,numero,subtotal,total,cobro_exigible,sesion_caja_id) values(700,4,'VTD-QA-700',20,20,true,1),(701,4,'VTD-QA-701',20,20,true,1);
    insert into venta_linea(id,venta_id,producto_id,presentacion_id,cantidad,cantidad_presentacion,precio_lista,precio_unitario) values(700,700,1,2,24,2,10,10),(701,701,1,2,24,2,10,10);`);
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261017140005_caja_almacen_operacion_unica.sql',import.meta.url),'utf8'));
  const op='20000000-0000-0000-0000-000000000001';
  const rpc=async(action,data={},id=op)=>(await db.query('select operar_caja_almacen($1,$2,1,$3) r',[action,id,JSON.stringify(data)])).rows[0].r;
  const quantities=d=>d.lineas.map(l=>({linea_id:l.linea_id,cantidad_base:l.cantidad_base}));
  await db.exec('set role authenticated');
  await rpc('vincular',{vtd_ids:[700],borrador:{cart:[]}});
  await assert.rejects(()=>db.query("select completar_venta(700,'Caja QA')"),/dos personas|verificada|operación de Caja/);
  const pay=()=>db.query("select checkout_caja(p_lineas=>'[]',p_pagos=>'[{\"metodo\":\"EFECTIVO\",\"monto\":20}]',p_sesion_id=>1,p_idempotencia=>$1,p_vtd_ids=>array[700]::bigint[])",['checkout:'+op]);
  await pay();const before=await stock(1),kBefore=await count('kardex_transacciones');
  await db.exec('reset role');await login(1);await db.exec('set role authenticated');
  let r=await rpc('escanear',{venta_id:700},null),d=r.vtds[0];
  assert((await rpc('listar_almacen',{},null)).documentos.some(x=>x.venta_id===700),'La entrega aparece en la bandeja de Almacén');
  assert.equal(r.operacion.borrador,undefined,'Almacén no recibe el carrito ni el cobro de Caja');
  r=await rpc('enviar',{venta_id:700,version:d.version,cantidades:quantities(d)},null);
  assert.equal(await stock(1),before-24,'Dos cajas x12 salen del estante real');
  assert.equal(await count('kardex_transacciones'),kBefore+1);
  await rpc('enviar',{venta_id:700,version:d.version,cantidades:quantities(d)},null);
  assert.equal(await count('kardex_transacciones'),kBefore+1);
  await db.exec('reset role');await login(7);await db.exec('set role authenticated');
  await rpc('completar');assert.equal(await stock(1),before-24,'Caja completa sin repetir Kardex');
  await db.exec('reset role');
  // Envío antes de cobrar y rechazo sin pago: el retorno espera recepción real.
  const op2='20000000-0000-0000-0000-000000000002';
  await rpc('vincular',{vtd_ids:[701],borrador:{cart:[]}},op2);
  await login(1);r=await rpc('consultar_vtd',{venta_id:701},null);d=r.vtds[0];
  await assert.rejects(()=>rpc('enviar',{venta_id:701,version:d.version,cantidades:quantities(d)},null),/motivo para regularizar/);
  await rpc('enviar',{venta_id:701,version:d.version,cantidades:quantities(d),motivo:'QA escaneo omitido, verificación física actual'},null);
  const afterSend=await stock(1);
  await login(7);r=await rpc('rechazar',{venta_id:701,motivo:'Cliente canceló la entrega'},op2);assert.equal(r.vtds[0].estado,'RETORNO_PENDIENTE');assert.equal(await stock(1),afterSend);
  await rpc('cerrar_rechazo',{},op2);
  await login(1);r=await rpc('consultar_vtd',{venta_id:701},null);d=r.vtds[0];
  assert.equal(d.escaneado_en,null,'La regularización no inventa un escaneo pasado');
  await rpc('recibir_retorno',{venta_id:701,version:d.version,cantidades:quantities(d)},null);
  assert.equal(await stock(1),afterSend+24);
  const kAfter=await count('kardex_transacciones');await rpc('recibir_retorno',{venta_id:701,version:d.version,cantidades:quantities(d)},null);assert.equal(await count('kardex_transacciones'),kAfter);
  console.log('OK: Caja–Almacén con Kardex real, x12, un encargado, cobro sin doble salida, regularización y retorno real');
}
