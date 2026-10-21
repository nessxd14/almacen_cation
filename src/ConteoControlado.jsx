import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ClipboardList, RefreshCw, ArrowLeft, LockKeyhole, CheckCircle } from 'lucide-react';
import { supabase } from './supabaseClient';
import { fetchAll } from './lib/fetchAll';
import { useUsuarioActual } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { useAppNav } from './lib/useAppNav';
import { etiquetaUbicacion } from './lib/ubicacionTexto';
import { abrirColaConteo, dispositivoConteo, operarConteo, sincronizarCaptura, fotoConteoControlado, formatoCantidadConteo as fmt, requiereReconteo, presentacionesDelCodigo, pendientesConteoAnterior, respaldarConteoAnterior } from './lib/conteoControlado';
import EscanerCodigo from './EscanerCodigo';
import './conteo-controlado.css';

const estados = { CAPTURA: 'En conteo', REVISION: 'Por revisar', APLICADA: 'Aplicado', CANCELADA: 'Cancelado' };
const fecha = iso => new Date(iso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
const activa = s => ['CAPTURA', 'REVISION'].includes(s.estado);
const accionesHistorial = { crear: 'Conteo iniciado', tomar_ronda: 'Ronda asignada', capturar: 'Captura registrada', anular_captura: 'Captura anulada', catalogar: 'Artículo vinculado', finalizar_ronda: 'Ronda finalizada', resolver: 'Producto aprobado', aplicar: 'Conteo aplicado', cancelar: 'Conteo cancelado' };

export default function ConteoControlado({ revision = false }) {
  const usuario = useUsuarioActual();
  const { sucursalActivaId } = useSucursal();
  return <Workspace key={`${usuario?.id}:${sucursalActivaId}`} usuario={usuario} sucursalId={sucursalActivaId} revision={revision} />;
}

function Workspace({ usuario, sucursalId, revision }) {
  const { conteoPrefill, setConteoPrefill } = useAppNav();
  const [catalogo, setCatalogo] = useState(null), [init, setInit] = useState(null);
  const [sesiones, setSesiones] = useState([]), [anteriores, setAnteriores] = useState(0);
  const [pendientesAnteriores, setPendientesAnteriores] = useState([]), [avisoAnterior, setAvisoAnterior] = useState('');
  const [detalle, setDetalle] = useState(null), [pendientes, setPendientes] = useState([]);
  const [error, setError] = useState(''), [aviso, setAviso] = useState(''), [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine), [nueva, setNueva] = useState(!!conteoPrefill);
  const [form, setForm] = useState({ nombre: '', ubicacion_id: conteoPrefill?.ubicacionId ?? '', metodo: 'SIMPLE', tipo: 'VERIFICACION', alcance: conteoPrefill ? 'PARCIAL' : 'UBICACION', producto_ids: conteoPrefill ? [conteoPrefill.productoId] : [] });
  const solicitud = useRef(null), syncActual = useRef(null);
  const listar = useCallback(async () => {
    const data = await operarConteo('listar', null, { sucursal_id: sucursalId });
    setSesiones(data.sesiones); setAnteriores(data.anteriores);
  }, [sucursalId]);

  useEffect(() => {
    let vigente = true;
    pendientesConteoAnterior(usuario).then(rows => { if (vigente) setPendientesAnteriores(rows); }).catch(e => { if (vigente) setAvisoAnterior(e.message); });
    return () => { vigente = false; };
  }, [usuario]);

  useEffect(() => {
    let vigente = true, cola;
    async function iniciar() {
      try {
        const [ubicaciones, presentaciones, identificadores] = await Promise.all([
          fetchAll(() => supabase.from('ubicacion').select('id,codigo_zona,estante,nivel,compartimiento,sucursal_id,excluye_disponible').eq('sucursal_id', sucursalId).eq('excluye_disponible', false).order('id')),
          fetchAll(() => supabase.from('presentacion').select('id,producto_id,nombre,factor_unidad_base,es_base,activo,producto(id,nombre,sku_interno,marca,unidad_base)').eq('activo', true).order('id')),
          fetchAll(() => supabase.from('identificador').select('presentacion_id,valor').eq('activo', true).order('id')),
        ]);
        cola = await abrirColaConteo();
        const dispositivo = dispositivoConteo();
        if (vigente) { setCatalogo({ ubicaciones, presentaciones, identificadores, sucursalId }); setInit({ cola, dispositivo }); }
        else cola.cerrar();
      } catch (e) { if (vigente) setError(e.message); }
    }
    void iniciar();
    return () => { vigente = false; cola?.cerrar(); };
  }, [sucursalId]);
  useEffect(() => {
    // La lista proviene del servidor; el callback actualiza el estado al llegar.
    const timer = setTimeout(() => { void listar().catch(e => setError(e.message)); }, 0);
    return () => clearTimeout(timer);
  }, [listar]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const leerCola = useCallback(async () => {
    if (!init) return [];
    const rows = (await init.cola.listar()).filter(c => c.usuarioId === usuario.id);
    setPendientes(rows); return rows;
  }, [init, usuario.id]);
  const sincronizar = useCallback(async () => {
    if (!init) return;
    if (syncActual.current) return syncActual.current;
    syncActual.current = (async () => {
      const rows = await leerCola();
      if (!navigator.onLine) return;
      for (const c of rows) {
        try {
          const result = await sincronizarCaptura(c);
          await init.cola.quitar(c.uuid);
          setDetalle(prev => prev?.sesion.id === result.sesion.id ? result : prev);
        } catch (e) { await init.cola.guardar({ ...c, error: e.message }); }
      }
      await leerCola();
    })().finally(() => { syncActual.current = null; });
    return syncActual.current;
  }, [init, leerCola]);
  useEffect(() => {
    void sincronizar().catch(e => setError(e.message));
    const timer = setInterval(() => { void sincronizar().catch(e => setError(e.message)); }, 15000);
    return () => clearInterval(timer);
  }, [sincronizar, online]);

  const ejecutar = async (action, data = {}, sessionId = detalle?.sesion.id ?? null) => {
    setBusy(true); setError(''); setAviso('');
    try {
      const result = await operarConteo(action, sessionId, data);
      setDetalle(result); await listar(); return result;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  };
  const abrir = id => ejecutar('detalle', {}, id);
  const crear = async e => {
    e.preventDefault(); solicitud.current ??= crypto.randomUUID();
    const result = await ejecutar('crear', { ...form, ubicacion_id: Number(form.ubicacion_id), solicitud: solicitud.current }, null);
    if (result) { setNueva(false); setConteoPrefill(null); solicitud.current = null; }
  };
  const cambiar = next => { solicitud.current = null; setForm(next); };
  const guardar = async (datos, foto, etiqueta) => {
    setBusy(true); setError(''); setAviso('');
    try {
      const uuid = crypto.randomUUID();
      await init.cola.guardar({ uuid, usuarioId: usuario.id, sesionId: detalle.sesion.id, etiqueta, foto,
        datos: { ...datos, uuid, dispositivo: init.dispositivo, foto_ref: `sesion_${detalle.sesion.id}/${uuid}.jpg` } });
      await leerCola(); setAviso('Captura guardada en este dispositivo. Se confirmará al sincronizar.');
      await sincronizar(); return true;
    } catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  };
  const finalizar = async () => {
    setError(''); setBusy(true);
    try {
      await sincronizar();
      if ((await leerCola()).some(c => c.sesionId === detalle.sesion.id)) throw new Error('Hay capturas pendientes. Reintenta la subida antes de finalizar.');
      const latest = await operarConteo('detalle', detalle.sesion.id);
      setDetalle(latest);
      await ejecutar('finalizar_ronda', { dispositivo: init.dispositivo, confirmo_sin_pendientes: true, capturas: latest.capturas.filter(c => !c.anulada).map(c => c.uuid) });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const pendientesSesion = pendientes.filter(c => !detalle || c.sesionId === detalle.sesion.id);
  const ronda = detalle?.rondas.find(r => r.mia);
  const capturando = detalle?.sesion.estado === 'CAPTURA' && ronda && !ronda.finalizada && ronda.dispositivo === init?.dispositivo;
  const ubicacion = catalogo?.ubicaciones.find(u => Number(u.id) === Number(detalle?.sesion.ubicacion_id));

  return <main className="conteo-workspace">
    <header className="conteo-heading"><div><span className="conteo-eyebrow">CONTROL DE EXISTENCIAS</span><h1><ClipboardList size={24} />{revision ? 'Revisión de conteos' : 'Conteo físico'}</h1><p>Cuenta, revisa las diferencias y conserva el respaldo de cada saldo.</p></div><button disabled={busy || !online} onClick={() => detalle ? abrir(detalle.sesion.id) : listar().catch(e => setError(e.message))}><RefreshCw size={16} /> Actualizar</button></header>
    {error && <div role="alert" className="conteo-message is-error">{error}</div>}
    {aviso && <div role="status" className="conteo-message">{aviso}</div>}
    {avisoAnterior && <div className="conteo-message is-warning">{avisoAnterior}</div>}
    {pendientesAnteriores.length > 0 && <section className="conteo-card"><h2>{pendientesAnteriores.length} captura(s) pendiente(s) del flujo anterior</h2><p>Se conservan en este navegador con sus fotos. Descarga el respaldo para revisarlas; necesitan un nuevo conteo con corte antes de actualizar existencias.</p><button onClick={() => respaldarConteoAnterior(pendientesAnteriores).catch(e => setError(e.message))}>Descargar respaldo de capturas anteriores</button></section>}
    {!online && <div className="conteo-message is-warning">Sin conexión. Las capturas quedan en este dispositivo. Conéctate para finalizar la ronda.</div>}
    {pendientesSesion.length > 0 && <section className="conteo-card conteo-pending" aria-label="Capturas pendientes"><h2>{pendientesSesion.length} captura(s) por confirmar</h2><ul>{pendientesSesion.map(c => <li key={c.uuid}>{c.etiqueta}<small>{c.error || 'Esperando sincronización'}</small></li>)}</ul><button disabled={!online || busy} onClick={() => sincronizar().catch(e => setError(e.message))}>Reintentar subida</button>{detalle?.sesion.estado === 'CANCELADA' && <button disabled={busy} onClick={async () => { try { for (const c of pendientesSesion) await init.cola.quitar(c.uuid); await leerCola(); } catch (e) { setError(e.message); } }}>Eliminar pendientes de este conteo cancelado</button>}</section>}
    {!catalogo || !init ? <p role="status">Preparando catálogo y almacenamiento del conteo…</p> : !detalle ? <>
      {anteriores > 0 && <p className="conteo-legacy">Se conservan {anteriores} sesiones del flujo anterior. Para validar sus existencias, inicia una sesión nueva con corte.</p>}
      <div className="conteo-section-heading"><h2>{revision ? 'Sesiones para revisar' : 'Sesiones de esta sucursal'}</h2><button onClick={() => setNueva(v => !v)}>{nueva ? 'Ocultar formulario' : 'Nuevo conteo'}</button></div>
      {nueva && <form className="conteo-card conteo-form" onSubmit={crear}><h2>Definir el conteo</h2>
        <label>Nombre<input value={form.nombre} maxLength={100} onChange={e => cambiar({ ...form, nombre: e.target.value })} placeholder="Ej. Estante A · verificación" disabled={busy} /></label>
        <label>Ubicación<select required disabled={busy} value={form.ubicacion_id} onChange={e => cambiar({ ...form, ubicacion_id: e.target.value })}><option value="">Seleccionar ubicación</option>{catalogo.ubicaciones.map(u => <option key={u.id} value={u.id}>{etiquetaUbicacion(u)}</option>)}</select></label>
        <label>Propósito<select disabled={busy} value={form.tipo} onChange={e => cambiar({ ...form, tipo: e.target.value })}><option value="VERIFICACION">Verificar existencias registradas</option><option value="INICIAL">Establecer existencia inicial</option></select></label>
        <label>Método<select disabled={busy} value={form.metodo} onChange={e => cambiar({ ...form, metodo: e.target.value })}><option value="SIMPLE">Una ronda y revisión</option><option value="DOBLE_CIEGO">Dos personas · doble ciego</option></select></label>
        <label>Alcance<select disabled={busy} value={form.alcance} onChange={e => cambiar({ ...form, alcance: e.target.value })}><option value="UBICACION">Toda la ubicación</option><option value="PARCIAL">Productos seleccionados</option></select></label>
        {form.alcance === 'PARCIAL' && <SelectorProductos catalogo={catalogo} seleccionados={form.producto_ids} disabled={busy} onChange={ids => cambiar({ ...form, producto_ids: ids })} />}
        <p className="conteo-message is-warning"><LockKeyhole size={18} />Al iniciar se bloquearán entradas y salidas de toda esta ubicación hasta aplicar o cancelar. Coordina primero con quienes despachan.</p>
        <button className="conteo-primary" disabled={busy || !online || !form.ubicacion_id || (form.alcance === 'PARCIAL' && !form.producto_ids.length)}>{busy ? 'Iniciando…' : 'Iniciar y bloquear ubicación'}</button>
      </form>}
      <div className="conteo-session-list">{sesiones.filter(s => !revision || s.estado === 'REVISION').map(s => <button className="conteo-card conteo-session" key={s.id} onClick={() => abrir(s.id)} disabled={busy || !online}><span><strong>{s.nombre}</strong><small>{etiquetaUbicacion(catalogo.ubicaciones.find(u => u.id === s.ubicacion_id))} · {s.metodo === 'SIMPLE' ? 'Una ronda' : 'Doble ciego'} · {fecha(s.corte_en)}</small></span><span className={`conteo-state is-${s.estado.toLowerCase()}`}>{estados[s.estado]}</span></button>)}{!sesiones.some(s => !revision || s.estado === 'REVISION') && <p>No hay sesiones {revision ? 'pendientes de revisión' : 'en esta sucursal'}.</p>}</div>
    </> : <>
      <button onClick={() => { setDetalle(null); setAviso(''); setError(''); }} disabled={busy}><ArrowLeft size={16} /> Volver a sesiones</button>
      <section className="conteo-card conteo-session-header"><div><span className={`conteo-state is-${detalle.sesion.estado.toLowerCase()}`}>{estados[detalle.sesion.estado]}</span><h2>{detalle.sesion.nombre}</h2><p>{etiquetaUbicacion(ubicacion)} · {detalle.sesion.tipo === 'INICIAL' ? 'Existencia inicial' : 'Verificación'} · {detalle.sesion.alcance === 'UBICACION' ? 'Ubicación completa' : 'Productos seleccionados'}</p><small>Corte: {fecha(detalle.sesion.corte_en)}</small></div>{activa(detalle.sesion) && <p className="conteo-lock"><LockKeyhole size={20} /> Ubicación bloqueada para movimientos</p>}</section>
      {detalle.sesion.estado === 'CAPTURA' && <section className="conteo-card"><h2>Rondas de conteo</h2><p>Cada ronda pertenece a una persona y un dispositivo. Cuenta las cajas cerradas y las unidades sueltas por separado, sin repetir mercancía.</p><div className="conteo-rounds">{(detalle.sesion.metodo === 'SIMPLE' ? [1] : [1, 2]).map(n => {
        const r = detalle.rondas.find(x => x.numero === n);
        return <div key={n}><strong>Ronda {n}</strong><span>{!r ? 'Disponible' : r.finalizada ? 'Finalizada' : r.mia ? 'Tu ronda' : 'Asignada a otra persona'}</span>{!r && <button disabled={busy || !online || !!ronda} onClick={() => ejecutar('tomar_ronda', { ronda: n, dispositivo: init.dispositivo })}>Tomar ronda {n}</button>}{r?.mia && r.dispositivo !== init.dispositivo && <small>Asignada a otro dispositivo. Retómala allí o solicita cancelar y repetir el conteo.</small>}</div>;
      })}</div></section>}
      {capturando && <Capturar key={`${detalle.sesion.id}:${ronda.numero}`} catalogo={catalogo} detalle={detalle} busy={busy} onGuardar={guardar} />}
      <section className="conteo-card"><h2>{detalle.puede_revisar ? 'Comparación y aprobación' : 'Productos del alcance'}</h2>{!detalle.productos.length && <p>Registra los productos encontrados antes de finalizar.</p>}{detalle.puede_revisar ? detalle.productos.map(p => <RevisarProducto key={`${p.producto_id}:${detalle.sesion.version}`} producto={p} doble={detalle.sesion.metodo === 'DOBLE_CIEGO'} aplicada={detalle.sesion.estado === 'APLICADA'} busy={busy} onResolver={datos => ejecutar('resolver', { ...datos, version: detalle.sesion.version })} />) : <ul className="conteo-checklist">{detalle.productos.map(p => <li key={p.producto_id}><span>{p.nombre}</span><span>{p.contado ? <><CheckCircle size={15} /> Capturado por ti</> : 'Pendiente en tu ronda'}</span></li>)}</ul>}</section>
      {detalle.capturas.length > 0 && <section className="conteo-card"><h2>Tus capturas</h2>{detalle.capturas.map(c => <CapturaRegistrada key={c.uuid} captura={c} catalogo={catalogo} puedeAnular={capturando && !c.anulada} busy={busy} onAnular={motivo => ejecutar('anular_captura', { uuid: c.uuid, dispositivo: init.dispositivo, motivo })} />)}</section>}
      {detalle.sin_catalogo?.length > 0 && <section className="conteo-card"><h2>Vincular artículos sin catálogo</h2><p>Selecciona la presentación de la cantidad capturada. Si el producto es nuevo, regístralo primero en Productos y vuelve a entrar al conteo.</p>{detalle.sin_catalogo.map(c => <Vincular key={c.uuid} captura={c} catalogo={catalogo} busy={busy} onVincular={id => ejecutar('catalogar', { uuid: c.uuid, presentacion_id: id })} />)}</section>}
      {capturando && <FinalizarRonda busy={busy} disabled={!online || pendientesSesion.length > 0 || detalle.productos.some(p => !p.contado) || !detalle.productos.length} onFinalizar={finalizar} />}
      {detalle.sesion.estado === 'CAPTURA' && ronda?.finalizada && <p className="conteo-message">Tu ronda terminó. La otra persona debe completar la suya antes de la revisión.</p>}
      {detalle.puede_revisar && detalle.sesion.estado === 'REVISION' && <section className="conteo-card conteo-apply"><h2>Aplicar las existencias aprobadas</h2><p>Se registrará un ajuste por producto y ubicación. La ubicación se liberará al terminar.</p><button className="conteo-primary" disabled={busy || !online || !detalle.productos.length || detalle.productos.some(p => !p.aprobada)} onClick={() => ejecutar('aplicar', { version: detalle.sesion.version })}>Aplicar conteo y liberar ubicación</button></section>}
      {detalle.sesion.estado === 'APLICADA' && <p className="conteo-message"><CheckCircle size={18} />Conteo aplicado. Se conserva también la verificación de productos sin diferencia.</p>}
      {detalle.evidencias?.length > 0 && <details className="conteo-card"><summary>Fotos y capturas de ambas rondas</summary>{detalle.evidencias.map(c => <div key={c.uuid} className="conteo-evidence"><span>Ronda {c.ronda} · {c.actor} · {fmt(c.cantidad)} × {fmt(c.factor)}{c.anulada ? ' · Anulada' : ''}</span><Foto path={c.foto_ref} /></div>)}</details>}
      {detalle.eventos?.length > 0 && <details className="conteo-card"><summary>Historial de revisión</summary><ul className="conteo-events">{detalle.eventos.map((e, i) => <li key={i}><strong>{accionesHistorial[e.accion] || 'Actividad del conteo'} · {e.actor}</strong><small>{fecha(e.creado_en)}{e.datos?.motivo ? ` · ${e.datos.motivo}` : ''}</small></li>)}</ul></details>}
      {activa(detalle.sesion) && detalle.puede_cancelar && <Cancelar busy={busy} online={online} onCancelar={motivo => ejecutar('cancelar', { motivo })} />}
    </>}
  </main>;
}

function SelectorProductos({ catalogo, seleccionados, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const productos = [...new Map(catalogo.presentaciones.map(p => [p.producto_id, p.producto])).values()].filter(Boolean);
  const matches = productos.filter(p => `${p.nombre} ${p.sku_interno ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  return <fieldset className="conteo-picker" disabled={disabled}><legend>Productos a contar</legend><input aria-label="Buscar productos del alcance" placeholder="Buscar por nombre o SKU" value={query} onChange={e => setQuery(e.target.value)} /><div className="conteo-selected">{seleccionados.map(id => <button type="button" key={id} onClick={() => onChange(seleccionados.filter(x => x !== id))}>{productos.find(p => p.id === id)?.nombre || `Producto ${id}`} ×</button>)}</div><div className="conteo-matches">{matches.filter(p => !seleccionados.includes(p.id)).map(p => <button type="button" key={p.id} onClick={() => onChange([...seleccionados, p.id])}>{p.nombre}</button>)}</div></fieldset>;
}

function BuscarPresentacion({ catalogo, onSelect, disabled }) {
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
    try {
      const found = presentacionesDelCodigo(catalogo, code);
      if (found.length === 1) { onSelect(found[0]); setScanMatches(null); setQuery(''); }
      else setScanMatches(found);
    } catch (e) { setScanError(e.message); }
  };
  return <div className="conteo-search"><label>Producto y presentación<input value={query} onChange={e => { setQuery(e.target.value); setScanMatches(null); setScanError(''); }} placeholder="Nombre, SKU o código de barras" disabled={disabled} /></label><button type="button" onClick={() => setScanning(true)} disabled={disabled}><Camera size={17} /> Escanear código</button>{scanning && <EscanerCodigo onDetect={detectar} onClose={() => setScanning(false)} />}{scanError && <p role="alert">{scanError}</p>}<div className="conteo-matches">{(scanMatches || matches).map(p => <button type="button" disabled={disabled} key={p.id} onClick={() => { onSelect(p); setQuery(''); setScanMatches(null); }}>{p.producto?.nombre} · {p.nombre}<small>×{fmt(p.factor_unidad_base)} en base</small></button>)}</div></div>;
}

function Capturar({ catalogo, detalle, busy, onGuardar }) {
  const [selected, setSelected] = useState(null), [unknown, setUnknown] = useState(false);
  const [description, setDescription] = useState(''), [qty, setQty] = useState(''), [foto, setFoto] = useState(null), [error, setError] = useState('');
  const fileInput = useRef(null);
  const scope = new Set(detalle.productos.map(p => p.producto_id));
  const elegible = detalle.sesion.alcance === 'PARCIAL' ? { ...catalogo, presentaciones: catalogo.presentaciones.filter(p => scope.has(p.producto_id)) } : catalogo;
  const guardar = async e => {
    e.preventDefault(); setError('');
    if (!foto || !['image/jpeg', 'image/png', 'image/webp'].includes(foto.type) || foto.size > 10 * 1024 * 1024) { setError('Adjunta una foto JPEG, PNG o WebP de hasta 10 MB.'); return; }
    if (qty === '' || !Number.isFinite(Number(qty)) || Number(qty) < 0) { setError('Indica la cantidad; escribe 0 si comprobaste que no hay.'); return; }
    if (await onGuardar({ presentacion_id: unknown ? null : selected.id, descripcion: unknown ? description.trim() : null, cantidad: Number(qty) }, foto, `${unknown ? description : selected.producto.nombre} · ${qty}`)) {
      setQty(''); setFoto(null); setSelected(null); setUnknown(false); setDescription(''); if (fileInput.current) fileInput.current.value = '';
    }
  };
  return <section className="conteo-card"><h2>Registrar observación</h2><form className="conteo-form" onSubmit={guardar}>{!unknown && <BuscarPresentacion catalogo={elegible} onSelect={setSelected} disabled={busy} />}
    {selected && !unknown && <p className="conteo-chosen">{selected.producto?.nombre} · <strong>{selected.nombre}</strong> · {fmt(selected.factor_unidad_base)} {selected.producto?.unidad_base} por presentación</p>}
    <label className="conteo-check"><input type="checkbox" checked={unknown} onChange={e => setUnknown(e.target.checked)} disabled={busy} />Artículo sin catálogo</label>
    {unknown && <label>Descripción<input value={description} onChange={e => setDescription(e.target.value)} required disabled={busy} /></label>}
    <label>Cantidad de {unknown ? 'artículos observados' : selected?.nombre || 'la presentación'}<input type="number" min="0" max="9999999999.9999" step="0.0001" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required disabled={busy} /></label>
    {selected && !unknown && qty !== '' && <p>Total de esta captura: <strong>{fmt(Number(qty) * Number(selected.factor_unidad_base))} {selected.producto?.unidad_base}</strong></p>}
    <label>Foto del conteo<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => setFoto(e.target.files?.[0] ?? null)} required disabled={busy} /></label>
    {error && <p role="alert" className="conteo-message is-error">{error}</p>}
    <button className="conteo-primary" disabled={busy || (!unknown && !selected) || (unknown && !description.trim())}>{busy ? 'Guardando…' : 'Guardar captura'}</button>
  </form></section>;
}

function Foto({ path }) {
  const [url, setUrl] = useState(null), [error, setError] = useState('');
  return <div>{url ? <img className="conteo-photo" src={url} alt="Evidencia del conteo físico" /> : <button type="button" onClick={async () => { try { setUrl(await fotoConteoControlado(path)); } catch (e) { setError(e.message); } }}>Ver foto</button>}{error && <p role="alert">{error}</p>}</div>;
}

function CapturaRegistrada({ captura: c, catalogo, puedeAnular, busy, onAnular }) {
  const [motivo, setMotivo] = useState('');
  const p = catalogo.presentaciones.find(p => p.id === c.presentacion_id);
  return <article className={`conteo-capture ${c.anulada ? 'is-void' : ''}`}><strong>{p?.producto?.nombre || c.descripcion} · {p?.nombre || 'Sin catálogo'}</strong><p>{fmt(c.cantidad)} × {fmt(c.factor)} {c.anulada && '· Anulada'}</p><Foto path={c.foto_ref} />{puedeAnular && <details><summary>Corregir esta captura</summary><p>La anulación conserva el registro. Después puedes cargar la cantidad correcta.</p><input aria-label="Motivo de anulación" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo" disabled={busy} /><button disabled={busy || motivo.trim().length < 5} onClick={() => onAnular(motivo)}>Anular captura</button></details>}</article>;
}

function RevisarProducto({ producto: p, doble, aplicada, busy, onResolver }) {
  const [qty, setQty] = useState(p.cantidad_final ?? (p.conteo_1 === p.conteo_2 || !doble ? p.conteo_1 : ''));
  const [motivo, setMotivo] = useState(p.motivo || ''), [confirmado, setConfirmado] = useState(false);
  const [editando, setEditando] = useState(false);
  const recount = qty !== '' && requiereReconteo(p, qty);
  return <article className="conteo-review-product"><h3>{p.nombre} <small>{p.unidad_base}</small></h3><dl className="conteo-quantities"><div><dt>Registrado al corte</dt><dd>{fmt(p.teorico)}</dd></div><div><dt>Ronda 1</dt><dd>{fmt(p.conteo_1)}</dd></div>{doble && <div><dt>Ronda 2</dt><dd>{fmt(p.conteo_2)}</dd></div>}<div><dt>Diferencia propuesta</dt><dd>{qty === '' ? '—' : fmt(Number(qty) - Number(p.teorico))}</dd></div></dl>
    {p.aprobada && !editando ? <><p className="conteo-approved"><CheckCircle size={16} />{aplicada ? 'Aplicado' : 'Aprobado'}: {fmt(p.cantidad_final)} · {p.motivo}</p>{!aplicada && <button disabled={busy} onClick={() => setEditando(true)}>Revisar aprobación</button>}</> : <form className="conteo-form" onSubmit={e => { e.preventDefault(); onResolver({ producto_id: p.producto_id, cantidad_base: Number(qty), motivo, reconteo_confirmado: confirmado }); }}>
      {doble && p.conteo_1 !== p.conteo_2 && <p className="conteo-message is-warning">Las rondas difieren. Recuenta físicamente antes de decidir.</p>}
      <label>Cantidad final en {p.unidad_base}<input type="number" min="0" max="9999999999.9999" step="0.0001" value={qty} onChange={e => setQty(e.target.value)} required disabled={busy} /></label>
      <label>Causa y revisión<textarea value={motivo} onChange={e => setMotivo(e.target.value)} required minLength={5} disabled={busy} placeholder="Ej. Recepción no registrada; se verificaron cajas y unidades" /></label>
      {recount && <label className="conteo-check"><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} disabled={busy} />Confirmo que se recontó físicamente esta diferencia</label>}
      <button disabled={busy || qty === '' || !Number.isFinite(Number(qty)) || Number(qty) < 0 || motivo.trim().length < 5 || (recount && !confirmado)}>Aprobar producto</button>
    </form>}
  </article>;
}

function FinalizarRonda({ busy, disabled, onFinalizar }) {
  const [confirmed, setConfirmed] = useState(false);
  return <section className="conteo-card"><h2>Terminar tu ronda</h2><p>Comprueba todos los productos del alcance. Registra cero donde no haya mercancía y sincroniza cada captura antes de continuar.</p><label className="conteo-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />Terminé el recorrido y no quedan capturas por ingresar en este dispositivo</label><button className="conteo-primary" disabled={busy || disabled || !confirmed} onClick={onFinalizar}>Finalizar mi ronda</button></section>;
}

function Vincular({ captura, catalogo, busy, onVincular }) {
  const [selected, setSelected] = useState(null);
  return <article className="conteo-capture"><h3>{captura.descripcion}</h3><BuscarPresentacion catalogo={catalogo} disabled={busy} onSelect={setSelected} />{selected && <p>{selected.producto?.nombre} · {selected.nombre} ×{fmt(selected.factor_unidad_base)}</p>}<button disabled={busy || !selected} onClick={() => onVincular(selected.id)}>Vincular presentación</button></article>;
}

function Cancelar({ busy, online, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  return <details className="conteo-card"><summary>Cancelar conteo y liberar ubicación</summary><p>Se conservarán las capturas y el motivo. Las existencias no se ajustarán.</p><form className="conteo-form" onSubmit={e => { e.preventDefault(); onCancelar(motivo); }}><label>Motivo de cancelación<textarea required minLength={5} value={motivo} onChange={e => setMotivo(e.target.value)} disabled={busy} /></label><button disabled={busy || !online || motivo.trim().length < 5}>Confirmar cancelación</button></form></details>;
}
