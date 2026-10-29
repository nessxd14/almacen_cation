import {describe, expect, it} from 'vitest';
import {cantidadEnvio, filasEnvio, textoCantidadEnvio} from './envioPedido';

const linea = (preparada, revisada = null, origenes = null) => ({vigente:true, confirmada:true, preparada_base:preparada, revisada_base:revisada, origenes_declarados:origenes, snapshot:{pendiente_base:100, factor:1, unidad_base:'unidades'}});
describe('cantidades físicas y pendientes de cada envío', () => {
  it.each([[100,0],[60,40],[50,50],[0,100]])('alistado %i conserva %i pendientes', (preparada, pendiente) => {
    expect(filasEnvio([linea(preparada)])[0]).toMatchObject({cantidad:preparada, pendiente});
  });
  it('una verificación de cero prevalece sobre la cantidad preparada', () => {
    expect(cantidadEnvio(linea(100,0), true)).toBe(0);
    expect(filasEnvio([linea(100,0)], true)[0]).toMatchObject({cantidad:0, pendiente:100, revisada:true});
  });
  it('no sustituye el cero alistado por lo solicitado', () => {
    expect(cantidadEnvio(linea(0))).toBe(0);
  });
  it('una procedencia incompleta no se presenta como origen confirmado', () => {
    expect(filasEnvio([linea(100,null,[{tipo:'ALMACEN',cantidad_base:60}])])[0].origenCompleto).toBe(false);
    expect(filasEnvio([linea(100,null,[{tipo:'ALMACEN',cantidad_base:60},{tipo:'COMPRA_RAPIDA',cantidad_base:40}])])[0].origenCompleto).toBe(true);
  });
  it('el reparto del reemplazo debe cubrir su cantidad física y no la cantidad solicitada', () => {
    const l={...linea(100),reemplazo:{factor:2},origenes_declarados:[{tipo:'ALMACEN',cantidad_base:200}]};
    expect(filasEnvio([l])[0].origenCompleto).toBe(true);
    expect(textoCantidadEnvio(100,{factor:100,presentacion:'paquete'})).toBe('1 paquete');
  });
  it('descarta líneas anuladas y no confunde incidencia con preparación terminada', () => {
    expect(filasEnvio([{...linea(100),vigente:false}])).toEqual([]);
    expect(filasEnvio([{...linea(100),incidencia_pendiente:true}])[0].preparada).toBe(false);
  });
});
