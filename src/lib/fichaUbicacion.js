import { fetchAll } from './fetchAll';
import { CAMPOS_UBICACION } from './fichaProducto';

const CAMPOS_PRODUCTO = 'id, nombre, sku_interno, unidad_base, imagen_url, activo';
const idValido = id => /^[1-9]\d*$/.test(String(id));

export function enlaceFichaUbicacion(ubicacionId, sucursalId, origin = window.location.origin) {
  if (!idValido(ubicacionId)) throw new Error('Ubicación inválida');
  if (sucursalId != null && !idValido(sucursalId)) throw new Error('Sucursal inválida');
  const url = new URL(`/ubicaciones/${ubicacionId}/ficha`, origin);
  if (sucursalId != null) url.searchParams.set('sucursal', String(sucursalId));
  return url.href;
}

export async function listarUbicacionesEtiqueta(cliente, sucursalId) {
  if (!idValido(sucursalId)) throw new Error('Elige el almacén o la tienda para consultar sus ubicaciones.');
  return fetchAll(() => cliente.from('ubicacion').select(CAMPOS_UBICACION)
    .eq('sucursal_id', sucursalId).eq('excluye_disponible', false).eq('activo', true).order('id'));
}

// Las asignaciones no demuestran una existencia cero: sólo el saldo consultado
// puede aportar esa cantidad. No se suman productos con unidades diferentes.
export function resumirProductosUbicacion(asignaciones, stock, stockConsultado = true) {
  const productos = new Map();
  for (const asignacion of asignaciones || []) {
    const id = asignacion.producto_id ?? asignacion.producto?.id;
    if (!idValido(id)) continue;
    productos.set(String(id), {
      producto_id: id, producto: asignacion.producto ?? null,
      asignado: true, es_principal: !!asignacion.es_principal,
      cantidad: null, actualizado_en: null,
    });
  }
  if (stockConsultado) {
    for (const registro of stock || []) {
      const id = registro.producto_id ?? registro.producto?.id;
      if (!idValido(id)) continue;
      const anterior = productos.get(String(id));
      const valor = registro.cantidad_base;
      const cantidad = valor != null && String(valor).trim() !== '' && Number.isFinite(Number(valor)) ? Number(valor) : null;
      productos.set(String(id), {
        producto_id: id, producto: registro.producto ?? anterior?.producto ?? null,
        asignado: anterior?.asignado ?? false, es_principal: anterior?.es_principal ?? false,
        cantidad, actualizado_en: registro.actualizado_en ?? null,
      });
    }
  }
  return [...productos.values()].sort((a, b) =>
    (a.producto?.nombre || '').localeCompare(b.producto?.nombre || '', 'es') || Number(a.producto_id) - Number(b.producto_id));
}

export async function cargarFichaUbicacion(cliente, ubicacionId, sucursalId) {
  if (!idValido(ubicacionId) || !idValido(sucursalId)) throw new Error('El enlace de la ubicación no es válido.');
  const ubicacionResultado = await cliente.from('ubicacion').select(CAMPOS_UBICACION)
    .eq('id', ubicacionId).eq('sucursal_id', sucursalId).eq('excluye_disponible', false).maybeSingle();
  if (ubicacionResultado.error) throw new Error('No se pudo consultar la ubicación. Actualiza para reintentar.');
  const ubicacion = ubicacionResultado.data;
  if (!ubicacion || Number(ubicacion.sucursal_id) !== Number(sucursalId) || ubicacion.excluye_disponible) {
    throw new Error('La ubicación no existe en esta sucursal o no está disponible para consulta.');
  }
  const resultados = await Promise.allSettled([
    fetchAll(() => cliente.from('producto_ubicacion').select(`id, producto_id, es_principal, producto:producto_id(${CAMPOS_PRODUCTO})`)
      .eq('ubicacion_id', ubicacionId).order('id')),
    fetchAll(() => cliente.from('stock_actual').select(`producto_id, cantidad_base, actualizado_en, producto:producto_id(${CAMPOS_PRODUCTO})`)
      .eq('ubicacion_id', ubicacionId).order('producto_id')),
  ]);
  const errores = {};
  const [asignaciones, stock] = resultados.map((resultado, i) => {
    if (resultado.status === 'fulfilled') return resultado.value;
    errores[i === 0 ? 'asignaciones' : 'stock'] = i === 0 ? 'No se pudieron consultar los productos asignados.' : 'No se pudieron consultar las existencias registradas.';
    return null;
  });
  return {
    ubicacion, productos: resumirProductosUbicacion(asignaciones, stock, !errores.stock),
    errores, consultadoEn: new Date().toISOString(),
  };
}
