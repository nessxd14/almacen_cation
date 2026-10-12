const ID = /^[1-9]\d*$/;
export function idOperacion(valor) {
  const texto = String(valor ?? '').trim();
  return ID.test(texto) && Number.isSafeInteger(Number(texto)) ? texto : null;
}

// El QR de Seller contiene su dominio. Sólo extraemos rutas conocidas;
// nunca navegamos al origen leído ni mezclamos los pedidos PDV con pedido.
export function interpretarCodigoOperacion(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto || texto.length > 2048) throw new Error('El código está vacío o es demasiado largo.');
  if (idOperacion(texto.replace(/^#/, ''))) return { tipo: 'pedido', id: idOperacion(texto.replace(/^#/, '')) };
  let url;
  try { url = new URL(texto, 'https://almacen.invalid'); } catch { /* código de barras */ }
  if (url && (/^https?:\/\//i.test(texto) || texto.startsWith('/'))) {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('El enlace no es válido.');
    let ruta = url.pathname;
    try { ruta = decodeURIComponent(ruta); } catch { throw new Error('El enlace no es válido.'); }
    const pedido = ruta.match(/^\/pedidos\/([1-9]\d*)\/?$/);
    if (pedido && idOperacion(pedido[1])) {
      if (url.searchParams.has('ne')) throw new Error('Este QR corresponde a una nota de entrega. Escanea el QR del pedido para preparar una entrega.');
      return { tipo: 'pedido', id: pedido[1] };
    }
    const ficha = ruta.match(/^\/(productos|ubicaciones)\/([1-9]\d*)\/ficha\/?$/);
    if (ficha && idOperacion(ficha[2])) {
      return { tipo: ficha[1] === 'productos' ? 'producto' : 'ubicacion', id: ficha[2], sucursalId: idOperacion(url.searchParams.get('sucursal')), presentacionId: idOperacion(url.searchParams.get('presentacion')) };
    }
    throw new Error('Este QR no corresponde a un pedido, producto o ubicación del almacén.');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(texto) || /^PDV-/i.test(texto)) throw new Error('Este código no corresponde a un pedido de Seller ni a una etiqueta del almacén.');
  return { tipo: 'barras', valor: texto };
}

// Un número de barras sólo es un pedido en el inicio. Durante la revisión
// se envía el texto original al servidor para resolver su presentación.
export function cantidadOperacion(valor) {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(texto)) throw new Error('Ingresa una cantidad válida, con hasta 6 decimales.');
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero > 1e12) throw new Error('La cantidad está fuera del rango permitido.');
  return numero;
}
export const nombresEstadoOperacion = { PREPARANDO: 'En preparación', PREPARADO: 'Preparado', REVISANDO: 'En revisión', VERIFICADO: 'Entrega verificada', DESPACHADO: 'Despachado', ANULADO: 'Preparación anulada' };
export const cantidadTexto = valor => Number(valor ?? 0).toLocaleString('es-BO', { maximumFractionDigits: 6 });
export function resumenOperacion(lineas = []) {
  const vigentes = lineas.filter(l => l.vigente);
  const conCantidad = vigentes.filter(l => Number(l.preparada_base) > 0);
  return { total: vigentes.length, preparadas: vigentes.filter(l => l.confirmada).length, revisar: conCantidad.length, revisadas: conCantidad.filter(l => l.revisada_base != null && Number(l.revisada_base) === Number(l.preparada_base)).length, parcial: vigentes.some(l => Number(l.preparada_base) < Number(l.snapshot.pendiente_base)) };
}
export async function operarPedidoMovil(cliente, { pedidoId, sucursalId, tareaId = null, accion = 'consultar', version = null, datos = {} }) {
  const { data, error } = await cliente.rpc('operar_preparacion_pedido', { p_pedido_id: pedidoId, p_sucursal_id: sucursalId, p_tarea_id: tareaId, p_accion: accion, p_version: version, p_datos: datos });
  if (error) throw new Error(error.message || 'No se pudo guardar la operación.');
  if (!data) throw new Error('No se recibió una respuesta del almacén.');
  return data;
}
export async function listarOperacionesMovil(cliente, sucursalId) {
  const { data, error } = await cliente.from('almacen_preparacion').select('*, pedido:pedido_id(id, numero, referencia, cliente:cliente_id(nombre))').eq('sucursal_id', sucursalId).order('actualizado_en', { ascending: false }).limit(80);
  if (error) throw new Error(error.message || 'No se pudieron cargar las tareas.');
  return data || [];
}
