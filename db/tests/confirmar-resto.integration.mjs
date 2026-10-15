import assert from 'node:assert/strict';

export async function testConfirmarResto(db, { login, stock, count, uid }) {
  const pedido = async (id,accion='consultar',datos={},version=null) =>
    (await db.query('select operar_preparacion_pedido($1,1,null,$2,$3,$4::jsonb) result',[id,accion,version,JSON.stringify(datos)])).rows[0].result;
  const confirmar = async (tipo,id,tarea,version,sucursal=1) =>
    (await db.query('select confirmar_resto_preparacion($1,$2,$3,$4,$5) result',[tipo,id,sucursal,tarea,version])).rows[0].result;
  await db.exec([
    "insert into pedido(id,categoria,numero) values(2000,'MAYOR','PED-QA-COMPLETO'),(2100,'MAYOR','PED-QA-ROLLBACK');",
    "insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id)",
    "select 2000+n,2000,1,2,24,2,10,10,1 from generate_series(1,40) n;",
    "insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id)",
    "select 2100+n,2100,1,2,24,2,10,10,1 from generate_series(1,3) n;",
  ].join('\n'));
  await login(1);await db.exec('set role authenticated');
  let p=await pedido(2000,'escanear');
  for (const [linea_id,cantidad_base] of [[2001,12],[2002,0],[2003,6]]) {
    p=await pedido(2000,'guardar_preparacion',{linea_id,cantidad_base,observacion:'QA faltante registrado'},p.tarea.version);
  }
  const anterior=structuredClone(p);
  const stockAntes=await stock(1),kAntes=await count('kardex_transacciones');
  await login(2);
  await assert.rejects(()=>confirmar('PEDIDO',2000,p.tarea.id,p.tarea.version),/preparador asignado/);
  await login(3);
  await assert.rejects(()=>confirmar('PEDIDO',2000,p.tarea.id,p.tarea.version),/perfil no puede/);
  await login(1);
  await assert.rejects(()=>confirmar('PEDIDO',2000,p.tarea.id,null),/otro celular/);
  p=await confirmar('PEDIDO',2000,p.tarea.id,p.tarea.version);
  assert.equal(p.confirmacion_preparacion.confirmadas,37);
  assert.equal(p.tarea.version,anterior.tarea.version+1,'Una versión para todo el lote');
  assert.equal(p.tarea.estado,'PREPARANDO','No termina ni verifica el documento');
  assert.equal(p.lineas.filter(l=>l.confirmada).length,40);
  for (const id of [2001,2002,2003]) {
    assert.deepEqual(p.lineas.find(l=>l.pedido_linea_id===id),anterior.lineas.find(l=>l.pedido_linea_id===id),'Conserva cantidades, observaciones y ceros');
  }
  assert(p.lineas.every(l=>l.revisada_base===null),'No marca revisión física');
  assert.equal(await stock(1),stockAntes);assert.equal(await count('kardex_transacciones'),kAntes);
  const evento=(await db.query("select * from almacen_preparacion_evento where preparacion_id=$1 and accion='RESTO_PREPARACION_CONFIRMADO'",[p.tarea.id])).rows;
  assert.equal(evento.length,1);assert.equal(evento[0].actor_id,uid(1));assert.equal(evento[0].detalle.cantidad_lineas,37);
  assert.equal(evento[0].detalle.lineas_confirmadas.length,37);
  await assert.rejects(()=>confirmar('PEDIDO',2000,p.tarea.id,anterior.tarea.version),/otro celular/);
  const noOp=await confirmar('PEDIDO',2000,p.tarea.id,p.tarea.version);
  assert.equal(noOp.tarea.version,p.tarea.version,'No duplica el evento cuando no queda nada');
  p=await pedido(2000,'preparado',{},p.tarea.version);
  await assert.rejects(()=>confirmar('PEDIDO',2000,p.tarea.id,p.tarea.version),/en preparación/);
  await db.exec('reset role');

  await db.exec([
    "insert into venta(id,ubicacion_id,numero,subtotal,total) values(2000,4,'VTD-QA-COMPLETO',50,50);",
    "insert into venta_linea(id,venta_id,producto_id,presentacion_id,cantidad,cantidad_presentacion,precio_lista,precio_unitario) values",
    "(2001,2000,1,2,24,2,10,10),(2002,2000,1,2,12,1,10,10),(2003,2000,1,2,24,2,10,10);",
  ].join('\n'));
  await db.exec('set role authenticated');
  const vtd=async (accion='consultar',datos={},version=null)=>
    (await db.query("select operar_documento_movil('VTD',2000,$1,$2,$3::jsonb) result",[accion,version,JSON.stringify(datos)])).rows[0].result;
  let v=await vtd('escanear');
  v=await vtd('guardar_preparacion',{linea_id:v.lineas[0].id,cantidad_base:12,observacion:'QA falta una caja'},v.tarea.version);
  const faltante=structuredClone(v.lineas[0]);
  await assert.rejects(()=>confirmar('VTD',2000,v.tarea.id,v.tarea.version,2),/otra sucursal/);
  await assert.rejects(()=>confirmar('VTD',2000,v.tarea.id+1,v.tarea.version),/no corresponde/);
  v=await confirmar('VTD',2000,v.tarea.id,v.tarea.version);
  assert.equal(v.confirmacion_preparacion.confirmadas,2);
  assert.deepEqual(v.lineas[0],faltante);
  assert(v.lineas.slice(1).every(l=>Number(l.preparada_base)===Number(l.declarada_base)&&l.confirmada));
  assert(v.lineas.every(l=>l.revisada_base===null));
  await assert.rejects(()=>vtd('preparado',{},v.tarea.version),/entrega completa/);
  assert.equal(await stock(1),stockAntes);assert.equal(await count('kardex_transacciones'),kAntes);
  await db.exec('reset role');

  let rollback=await pedido(2100,'escanear');
  await db.exec([
    "create function test_bulk_rollback() returns trigger language plpgsql as $$begin",
    "if new.pedido_linea_id=2102 and new.confirmada then raise exception 'Fallo QA de confirmación';end if;return new;end;$$;",
    "create trigger test_bulk_rollback before update on almacen_preparacion_linea for each row execute function test_bulk_rollback();",
  ].join('\n'));
  await db.exec('set role authenticated');
  await assert.rejects(()=>confirmar('PEDIDO',2100,rollback.tarea.id,rollback.tarea.version),/Fallo QA/);
  const sinCambios=await pedido(2100);
  assert.deepEqual(sinCambios,rollback,'Un error revierte todas las líneas y la auditoría');
  await db.exec('reset role;drop trigger test_bulk_rollback on almacen_preparacion_linea;');
  await db.exec('update pedido_linea set cantidad_base=36 where id=2103;');
  await db.exec('set role authenticated');
  await assert.rejects(()=>confirmar('PEDIDO',2100,rollback.tarea.id,rollback.tarea.version),/documento cambió/);
  await assert.rejects(()=>confirmar('TRASLADO_VIRTUAL',2100,rollback.tarea.id,rollback.tarea.version),/sólo corresponde/);
  await db.exec('reset role');
  await db.query('update perfil set activo=false where id=$1',[uid(1)]);
  await assert.rejects(()=>confirmar('PEDIDO',2100,rollback.tarea.id,rollback.tarea.version),/perfil no puede/);
  await db.query('update perfil set activo=true where id=$1',[uid(1)]);
  for (const schema of ['public','almacen_operaciones']) {
    assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') permitido",[schema+'.confirmar_resto_preparacion(text,bigint,bigint,bigint,integer)'])).rows[0].permitido,false);
  }
  console.log('OK: 40 líneas/3 faltantes, 37 completas en un lote, VTD, versiones, permisos, rollback y sin stock/revisión');
}
