import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function testPedidosDosActores(db,{login,stock,count,uid}) {
  const fixture=JSON.parse(await fs.readFile(new URL('./pedido_retiro.fixture.json',import.meta.url),'utf8'));
  for(const f of fixture.functions)await db.exec(f);
  await db.exec('create view public.v_pedido_linea_reserva as '+fixture.reserva);
  await db.exec('grant select on public.v_pedido_linea_reserva to authenticated');
  // Entrega del circuito anterior: salió stock, pero nadie registró aún el retiro.
  await db.exec(`insert into pedido(id,categoria,numero) values(904,'TIENDA','QA-LEGADO-SALIDO');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id)
      values(9041,904,1,2,12,1,10,10,1);`);
  let legado;
  const operarLegado=async(accion='consultar',datos={},version=legado?.tarea.version)=>(await db.query('select operar_preparacion_pedido(904,1,null,$1,$2,$3) r',[accion,version||null,JSON.stringify(datos)])).rows[0].r;
  await login(1);legado=await operarLegado('crear');legado=await operarLegado('guardar_preparacion',{linea_id:9041,cantidad_base:12});legado=await operarLegado('preparado');
  await login(2);legado=await operarLegado('escanear');legado=await operarLegado('guardar_revision',{linea_id:9041,cantidad_base:12,metodo:'visual'});legado=await operarLegado('verificado');
  await db.query("select _despachar_linea_nucleo(9041,'[{\"ubicacion_id\":1,\"cantidad_base\":12}]','QA',true)");
  const vtd=(await db.query("select pg_get_functiondef('public.operar_caja_almacen(text,uuid,bigint,jsonb)'::regprocedure) f")).rows[0].f;
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261021192845_pedidos_dos_responsables_evidencias.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("select pg_get_functiondef('public.operar_caja_almacen(text,uuid,bigint,jsonb)'::regprocedure) f")).rows[0].f,vtd);
  await db.exec('update evidencia_operacion.configuracion set activo=true,pedidos_dos_actores=true');
  await db.exec('set role authenticated');legado=await operarLegado();assert.equal(legado.pedido_dos_actores,true);assert.equal(legado.tarea.salida_previa,true);
  const idLegado='60000000-0000-0000-0000-000000000003';
  const fotoLegado=(await db.query("select operar_evidencia_operacion('PEDIDO',904,$1,'crear',$2) r",[legado.tarea.id,JSON.stringify({id:idLegado,version:legado.tarea.version,cantidad:1})])).rows[0].r;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[fotoLegado.rutas[0]]);
  const stockLegado=await stock(1),eventosLegado=await count('pedido_despacho_evento');
  legado=await operarLegado('confirmar_retiro',{evidencia_id:idLegado,destino:'Destino legado',plan:legado.plan_salida});
  assert.equal(legado.retiro.transportista_id,uid(2));assert.equal(await stock(1),stockLegado);assert.equal(await count('pedido_despacho_evento'),eventosLegado,'El material que ya salió no se despacha otra vez');
  await db.exec('reset role');
  assert.equal((await db.query('select transportista_id from evidencia_operacion.retiro r join almacen_preparacion p on p.id=r.preparacion_id where p.pedido_id=901')).rows[0].transportista_id,uid(4),'No se reescribe el responsable de un retiro histórico');
  await db.exec(`
    select registrar_entrada(1,1,5000,'QA dos actores','QA');
    insert into pedido(id,categoria,numero) values(902,'TIENDA','PED-QA-DOS');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id)
      values(9021,902,1,2,24,2,10,10,1),(9022,902,1,2,12,1,10,10,1),(9023,902,1,2,12,1,10,10,1);`);
  let r;
  const pedido=async(accion='consultar',datos={},version=r?.tarea.version,tarea=r?.tarea.id)=>(await db.query('select operar_preparacion_pedido(902,1,$1,$2,$3,$4) r',[tarea||null,accion,version||null,JSON.stringify(datos)])).rows[0].r;
  const foto=async(id)=>{
    const e=(await db.query("select operar_evidencia_operacion('PEDIDO',902,$1,'crear',$2) r",[r.tarea.id,JSON.stringify({id,version:r.tarea.version,cantidad:1})])).rows[0].r;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[e.rutas[0]]);return id;
  };
  await login(1);await db.exec('set role authenticated');r=await pedido('escanear');assert.equal(r.pedido_dos_actores,true);
  r=await pedido('guardar_preparacion',{linea_id:9021,cantidad_base:12,observacion:'Falta una caja'});
  r=await pedido('guardar_preparacion',{linea_id:9023,cantidad_base:0,observacion:'No encontrado'});
  r=await pedido('confirmar_resto');assert.deepEqual(r.lineas.map(l=>Number(l.preparada_base)),[12,12,0]);
  await assert.rejects(()=>pedido('preparado'),/Adjunta fotos/);
  const inicial='60000000-0000-0000-0000-000000000001';await foto(inicial);
  const versionPreparado=r.tarea.version;const tarea=r.tarea.id;
  const antes=await stock(1);r=await pedido('preparado',{evidencia_id:inicial});assert.equal(r.tarea.estado,'PREPARADO');assert.equal(await stock(1),antes);
  await pedido('preparado',{evidencia_id:inicial},versionPreparado);
  await assert.rejects(()=>pedido('tomar_revision'),/otra persona/);
  await login(2);r=await pedido('escanear');assert.equal(r.tarea.revisor_id,uid(2));
  await assert.rejects(()=>pedido('guardar_revision',{linea_id:9021,cantidad_base:6,metodo:'visual'}),/motivo de la diferencia/);
  r=await pedido('guardar_revision',{linea_id:9021,cantidad_base:6,metodo:'visual',observacion:'Se encontraron seis unidades'});
  r=await pedido('confirmar_resto_revision');assert.deepEqual(r.lineas.map(l=>Number(l.revisada_base)),[6,12,0]);assert.equal(r.lineas[0].observacion_revision,'Se encontraron seis unidades');
  const stockDos=await stock(2);
  await db.exec("reset role;select registrar_ajuste(1,1,10,'QA plan repetido','QA','QA');select registrar_ajuste(1,2,8,'QA plan repetido','QA','QA');set role authenticated");
  const repetido=(await pedido()).plan_salida;
  const porBin=new Map();for(const l of repetido)for(const a of l.asignaciones)porBin.set(a.ubicacion_id,(porBin.get(a.ubicacion_id)||0)+Number(a.cantidad_base));
  assert.equal(porBin.get(1),10);assert.equal(porBin.get(2),8);assert.ok(repetido.every(l=>!l.error),'Dos líneas del mismo producto comparten el stock disponible sin asignarlo dos veces');
  await db.exec('reset role');await db.query("select registrar_ajuste(1,1,$1,'QA restaurar','QA','QA'),registrar_ajuste(1,2,$2,'QA restaurar','QA','QA')",[antes,stockDos]);await db.exec('set role authenticated');
  await assert.rejects(()=>pedido('verificado'),/Confirmar revisión y retirar/);
  await assert.rejects(()=>db.query("select despachar_linea(9021,'[{\"ubicacion_id\":1,\"cantidad_base\":6}]','QA')"),/miniapp/);
  assert.equal(await stock(1),antes);
  await assert.rejects(()=>pedido('confirmar_retiro',{destino:'Obra QA',plan:r.plan_salida}),/Adjunta fotos/);
  const final='60000000-0000-0000-0000-000000000002';await foto(final);
  const intencion={evidencia_id:final,destino:'Obra QA',plan:r.plan_salida};const versionRetiro=r.tarea.version;
  const eventos=await count('pedido_despacho_evento');
  await login(4);await assert.rejects(()=>pedido('confirmar_retiro',intencion),/quien verifica/);
  await login(5);await assert.rejects(()=>pedido('confirmar_retiro',intencion),/autorizada/);
  await login(2);
  await assert.rejects(()=>pedido('confirmar_retiro',{...intencion,plan:[]}),/ubicaciones de salida/);
  // Una reserva prioritaria sigue bloqueando la salida. Toda la confirmación,
  // fotos, retiro y eventos deben revertirse cuando el motor FIFO rechaza.
  await db.exec(`reset role;
    insert into pedido(id,categoria,numero,creado_en) values(903,'MAYOR','QA-PRIORITARIO','2000-01-01');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_lista,precio_unitario,sucursal_origen_id)
      values(9031,903,1,1,100000,100000,1,1,1);
    set role authenticated;`);
  await assert.rejects(()=>pedido('confirmar_retiro',intencion),/turno/);
  assert.equal(await stock(1),antes);assert.equal(await count('pedido_despacho_evento'),eventos);
  assert.equal((await pedido()).tarea.estado,'REVISANDO');
  await db.exec("reset role;update pedido_linea set estado='RECHAZADO' where id=9031;set role authenticated");
  const reserva=(await db.query('select stock_producto-(select coalesce(sum(pendiente),0) from v_pedido_linea_reserva b where b.producto_id=a.producto_id and b.turno<a.turno)-24 as cantidad from v_pedido_linea_reserva a where linea_id=9021')).rows[0].cantidad;
  await db.exec('reset role');await db.query("update pedido_linea set estado='POR_DESPACHAR',cantidad_base=$1,cantidad_presentacion=$1 where id=9031",[reserva]);await db.exec('set role authenticated');
  const turnos=(await db.query('select linea_id,cubierto from v_pedido_linea_reserva where linea_id in (9021,9022) order by linea_id')).rows;
  assert.ok(Number(turnos[0].cubierto)>=6);assert.ok(Number(turnos[1].cubierto)<12);
  await assert.rejects(()=>pedido('confirmar_retiro',intencion),/turno/);
  assert.equal(await stock(1),antes,'El fallo de la segunda línea revierte la salida de la primera');assert.equal(await count('pedido_despacho_evento'),eventos);
  await db.exec("reset role;update pedido_linea set estado='RECHAZADO' where id=9031;set role authenticated");
  r=await pedido('confirmar_retiro',intencion);assert.equal(r.tarea.estado,'DESPACHADO');assert.equal(r.retiro.transportista_id,uid(2));
  assert.equal(await stock(1),antes-18);assert.equal(await count('pedido_despacho_evento'),eventos+2);
  await pedido('confirmar_retiro',intencion,versionRetiro);
  assert.equal(await stock(1),antes-18);assert.equal(await count('pedido_despacho_evento'),eventos+2);
  assert.equal((await pedido('escanear')).tarea.id,tarea);
  await assert.rejects(()=>db.query("select operar_evidencia_operacion('PEDIDO',902,$1,'retirar','{}')",[tarea]),/miniapp actualizada/);
  await assert.rejects(()=>db.query("select almacen_operaciones.operar(902,1,$1,'verificado',1,'{}')",[tarea]),/permission denied/);
  r=await pedido('crear');assert.equal(r.pedido_dos_actores,true);assert.notEqual(r.tarea.id,tarea);assert.equal(r.retiro,null);
  await db.exec('reset role');
  const jobs=(await db.query("select etapa,estado,caption,mensajes from evidencia_operacion.lote where preparacion_id=$1 and estado<>'BORRADOR' order by creado_en",[tarea])).rows;
  assert.equal(jobs.length,2);assert.equal(jobs[0].etapa,'PREPARACION');assert.equal(jobs[1].etapa,'SALIDA');
  assert.match(jobs[0].mensajes.join('\n'),/📦 PEDIDO ALISTADO/);assert.match(jobs[1].mensajes.join('\n'),/🔎 Revisó y retira: Verifica QA/);
  assert.match(jobs[1].mensajes.join('\n'),/⚠️ Bolígrafos QA · salen 0.5 de 2 Caja/);assert.match(jobs[1].mensajes.join('\n'),/❌ Bolígrafos QA/);
  const largo=Array.from({length:150},(_,i)=>`✅ Producto ${i+1} · ${'📦'.repeat(20)} · salen 12 de 12 cajas`).join('\n');
  const partes=(await db.query('select evidencia_operacion.partir_texto($1) p',[largo])).rows[0].p;
  assert.ok(partes.length>1);assert.equal(partes.join('\n'),largo);assert.ok(partes.every(p=>p.length<3500));
  // El worker no puede dar por completo el álbum sin todos los mensajes.
  await db.exec('set role service_role');
  const worker=async(accion,datos={})=>(await db.query('select worker_evidencia_operacion($1,$2) r',[accion,JSON.stringify(datos)])).rows[0].r;
  const job=await worker('reclamar');
  await assert.rejects(()=>worker('confirmar',{id:job.id,lease:job.lease,telegram:[{message_id:1}]}),/detalle completo/);
  await worker('guardar_fotos',{id:job.id,lease:job.lease,telegram:[{message_id:1}]});
  for(let i=0;i<job.mensajes.length;i++)await worker('guardar_mensaje',{id:job.id,lease:job.lease,orden:i,telegram:{message_id:2+i}});
  await worker('confirmar',{id:job.id,lease:job.lease,telegram:[{message_id:1}]});
  await db.exec('reset role');
  console.log('OK: Pedido con dos responsables, fotos en ambas etapas, revisión rápida con diferencias preservadas, retiro/stock único y Telegram por línea');
}
