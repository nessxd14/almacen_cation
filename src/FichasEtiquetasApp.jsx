import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Save, Trash2, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useSucursal } from './lib/useSucursal';
import { useAuth } from './lib/useAuth';
import { cargarDatosEtiqueta, codigosDePresentaciones, enlaceFicha, textoUbicacion, sucursalDeFicha } from './lib/fichaProducto';
import { FORMATO_INICIAL, FORMATOS_ETIQUETA, normalizarFormato, validarFormato, distribucionEtiquetas } from './lib/formatosEtiqueta';
import { CSS_ETIQUETA, imprimirEtiquetas } from './lib/impresionEtiquetas';
import TypeaheadProducto from './TypeaheadProducto';
import EtiquetaProducto from './EtiquetaProducto';
import './fichas.css';

function leerPreferencias(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

export default function FichasEtiquetasApp({ productoId, sucursalId: inicialSucursalId }) {
  const { usuario } = useAuth();
  const { sucursalActivaId, sucursales, puedeElegir, cargando: cargandoSucursal, error: errorCargaSucursal, reintentarSucursales } = useSucursal();
  const storageKey = `wms_etiquetas_v1_${usuario.id}`;
  const [preferencias] = useState(() => leerPreferencias(storageKey));
  const [formato, setFormato] = useState(() => normalizarFormato(preferencias.formato) || { ...FORMATO_INICIAL });
  const [guardados, setGuardados] = useState(() => (Array.isArray(preferencias.guardados) ? preferencias.guardados : []).filter(g => typeof g.nombre === 'string' && normalizarFormato(g.formato)));
  const [nombreFormato, setNombreFormato] = useState('');
  const [baseUrl, setBaseUrl] = useState(preferencias.baseUrl || import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin);
  const [ids, setIds] = useState(() => productoId ? [String(productoId)] : []);
  const [busqueda, setBusqueda] = useState('');
  const [carga, setCarga] = useState(null);
  const [revision, setRevision] = useState(0);
  const [elecciones, setElecciones] = useState({});
  const [estados, setEstados] = useState({});
  const [mensaje, setMensaje] = useState(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  let sucursalId, errorSucursal;
  if (!cargandoSucursal && !errorCargaSucursal) {
    try { sucursalId = sucursalDeFicha(inicialSucursalId ?? null, usuario.sucursalId, sucursalActivaId, sucursales); }
    catch (e) { errorSucursal = e.message; }
  }
  const clave = `${ids.join(',')}:${sucursalId}:${revision}`;
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!sucursalId) return;
    let activo = true;
    const seleccionados = idsKey ? idsKey.split(',') : [];
    (async () => {
      const datos = [];
      // Limita concurrencia en lotes grandes para no saturar las consultas.
      for (let i = 0; i < seleccionados.length; i += 5) {
        const lote = await Promise.all(seleccionados.slice(i, i + 5).map(async id => {
          try { return { id, datos: await cargarDatosEtiqueta(supabase, id, sucursalId) }; }
          catch (error) { return { id, error: error.message }; }
        }));
        if (!activo) return;
        datos.push(...lote);
      }
      if (activo) setCarga({ clave: `${idsKey}:${sucursalId}:${revision}`, datos });
    })();
    return () => { activo = false; };
  }, [idsKey, sucursalId, revision]);

  const cargando = !!ids.length && carga?.clave !== clave;
  const datos = carga?.clave === clave ? carga.datos : [];
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
    setEstados(prev => {
      const key = String(id);
      if (prev[key]?.error === estado.error && prev[key]?.nodo === estado.nodo) return prev;
      return { ...prev, [key]: estado };
    });
  }, []);
  const cambiar = (campo, valor) => { setFormato(f => ({ ...f, [campo]: valor })); setMensaje(null); };
  const elegir = (id, campo, valor) => setElecciones(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));
  const copias = id => elecciones[id]?.copias ?? 1;
  const totalEtiquetas = ids.reduce((n, id) => n + Number(copias(id)), 0);
  const copiasInvalidas = ids.some(id => !Number.isInteger(Number(copias(id))) || Number(copias(id)) < 1 || Number(copias(id)) > 100) || totalEtiquetas > 500;
  const faltanDatos = datos.some(d => d.error);
  const etiquetasListas = datos.length === ids.length && datos.every(d => !d.error && estados[d.id]?.nodo?.isConnected && !estados[d.id]?.error);

  function persistir(nuevosGuardados = guardados) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ formato, guardados: nuevosGuardados, baseUrl }));
      setMensaje('Formato y dirección guardados en este navegador.');
    } catch { setMensaje('No se pudo guardar en este navegador. Puedes seguir usando el formato durante esta sesión.'); }
  }
  function guardarFormato() {
    if (erroresFormato.length || errorUrl) return;
    const nombre = nombreFormato.trim().slice(0, 60);
    if (!nombre) { persistir(); return; }
    const nuevos = [...guardados.filter(g => g.nombre !== nombre), { nombre, formato }].slice(-20);
    setGuardados(nuevos); setNombreFormato(''); persistir(nuevos);
  }
  async function imprimir() {
    setImprimiendo(true); setMensaje(null);
    try {
      const nodos = datos.flatMap(d => Array.from({ length: Number(copias(d.id)) }, () => estados[d.id].nodo.outerHTML));
      await imprimirEtiquetas(nodos, formato);
    } catch (e) { setMensaje(e.message); }
    finally { setImprimiendo(false); }
  }
  const numeros = [
    ['ancho', 'Ancho (mm)', 35, 297], ['alto', 'Alto (mm)', 25, 420], ['fuente', 'Texto (pt)', 6, 24],
    ['qr', 'QR (mm)', 20, 60], ['relleno', 'Margen de etiqueta (mm)', 1, 10],
    ...(formato.papel === 'hoja' ? [['margen', 'Margen de hoja (mm)', 0, 30], ['separacion', 'Separación (mm)', 0, 20]] : []),
  ];
  const opciones = [['codigo', 'Código del producto'], ['marca', 'Marca'], ['ubicacion', 'Sucursal y ubicación'], ['unidad', 'Unidad base'], ['atributos', 'Características'], ['foto', 'Foto si existe'], ['barras', 'Código de barras existente']];

  return <div className="fichas-app">
    <style>{CSS_ETIQUETA}</style>
    <header className="fichas-heading"><div><span className="fichas-eyebrow">CATÁLOGO · {sucursalNombre || 'ALMACÉN'}</span><h2>Fichas y etiquetas</h2><p>Consulta la ficha digital y prepara etiquetas individuales o por lote.</p></div></header>
    {cargandoSucursal && <p role="status">Cargando almacenes y tiendas…</p>}
    {errorCargaSucursal && <div className="fichas-alert" role="alert"><p>{errorCargaSucursal}</p><button className="fichas-button" onClick={reintentarSucursales}>Reintentar</button></div>}
    {errorSucursal && <p role="alert" className="fichas-alert">{errorSucursal}</p>}
    {sucursalNombre && <p className="fichas-note">Las fichas mostrarán las ubicaciones y existencias de {sucursalNombre}.{puedeElegir && ' Para consultar otro lugar, cambia la sucursal en el selector superior.'}</p>}
    <div className="fichas-generator-grid">
      <section className="fichas-panel fichas-settings"><h3>Formato de impresión</h3>
        <label className="fichas-field">Formato
          <select aria-label="Formato" value="" onChange={e => {
            const index = Number(e.target.value.split(':')[1]);
            const elegido = e.target.value.startsWith('base:') ? { ...FORMATO_INICIAL, ...FORMATOS_ETIQUETA[index] } : normalizarFormato(guardados[index]?.formato);
            if (elegido) { setFormato(elegido); setMensaje(null); }
          }}><option value="" disabled>Elegir o adaptar un formato</option><optgroup label="Predefinidos">{FORMATOS_ETIQUETA.map((f, i) => <option key={f.id} value={`base:${i}`}>{f.nombre}</option>)}</optgroup>{guardados.length > 0 && <optgroup label="Guardados en este navegador">{guardados.map((g, i) => <option key={g.nombre} value={`guardado:${i}`}>{g.nombre}</option>)}</optgroup>}</select>
        </label>
        <div className="fichas-fields-grid"><label className="fichas-field">Papel<select aria-label="Papel" value={formato.papel} onChange={e => cambiar('papel', e.target.value)}><option value="hoja">Hoja A4</option><option value="rollo">Rollo / etiqueta individual</option></select></label>
          {formato.papel === 'hoja' && <label className="fichas-field">Orientación de hoja<select aria-label="Orientación de hoja" value={formato.orientacion} onChange={e => cambiar('orientacion', e.target.value)}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>}
          {numeros.map(([campo, label, min, max]) => <label className="fichas-field" key={campo}>{label}<input type="number" min={min} max={max} step="0.5" value={formato[campo]} onChange={e => cambiar(campo, Number(e.target.value))} /></label>)}
        </div>
        <fieldset className="fichas-options"><legend>Contenido de la etiqueta</legend>{opciones.map(([campo, label]) => <label key={campo}><input type="checkbox" checked={formato[campo]} onChange={e => cambiar(campo, e.target.checked)} />{label}</label>)}</fieldset>
        <p className="fichas-note">El QR se incluye siempre. Las cantidades se consultan en la ficha digital.</p>
        <label className="fichas-field">Dirección de Almacén para el QR<input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://tu-almacen…" /></label>
        {urlLocal && <p className="fichas-alert">Esta dirección solo funciona en este equipo. Para escanear desde celulares, escribe la dirección publicada de Almacén o una dirección accesible en tu red.</p>}
        {errorUrl && <p className="fichas-alert" role="alert">{errorUrl}</p>}
        {erroresFormato.length > 0 && <ul className="fichas-alert" role="alert">{erroresFormato.map(e => <li key={e}>{e}</li>)}</ul>}
        <label className="fichas-field">Nombre para guardar (opcional)<input maxLength={60} value={nombreFormato} onChange={e => setNombreFormato(e.target.value)} placeholder="Ej.: Estante pequeño" /></label>
        <button className="fichas-button" disabled={!!erroresFormato.length || !!errorUrl} onClick={guardarFormato}><Save size={16} /> Guardar formato y dirección</button>
        {guardados.length > 0 && <details><summary>Administrar formatos guardados</summary>{guardados.map(g => <div className="fichas-saved" key={g.nombre}><span>{g.nombre}</span><button className="fichas-icon-button" aria-label={`Eliminar formato ${g.nombre}`} onClick={() => { const nuevos = guardados.filter(f => f.nombre !== g.nombre); setGuardados(nuevos); persistir(nuevos); }}><Trash2 size={16} /></button></div>)}</details>}
      </section>
      <section className="fichas-selection">
        <div className="fichas-panel"><h3>Productos</h3><TypeaheadProducto value={busqueda} onChange={setBusqueda} label="Buscar producto para etiquetas" placeholder="Nombre, SKU o código de barras…" onSeleccionar={p => {
          if (ids.includes(String(p.id))) { setMensaje('El producto ya está seleccionado. Ajusta sus copias.'); return; }
          if (ids.length >= 50) { setMensaje('Puedes preparar hasta 50 productos por lote.'); return; }
          setIds(prev => [...prev, String(p.id)]); setMensaje(null);
        }} />
          <div className="fichas-actions"><span>{ids.length} {ids.length === 1 ? 'producto' : 'productos'} · {totalEtiquetas} {totalEtiquetas === 1 ? 'etiqueta' : 'etiquetas'}</span>{ids.length > 0 && <button className="fichas-button" onClick={() => setRevision(r => r + 1)} disabled={cargando}><RefreshCw size={15} /> Actualizar datos</button>}</div>
          {cargando && <p role="status">Consultando productos y ubicaciones actuales…</p>}
          {!ids.length && <p className="fichas-empty"><Plus size={18} /> Busca y selecciona los productos que quieres etiquetar.</p>}
          {datos.map(d => <div className="fichas-selected-row" key={d.id}><div><strong>{d.datos?.producto.nombre || `Producto ${d.id}`}</strong>{d.error && <p className="fichas-alert" role="alert">{d.error}</p>}</div><label className="fichas-field">Copias<input type="number" min={1} max={100} value={copias(d.id)} onChange={e => elegir(d.id, 'copias', Number(e.target.value))} /></label><button className="fichas-icon-button" aria-label={`Quitar ${d.datos?.producto.nombre || d.id}`} onClick={() => setIds(prev => prev.filter(id => id !== d.id))}><Trash2 size={16} /></button></div>)}
          {cargando && ids.map(id => <button className="fichas-button" key={id} onClick={() => setIds(prev => prev.filter(v => v !== id))}>Quitar producto {id}</button>)}
        </div>
        {datos.filter(d => d.datos).map(({ id, datos: data }) => {
          const asignaciones = data.asignaciones;
          const ubicacion = asignaciones.find(a => String(a.ubicacion.id) === elecciones[id]?.ubicacionId)?.ubicacion || asignaciones[0]?.ubicacion;
          const codigos = codigosDePresentaciones(data.presentaciones);
          const codigoBarras = codigos.find(c => String(c.id) === elecciones[id]?.codigoId) || codigos[0];
          const enlace = urlOrigin ? enlaceFicha(id, sucursalId, urlOrigin) : null;
          return <section className="fichas-panel fichas-preview" key={id}><div className="fichas-preview-heading"><h3>{data.producto.nombre}</h3><Link className="fichas-button" to={`/productos/${id}/ficha?sucursal=${sucursalId}`}><ExternalLink size={15} /> Ficha digital</Link></div>
            <div className="fichas-fields-grid">
              {formato.ubicacion && <label className="fichas-field">Ubicación impresa<select aria-label={`Ubicación impresa de ${data.producto.nombre}`} value={ubicacion?.id || ''} onChange={e => elegir(id, 'ubicacionId', e.target.value)}>{!asignaciones.length && <option value="">Sin ubicación asignada</option>}{asignaciones.map(a => <option key={a.ubicacion.id} value={a.ubicacion.id}>{textoUbicacion(a.ubicacion)}{a.es_principal && ' · Principal'}</option>)}</select></label>}
              {formato.barras && <label className="fichas-field">Código de barras / presentación<select aria-label={`Código de barras de ${data.producto.nombre}`} value={codigoBarras?.id || ''} onChange={e => elegir(id, 'codigoId', e.target.value)}>{!codigos.length && <option value="">Sin código de barras registrado</option>}{codigos.map(c => <option key={c.id} value={c.id}>{c.valor} · {c.presentacion}</option>)}</select></label>}
            </div>
            {formato.barras && !codigos.length && <p className="fichas-note">Este producto no tiene código de barras registrado. Se imprimirá su QR.</p>}
            {formato.foto && !data.producto.imagen_url && <p className="fichas-note">No tiene foto registrada. La etiqueta se generará sin foto.</p>}
            {enlace && !erroresFormato.length && <EtiquetaProducto datos={data} formato={formato} enlace={enlace} ubicacion={ubicacion} codigoBarras={codigoBarras} sucursalNombre={sucursalNombre} onEstado={onEstado} />}
            {estados[id]?.error && <p className="fichas-alert" role="alert">{estados[id].error}</p>}
            <p className="fichas-note">{formato.ancho} × {formato.alto} mm · {copias(id)} {Number(copias(id)) === 1 ? 'copia' : 'copias'}</p>
          </section>;
        })}
        <footer className="fichas-panel fichas-print-actions">
          <div>{layout && <p>{layout.porPagina} {layout.porPagina === 1 ? 'etiqueta' : 'etiquetas'} por {formato.papel === 'rollo' ? 'página / corte' : 'hoja A4'} · {Math.ceil(totalEtiquetas / layout.porPagina)} {Math.ceil(totalEtiquetas / layout.porPagina) === 1 ? 'página' : 'páginas'}</p>}<p className="fichas-note">Imprime al 100%, sin ajustar a página y sin encabezados. También puedes elegir “Guardar como PDF” en la impresión.</p></div>
          <button className="fichas-button fichas-button-primary" onClick={imprimir} disabled={!ids.length || !sucursalId || cargando || faltanDatos || !etiquetasListas || erroresFormato.length > 0 || !!errorUrl || copiasInvalidas || imprimiendo}><Printer size={18} /> {imprimiendo ? 'Preparando…' : 'Imprimir etiquetas'}</button>
          {copiasInvalidas && <p className="fichas-alert" role="alert">Usa entre 1 y 100 copias por producto, con un máximo de 500 etiquetas por lote.</p>}
        </footer>
      </section>
    </div>
    {mensaje && <p className="fichas-feedback" role="status">{mensaje}</p>}
  </div>;
}
