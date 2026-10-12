import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Trash2, ExternalLink, Plus, RefreshCw, Copy } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useSucursal } from './lib/useSucursal';
import { useAuth } from './lib/useAuth';
import { cargarDatosEtiqueta, enlaceFicha, textoUbicacion, sucursalDeFicha } from './lib/fichaProducto';
import { listarUbicacionesEtiqueta, enlaceFichaUbicacion } from './lib/fichaUbicacion';
import { presentacionesActivas, resolverPresentacion, textoPresentacion, codigosDePresentacion } from './lib/presentacionEtiqueta';
import { FORMATO_INICIAL, normalizarFormato, validarFormato, distribucionEtiquetas } from './lib/formatosEtiqueta';
import { CSS_ETIQUETA, imprimirEtiquetas } from './lib/impresionEtiquetas';
import ConfiguracionEtiquetas from './ConfiguracionEtiquetas';
import TypeaheadProducto from './TypeaheadProducto';
import EtiquetaProducto from './EtiquetaProducto';
import './fichas.css';

function leerPreferencias(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

export default function FichasEtiquetasApp({ productoId, sucursalId: inicialSucursalId, presentacionId: inicialPresentacionId }) {
  const { usuario } = useAuth();
  const { sucursalActivaId, sucursales, puedeElegir, cargando: cargandoSucursal, error: errorCargaSucursal, reintentarSucursales } = useSucursal();
  const storageKey = `wms_etiquetas_v1_${usuario.id}`;
  const [preferencias] = useState(() => leerPreferencias(storageKey));
  const [formato, setFormato] = useState(() => {
    const guardado = normalizarFormato(preferencias.formato);
    return guardado && !(productoId && guardado.diseno === 'ubicacion') ? guardado : { ...FORMATO_INICIAL };
  });
  const [guardados, setGuardados] = useState(() => (Array.isArray(preferencias.guardados) ? preferencias.guardados : []).filter(g => typeof g.nombre === 'string' && normalizarFormato(g.formato)));
  const [baseUrl, setBaseUrl] = useState(preferencias.baseUrl || import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin);
  const [selecciones, setSelecciones] = useState(() => productoId ? [{ key: 'producto:0', tipo: 'producto', id: String(productoId), presentacionId: inicialPresentacionId == null ? '' : String(inicialPresentacionId), copias: 1 }] : []);
  const contador = useRef(1);
  const [busqueda, setBusqueda] = useState('');
  const [filtroUbicacion, setFiltroUbicacion] = useState('');
  const [carga, setCarga] = useState(null);
  const [cargaUbicaciones, setCargaUbicaciones] = useState(null);
  const [revision, setRevision] = useState(0);
  const [estados, setEstados] = useState({});
  const [mensaje, setMensaje] = useState(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const esUbicacion = formato.diseno === 'ubicacion';
  const tipo = esUbicacion ? 'ubicacion' : 'producto';
  const filas = selecciones.filter(f => f.tipo === tipo);
  let sucursalId, errorSucursal;
  if (!cargandoSucursal && !errorCargaSucursal) {
    try { sucursalId = sucursalDeFicha(inicialSucursalId ?? null, usuario.sucursalId, sucursalActivaId, sucursales); }
    catch (e) { errorSucursal = e.message; }
  }
  const idsKey = [...new Set(selecciones.filter(f => f.tipo === 'producto').map(f => f.id))].sort().join(',');
  const clave = `${idsKey}:${sucursalId}:${revision}`;
  const claveUbicaciones = `${sucursalId}:${revision}`;
  useEffect(() => {
    if (!sucursalId || esUbicacion) return;
    let vigente = true;
    const ids = idsKey ? idsKey.split(',') : [];
    (async () => {
      const datos = [];
      for (let i = 0; i < ids.length; i += 5) {
        const lote = await Promise.all(ids.slice(i, i + 5).map(async id => {
          try { return { id, datos: await cargarDatosEtiqueta(supabase, id, sucursalId) }; }
          catch (error) { return { id, error: error.message }; }
        }));
        if (!vigente) return;
        datos.push(...lote);
      }
      if (vigente) setCarga({ clave: `${idsKey}:${sucursalId}:${revision}`, datos });
    })();
    return () => { vigente = false; };
  }, [idsKey, sucursalId, revision, esUbicacion]);

  useEffect(() => {
    if (!sucursalId || !esUbicacion) return;
    let vigente = true;
    listarUbicacionesEtiqueta(supabase, sucursalId).then(
      datos => { if (vigente) setCargaUbicaciones({ clave: `${sucursalId}:${revision}`, datos }); },
      error => { if (vigente) setCargaUbicaciones({ clave: `${sucursalId}:${revision}`, error: error.message }); },
    );
    return () => { vigente = false; };
  }, [sucursalId, revision, esUbicacion]);

  const cargando = esUbicacion ? cargaUbicaciones?.clave !== claveUbicaciones : !!filas.length && carga?.clave !== clave;
  const datos = carga?.clave === clave ? carga.datos : [];
  const ubicaciones = cargaUbicaciones?.clave === claveUbicaciones ? cargaUbicaciones.datos || [] : [];
  const errorUbicaciones = cargaUbicaciones?.clave === claveUbicaciones ? cargaUbicaciones.error : null;
  const sucursalNombre = sucursales.find(s => Number(s.id) === sucursalId)?.nombre || '';
  const erroresFormato = validarFormato(formato);
  const layout = distribucionEtiquetas(formato);
  let errorUrl = null, urlOrigin = null, urlLocal = false;
  try {
    const url = new URL(baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    urlOrigin = url.origin;
    urlLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { errorUrl = 'Escribe una dirección válida de Almacén (https://…).'; }

  const onEstado = useCallback((id, estado) => {
    setEstados(prev => prev[id]?.error === estado.error && prev[id]?.nodo === estado.nodo ? prev : { ...prev, [id]: estado });
  }, []);
  const elegir = (key, cambios) => setSelecciones(prev => prev.map(f => f.key === key ? { ...f, ...cambios } : f));
  const quitar = key => setSelecciones(prev => prev.filter(f => f.key !== key));
  const agregar = (id, duplicar = false) => {
    if (filas.length >= 50) { setMensaje('Puedes preparar hasta 50 selecciones por lote.'); return; }
    if (!duplicar && filas.some(f => f.id === String(id))) { setMensaje(esUbicacion ? 'La ubicación ya está seleccionada. Ajusta sus copias.' : 'El producto ya está seleccionado. Usa “Añadir otra presentación” para preparar otra etiqueta.'); return; }
    const nueva = { key: `${tipo}:${contador.current++}`, tipo, id: String(id), copias: 1, presentacionId: '' };
    setSelecciones(prev => [...prev, nueva]);
    setMensaje(null);
  };

  const etiquetas = filas.map(fila => {
    if (esUbicacion) {
      const ubicacion = ubicaciones.find(u => String(u.id) === fila.id);
      return { fila, ubicacion, nombre: textoUbicacion(ubicacion), data: ubicacion ? { producto: { id: ubicacion.id, nombre: textoUbicacion(ubicacion) }, atributos: [] } : null,
        enlace: urlOrigin && ubicacion ? enlaceFichaUbicacion(ubicacion.id, sucursalId, urlOrigin) : null,
        destino: ubicacion ? `/ubicaciones/${ubicacion.id}/ficha?sucursal=${sucursalId}` : null,
        error: !cargando && !ubicacion ? 'Esta ubicación no está disponible en la sucursal actual. Quítala y selecciona otra.' : null };
    }
    const registro = datos.find(d => d.id === fila.id);
    const data = registro?.datos;
    if (!data) return { fila, nombre: `Producto ${fila.id}`, error: registro?.error };
    const presentaciones = presentacionesActivas(data.presentaciones);
    const presentacion = resolverPresentacion(data.presentaciones, fila.presentacionId);
    const codigos = codigosDePresentacion(presentacion);
    const codigoBarras = fila.codigoId ? codigos.find(c => String(c.id) === fila.codigoId) : codigos[0];
    const ubicacion = fila.ubicacionId ? data.asignaciones.find(a => String(a.ubicacion.id) === fila.ubicacionId)?.ubicacion : data.asignaciones[0]?.ubicacion;
    const error = fila.presentacionId && !presentacion ? 'La presentación elegida ya no está disponible. Selecciona una presentación actual.'
      : fila.ubicacionId && !ubicacion ? 'La ubicación elegida ya no está disponible. Selecciona otra ubicación.'
        : formato.barras && fila.codigoId && !codigoBarras ? 'El código elegido ya no pertenece a esta presentación. Selecciona otro código.'
          : formato.diseno === 'caja_bulto' && (!presentacion || !Number.isFinite(Number(presentacion.factor_unidad_base)) || !(Number(presentacion.factor_unidad_base) > 0)) ? 'Selecciona una presentación con equivalencia registrada para etiquetar la caja o bulto.' : null;
    return { fila, data, nombre: data.producto.nombre, presentaciones, presentacion, codigos, codigoBarras, ubicacion,
      enlace: urlOrigin ? enlaceFicha(fila.id, sucursalId, urlOrigin, presentacion?.id) : null,
      destino: enlaceFicha(fila.id, sucursalId, window.location.origin, presentacion?.id), error };
  });
  const totalEtiquetas = filas.reduce((n, f) => n + Number(f.copias), 0);
  const copiasInvalidas = filas.some(f => !Number.isInteger(Number(f.copias)) || Number(f.copias) < 1 || Number(f.copias) > 100) || totalEtiquetas > 500;
  const etiquetasListas = etiquetas.every(e => e.data && !e.error && estados[e.fila.key]?.nodo?.isConnected && !estados[e.fila.key]?.error);
  const puedeImprimir = !!filas.length && !!sucursalId && !cargando && etiquetasListas && !erroresFormato.length && !errorUrl && !imprimiendo;

  function persistir(nuevosGuardados) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ formato, guardados: nuevosGuardados, baseUrl }));
      setMensaje('Formato y dirección guardados en este navegador.');
    } catch { setMensaje('No se pudo guardar en este navegador. Puedes seguir usando el formato durante esta sesión.'); }
  }
  function guardar(nombre) {
    if (erroresFormato.length || errorUrl) return;
    const nuevos = nombre ? [...guardados.filter(g => g.nombre !== nombre), { nombre, formato }].slice(-20) : guardados;
    setGuardados(nuevos); persistir(nuevos);
  }
  function eliminar(nombre) { const nuevos = guardados.filter(g => g.nombre !== nombre); setGuardados(nuevos); persistir(nuevos); }
  async function imprimir(prueba = false) {
    if (!puedeImprimir || (!prueba && copiasInvalidas)) return;
    setImprimiendo(true); setMensaje(null);
    try {
      const nodos = prueba ? [estados[filas[0].key].nodo.outerHTML] : filas.flatMap(f => Array.from({ length: Number(f.copias) }, () => estados[f.key].nodo.outerHTML));
      await imprimirEtiquetas(nodos, formato);
    } catch (e) { setMensaje(e.message); }
    finally { setImprimiendo(false); }
  }

  return <div className="fichas-app">
    <style>{CSS_ETIQUETA}</style>
    <header className="fichas-heading"><div><span className="fichas-eyebrow">CATÁLOGO · {sucursalNombre || 'ALMACÉN'}</span><h2>Fichas y etiquetas</h2><p>Elige el diseño, la presentación y el lugar que necesitas identificar.</p></div></header>
    {cargandoSucursal && <p role="status">Cargando almacenes y tiendas…</p>}
    {errorCargaSucursal && <div className="fichas-alert" role="alert"><p>{errorCargaSucursal}</p><button className="fichas-button" onClick={reintentarSucursales}>Reintentar</button></div>}
    {errorSucursal && <p role="alert" className="fichas-alert">{errorSucursal}</p>}
    {sucursalNombre && <p className="fichas-note">Consulta e impresión de {sucursalNombre}.{puedeElegir && ' Puedes cambiar de lugar en el selector superior.'}</p>}
    <div className="fichas-generator-grid">
      <ConfiguracionEtiquetas formato={formato} setFormato={setFormato} guardados={guardados} guardar={guardar} eliminar={eliminar} baseUrl={baseUrl} setBaseUrl={setBaseUrl} errorUrl={errorUrl} urlLocal={urlLocal} errores={erroresFormato} />
      <section className="fichas-selection">
        <div className="fichas-panel"><h3>{esUbicacion ? 'Ubicaciones del almacén' : 'Productos y presentaciones'}</h3>
          {esUbicacion ? <><label className="fichas-field">Buscar ubicación<input value={filtroUbicacion} onChange={e => setFiltroUbicacion(e.target.value)} placeholder="Zona, estante o nivel…" /></label><label className="fichas-field">Añadir ubicación<select aria-label="Añadir ubicación" value="" onChange={e => { if (e.target.value) agregar(e.target.value); }}><option value="">Seleccionar ubicación registrada</option>{ubicaciones.filter(u => textoUbicacion(u).toLocaleLowerCase().includes(filtroUbicacion.toLocaleLowerCase())).map(u => <option key={u.id} value={u.id}>{textoUbicacion(u)}</option>)}</select></label>{errorUbicaciones && <p className="fichas-alert" role="alert">{errorUbicaciones}</p>}{!cargando && !errorUbicaciones && !ubicaciones.length && <p className="fichas-note">No hay ubicaciones disponibles en esta sucursal.</p>}</>
            : <TypeaheadProducto value={busqueda} onChange={setBusqueda} label="Buscar producto para etiquetas" placeholder="Nombre, SKU o código de barras…" onSeleccionar={p => agregar(p.id)} />}
          <div className="fichas-actions"><span>{filas.length} selecciones · {totalEtiquetas} etiquetas</span><button className="fichas-button" onClick={() => setRevision(r => r + 1)} disabled={cargando || !sucursalId}><RefreshCw size={15} /> Actualizar datos</button></div>
          {cargando && sucursalId && <p role="status">Consultando información actual…</p>}
          {!filas.length && <p className="fichas-empty"><Plus size={18} /> {esUbicacion ? 'Selecciona los lugares que quieres identificar.' : 'Selecciona un producto y luego su presentación.'}</p>}
        </div>
        {etiquetas.map(e => <section className="fichas-panel fichas-preview" key={e.fila.key}>
          <div className="fichas-preview-heading"><h3>{e.nombre}</h3><button className="fichas-icon-button" aria-label={`Quitar ${e.nombre}`} onClick={() => quitar(e.fila.key)}><Trash2 size={16} /></button>{e.destino && <Link className="fichas-button" to={e.destino}><ExternalLink size={15} /> Ficha digital</Link>}</div>
          {e.error && <p className="fichas-alert" role="alert">{e.error}</p>}
          <div className="fichas-fields-grid">
            {!esUbicacion && e.data && <label className="fichas-field fichas-presentation-field">Presentación<select aria-label={`Presentación de ${e.nombre}`} value={e.presentacion?.id || ''} onChange={event => elegir(e.fila.key, { presentacionId: event.target.value, codigoId: '' })}>{!e.presentacion && <option value="">{e.presentaciones.length ? 'Selecciona una presentación' : 'Sin presentaciones registradas'}</option>}{e.presentaciones.map(p => <option key={p.id} value={p.id}>{textoPresentacion(p, e.data.producto.unidad_base)}</option>)}</select><span>{e.presentacion ? textoPresentacion(e.presentacion, e.data.producto.unidad_base) : `Unidad base del producto: ${e.data.producto.unidad_base}`}</span></label>}
            <label className="fichas-field">Copias<input aria-label={`Copias de ${e.nombre}`} type="number" min={1} max={100} value={e.fila.copias} onChange={event => elegir(e.fila.key, { copias: Number(event.target.value) })} /></label>
            {!esUbicacion && e.data && formato.ubicacion && <label className="fichas-field">Ubicación impresa<select aria-label={`Ubicación impresa de ${e.nombre}`} value={e.ubicacion?.id || ''} onChange={event => elegir(e.fila.key, { ubicacionId: event.target.value })}><option value="">{e.data.asignaciones.length ? 'Usar ubicación principal / disponible' : 'Sin ubicación asignada'}</option>{e.data.asignaciones.map(a => <option key={a.ubicacion.id} value={a.ubicacion.id}>{textoUbicacion(a.ubicacion)}{a.es_principal && ' · Principal'}</option>)}</select></label>}
            {!esUbicacion && e.data && formato.barras && <label className="fichas-field">Código de la presentación<select aria-label={`Código de barras de ${e.nombre}`} value={e.codigoBarras?.id || ''} onChange={event => elegir(e.fila.key, { codigoId: event.target.value })}>{!e.codigoBarras && <option value="">{e.codigos.length ? 'Seleccionar código' : 'Sin código registrado en esta presentación'}</option>}{e.codigos.map(c => <option key={c.id} value={c.id}>{c.valor}</option>)}</select></label>}
            {formato.diseno === 'control_lote' && <><label className="fichas-field">Lote para imprimir<input maxLength={40} value={e.fila.lote || ''} onChange={event => elegir(e.fila.key, { lote: event.target.value })} placeholder="Completar si corresponde" /></label><label className="fichas-field">Fecha de ingreso para imprimir<input type="date" value={e.fila.fechaIngreso || ''} onChange={event => elegir(e.fila.key, { fechaIngreso: event.target.value })} /></label></>}
          </div>
          {formato.diseno === 'control_lote' && <p className="fichas-note">Lote y fecha son anotaciones de esta impresión. No registran una entrada de inventario.</p>}
          {!esUbicacion && e.data && <button className="fichas-button" onClick={() => agregar(e.fila.id, true)}><Copy size={15} /> Añadir otra presentación</button>}
          {!esUbicacion && e.data && formato.barras && !e.codigos.length && <p className="fichas-note">La presentación elegida no tiene código de barras. Su etiqueta llevará el QR de la ficha.</p>}
          {!esUbicacion && e.data && formato.foto && !e.data.producto.imagen_url && <p className="fichas-note">Este producto no tiene foto registrada.</p>}
          {e.data && e.enlace && !e.error && !erroresFormato.length && <EtiquetaProducto etiquetaId={e.fila.key} datos={e.data} formato={formato} enlace={e.enlace} ubicacion={e.ubicacion} presentacion={e.presentacion} codigoBarras={e.codigoBarras} sucursalNombre={sucursalNombre} lote={e.fila.lote || ''} fechaIngreso={e.fila.fechaIngreso || ''} onEstado={onEstado} />}
          {estados[e.fila.key]?.error && <p className="fichas-alert" role="alert">{estados[e.fila.key].error}</p>}
          <p className="fichas-note">{formato.ancho} × {formato.alto} mm · {e.fila.copias} copias</p>
        </section>)}
        <footer className="fichas-panel fichas-print-actions">
          <div>{layout && <p>{layout.porPagina} etiquetas por {formato.papel === 'rollo' ? 'corte' : 'hoja A4'}{layout.girada && ' · etiquetas giradas 90°'} · {Math.ceil(totalEtiquetas / layout.porPagina)} páginas</p>}<p className="fichas-note">Imprime al 100%, sin ajustar a página y sin encabezados. Elige “Guardar como PDF” para descargar el documento.</p></div>
          <div className="fichas-print-buttons"><button className="fichas-button" onClick={() => imprimir(true)} disabled={!puedeImprimir}><Printer size={16} /> Imprimir 1 prueba</button><button className="fichas-button fichas-button-primary" onClick={() => imprimir(false)} disabled={!puedeImprimir || copiasInvalidas}><Printer size={18} /> {imprimiendo ? 'Preparando…' : 'Imprimir etiquetas'}</button></div>
          {copiasInvalidas && <p className="fichas-alert" role="alert">Usa entre 1 y 100 copias por selección, con un máximo de 500 etiquetas por lote.</p>}
        </footer>
      </section>
    </div>
    {mensaje && <p className="fichas-feedback" role="status">{mensaje}</p>}
  </div>;
}
