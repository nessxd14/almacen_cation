import { supabase } from '../supabaseClient';
import { fetchAll } from './fetchAll';
import { labelUbicacion } from './operaciones';

const redondear = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const precisionValida = value => Math.abs(value - redondear(value)) < 1e-8;

export const cantidadOperacion = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 }).format(Number(value));

// Lectura específica de esta pantalla. No cambia las consultas compartidas por
// Compras, Pedidos y Traslados. Las ubicaciones conservan su sucursal real.
export async function cargarDatosOperacion({ productoId, sucursalId, sucursales, nombreSucursal }) {
  const ids = sucursales.filter(s => s.tipo !== 'virtual').map(s => Number(s.id));
  if (!ids.includes(Number(sucursalId))) throw new Error('Selecciona una sucursal física disponible.');
  const [presentaciones, ubicaciones, asignaciones, stocks] = await Promise.all([
    fetchAll(() => supabase.from('presentacion')
      .select('id, producto_id, nombre, factor_unidad_base, es_base')
      .eq('producto_id', productoId).eq('activo', true).order('id')),
    fetchAll(() => supabase.from('ubicacion')
      .select('id, codigo_zona, estante, nivel, compartimiento, sucursal_id')
      .in('sucursal_id', ids).order('id')),
    fetchAll(() => supabase.from('producto_ubicacion')
      .select('id, ubicacion_id, es_principal').eq('producto_id', productoId).order('id')),
    fetchAll(() => supabase.from('stock_actual')
      .select('ubicacion_id, cantidad_base').eq('producto_id', productoId).order('ubicacion_id')),
  ]);
  const asignadas = new Map(asignaciones.map(a => [Number(a.ubicacion_id), a]));
  const saldos = new Map(stocks.map(s => [Number(s.ubicacion_id), Number(s.cantidad_base)]));
  const lugares = ubicaciones.map(u => ({
    ...u, label: labelUbicacion(u, { nombreSucursal }),
    asignada: asignadas.has(Number(u.id)),
    principal: Boolean(asignadas.get(Number(u.id))?.es_principal),
    stock: saldos.get(Number(u.id)) ?? 0,
  })).sort((a, b) => Number(b.principal) - Number(a.principal)
    || Number(b.asignada) - Number(a.asignada) || a.label.localeCompare(b.label));
  return { presentaciones, ubicaciones: lugares };
}

export async function leerStockOperacion({ productoId, ubicacionId }) {
  const { data, error } = await supabase.from('stock_actual').select('cantidad_base')
    .eq('producto_id', Number(productoId)).eq('ubicacion_id', Number(ubicacionId)).maybeSingle();
  if (error) throw error;
  const saldo = Number(data?.cantidad_base ?? 0);
  if (!Number.isFinite(saldo)) throw new Error('El saldo de esta ubicación no es válido.');
  return saldo;
}

// La misma conversión alimenta el resumen y el envío: nunca hay una
// presentación oculta que multiplique la cantidad escrita en unidades.
export function resumenOperacion({ modo, cantidad, cantidadObjetivo, factor, stockOrigen, stockDestino }) {
  const ajuste = modo === 'AJUSTE';
  const texto = ajuste ? cantidadObjetivo : cantidad;
  const numero = texto === '' ? null : Number(texto);
  const factorNumero = Number(factor);
  let error = '';
  if (numero === null) error = ajuste ? 'Indica la cantidad física verificada.' : 'Indica la cantidad del movimiento.';
  else if (!Number.isFinite(numero) || numero < 0 || (!ajuste && numero === 0)) error = 'Ingresa una cantidad válida.';
  else if (!ajuste && (!Number.isFinite(factorNumero) || factorNumero <= 0)) error = 'Selecciona una presentación válida.';
  const base = error ? null : ajuste ? numero : numero * factorNumero;
  if (base !== null && (!Number.isFinite(base) || !precisionValida(base))) error = 'La cantidad debe poder expresarse con hasta 4 decimales en la unidad base.';
  const cantidadBase = error ? null : redondear(base);
  if (modo === 'TRASLADO' && stockOrigen != null && cantidadBase > Number(stockOrigen)) error = 'La cantidad supera el stock de la ubicación de origen.';
  return {
    error, cantidadBase,
    delta: cantidadBase == null ? null : ajuste ? stockOrigen == null ? null : redondear(cantidadBase - stockOrigen) : modo === 'ENTRADA' ? cantidadBase : -cantidadBase,
    origenFinal: cantidadBase == null || stockOrigen == null ? null : ajuste ? cantidadBase : redondear(stockOrigen + (modo === 'ENTRADA' ? cantidadBase : -cantidadBase)),
    destinoFinal: modo !== 'TRASLADO' || cantidadBase == null || stockDestino == null ? null : redondear(stockDestino + cantidadBase),
  };
}
