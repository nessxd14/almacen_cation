import { supabase } from '../supabaseClient';
import { interpretarCodigoOperacion } from './operacionesMovil';

export const BUCKET_CONTEO = 'conteos_controlados';
export async function operarConteo(accion, sesionId = null, datos = {}) {
  const { data, error } = await supabase.rpc('operar_conteo', { p_accion: accion, p_sesion_id: sesionId, p_datos: datos });
  if (error) throw new Error(error.message || 'No se pudo guardar el conteo.');
  return data;
}

export function dispositivoConteo() {
  const key = 'wms_conteo_dispositivo_v2';
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

// No se anuncia persistencia offline cuando IndexedDB no está disponible.
// Esperar tx.oncomplete garantiza que la captura ya es durable al confirmar.
export async function abrirColaConteo() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('wms_conteo_controlado', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('capturas', { keyPath: 'uuid' });
    request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento del conteo. No cierres la pantalla.'));
    request.onsuccess = () => resolve(request.result);
  });
  const tx = (mode, operation) => new Promise((resolve, reject) => {
    const transaction = db.transaction('capturas', mode);
    const request = operation(transaction.objectStore('capturas'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(new Error('No se pudo guardar la captura en este dispositivo.'));
  });
  return {
    listar: () => tx('readonly', s => s.getAll()),
    guardar: captura => tx('readwrite', s => s.put(captura)),
    quitar: uuid => tx('readwrite', s => s.delete(uuid)),
    cerrar: () => db.close(),
  };
}

// El cambio de motor no elimina ni aplica observaciones antiguas sin corte.
export async function pendientesConteoAnterior(usuario) {
  if (typeof indexedDB === 'undefined') return [];
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('conteo_wms');
    let inexistente = false;
    request.onupgradeneeded = () => { inexistente = true; request.transaction.abort(); };
    request.onerror = () => inexistente ? resolve([]) : reject(new Error('No se pudo revisar la cola del conteo anterior en este dispositivo.'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('conteos')) { db.close(); resolve([]); return; }
      const tx = db.transaction('conteos', 'readonly');
      const query = tx.objectStore('conteos').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(query.result.filter(c => c._sync !== 'ok' && (['admin', 'gerente'].includes(usuario.rol) || c.contador === usuario.nombre)));
      };
      tx.onerror = () => { db.close(); reject(new Error('No se pudo leer la cola del conteo anterior.')); };
    };
  });
}

export async function respaldarConteoAnterior(rows) {
  const capturas = await Promise.all(rows.map(async row => {
    const { _foto_blob: foto, ...datos } = row;
    let fotoRespaldo = null;
    if (foto) {
      const bytes = new Uint8Array(await foto.arrayBuffer());
      let binary = '';
      for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
      fotoRespaldo = { tipo: foto.type, base64: btoa(binary) };
    }
    return { datos, foto: fotoRespaldo };
  }));
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, motor: 'conteo_anterior_sin_corte', capturas }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'respaldo-conteos-anteriores.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sincronizarCaptura(captura) {
  const estado = await operarConteo('estado_captura', captura.sesionId, { uuid: captura.uuid || captura.datos.uuid });
  // Si la respuesta anterior se perdió, confirmar sin volver a escribir una
  // foto de una ronda que ya pudo cerrarse en otro teléfono.
  if (estado?.confirmada) return operarConteo('capturar', captura.sesionId, captura.datos);
  const path = captura.datos.foto_ref;
  const { error } = await supabase.storage.from(BUCKET_CONTEO).upload(path, captura.foto, {
    contentType: captura.foto.type, upsert: false,
  });
  // La foto es inmutable; un reintento usa el mismo objeto y UUID.
  if (error && String(error.statusCode) !== '409') throw new Error(error.message || 'No se pudo subir la foto.');
  return operarConteo('capturar', captura.sesionId, captura.datos);
}

export async function fotoConteoControlado(path) {
  const { data, error } = await supabase.storage.from(BUCKET_CONTEO).createSignedUrl(path, 120);
  if (error) throw new Error(error.message || 'No se pudo consultar la foto.');
  return data.signedUrl;
}

export const formatoCantidadConteo = n => n == null ? '—' : Number(n).toLocaleString('es-BO', { maximumFractionDigits: 4 });
export function requiereReconteo(producto, cantidad) {
  return Number(producto.teorico) !== Number(cantidad) || Number(producto.conteo_1) !== Number(cantidad) ||
    (producto.conteo_2 != null && Number(producto.conteo_2) !== Number(cantidad));
}

export function presentacionesDelCodigo(catalogo, codigo) {
  const texto = String(codigo).trim();
  let matches;
  if (/^https?:\/\//i.test(texto) || texto.startsWith('/')) {
    const etiqueta = interpretarCodigoOperacion(texto);
    if (etiqueta.tipo !== 'producto') throw new Error('Escanea una etiqueta de producto o un código de barras de presentación.');
    if (etiqueta.sucursalId && Number(etiqueta.sucursalId) !== Number(catalogo.sucursalId)) throw new Error('La etiqueta corresponde a otra sucursal.');
    matches = catalogo.presentaciones.filter(p => p.producto_id === Number(etiqueta.id) && (!etiqueta.presentacionId || p.id === Number(etiqueta.presentacionId)));
  } else {
    const ids = new Set(catalogo.identificadores.filter(i => i.valor === texto).map(i => i.presentacion_id));
    matches = catalogo.presentaciones.filter(p => ids.has(p.id));
  }
  if (!matches.length) throw new Error('Código sin presentación disponible en el alcance. Revisa el catálogo o registra un artículo sin catálogo.');
  return matches;
}
