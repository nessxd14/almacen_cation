import { expect, it, vi } from 'vitest';
import { cargarLineasTraslado, cargarSolicitudesTraslado, validarCantidadTraslado } from './traslados';

it('rechaza exceso, valores no finitos y cero; permite cantidades parciales', () => {
  for (const n of [0,-1,6,NaN,Infinity]) expect(validarCantidadTraslado(n,5)).toBe(false);
  expect(validarCantidadTraslado(2.5,5)).toBe(true);
});

function cliente(rows, failAfter = Infinity) {
  return { from: vi.fn(() => {
    let filtered = rows, after = 0;
    const query = {
      select: () => query, or: () => query,
      in: (key, ids) => { filtered=filtered.filter(r => ids.includes(r[key])); return query; },
      gt: (_key, id) => { after=id; filtered=filtered.filter(r => r.id>id); return query; },
      eq: (key, value) => { filtered=filtered.filter(r => r[key]===value); return query; },
      order: () => query,
      limit: async () => after>=failAfter ? { error: new Error('No se pudo leer') } : { data: filtered.slice(0,17),error:null },
    }; return query;
  }) };
}
it('conserva las 1100 líneas aun si el servidor entrega sólo 17 por página', async () => {
  const rows=Array.from({length:1100},(_,i)=>({id:i+1,solicitud_id:i<1060?1:2}));
  const result=await cargarLineasTraslado(cliente(rows),[1,2]);
  expect(result).toHaveLength(1100);expect(result.at(-1).id).toBe(1100);
});
it('no devuelve tarjetas incompletas cuando falla una página', async () => {
  const rows=Array.from({length:40},(_,i)=>({id:i+1,solicitud_id:1}));
  await expect(cargarLineasTraslado(cliente(rows,17),[1])).rejects.toThrow('No se pudo leer');
});
it('pagina solicitudes y ordena por fecha sin ocultar las antiguas', async () => {
  const rows=Array.from({length:240},(_,i)=>({id:i+1,estado:'SOLICITADO',creado_en:String(i+1).padStart(4,'0')}));
  const result=await cargarSolicitudesTraslado(cliente(rows),1,'SOLICITADO');
  expect(result).toHaveLength(240);expect(result[0].id).toBe(240);expect(result.at(-1).id).toBe(1);
});
