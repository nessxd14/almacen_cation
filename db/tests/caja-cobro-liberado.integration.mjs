import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function testCajaCobroLiberado(db, { login, stock, count }) {
  const wrapper = () => db.query("select pg_get_functiondef('public.operar_caja_almacen(text,uuid,bigint,jsonb)'::regprocedure) def");
  const previousWrapper = (await wrapper()).rows[0].def;
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261022140815_caja_liberar_tras_cobro.sql', import.meta.url), 'utf8'));
  assert.equal((await wrapper()).rows[0].def, previousWrapper, 'La migración conserva el wrapper de evidencia y sus permisos');
  await login(7);
  await db.exec('set role authenticated');
  const op = '20000000-0000-0000-0000-000000000003';
  const rpc = async (action, id = op) => (await db.query('select operar_caja_almacen($1,$2,1,$3) r', [action,id,'{}'])).rows[0].r;
  const antes = await stock(1), kardex = await count('kardex_transacciones');
  const pay = () => db.query("select checkout_caja(p_lineas=>'[]',p_pagos=>'[{\"metodo\":\"EFECTIVO\",\"monto\":10}]',p_sesion_id=>1,p_idempotencia=>$1,p_vtd_ids=>array[702]::bigint[]) r", ['checkout:'+op]);
  const receipt = (await pay()).rows[0].r;
  assert.equal((await rpc('actual')).operacion, null);
  assert.equal((await rpc('actual')).pendientes[0].operacion.id, op);
  assert.equal((await pay()).rows[0].r.id, receipt.id);
  assert.equal(await stock(1), antes);
  assert.equal(await count('kardex_transacciones'), kardex, 'Cobrar material despachado no repite la salida x12');
  await assert.rejects(() => db.query("select caja_almacen.operar('enviar',null,null,'{}')"), /permission denied/);
  await rpc('completar');
  assert.equal((await rpc('actual')).pendientes.length, 0);
  assert.equal(await stock(1), antes, 'Completar desde la bandeja conserva el Kardex');
  await db.exec('reset role');
  console.log('OK: cobro libera el carrito, entrega pendiente, recibo idempotente y wrapper de fotos/permisos preservado');
}
