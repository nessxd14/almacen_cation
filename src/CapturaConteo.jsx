import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, CheckCircle, CloudCheck, ListChecks, ScanBarcode } from 'lucide-react';
import EscanerCodigo from './EscanerCodigo';
import { formatoCantidadConteo as fmt, presentacionesDelCodigo } from './lib/conteoControlado';

const borradorVacio = () => ({ cantidades: {}, foto: null, descripcion: '' });
const mismoId = (a, b) => String(a) === String(b);

export default function CapturaConteo({ catalogo, detalle, pendientes, busy, online, onGuardar, onBorrador }) {
  const [seleccion, setSeleccion] = useState(null), [filtro, setFiltro] = useState('pendientes');
  const [query, setQuery] = useState(''), [borradores, setBorradores] = useState({});
  const [scanning, setScanning] = useState(false), [opciones, setOpciones] = useState([]);
  const [error, setError] = useState(''), [mensaje, setMensaje] = useState('');
  const guardando = useRef(false), ficha = useRef(null);
  const enAlcance = p => detalle.sesion.alcance !== 'PARCIAL' || detalle.productos.some(x => mismoId(x.producto_id, p.producto_id));
  const presentaciones = catalogo.presentaciones.filter(enAlcance);
  const productos = [...new Map([
    ...detalle.productos.map(p => [String(p.producto_id), { id: p.producto_id, nombre: p.nombre, unidad_base: p.unidad_base }]),
    ...presentaciones.filter(p => p.producto).map(p => [String(p.producto_id), p.producto]),
  ]).values()].filter(Boolean);
  const estado = id => {
    const filas = pendientes.filter(c => mismoId(c.productoId ?? catalogo.presentaciones.find(p => mismoId(p.id, c.datos?.presentacion_id))?.producto_id, id));
    const capturas = detalle.capturas.filter(c => !c.anulada && mismoId(c.producto_id ?? catalogo.presentaciones.find(p => mismoId(p.id, c.presentacion_id))?.producto_id, id));
    const contado = detalle.productos.some(p => mismoId(p.producto_id, id) && p.contado) || capturas.length > 0;
    return { pendiente: filas.length > 0, contado, total: capturas.reduce((sum, c) => sum + Number(c.cantidad) * Number(c.factor), 0) };
  };
  // El catálogo permite descubrir productos nuevos; el progreso usa el alcance
  // del servidor y las declaraciones locales, nunca todo el catálogo global.
  const idsAlcance = new Set([...detalle.productos.map(p => String(p.producto_id)), ...pendientes.map(c => c.productoId).filter(Boolean).map(String)]);
  const confirmados = detalle.productos.filter(p => p.contado && !estado(p.producto_id).pendiente).length;
  const porSubir = [...idsAlcance].filter(id => estado(id).pendiente).length;
  const faltantes = detalle.productos.filter(p => !estado(p.producto_id).contado && !estado(p.producto_id).pendiente).length;
  const desconocido = seleccion === 'sin-catalogo';
  const producto = productos.find(p => mismoId(p.id, seleccion));
  const empaques = producto ? presentaciones.filter(p => mismoId(p.producto_id, producto.id)).sort((a, b) => Number(b.factor_unidad_base) - Number(a.factor_unidad_base)) : [];
  const borrador = borradores[seleccion] ?? borradorVacio();
  const tieneBorradores = Object.values(borradores).some(b => b.foto || b.descripcion.trim() || Object.values(b.cantidades).some(q => q !== ''));
  useEffect(() => { onBorrador(tieneBorradores); }, [tieneBorradores, onBorrador]);
  const cambiar = datos => setBorradores(prev => ({ ...prev, [seleccion]: { ...(prev[seleccion] ?? borradorVacio()), ...datos } }));
  const elegir = id => { setSeleccion(String(id)); setError(''); setMensaje(''); setOpciones([]); };
  const enfocar = presentacion => {
    elegir(presentacion.producto_id);
    requestAnimationFrame(() => ficha.current?.querySelector(`[data-presentacion="${presentacion.id}"]`)?.focus());
  };
  const escanear = codigo => {
    setScanning(false); setError('');
    try {
      const matches = presentacionesDelCodigo({ ...catalogo, presentaciones }, codigo);
      if (matches.length === 1) enfocar(matches[0]);
      else setOpciones(matches);
    } catch (e) { setError(e.message); }
  };
  const total = empaques.reduce((sum, p) => sum + Number(borrador.cantidades[p.id] || 0) * Number(p.factor_unidad_base), 0);
  const actual = producto ? estado(producto.id) : null;
  const yaDeclarado = actual?.contado || actual?.pendiente;
  const guardar = async e => {
    e.preventDefault();
    if (busy || guardando.current || yaDeclarado) return;
    setError('');
    const foto = borrador.foto;
    if (!foto || !['image/jpeg', 'image/png', 'image/webp'].includes(foto.type) || foto.size > 10 * 1024 * 1024) { setError('Adjunta una foto JPEG, PNG o WebP de hasta 10 MB.'); return; }
    const filas = desconocido ? [{ presentacion_id: null, descripcion: borrador.descripcion.trim(), cantidad: borrador.cantidades.desconocido }] : empaques.filter(p => borrador.cantidades[p.id] !== undefined && borrador.cantidades[p.id] !== '').map(p => ({ presentacion_id: p.id, cantidad: borrador.cantidades[p.id] }));
    if (!filas.length || filas.some(f => f.cantidad === '' || !Number.isFinite(Number(f.cantidad)) || Number(f.cantidad) < 0 || Number(f.cantidad) >= 1e10 || !/^\d+(?:\.\d{1,4})?$/.test(String(f.cantidad)))) { setError('Indica la cantidad con hasta cuatro decimales; usa «Verifiqué: no hay» para declarar cero.'); return; }
    if (desconocido && !borrador.descripcion.trim()) { setError('Describe el artículo sin catálogo.'); return; }
    if (!desconocido && (total >= 1e10 || !Number.isFinite(total) || filas.some(f => {
      const base = Number(f.cantidad) * Number(empaques.find(p => p.id === f.presentacion_id).factor_unidad_base);
      return Math.abs(base * 1e4 - Math.round(base * 1e4)) > 1e-5;
    }))) { setError('La conversión a unidades base excede el rango o los cuatro decimales permitidos.'); return; }
    guardando.current = true;
    try {
      const etiqueta = desconocido ? borrador.descripcion.trim() : producto.nombre;
      const result = await onGuardar(filas.map(f => ({ ...f, descripcion: f.descripcion ?? null, cantidad: Number(f.cantidad) })), foto, etiqueta, producto?.id ?? null);
      if (!result) return;
      setBorradores(prev => { const next = { ...prev }; delete next[seleccion]; return next; });
      const siguiente = detalle.productos.find(p => !mismoId(p.producto_id, seleccion) && !estado(p.producto_id).contado && !estado(p.producto_id).pendiente);
      setSeleccion(siguiente ? String(siguiente.producto_id) : null);
      setMensaje(`${etiqueta}: declaración guardada en este dispositivo. El stock se actualizará al aprobar y aplicar.`);
    } finally { guardando.current = false; }
  };

  const q = query.trim().toLowerCase();
  const idsPorCodigo = new Set(q ? catalogo.identificadores.filter(i => i.valor.toLowerCase().includes(q)).map(i => String(i.presentacion_id)) : []);
  const productosPorCodigo = new Set(presentaciones.filter(p => idsPorCodigo.has(String(p.id))).map(p => String(p.producto_id)));
  const encontrados = productos.filter(p => {
    const s = estado(p.id), conocido = detalle.productos.some(x => mismoId(x.producto_id, p.id)) || s.pendiente;
    const coincide = `${p.nombre} ${p.sku_interno ?? ''} ${p.marca ?? ''}`.toLowerCase().includes(q) || productosPorCodigo.has(String(p.id));
    return coincide && (filtro === 'todos' ? (conocido || query.trim()) : filtro === 'contados' ? s.contado || s.pendiente : conocido && !s.contado && !s.pendiente);
  });
  return <section className="conteo-captura-rapida" aria-label="Declarar o verificar existencia">
    <div className="conteo-progress"><div><span><strong>{confirmados} de {idsAlcance.size}</strong> productos confirmados</span><span>{faltantes} pendientes{porSubir > 0 ? ` · ${porSubir} por sincronizar` : ''}</span></div><progress aria-label="Productos confirmados" max={Math.max(idsAlcance.size, 1)} value={confirmados} /></div>
    <nav className="conteo-capture-tools" aria-label="Captura de existencias"><button disabled={busy} onClick={() => { setSeleccion(null); setError(''); }}><ListChecks size={17} /> Pendientes</button><button disabled={busy} onClick={() => setScanning(true)}><ScanBarcode size={17} /> Escanear código</button></nav>
    {scanning && <EscanerCodigo onDetect={escanear} onClose={() => setScanning(false)} />}
    {opciones.length > 0 && <div className="conteo-card"><h3>Elige la presentación de la etiqueta</h3><div className="conteo-matches">{opciones.map(p => <button key={p.id} disabled={busy} onClick={() => enfocar(p)}>{p.producto?.nombre} · {p.nombre}</button>)}</div></div>}
    {mensaje && <p role="status" className="conteo-message">{mensaje}</p>}
    {error && <p role="alert" className="conteo-message is-error">{error}</p>}
    {seleccion == null ? <div className="conteo-card conteo-product-list">
      <h2>Productos de esta ubicación</h2>
      <label className="conteo-search-label">Buscar producto<input value={query} onChange={e => { setQuery(e.target.value); if (e.target.value) setFiltro('todos'); }} placeholder="Nombre, SKU o código de barras" disabled={busy} /></label>
      <div className="conteo-filters" role="group" aria-label="Filtrar productos">{[['pendientes', 'Pendientes'], ['contados', 'Contados'], ['todos', 'Todos']].map(([value, label]) => <button key={value} aria-pressed={filtro === value} onClick={() => setFiltro(value)} disabled={busy}>{label}</button>)}</div>
      <ul className="conteo-quick-list">{encontrados.map(p => { const s = estado(p.id); return <li key={p.id}><button disabled={busy} onClick={() => elegir(p.id)}><span><strong>{p.nombre}</strong><small>{p.sku_interno || p.unidad_base}{borradores[p.id] ? ' · Borrador sin guardar' : ''}</small></span><span>{s.pendiente ? 'Por sincronizar' : s.contado ? <><CheckCircle size={15} /> Confirmado</> : 'Contar →'}</span></button></li>; })}</ul>
      {!encontrados.length && <p>{filtro === 'pendientes' && !query ? 'No quedan productos pendientes del alcance. Comprueba que recorriste toda la ubicación.' : 'No hay productos para este filtro.'}</p>}
      {detalle.sesion.alcance === 'UBICACION' && <p className="conteo-help">¿Encontraste otro producto? Búscalo por nombre o escanea su etiqueta para incluirlo.</p>}
      <button disabled={busy} onClick={() => elegir('sin-catalogo')}>Artículo sin catálogo</button>
    </div> : <div className="conteo-card conteo-product-entry" ref={ficha}>
      <button className="conteo-back" disabled={busy} onClick={() => setSeleccion(null)}><ArrowLeft size={16} /> Volver a productos</button>
      <span className="conteo-eyebrow">DECLARAR EXISTENCIA FÍSICA</span><h2>{desconocido ? 'Artículo sin catálogo' : producto?.nombre ?? 'Producto sin presentación activa'}</h2>
      {yaDeclarado ? <div className="conteo-message"><CheckCircle size={18} /><div>{actual.pendiente ? 'Declaración guardada en este dispositivo, pendiente de sincronizar.' : `Ya declaraste este producto: ${fmt(actual.total)} ${producto.unidad_base}.`}<p>Para reemplazar la cantidad, anula sus capturas en «Tus declaraciones» indicando el motivo y vuelve a contar. Así evitas sumar dos veces la misma mercancía.</p></div></div> : <form className="conteo-form" onSubmit={guardar}>
        <p className="conteo-help">Declara todo lo que hay de este producto en esta ubicación. Cuenta empaques cerrados y unidades sueltas sin repetir mercancía.</p>
        {desconocido ? <><label>Descripción<input required value={borrador.descripcion} disabled={busy} onChange={e => cambiar({ descripcion: e.target.value })} /></label><label>Cantidad observada<input type="number" min="0" max="9999999999.9999" step="0.0001" inputMode="decimal" value={borrador.cantidades.desconocido ?? ''} disabled={busy} onChange={e => cambiar({ cantidades: { desconocido: e.target.value } })} /></label></> : <>
          <div className="conteo-package-fields">{empaques.map(p => <label key={p.id}>Cantidad de {p.nombre}<small>{fmt(p.factor_unidad_base)} {producto.unidad_base} por presentación</small><input data-presentacion={p.id} type="number" min="0" max="9999999999.9999" step="0.0001" inputMode="decimal" placeholder="0" value={borrador.cantidades[p.id] ?? ''} disabled={busy} onChange={e => cambiar({ cantidades: { ...borrador.cantidades, [p.id]: e.target.value } })} /></label>)}</div>
          {!empaques.length && <p role="alert">Este producto necesita una presentación activa en el catálogo para declarar su cantidad.</p>}
          <div className="conteo-entry-total" aria-live="polite"><span>Total declarado</span><strong>{fmt(total)} <small>{producto?.unidad_base}</small></strong></div>
        </>}
        <label className={`conteo-evidence-input${borrador.foto ? ' has-photo' : ''}`}><span><Camera size={20} />{borrador.foto ? 'Foto adjunta · Cambiar' : 'Añadir foto del conteo'}</span><input key={`${seleccion}:${borrador.foto ? 'con-foto' : 'sin-foto'}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={e => { const foto = e.target.files?.[0]; if (foto) cambiar({ foto }); }} /><small>{borrador.foto ? borrador.foto.name : 'JPEG, PNG o WebP · Hasta 10 MB'}</small></label>
        {!desconocido && empaques.length > 0 && <button type="button" className="conteo-zero" disabled={busy} onClick={() => cambiar({ cantidades: Object.fromEntries(empaques.map(p => [p.id, '0'])) })}>Verifiqué: no hay este producto</button>}
        <button className="conteo-primary" disabled={busy || (!desconocido && !empaques.length)}>{busy ? 'Guardando declaración…' : <>Guardar y siguiente <ArrowRight size={17} /></>}</button>
        <small className="conteo-save-status"><CloudCheck size={15} />{online ? 'Se guarda en el dispositivo y se confirma al sincronizar.' : 'Sin conexión · Se conservará en este dispositivo.'}</small>
        <small className="conteo-help">Guardar declara la cantidad. Aprobar y aplicar establece la nueva existencia; no la suma a la anterior.</small>
        {(borrador.foto || borrador.descripcion || Object.values(borrador.cantidades).some(q => q !== '')) && <button type="button" disabled={busy} onClick={() => { setBorradores(prev => { const next = { ...prev }; delete next[seleccion]; return next; }); setError(''); }}>Descartar borrador</button>}
      </form>}
    </div>}
  </section>;
}

export function BuscarPresentacionConteo({ catalogo, onSelect, disabled }) {
  const [query, setQuery] = useState(''), [scanning, setScanning] = useState(false);
  const [scanMatches, setScanMatches] = useState(null), [scanError, setScanError] = useState('');
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    const ids = new Set(catalogo.identificadores.filter(i => i.valor.toLowerCase().includes(q)).map(i => i.presentacion_id));
    return catalogo.presentaciones.filter(p => `${p.producto?.nombre} ${p.nombre} ${p.producto?.sku_interno ?? ''} ${p.producto?.marca ?? ''}`.toLowerCase().includes(q) || ids.has(p.id)).slice(0, 30);
  }, [query, catalogo]);
  const detectar = code => {
    setScanning(false); setScanError('');
    try { const found = presentacionesDelCodigo(catalogo, code); if (found.length === 1) { onSelect(found[0]); setScanMatches(null); setQuery(''); } else setScanMatches(found); }
    catch (e) { setScanError(e.message); }
  };
  return <div className="conteo-search"><label>Producto y presentación<input value={query} onChange={e => { setQuery(e.target.value); setScanMatches(null); setScanError(''); }} placeholder="Nombre, SKU o código de barras" disabled={disabled} /></label><button type="button" onClick={() => setScanning(true)} disabled={disabled}><Camera size={17} /> Escanear código</button>{scanning && <EscanerCodigo onDetect={detectar} onClose={() => setScanning(false)} />}{scanError && <p role="alert">{scanError}</p>}<div className="conteo-matches">{(scanMatches || matches).map(p => <button type="button" disabled={disabled} key={p.id} onClick={() => { onSelect(p); setQuery(''); setScanMatches(null); }}>{p.producto?.nombre} · {p.nombre}<small>×{fmt(p.factor_unidad_base)} en base</small></button>)}</div></div>;
}
