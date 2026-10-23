import { describe, expect, it } from 'vitest';
import { basesRecorridoTurno, notaSinVerificacionEmpaques, observacionEmpaquesTurno, ordenarRecorridoTurno, tieneVerificacionEmpaques, ubicacionRecorridoTurno } from './recorridoTurno';

const linea = (id, ubicacion) => ({ id, numero: id, ubicacion_id: id, producto_id: 1, ubicacion });

describe('recorrido de conteo por ubicación base', () => {
  it('agrupa las zonas reales sin unir las existencias de un producto en distintos lugares', () => {
    const items = [linea(4, 'GARAJE / Pallet A / 1'), linea(3, 'HUECO / Estante B / 1'), linea(2, 'PLANTA BAJA / Estante A / 10'), linea(1, 'PLANTA BAJA / Estante A / 2'), linea(5, 'DEPÓSITO / Pallet C / 1')];
    expect(ordenarRecorridoTurno(items).map(l => l.id)).toEqual([1, 2, 3, 4, 5]);
    expect(basesRecorridoTurno(items).map(b => [b.nombre, b.lineas.map(l => l.id)])).toEqual([
      ['Planta Baja', [1, 2]], ['Hueco', [3]], ['Garaje', [4]], ['DEPÓSITO', [5]],
    ]);
    expect(items[0].id).toBe(4);
  });

  it('reconoce la zona de la fotografía del reporte y admite ubicaciones sin mueble', () => {
    expect(ubicacionRecorridoTurno(linea(1, ' PLANTA BAJA / Estante A / 3 '))).toEqual({ id: 'PLANTA BAJA', nombre: 'Planta Baja', detalle: 'Estante A / 3' });
    expect(basesRecorridoTurno([linea(1, 'Hueco / Estante A / 1'), linea(2, 'HUECO / Estante B / 1')])).toHaveLength(1);
    expect(ubicacionRecorridoTurno(linea(1, 'GARAJE')).nombre).toBe('Garaje');
    expect(ubicacionRecorridoTurno({}).nombre).toBe('Sin ubicación base');
  });
});

describe('declaración de empaques verificados', () => {
  const presentacion = { factor: 100, empaque: 'Caja x100', unidad: 'unidad' };
  it('exige verificación de los empaques declarados y la conserva junto a la nota', () => {
    expect(() => observacionEmpaquesTurno({ empaques: '180' }, presentacion)).toThrow('Confirma');
    const nota = observacionEmpaquesTurno({ empaques: '180', empaquesVerificados: true, observacion: 'Material cerrado' }, presentacion);
    expect(nota).toContain('180 Caja x100');
    expect(tieneVerificacionEmpaques(nota)).toBe(true);
    expect(notaSinVerificacionEmpaques(nota)).toBe('Material cerrado');
  });

  it('reemplaza la evidencia al corregir y no la atribuye a unidades sueltas o cantidades cero', () => {
    const nota = observacionEmpaquesTurno({ empaques: '180', empaquesVerificados: true, observacion: 'Observación' }, presentacion);
    const nueva = observacionEmpaquesTurno({ empaques: '179', empaquesVerificados: true, observacion: nota }, presentacion);
    expect(nueva).not.toContain('180 Caja');expect(nueva).toContain('179 Caja');
    expect(nueva.match(/\[Empaques verificados\]/g)).toHaveLength(1);
    expect(observacionEmpaquesTurno({ empaques: '0', observacion: nota }, presentacion)).toBe('Observación');
    expect(observacionEmpaquesTurno({ empaques: '180', observacion: '' }, { ...presentacion, factor: 1 })).toBe('');
    expect(() => observacionEmpaquesTurno({ empaques: '1', empaquesVerificados: true, observacion: 'x'.repeat(1990) }, presentacion)).toThrow('Acorta');
  });
});
