import {peticionAcotada} from './peticionAcotada';
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
    const operacion = ruta.match(/^\/operaciones\/(pedidos|vtd|traslados|traslados-virtuales)\/([1-9]\d*)\/?$/);
    if (operacion && idOperacion(operacion[2])) return { tipo: { pedidos: 'pedido', vtd: 'vtd', traslados: 'traslado', 'traslados-virtuales': 'traslado_virtual' }[operacion[1]], id: operacion[2] };
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
export const nombresEstadoOperacion = { SOLICITADO: 'Pendiente de verificar', EN_CAJA: 'Enviado a Caja', RETORNO_PENDIENTE: 'Material en retorno', RETORNADO: 'Retorno recibido', CANCELADO: 'Cancelado', BORRADOR: 'Armando carrito', PREPARANDO: 'En preparación', PREPARADO: 'Listo para verificar', REVISANDO: 'En verificación', VERIFICADO: 'Entrega verificada', DESPACHADO: 'Despachado', EN_TRANSITO: 'En tránsito', RECIBIDO: 'Recibido en Tienda', ANULADO: 'Preparación anulada' };
export const cantidadTexto = valor => Number(valor ?? 0).toLocaleString('es-BO', { maximumFractionDigits: 6 });
export function resumenOperacion(lineas = [], ajustable = false) {
  const vigentes = lineas.filter(l => l.vigente);
  const conCantidad = vigentes.filter(l => Number(l.preparada_base) > 0 || ajustable && l.snapshot?.preparable);
  return { total: vigentes.length, preparadas: vigentes.filter(l => l.confirmada).length, revisar: conCantidad.length, revisadas: conCantidad.filter(l => l.revisada_base != null && (ajustable || Number(l.revisada_base) === Number(l.preparada_base))).length, parcial: vigentes.some(l => l.confirmada && Number(l.preparada_base) < Number(l.snapshot.pendiente_base)) };
}
export function planPreparacionCompleta(lineas = []) {
  const vigentes = lineas.filter(l => l.vigente);
  const preservadas = vigentes.filter(l => l.confirmada);
  const completar = vigentes.filter(l => !l.confirmada && l.snapshot?.preparable
    && Number.isFinite(Number(l.snapshot.pendiente_base)) && Number(l.snapshot.pendiente_base) > 0
    && Number(l.snapshot.pendiente_base) <= 1e12);
  return {
    completar, preservadas,
    faltantes: preservadas.filter(l => Number(l.preparada_base) < Number(l.snapshot.pendiente_base)),
    porResolver: vigentes.filter(l => !l.confirmada && !completar.includes(l)),
  };
}
export async function operarPedidoMovil(cliente, { pedidoId, sucursalId, tareaId = null, accion = 'consultar', version = null, datos = {} }) {
  const { data, error } = await peticionAcotada(cliente.rpc('operar_preparacion_pedido', { p_pedido_id: pedidoId, p_sucursal_id: sucursalId, p_tarea_id: tareaId, p_accion: accion, p_version: version, p_datos: datos }),{incierta:true});
  if (error) { const fallo=new Error(error.message || 'No se pudo guardar la operación.');fallo.code=error.code;throw fallo; }
  if (!data) throw new Error('No se recibió una respuesta del almacén.');
  return data;
}
export async function listarOperacionesMovil(cliente, sucursalId) {
  const [{data,error},origenes] = await Promise.all([
    cliente.from('almacen_preparacion').select('*, pedido:pedido_id(id, numero, referencia, cliente:cliente_id(nombre))').eq('sucursal_id', sucursalId).order('actualizado_en', { ascending: false }).limit(80),
    cliente.rpc('listar_origenes_pendientes_pedido',{p_sucursal_id:sucursalId}),
  ]);
  if (error) throw new Error(error.message || 'No se pudieron cargar las tareas.');
  if(origenes.error&&origenes.error.code!=='PGRST202')throw new Error(origenes.error.message||'No se pudieron consultar los orígenes pendientes.');
  const pendientes=Array.isArray(origenes.data)?origenes.data:[];
  return [...(data||[]),...pendientes.filter(t=>!(data||[]).some(r=>r.id===t.id))];
}

export const rolesAlmacen = new Set(['admin', 'gerente', 'almacenero', 'operario']);
export const rolesOperacionesMovil = new Set([...rolesAlmacen, 'vendedor', 'cajero']);
export const etiquetaDocumento = tipo => ({ pedido: 'Pedido', vtd: 'VTD', traslado_virtual: 'Traslado virtual' }[tipo] || 'Documento');
export function rutaDocumentoMovil(tipo, id, escanear = false) {
  if (!idOperacion(id)) throw new Error('El documento no tiene un ID válido.');
  const segmento = { pedido: 'pedidos', vtd: 'vtd', traslado: 'traslados', traslado_virtual: 'traslados-virtuales' }[tipo];
  if (!segmento) throw new Error('Tipo de documento no válido.');
  return `/operaciones/${segmento}/${id}${escanear ? '?escanear=1' : ''}`;
}
export async function solicitarDocumentoMovil(cliente, { tipo = 'traslado_virtual', documentoId = null, accion = 'consultar', version = null, datos = {} }) {
  const { data, error } = await peticionAcotada(cliente.rpc('operar_documento_movil', { p_tipo: tipo.toUpperCase(), p_documento_id: documentoId, p_accion: accion, p_version: version, p_datos: datos }),{incierta:true});
  if (error) throw new Error(error.message || 'No se pudo guardar la operación.');
  if (!data) throw new Error('No se recibió una respuesta del almacén.');
  return data;
}
export function adaptarDocumentoMovil(data) {
  if (!data.documento) return data;
  return { ...data, pedido: data.documento, otras_sucursales: 0, lineas: (data.lineas || []).map(l => ({ ...l, pedido_linea_id: l.id })) };
}
export async function operarDocumentoMovil(cliente, { tipo = 'pedido', documentoId, sucursalId, tareaId = null, accion = 'consultar', version = null, datos = {}, dosActores = false }) {
  if (accion === 'confirmar_resto' && !(tipo === 'pedido' && dosActores)) {
    const { data, error } = await peticionAcotada(cliente.rpc('confirmar_resto_preparacion', {
      p_tipo: tipo.toUpperCase(), p_documento_id: documentoId, p_sucursal_id: sucursalId,
      p_tarea_id: tareaId, p_version: version,
    }),{incierta:true});
    if (error) throw new Error(error.message || 'No se pudo confirmar la preparación.');
    if (!data) throw new Error('No se recibió una respuesta del almacén.');
    return tipo === 'pedido' ? data : adaptarDocumentoMovil(data);
  }
  if (tipo === 'pedido') return operarPedidoMovil(cliente, { pedidoId: documentoId, sucursalId, tareaId, accion, version, datos });
  if (tipo === 'vtd' && ['consultar','escanear'].includes(accion)) {
    const { data, error } = await peticionAcotada(cliente.rpc('operar_caja_almacen', { p_accion: accion === 'escanear' ? 'escanear' : 'consultar_vtd', p_operacion_id: null, p_sesion_id: null, p_datos: { venta_id: Number(documentoId) } }),{incierta:true});
    if (error && error.code !== 'PGRST202') throw new Error(error.message || 'No se pudo consultar la operación de Caja.');
    if (data?.operacion) return { cajaAlmacen: data };
  }
  return adaptarDocumentoMovil(await solicitarDocumentoMovil(cliente, { tipo, documentoId, accion, version, datos }));
}
export async function listarDocumentosMovil(cliente, sucursalId, rol) {
  const [pedidos, extra, caja] = await Promise.all([
    rolesAlmacen.has(rol) ? listarOperacionesMovil(cliente, sucursalId) : Promise.resolve([]),
    solicitarDocumentoMovil(cliente, { accion: 'listar', datos: { sucursal_id: sucursalId } }),
    rolesAlmacen.has(rol) ? cliente.rpc('operar_caja_almacen', { p_accion: 'listar_almacen', p_operacion_id: null, p_sesion_id: null, p_datos: {} }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (caja.error && caja.error.code !== 'PGRST202') throw new Error(caja.error.message || 'No se pudieron consultar las entregas de Caja.');
  const vinculados = (caja.data?.documentos || []).map(t => ({ ...t, id: `caja-${t.venta_id}`, tipo: 'vtd', documento_id: t.venta_id, actualizado_en: t.enviado_en || t.escaneado_en || '', preparador_nombre: 'Operación de Caja', pedido: { numero: t.numero, cliente: { nombre: '' } } }));
  return [...pedidos.map(t => ({ ...t, tipo: 'pedido', documento_id: t.pedido_id })), ...(extra.documentos || []).filter(t => !vinculados.some(v => v.documento_id === t.documento_id && String(t.tipo).toLowerCase() === 'vtd')).map(t => ({ ...t, pedido: { numero: t.numero, cliente: { nombre: t.cliente } } })), ...vinculados]
    .sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
}
