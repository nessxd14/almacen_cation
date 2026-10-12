import { fetchAll } from './fetchAll';
import { etiquetaUbicacion } from './ubicacionTexto';

export const CAMPOS_UBICACION = 'id, codigo_zona, estante, nivel, compartimiento, sucursal_id, excluye_disponible';
export const CAMPOS_PRODUCTO_FICHA = 'id, nombre, sku_interno, marca, unidad_base, imagen_url, activo, ficha_md';

export function textoUbicacion(ubicacion) {
  if (!ubicacion) return 'Sin ubicación asignada';
  return etiquetaUbicacion(ubicacion, { separador: ' · ', largo: true });
}

export function enlaceFicha(productoId, sucursalId, origin = window.location.origin, presentacionId = null) {
  const id = String(productoId);
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Producto inválido');
  const url = new URL(`/productos/${id}/ficha`, origin);
  if (sucursalId != null) url.searchParams.set('sucursal', String(sucursalId));
  if (presentacionId != null) {
    if (!/^[1-9]\d*$/.test(String(presentacionId))) throw new Error('Presentación inválida');
    url.searchParams.set('presentacion', String(presentacionId));
  }
  return url.href;
}

export function sucursalDeFicha(solicitada, perfilSucursalId, activa, sucursales) {
  if (solicitada != null && !/^[1-9]\d*$/.test(String(solicitada))) throw new Error('La sucursal del enlace no es válida.');
  const elegida = solicitada == null ? activa : Number(solicitada);
  if (perfilSucursalId != null && elegida != null && Number(elegida) !== Number(perfilSucursalId)) {
    throw new Error('Esta etiqueta corresponde a otra sucursal. Consulta al encargado de esa sucursal.');
  }
  const id = perfilSucursalId ?? elegida;
  if (!sucursales.some(s => Number(s.id) === Number(id) && s.tipo !== 'virtual')) {
    throw new Error('Elige el almacén o la tienda que quieres consultar en el selector de sucursal.');
  }
  return Number(id);
}

// Una ubicación asignada sin fila de stock no es una cantidad cero comprobada.
export function resumirUbicaciones(asignaciones, stock, sucursalId, stockConsultado = true) {
  const mapa = new Map();
  const elegible = u => u && Number(u.sucursal_id) === Number(sucursalId) && !u.excluye_disponible && u.sucursal?.tipo !== 'virtual';
  for (const a of asignaciones || []) {
    if (!elegible(a.ubicacion)) continue;
    mapa.set(String(a.ubicacion.id), { ...a.ubicacion, es_principal: a.es_principal, cantidad: null });
  }
  let total = null;
  if (stockConsultado) {
    for (const s of stock || []) {
      if (!elegible(s.ubicacion)) continue;
      const cantidad = Number(s.cantidad_base);
      if (!Number.isFinite(cantidad)) continue;
      const id = String(s.ubicacion.id);
      const anterior = mapa.get(id);
      mapa.set(id, { ...s.ubicacion, ...anterior, cantidad, actualizado_en: s.actualizado_en });
      total = (total ?? 0) + cantidad;
    }
  }
  return { total, ubicaciones: [...mapa.values()].sort((a, b) => Number(!!b.es_principal) - Number(!!a.es_principal) || textoUbicacion(a).localeCompare(textoUbicacion(b))) };
}

export function codigosDePresentaciones(presentaciones) {
  return (presentaciones || []).filter(p => p.activo !== false).flatMap(p =>
    (p.identificador || []).filter(i => i.activo !== false && i.tipo === 'barra' && i.valor).map(i => ({
      ...i, presentacion: p.nombre, presentacion_id: p.id, es_base: p.es_base,
    }))
  ).sort((a, b) => Number(!!b.es_base) - Number(!!a.es_base) || Number(!!b.es_principal) - Number(!!a.es_principal));
}

function comprobar(resultado, nombre) {
  if (resultado.error) throw new Error(`No se pudo consultar ${nombre}.`);
  return resultado.data;
}

// La impresión requiere datos completos de identificación y ubicación.
export async function cargarDatosEtiqueta(cliente, productoId, sucursalId) {
  const resultados = await Promise.all([
    cliente.from('producto').select(CAMPOS_PRODUCTO_FICHA).eq('id', productoId).single(),
    cliente.from('producto_ubicacion').select(`id, es_principal, ubicacion:ubicacion_id!inner(${CAMPOS_UBICACION})`).eq('producto_id', productoId).eq('ubicacion.sucursal_id', sucursalId).order('es_principal', { ascending: false }),
    cliente.from('presentacion').select('id, nombre, factor_unidad_base, es_base, activo, identificador(id, valor, tipo, activo, es_principal)').eq('producto_id', productoId).order('id'),
    cliente.from('producto_atributo').select('atributo_valor:atributo_valor_id(valor, atributo:atributo_id(nombre))').eq('producto_id', productoId),
    cliente.from('stock_actual').select(`cantidad_base, ubicacion:ubicacion_id!inner(${CAMPOS_UBICACION})`).eq('producto_id', productoId).eq('ubicacion.sucursal_id', sucursalId).gt('cantidad_base', 0).order('ubicacion_id'),
  ]);
  const [producto, asignaciones, presentaciones, atributos, stock] = resultados.map((r, i) => comprobar(r, ['el producto', 'las ubicaciones', 'las presentaciones', 'las características', 'las ubicaciones con existencias'][i]));
  if (!producto) throw new Error('El producto no existe o no tienes acceso.');
  const ubicaciones = resumirUbicaciones(asignaciones, stock, sucursalId).ubicaciones;
  return { producto, asignaciones: ubicaciones.map(u => ({ es_principal: !!u.es_principal, ubicacion: u })), presentaciones: presentaciones || [], atributos: atributos || [] };
}

// Cada sección informa su propio error. Un fallo de stock nunca produce un cero.
export async function cargarFichaProducto(cliente, productoId, sucursalId) {
  const producto = comprobar(await cliente.from('producto').select(CAMPOS_PRODUCTO_FICHA).eq('id', productoId).single(), 'el producto');
  if (!producto) throw new Error('El producto no existe o no tienes acceso.');
  const consultas = {
    asignaciones: () => fetchAll(() => cliente.from('producto_ubicacion').select(`id, es_principal, ubicacion:ubicacion_id!inner(${CAMPOS_UBICACION})`).eq('producto_id', productoId).eq('ubicacion.sucursal_id', sucursalId).order('id')),
    stock: () => fetchAll(() => cliente.from('stock_actual').select(`ubicacion_id, cantidad_base, actualizado_en, ubicacion:ubicacion_id!inner(${CAMPOS_UBICACION})`).eq('producto_id', productoId).eq('ubicacion.sucursal_id', sucursalId).order('ubicacion_id')),
    presentaciones: () => cliente.from('presentacion').select('id, nombre, factor_unidad_base, es_base, activo, identificador(id, valor, tipo, activo, es_principal)').eq('producto_id', productoId).order('id'),
    atributos: () => cliente.from('producto_atributo').select('atributo_valor:atributo_valor_id(valor, atributo:atributo_id(nombre))').eq('producto_id', productoId),
    control: () => cliente.from('producto_sucursal').select('control_stock, inventariado_en, inventariado_por').eq('producto_id', productoId).eq('sucursal_id', sucursalId).maybeSingle(),
    disponibilidad: () => cliente.rpc('saldo_vendible', { p_producto_ids: [Number(productoId)], p_sucursal_id: Number(sucursalId) }),
    movimientos: () => cliente.from('kardex_transacciones').select(`id, cantidad, tipo_movimiento, referencia, creado_por, creado_en, ubicacion:ubicacion_id!inner(${CAMPOS_UBICACION})`).eq('producto_id', productoId).eq('ubicacion.sucursal_id', sucursalId).order('creado_en', { ascending: false }).order('id', { ascending: false }).limit(6),
    conteo: () => cliente.from('kardex_transacciones').select('id, creado_en, creado_por, origen_conciliacion_id, ubicacion:ubicacion_id!inner(sucursal_id)').eq('producto_id', productoId).eq('ubicacion.sucursal_id', sucursalId).not('origen_conciliacion_id', 'is', null).order('creado_en', { ascending: false }).order('id', { ascending: false }).limit(1),
  };
  const nombres = Object.keys(consultas);
  const resultados = await Promise.allSettled(nombres.map(nombre => consultas[nombre]()));
  const ficha = { producto, errores: {}, consultadoEn: new Date().toISOString() };
  resultados.forEach((resultado, index) => {
    const nombre = nombres[index];
    if (resultado.status === 'rejected' || resultado.value?.error) {
      ficha[nombre] = null;
      ficha.errores[nombre] = `No se pudo consultar ${nombre === 'stock' ? 'las existencias' : nombre}.`;
    } else {
      ficha[nombre] = Array.isArray(resultado.value) ? resultado.value : resultado.value.data;
    }
  });
  ficha.disponibilidad = ficha.disponibilidad?.find(r => String(r.producto_id) === String(productoId)) ?? null;
  ficha.conteo = ficha.conteo?.[0] ?? null;
  return ficha;
}
