import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, RefreshCw, ArrowLeft, LockKeyhole, CheckCircle } from 'lucide-react';
import { supabase } from './supabaseClient';
import { fetchAll } from './lib/fetchAll';
import { useUsuarioActual } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { useAppNav } from './lib/useAppNav';
import { etiquetaUbicacion } from './lib/ubicacionTexto';
import { abrirColaConteo, dispositivoConteo, operarConteo, sincronizarCaptura, fotoConteoControlado, formatoCantidadConteo as fmt, requiereReconteo, pendientesConteoAnterior, respaldarConteoAnterior } from './lib/conteoControlado';
import CapturaConteo, { BuscarPresentacionConteo } from './CapturaConteo';
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
  const [borradorPendiente, setBorradorPendiente] = useState(false);
  const guardandoDeclaracion = useRef(false);
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
          fetchAll(() => supabase.from('ubicacion').select('id,codigo_zona,estante,nivel,compartimiento,sucursal_id,excluye_disponible').eq('sucursal_id', sucursalId).eq('excluye_disponible', false).eq('activo', true).order('id')),
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
  const guardar = async (filas, foto, etiqueta, productoId) => {
    if (guardandoDeclaracion.current) return false;
    guardandoDeclaracion.current = true;
    setBusy(true); setError(''); setAviso('');
    let persistida = false;
    try {
      const existentes = await init.cola.listar();
      if (productoId != null && (detalle.productos.some(p => String(p.producto_id) === String(productoId) && p.contado) || existentes.some(c => c.usuarioId === usuario.id && c.sesionId === detalle.sesion.id && String(c.productoId) === String(productoId)))) {
        throw new Error('Este producto ya tiene una declaración. Revisa sus capturas antes de reemplazarla.');
      }
      const positivas = filas.filter(f => f.cantidad > 0);
      const aGuardar = positivas.length ? positivas : [filas.find(f => catalogo.presentaciones.find(p => p.id === f.presentacion_id)?.es_base) ?? filas[0]];
      const capturas = aGuardar.map(datos => {
        const uuid = crypto.randomUUID();
        return { uuid, usuarioId: usuario.id, sesionId: detalle.sesion.id, productoId, etiqueta, foto,
          datos: { ...datos, uuid, dispositivo: init.dispositivo, foto_ref: `sesion_${detalle.sesion.id}/${uuid}.jpg` } };
      });
      await init.cola.guardarLote(capturas);
      persistida = true;
      await leerCola();
      setAviso('Declaración guardada en este dispositivo. El stock cambia al aprobar y aplicar el conteo.');
      await sincronizar();
      await leerCola();
      return true;
    } catch (e) { setError(e.message); return persistida; }
    finally { setBusy(false); guardandoDeclaracion.current = false; }
  };
  const finalizar = async () => {
    if (borradorPendiente) { setError('Hay una declaración sin guardar. Guárdala o descarta el borrador antes de finalizar.'); return; }
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

  return <main className={`conteo-workspace${capturando ? ' is-counting' : ''}`}>
    <header className="conteo-heading"><div><span className="conteo-eyebrow">CONTROL DE EXISTENCIAS</span><h1><ClipboardList size={24} />{revision ? 'Revisión de conteos' : 'Conteo físico'}</h1>{!capturando && <p>Declara lo que hay físicamente. La nueva existencia se establece al aprobar y aplicar.</p>}</div><button disabled={busy || !online} onClick={() => detalle ? abrir(detalle.sesion.id) : listar().catch(e => setError(e.message))}><RefreshCw size={16} /> Actualizar</button></header>
    {error && <div role="alert" className="conteo-message is-error">{error}</div>}
    {aviso && <div role="status" className="conteo-message">{aviso}</div>}
    {avisoAnterior && <div className="conteo-message is-warning">{avisoAnterior}</div>}
    {pendientesAnteriores.length > 0 && <section className="conteo-card"><h2>{pendientesAnteriores.length} captura(s) pendiente(s) del flujo anterior</h2><p>Se conservan en este navegador con sus fotos. Descarga el respaldo para revisarlas; necesitan un nuevo conteo con corte antes de actualizar existencias.</p><button onClick={() => respaldarConteoAnterior(pendientesAnteriores).catch(e => setError(e.message))}>Descargar respaldo de capturas anteriores</button></section>}
    {!online && <div className="conteo-message is-warning">Sin conexión. Las capturas quedan en este dispositivo. Conéctate para finalizar la ronda.</div>}
    {pendientesSesion.length > 0 && <section className="conteo-card conteo-pending" aria-label="Capturas pendientes"><h2>{pendientesSesion.length} captura(s) por confirmar</h2><ul>{pendientesSesion.map(c => <li key={c.uuid}>{c.etiqueta}<small>{c.error || 'Esperando sincronización'}</small></li>)}</ul><button disabled={!online || busy} onClick={() => sincronizar().catch(e => setError(e.message))}>Reintentar subida</button>{detalle?.sesion.estado === 'CANCELADA' && <button disabled={busy} onClick={async () => { try { for (const c of pendientesSesion) await init.cola.quitar(c.uuid); await leerCola(); } catch (e) { setError(e.message); } }}>Eliminar pendientes de este conteo cancelado</button>}</section>}
    {!catalogo || !init ? <p role="status">Preparando catálogo y almacenamiento del conteo…</p> : !detalle ? <>
      {anteriores > 0 && <p className="conteo-legacy">Se conservan {anteriores} sesiones del flujo anterior. Para validar sus existencias, inicia una sesión nueva con corte.</p>}
      <div className="conteo-section-heading"><h2>{revision ? 'Sesiones para revisar' : 'Sesiones de esta sucursal'}</h2><button onClick={() => setNueva(v => !v)}>{nueva ? 'Ocultar formulario' : 'Nuevo conteo'}</button></div>
      {nueva && <form className="conteo-card conteo-form" onSubmit={crear}><h2>¿Qué necesitas contar?</h2>
        <div className="conteo-start-options" role="group" aria-label="Tipo de conteo">
          {[
            ['INICIAL', 'UBICACION', 'Declarar existencias iniciales', 'Establecer las cantidades de una ubicación.'],
            ['VERIFICACION', 'UBICACION', 'Verificar una ubicación', 'Contar todos sus productos.'],
            ['VERIFICACION', 'PARCIAL', 'Verificar productos específicos', 'Declarar la existencia física de productos seleccionados.'],
          ].map(([tipo, alcance, titulo, texto]) => <button type="button" key={titulo} disabled={busy} aria-pressed={form.tipo === tipo && form.alcance === alcance} onClick={() => cambiar({ ...form, tipo, alcance })}><strong>{titulo}</strong><small>{texto}</small></button>)}
        </div>
        <label>Ubicación<select required disabled={busy} value={form.ubicacion_id} onChange={e => cambiar({ ...form, ubicacion_id: e.target.value })}><option value="">Seleccionar ubicación</option>{catalogo.ubicaciones.map(u => <option key={u.id} value={u.id}>{etiquetaUbicacion(u)}</option>)}</select></label>
        <details><summary>Nombre y alcance del conteo</summary><div className="conteo-form"><label>Nombre<input value={form.nombre} maxLength={100} onChange={e => cambiar({ ...form, nombre: e.target.value })} placeholder="Ej. Estante A · verificación" disabled={busy} /></label>

        <label>Alcance<select disabled={busy} value={form.alcance} onChange={e => cambiar({ ...form, alcance: e.target.value })}><option value="UBICACION">Toda la ubicación</option><option value="PARCIAL">Productos seleccionados</option></select></label></div></details>
        <label>Personas que cuentan<select disabled={busy} value={form.metodo} onChange={e => cambiar({ ...form, metodo: e.target.value })}><option value="SIMPLE">Una persona y revisión</option><option value="DOBLE_CIEGO">Dos personas · conteos independientes</option></select></label>
        {form.alcance === 'PARCIAL' && <SelectorProductos catalogo={catalogo} seleccionados={form.producto_ids} disabled={busy} onChange={ids => cambiar({ ...form, producto_ids: ids })} />}
        <p className="conteo-message is-warning"><LockKeyhole size={18} />Al iniciar se bloquearán entradas y salidas de toda esta ubicación hasta aplicar o cancelar. Coordina primero con quienes despachan.</p>
        <button className="conteo-primary" disabled={busy || !online || !form.ubicacion_id || (form.alcance === 'PARCIAL' && !form.producto_ids.length)}>{busy ? 'Iniciando…' : 'Iniciar y bloquear ubicación'}</button>
      </form>}
      <div className="conteo-session-list">{sesiones.filter(s => !revision || s.estado === 'REVISION').map(s => <button className="conteo-card conteo-session" key={s.id} onClick={() => abrir(s.id)} disabled={busy || !online}><span><strong>{s.nombre}</strong><small>{etiquetaUbicacion(catalogo.ubicaciones.find(u => u.id === s.ubicacion_id))} · {s.metodo === 'SIMPLE' ? 'Una ronda' : 'Doble ciego'} · {fecha(s.corte_en)}</small></span><span className={`conteo-state is-${s.estado.toLowerCase()}`}>{estados[s.estado]}</span></button>)}{!sesiones.some(s => !revision || s.estado === 'REVISION') && <p>No hay sesiones {revision ? 'pendientes de revisión' : 'en esta sucursal'}.</p>}</div>
    </> : <>
      <button onClick={() => { setDetalle(null); setAviso(''); setError(''); }} disabled={busy || borradorPendiente}><ArrowLeft size={16} /> Volver a sesiones</button>
      {capturando ? <div className="conteo-session-compact"><strong>{etiquetaUbicacion(ubicacion)}</strong><span><LockKeyhole size={14} />Ubicación bloqueada · Ronda {ronda.numero}</span></div> : <section className="conteo-card conteo-session-header"><div><span className={`conteo-state is-${detalle.sesion.estado.toLowerCase()}`}>{estados[detalle.sesion.estado]}</span><h2>{detalle.sesion.nombre}</h2><p>{etiquetaUbicacion(ubicacion)} · {detalle.sesion.tipo === 'INICIAL' ? 'Existencia inicial' : 'Verificación'} · {detalle.sesion.alcance === 'UBICACION' ? 'Ubicación completa' : 'Productos seleccionados'}</p><small>Corte: {fecha(detalle.sesion.corte_en)}</small></div>{activa(detalle.sesion) && <p className="conteo-lock"><LockKeyhole size={20} /> Ubicación bloqueada para movimientos</p>}</section>}
      {capturando && <CapturaConteo key={`${detalle.sesion.id}:${ronda.numero}`} catalogo={catalogo} detalle={detalle} pendientes={pendientesSesion} busy={busy} online={online} onGuardar={guardar} onBorrador={setBorradorPendiente} />}
      {detalle.sesion.estado === 'CAPTURA' && <details className="conteo-card conteo-round-details" open={!ronda}><summary>Rondas de conteo{ronda ? ` · Ronda ${ronda.numero} asignada` : ''}</summary><p>Cada ronda pertenece a una persona y un dispositivo. Cuenta las cajas cerradas y las unidades sueltas por separado, sin repetir mercancía.</p><div className="conteo-rounds">{(detalle.sesion.metodo === 'SIMPLE' ? [1] : [1, 2]).map(n => {
        const r = detalle.rondas.find(x => x.numero === n);
        return <div key={n}><strong>Ronda {n}</strong><span>{!r ? 'Disponible' : r.finalizada ? 'Finalizada' : r.mia ? 'Tu ronda' : 'Asignada a otra persona'}</span>{!r && <button disabled={busy || !online || !!ronda} onClick={() => ejecutar('tomar_ronda', { ronda: n, dispositivo: init.dispositivo })}>Tomar ronda {n}</button>}{r?.mia && r.dispositivo !== init.dispositivo && <small>Asignada a otro dispositivo. Retómala allí o solicita cancelar y repetir el conteo.</small>}</div>;
      })}</div></details>}
      {!capturando && <section className="conteo-card"><h2>{detalle.puede_revisar ? 'Comparación y aprobación' : 'Productos del alcance'}</h2>{!detalle.productos.length && <p>Registra los productos encontrados antes de finalizar.</p>}{detalle.puede_revisar ? <RevisionConteo detalle={detalle} busy={busy} onResolver={datos => ejecutar('resolver', { ...datos, version: detalle.sesion.version })} /> : <ul className="conteo-checklist">{detalle.productos.map(p => <li key={p.producto_id}><span>{p.nombre}</span><span>{p.contado ? <><CheckCircle size={15} /> Capturado por ti</> : 'Pendiente en tu ronda'}</span></li>)}</ul>}</section>}
      {detalle.capturas.length > 0 && <details className="conteo-card" id="conteo-declaraciones"><summary>Tus declaraciones · {detalle.capturas.filter(c => !c.anulada).length} captura(s) vigentes</summary>{detalle.capturas.map(c => <CapturaRegistrada key={c.uuid} captura={c} catalogo={catalogo} puedeAnular={capturando && !c.anulada} busy={busy} onAnular={motivo => ejecutar('anular_captura', { uuid: c.uuid, dispositivo: init.dispositivo, motivo })} />)}</details>}
      {detalle.sin_catalogo?.length > 0 && <section className="conteo-card"><h2>Vincular artículos sin catálogo</h2><p>Selecciona la presentación de la cantidad capturada. Si el producto es nuevo, regístralo primero en Productos y vuelve a entrar al conteo.</p>{detalle.sin_catalogo.map(c => <Vincular key={c.uuid} captura={c} catalogo={catalogo} busy={busy} onVincular={id => ejecutar('catalogar', { uuid: c.uuid, presentacion_id: id })} />)}</section>}
      {capturando && <FinalizarRonda busy={busy} online={online} pendientes={pendientesSesion.length} faltantes={detalle.productos.filter(p => !p.contado).length} sinCatalogo={detalle.sin_catalogo?.length ?? 0} borrador={borradorPendiente} disabled={!online || pendientesSesion.length > 0 || detalle.productos.some(p => !p.contado) || !detalle.productos.length || borradorPendiente || detalle.sin_catalogo?.length > 0} onFinalizar={finalizar} />}
      {detalle.sesion.estado === 'CAPTURA' && ronda?.finalizada && <p className="conteo-message">Tu ronda terminó. {detalle.sesion.metodo === 'DOBLE_CIEGO' ? 'La otra persona debe completar la suya antes de la revisión.' : 'El conteo queda listo para revisión de supervisión.'}</p>}
      {detalle.puede_revisar && detalle.sesion.estado === 'REVISION' && <section className="conteo-card conteo-apply"><h2>Aplicar las existencias aprobadas</h2><p>Cada cantidad aprobada será la nueva existencia de este producto en esta ubicación. No se suma a la anterior. Se registrarán las diferencias y la ubicación se liberará al terminar.</p><button className="conteo-primary" disabled={busy || !online || !detalle.productos.length || detalle.productos.some(p => !p.aprobada)} onClick={() => ejecutar('aplicar', { version: detalle.sesion.version })}>Aplicar conteo y liberar ubicación</button></section>}
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

function Foto({ path }) {
  const [url, setUrl] = useState(null), [error, setError] = useState('');
  return <div>{url ? <img className="conteo-photo" src={url} alt="Evidencia del conteo físico" /> : <button type="button" onClick={async () => { try { setUrl(await fotoConteoControlado(path)); } catch (e) { setError(e.message); } }}>Ver foto</button>}{error && <p role="alert">{error}</p>}</div>;
}

function CapturaRegistrada({ captura: c, catalogo, puedeAnular, busy, onAnular }) {
  const [motivo, setMotivo] = useState('');
  const p = catalogo.presentaciones.find(p => p.id === c.presentacion_id);
  return <article className={`conteo-capture ${c.anulada ? 'is-void' : ''}`}><strong>{p?.producto?.nombre || c.descripcion} · {p?.nombre || 'Sin catálogo'}</strong><p>{fmt(c.cantidad)} × {fmt(c.factor)} {c.anulada && '· Anulada'}</p><Foto path={c.foto_ref} />{puedeAnular && <details><summary>Corregir esta captura</summary><p>La anulación conserva el registro. Después puedes cargar la cantidad correcta.</p><input aria-label="Motivo de anulación" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo" disabled={busy} /><button disabled={busy || motivo.trim().length < 5} onClick={() => onAnular(motivo)}>Anular captura</button></details>}</article>;
}

function RevisionConteo({ detalle, busy, onResolver }) {
  const [filtro, setFiltro] = useState('pendientes'), [seleccion, setSeleccion] = useState(null);
  const doble = detalle.sesion.metodo === 'DOBLE_CIEGO';
  const aplicada = detalle.sesion.estado === 'APLICADA';
  const diferencias = p => requiereReconteo(p, p.cantidad_final ?? p.conteo_1);
  const productos = detalle.productos.filter(p => filtro === 'todos' || (filtro === 'diferencias' ? diferencias(p) : !p.aprobada));
  const producto = detalle.productos.find(p => p.producto_id === seleccion) ?? productos[0];
  const aprobar = async datos => { const result = await onResolver(datos); if (result) setSeleccion(null); };
  return <>
    <p className="conteo-help">{detalle.productos.filter(p => p.aprobada).length} de {detalle.productos.length} aprobados · {detalle.productos.filter(diferencias).length} con diferencias que requieren revisión.</p>
    <div className="conteo-filters" role="group" aria-label="Filtrar revisión">{[['pendientes', 'Por aprobar'], ['diferencias', 'Con diferencias'], ['todos', 'Todos']].map(([value, label]) => <button key={value} disabled={busy} aria-pressed={filtro === value} onClick={() => { setFiltro(value); setSeleccion(null); }}>{label}</button>)}</div>
    <div className="conteo-review-table"><table><caption className="conteo-help">Comparación de existencias por producto</caption><thead><tr><th>Producto</th><th>Al corte</th><th>Ronda 1</th>{doble && <th>Ronda 2</th>}<th>Estado</th><th>Revisión</th></tr></thead><tbody>{productos.map(p => <tr key={p.producto_id}><th scope="row">{p.nombre}</th><td>{fmt(p.teorico)}</td><td>{fmt(p.conteo_1)}</td>{doble && <td>{fmt(p.conteo_2)}</td>}<td>{p.aprobada ? 'Aprobado' : diferencias(p) ? 'Recontar' : 'Coincide'}</td><td><button disabled={busy} aria-label={`Revisar ${p.nombre}`} onClick={() => setSeleccion(p.producto_id)}>Ver detalle</button></td></tr>)}</tbody></table></div>
    {!productos.length && <p>No hay productos para este filtro.</p>}
    {producto && <RevisarProducto key={`${producto.producto_id}:${detalle.sesion.version}`} producto={producto} doble={doble} aplicada={aplicada} busy={busy} onResolver={aprobar} />}
  </>;
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

function FinalizarRonda({ busy, disabled, online, pendientes, faltantes, sinCatalogo, borrador, onFinalizar }) {
  const [confirmed, setConfirmed] = useState(false);
  return <details className="conteo-card conteo-finish" open={!disabled}><summary>Terminar tu ronda{faltantes > 0 ? ` · ${faltantes} producto(s) por confirmar` : pendientes > 0 ? ` · ${pendientes} captura(s) por sincronizar` : ''}</summary>{disabled && <ul className="conteo-completion-reasons">{faltantes > 0 && <li>{faltantes} producto(s) por confirmar en tu ronda.</li>}{pendientes > 0 && <li>{pendientes} captura(s) por sincronizar.</li>}{sinCatalogo > 0 && <li>{sinCatalogo} artículo(s) sin catálogo por vincular con supervisión.</li>}{borrador && <li>Hay cantidades o fotos sin guardar.</li>}{!online && <li>Conéctate para finalizar la ronda.</li>}</ul>}<p>Comprueba todos los productos del alcance. Registra cero donde no haya mercancía y sincroniza cada captura antes de continuar.</p><label className="conteo-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />Terminé el recorrido y no quedan capturas por ingresar en este dispositivo</label><button className="conteo-primary" disabled={busy || disabled || !confirmed} onClick={onFinalizar}>Finalizar mi ronda</button></details>;
}

function Vincular({ captura, catalogo, busy, onVincular }) {
  const [selected, setSelected] = useState(null);
  return <article className="conteo-capture"><h3>{captura.descripcion}</h3><BuscarPresentacionConteo catalogo={catalogo} disabled={busy} onSelect={setSelected} />{selected && <p>{selected.producto?.nombre} · {selected.nombre} ×{fmt(selected.factor_unidad_base)}</p>}<button disabled={busy || !selected} onClick={() => onVincular(selected.id)}>Vincular presentación</button></article>;
}

function Cancelar({ busy, online, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  return <details className="conteo-card"><summary>Cancelar conteo y liberar ubicación</summary><p>Se conservarán las capturas y el motivo. Las existencias no se ajustarán.</p><form className="conteo-form" onSubmit={e => { e.preventDefault(); onCancelar(motivo); }}><label>Motivo de cancelación<textarea required minLength={5} value={motivo} onChange={e => setMotivo(e.target.value)} disabled={busy} /></label><button disabled={busy || !online || motivo.trim().length < 5}>Confirmar cancelación</button></form></details>;
}
