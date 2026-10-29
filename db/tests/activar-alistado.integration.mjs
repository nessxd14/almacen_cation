import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testActivarAlistado(db,{login,uid}) {
  await db.exec(`insert into pedido(id,categoria,numero) values
    (980,'TIENDA','QA-MIGRAR-ALISTADO'),(981,'TIENDA','QA-MIGRAR-REVISION'),(982,'TIENDA','QA-MIGRAR-CANCELADO'),(983,'TIENDA','QA-MIGRAR-PREPARADO');
    insert into pedido_linea(id,pedido_id,producto_id,presentacion_id,cantidad_base,cantidad_presentacion,precio_unitario,sucursal_origen_id)
      values(9801,980,22,22,10,10,15,1),(9811,981,22,22,10,10,15,1),(9821,982,22,22,10,10,15,1),(9831,983,22,22,10,10,15,1);
    insert into almacen_preparacion(pedido_id,sucursal_id,preparador_id,preparador_nombre,revisor_id,revisor_nombre,estado,version)
      values(980,1,'${uid(1)}','Prepara QA',null,null,'PREPARANDO',3),
      (981,1,'${uid(1)}','Prepara QA','${uid(2)}','Verifica QA','REVISANDO',7),
      (982,1,'${uid(1)}','Prepara QA',null,null,'PREPARANDO',1),
      (983,1,'${uid(1)}','Prepara QA',null,null,'PREPARADO',5);
    update almacen_preparacion set alistado_simple=false,modo_flexible=true,modo_abastecimiento=true,flujo_dos_actores=true where pedido_id in (980,981,982,983);
    insert into almacen_preparacion_linea(preparacion_id,pedido_linea_id,snapshot)
      select t.id,a.linea_id,a.datos from almacen_preparacion t cross join lateral almacen_operaciones.lineas_actuales(t.pedido_id,1)a where t.pedido_id in (980,981,982,983);
    update almacen_preparacion_linea set confirmada=true,preparada_base=8,observacion='Dos pendientes' where pedido_linea_id in (9801,9811,9831);
    update almacen_preparacion_linea set revisada_base=6,metodo_revision='visual',observacion_revision='Salen seis' where pedido_linea_id=9811;
    update pedido set estado='CANCELADO' where id=982;
    insert into compra_solicitud(pedido_linea_id,producto_id,descripcion,cantidad_base,origen,motivo,solicitado_por)
      values(9801,22,'Compra previa QA',2,'ALMACEN','Compra previa','Prepara QA');`);
  const tarea=(await db.query('select id from almacen_preparacion where pedido_id=981')).rows[0].id;
  await login(2);await db.exec('set role authenticated');
  const foto=randomUUID(),lote=(await db.query("select operar_evidencia_operacion('PEDIDO',981,$1,'crear',$2) r",[tarea,JSON.stringify({id:foto,version:7,cantidad:1})])).rows[0].r;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('evidencias_operaciones',$1,'{\"mimetype\":\"image/jpeg\",\"size\":512}')",[lote.rutas[0]]);
  await db.exec('reset role');
  const digest=async sql=>(await db.query(`select md5(coalesce(jsonb_agg(x order by x::text)::text,'')) h from (${sql})x`)).rows[0].h;
  const lineasSql='select * from almacen_preparacion_linea';
  const historicoSql="select to_jsonb(t)-'alistado_migrado' datos from almacen_preparacion t join pedido p on p.id=t.pedido_id where p.estado<>'ABIERTO' or t.estado in ('DESPACHADO','ANULADO')";
  const antes={lineas:await digest(lineasSql),historico:await digest(historicoSql),stock:await digest('select * from stock_actual')};
  // Contrato de producción: el fixture previo no incluía este CHECK comercial.
  await db.exec(`alter table pedido_evento add constraint pedido_evento_accion_check check (accion in (
    'ANULADO','RESTAURADO','ELIMINADO','LINEA_RECHAZADA','PEDIDO_RECHAZADO','LINEA_CAMBIADA','LINEA_RETIRADA',
    'LINEA_DEVUELTA_ALMACEN','LINEA_INYECTADA_TIENDA','LINEAS_AGREGADAS','LINEA_A_COMPRA','COMPRA_COMPRADA',
    'COMPRA_RECIBIDA','COMPRA_CANCELADA','REMANENTE_CANCELADO','PEDIDO_EDITADO','AVISO_RESUELTO','TANDA_CORTADA')) not valid;`);
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261029131809_activar_alistado_pedidos_abiertos.sql',import.meta.url),'utf8'));
  assert.equal(await digest(lineasSql),antes.lineas,'Conserva exactamente cantidades, revisión, orígenes y responsables de todas las líneas');
  assert.equal(await digest(historicoSql),antes.historico,'No modifica cancelados ni históricos');
  assert.equal(await digest('select * from stock_actual'),antes.stock,'Activar no mueve inventario');
  assert.equal((await db.query("select count(*)::int n from almacen_preparacion where pedido_id in (980,981,983) and alistado_simple and alistado_migrado")).rows[0].n,3);
  assert.equal((await db.query('select version from evidencia_operacion.lote where id=$1',[foto])).rows[0].version,7);
  assert.equal((await db.query('select version from almacen_preparacion where id=$1',[tarea])).rows[0].version,7);
  assert.equal((await db.query('select count(*)::int n from compra_solicitud where pedido_linea_id=9801')).rows[0].n,1,'No duplica la compra previa');
  const op=async(accion='consultar',datos={},version=7)=>(await db.query('select operar_preparacion_pedido(981,1,$1,$2,$3,$4) r',[tarea,accion,version,JSON.stringify(datos)])).rows[0].r;
  await db.exec('set role authenticated');let r=await op();assert.equal(r.alistado_simple,true);assert.equal(r.alistado_migrado,true);assert.equal(r.lineas[0].preparada_base,8);assert.equal(r.lineas[0].revisada_base,6);
  assert.equal(r.origenes_pendientes.length,1);
  await assert.rejects(()=>op('confirmar_retiro',{evidencia_id:foto,destino:'Obra QA',plan:r.plan_salida}),/Completa el origen/);
  const origen={linea_id:9811,origenes:[{tipo:'ALMACEN',cantidad_base:4,ubicacion_id:22},{tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Proveedor QA'}]};
  await assert.rejects(()=>op('declarar_origen',origen),/alistador/);
  await login(1);await assert.rejects(()=>op('declarar_origen',origen,6),/tanda cambió/);
  r=await op('declarar_origen',origen);assert.equal(r.tarea.version,7,'La declaración documental conserva la foto en borrador');
  await op('declarar_origen',origen);assert.equal(r.lineas[0].revisada_base,6);
  await login(2);r=await op();const salida={evidencia_id:foto,destino:'Obra QA',plan:r.plan_salida};
  r=await op('confirmar_retiro',salida);await op('confirmar_retiro',salida);
  assert.equal(r.tarea.estado,'DESPACHADO','Cierra con la revisión y foto heredadas');
  await db.exec('reset role');
  assert.equal((await db.query('select cantidad_despachada from pedido_linea where id=9811')).rows[0].cantidad_despachada,'6');
  assert.equal((await db.query("select count(*)::int n from pedido_despacho_movimiento m join pedido_despacho_evento e on e.id=m.evento_id where e.pedido_linea_id=9811")).rows[0].n,1,'Salida de Almacén única');
  console.log('OK: alistado para pedidos existentes, revisiones y fotos conservadas, orígenes sin inventar, compras sin duplicar e históricos intactos');
}
