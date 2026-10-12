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
    const operacion = ruta.match(/^\/operaciones\/(pedidos|vtd|traslados-virtuales)\/([1-9]\d*)\/?$/);
    if (operacion && idOperacion(operacion[2])) return { tipo: { pedidos: 'pedido', vtd: 'vtd', 'traslados-virtuales': 'traslado_virtual' }[operacion[1]], id: operacion[2] };
    const ficha = ruta.match(/^\/(productos|ubicaciones)\/([1-9]\d*)\/ficha\/?$/);
    if (ficha && idOperacion(ficha[2])) {
      return { tipo: ficha[1] === 'productos' ? 'producto' : 'ubicacion', id: ficha[2], sucursalId: idOperacion(url.searchParams.get('sucursal')), presentacionId: idOperacion(url.searchParams.get('presentacion')) };
    }
    throw new Error('Este QR no corresponde a un pedido, producto o ubicación del almacén.');
  }
  if (/^VTD-\d{4}-\d+$/i.test(texto)) return { tipo: 'vtd', numero: texto.toUpperCase() };
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
export const nombresEstadoOperacion = { BORRADOR: 'Armando carrito', PREPARANDO: 'En preparación', PREPARADO: 'Listo para verificar', REVISANDO: 'En verificación', VERIFICADO: 'Entrega verificada', DESPACHADO: 'Despachado', EN_TRANSITO: 'En tránsito', RECIBIDO: 'Recibido en Tienda', ANULADO: 'Preparación anulada' };
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

export const rolesAlmacen = new Set(['admin', 'gerente', 'almacenero', 'operario']);
export const rolesOperacionesMovil = new Set([...rolesAlmacen, 'vendedor', 'cajero']);
export const etiquetaDocumento = tipo => ({ pedido: 'Pedido', vtd: 'VTD', traslado_virtual: 'Traslado virtual' }[tipo] || 'Documento');
export function rutaDocumentoMovil(tipo, id, escanear = false) {
  if (!idOperacion(id)) throw new Error('El documento no tiene un ID válido.');
  const segmento = { pedido: 'pedidos', vtd: 'vtd', traslado_virtual: 'traslados-virtuales' }[tipo];
  if (!segmento) throw new Error('Tipo de documento no válido.');
  return `/operaciones/${segmento}/${id}${escanear ? '?escanear=1' : ''}`;
}
export async function solicitarDocumentoMovil(cliente, { tipo = 'traslado_virtual', documentoId = null, accion = 'consultar', version = null, datos = {} }) {
  const { data, error } = await cliente.rpc('operar_documento_movil', { p_tipo: tipo.toUpperCase(), p_documento_id: documentoId, p_accion: accion, p_version: version, p_datos: datos });
  if (error) throw new Error(error.message || 'No se pudo guardar la operación.');
  if (!data) throw new Error('No se recibió una respuesta del almacén.');
  return data;
}
export function adaptarDocumentoMovil(data) {
  if (!data.documento) return data;
  return { ...data, pedido: data.documento, otras_sucursales: 0, lineas: (data.lineas || []).map(l => ({ ...l, pedido_linea_id: l.id })) };
}
export async function operarDocumentoMovil(cliente, { tipo = 'pedido', documentoId, sucursalId, tareaId = null, accion = 'consultar', version = null, datos = {} }) {
  if (tipo === 'pedido') return operarPedidoMovil(cliente, { pedidoId: documentoId, sucursalId, tareaId, accion, version, datos });
  return adaptarDocumentoMovil(await solicitarDocumentoMovil(cliente, { tipo, documentoId, accion, version, datos }));
}
export async function listarDocumentosMovil(cliente, sucursalId, rol) {
  const [pedidos, extra] = await Promise.all([
    rolesAlmacen.has(rol) ? listarOperacionesMovil(cliente, sucursalId) : Promise.resolve([]),
    solicitarDocumentoMovil(cliente, { accion: 'listar', datos: { sucursal_id: sucursalId } }),
  ]);
  return [...pedidos.map(t => ({ ...t, tipo: 'pedido', documento_id: t.pedido_id })), ...(extra.documentos || []).map(t => ({ ...t, pedido: { numero: t.numero, cliente: { nombre: t.cliente } } }))]
    .sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
}
