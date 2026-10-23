import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Printer, RefreshCw } from 'lucide-react';
import { useUsuarioActual } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { useAppNav } from './lib/useAppNav';
import { operarReporte } from './lib/reportesAlmacen';
import ConteoRapidoTurno from './ConteoRapidoTurno';
import { MovimientosReporte } from './MovimientosReporte';
import MovimientosDiarios from './MovimientosDiarios';
import { convertirConteo, equivalenciaReporte, fechaHoraReporte, fechaReporte, fmtReporte as fmt, formularioLinea, imprimirHojaConteo, turnoEnCurso, TURNOS_ALMACEN } from './lib/reporteTurno';
import './reportes-almacen.css';

const ESTADOS = { BORRADOR: 'En preparación', REVISION: 'Comparado · Por entregar', ENTREGADO: 'Por recibir', RECIBIDO: 'Recibido' };
const ORIGENES = { MOVIMIENTO: 'Movimiento del turno', CICLICO: 'Rotación cíclica', PENDIENTE: 'Diferencia anterior', MANUAL: 'Agregado al recorrido' };
const VISTAS = { arqueos: 'Arqueos de turno', recepcion: 'Recibir turno', diario: 'Movimientos diarios', plan: 'Plan cíclico' };
const mensaje = e => e?.message || 'No se pudo completar la operación.';
const diferencia = (declarado, esperado) => declarado == null || esperado == null ? null : Math.round((Number(declarado) - Number(esperado)) * 10000) / 10000;

export default function ReportesAlmacenApp() {
  const usuario = useUsuarioActual();
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  const [fecha, setFecha] = useState(fechaReporte);
  if (!sucursalActivaId) return <p>Selecciona una sucursal para consultar sus reportes.</p>;
  return <Workspace key={`${usuario.id}:${sucursalActivaId}:${fecha}`} usuario={usuario} sucursalId={sucursalActivaId} sucursal={nombreSucursal(sucursalActivaId)} fecha={fecha} setFecha={setFecha} />;
}

function Workspace({ usuario, sucursalId, sucursal, fecha, setFecha }) {
  const [vista, setVista] = useState('arqueos'), [reportes, setReportes] = useState(null);
  const [detalle, setDetalle] = useState(null), [extra, setExtra] = useState(null);
  const [error, setError] = useState(''), [aviso, setAviso] = useState(''), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const solicitud = useRef(null);
  const datosSucursal = { sucursal_id: sucursalId, fecha };
  useEffect(() => {
    let vigente = true;
    const cargar = async () => {
      try {
        const lista = await operarReporte('inicio', null, { sucursal_id: sucursalId, fecha });
        if (!vigente) return;
        setReportes(lista.reportes);
        if (vista === 'diario' || vista === 'plan') {
          const data = await operarReporte(vista === 'diario' ? 'resumen' : 'plan', null, { sucursal_id: sucursalId, fecha });
          if (vigente) setExtra({ vista, data });
        }
      } catch (e) { if (vigente) setError(mensaje(e)); }
    };
    void cargar();
    return () => { vigente = false; };
  }, [sucursalId, fecha, vista, revision]);

  const ejecutar = async (accion, id = detalle?.reporte.id ?? null, datos = {}) => {
    setBusy(true); setError(''); setAviso('');
    try {
      const data = await operarReporte(accion, id, datos);
      if (data.reporte) setDetalle(data);
      setRevision(v => v + 1); return data;
    } catch (e) { setError(mensaje(e)); return null; }
    finally { setBusy(false); }
  };
  const crear = async turno => {
    if (solicitud.current?.turno !== turno) solicitud.current = { turno, id: crypto.randomUUID() };
    const data = await ejecutar('crear', null, { ...datosSucursal, turno, solicitud: solicitud.current.id });
    if (data) solicitud.current = null;
  };
  const imprimir = async (data, recepcion = false) => {
    setBusy(true); setError('');
    try { await imprimirHojaConteo(data, { recepcion }); setAviso('En el diálogo de impresión puedes imprimir o elegir Guardar como PDF.'); }
    catch (e) { setError(mensaje(e)); } finally { setBusy(false); }
  };
  return <div className="rp-app">
    <header className="rp-heading"><div><span className="rp-eyebrow">CONTROL DE ALMACÉN</span><h2>Reportes y entrega de turnos</h2><p>{sucursal} · Cantidades y equivalencias · Horario de Bolivia</p></div>
      <div className="rp-tools"><label>Fecha<input type="date" value={fecha} max={fechaReporte()} disabled={busy || !!detalle} onChange={e => { if (e.target.value) setFecha(e.target.value); }} /></label><button type="button" disabled={busy || !!detalle} onClick={() => { setError(''); setRevision(v => v + 1); }}><RefreshCw size={16} />Actualizar</button></div>
    </header>
    {error && <div className="rp-alert is-error" role="alert">{error}</div>}
    {aviso && <p className="rp-alert" role="status">{aviso}</p>}
    {detalle ? <Detalle key={detalle.reporte.id} detalle={detalle} usuario={usuario} busy={busy}
      onVolver={() => {setDetalle(null);setError('');setAviso('');}} onAccion={(accion, datos) => ejecutar(accion, detalle.reporte.id, { version: detalle.reporte.version, ...datos })}
      onAbrir={id => ejecutar('detalle', id)} onImprimir={recepcion => imprimir(detalle, recepcion)} /> : <>
      <nav className="rp-tabs" aria-label="Vistas de reportes">{Object.entries(VISTAS).map(([id, label]) => <button key={id} type="button" aria-current={vista === id ? 'page' : undefined} disabled={busy} onClick={() => {setVista(id);setError('');}}>{label}</button>)}</nav>
      {!reportes ? <p role="status">Cargando reportes…</p> : vista === 'arqueos' ? <>
        <div className="rp-shifts">{Object.entries(TURNOS_ALMACEN).map(([id, turno]) => {
          const reporte = reportes.find(r => r.fecha === fecha && r.turno === id);
          return <section className="rp-card" key={id}><div className="rp-section-heading"><h3>{turno.nombre}</h3><span className="rp-badge">{reporte ? ESTADOS[reporte.estado] : 'Sin hoja'}</span></div><p className="rp-shift-time">{turno.inicio} - {turno.fin}</p><p>{reporte ? `${reporte.responsable} · ${reporte.pendientes} pendiente(s)` : 'Movimientos del turno y hasta 10 ítems de rotación cíclica.'}</p>
            <button type="button" className="rp-primary" disabled={busy} onClick={() => reporte ? ejecutar('detalle', reporte.id) : crear(id)}><FileText size={16} />{reporte ? 'Abrir reporte / hoja' : 'Generar hoja de conteo'}</button></section>;
        })}</div>
        <p className="rp-help">Abre el reporte y cuenta desde el celular con «Guardar y siguiente». También puedes imprimir la hoja y transcribirla después. Antes de entregar, actualiza el alcance para incluir los nuevos ítems movidos.</p>
        <div className="rp-alert">Los reportes no modifican existencias. Las diferencias se revisan mediante el conteo controlado y su aprobación.</div>
      </> : vista === 'recepcion' ? <section><h3>Entregas y pendientes anteriores</h3><p className="rp-help">Verifica al recibir, antes de los nuevos movimientos. Recibir el reporte conserva abiertas sus diferencias.</p>
        <div className="rp-list">{reportes.filter(r => ['ENTREGADO','RECIBIDO'].includes(r.estado)).map(r => <button type="button" className="rp-report-row" key={r.id} disabled={busy} onClick={() => ejecutar('detalle', r.id)}><span><strong>{r.fecha} · {TURNOS_ALMACEN[r.turno].nombre}</strong><small>Entrega: {r.responsable}{r.receptor ? ` · Recibe: ${r.receptor}` : ''}</small></span><span>{ESTADOS[r.estado]} · {r.pendientes} pendiente(s)</span></button>)}{!reportes.some(r => ['ENTREGADO','RECIBIDO'].includes(r.estado)) && <p className="rp-empty">No hay reportes entregados ni pendientes para esta fecha.</p>}</div>
      </section> : extra?.vista !== vista ? <p role="status">Cargando {VISTAS[vista].toLowerCase()}…</p> : vista === 'diario' ? <MovimientosDiarios key={extra.data.hasta} data={extra.data} fecha={fecha} sucursalId={sucursalId} preferenciaId={usuario.id} /> : <Plan data={extra.data} puedeProgramar={['admin','gerente'].includes(usuario.rol)} busy={busy} onProgramar={datos => ejecutar('programar', null, {...datosSucursal, ...datos})} />}
    </>}
  </div>;
}

function Detalle({ detalle, usuario, busy, onVolver, onAccion, onImprimir, onAbrir }) {
  const { reporte: r, lineas, eventos } = detalle;
  const nav = useAppNav();
  const [formularios, setFormularios] = useState(() => Object.fromEntries(lineas.map(l => [l.id, formularioLinea(l)])));
  const [observacion, setObservacion] = useState(r.observacion || ''), [recepcionNota, setRecepcionNota] = useState('');
  const [dirty, setDirty] = useState(false), [error, setError] = useState(''), [seleccion, setSeleccion] = useState(null);
  const [quickDirty, setQuickDirty] = useState(false), [modo, setModo] = useState(() => turnoEnCurso(r) ? 'rapido' : 'papel');
  const [base, setBase] = useState(detalle);
  const [preparandoRevision, setPreparandoRevision] = useState(false), [avisoRevision, setAvisoRevision] = useState('');
  const revisionLock = useRef(false);
  const sinGuardar = dirty || quickDirty;
  const [verForm, setVerForm] = useState(null), [movimientos, setMovimientos] = useState(null);
  const [busqueda, setBusqueda] = useState(''), [resultados, setResultados] = useState([]), [buscando, setBuscando] = useState(false);
  const [resolver, setResolver] = useState(null), [sesion, setSesion] = useState(''), [resolucion, setResolucion] = useState('');
  const seq = useRef(0);
  if (base !== detalle) {
    setBase(detalle);
    setFormularios(Object.fromEntries(lineas.map(l => [l.id, formularioLinea(l)])));
    setObservacion(r.observacion || ''); setDirty(false);
    setSeleccion(null); setVerForm(null); setResolver(null); setSesion(''); setResolucion(''); setRecepcionNota(''); setMovimientos(null);
  }
  const pendientes = lineas.filter(l => l.pendiente);
  const puedeRecibir = r.estado === 'ENTREGADO' && r.creado_por !== usuario.id;
  const puedeResolver = ['ENTREGADO','RECIBIDO'].includes(r.estado) && ['admin','gerente'].includes(usuario.rol);
  const cambiar = (id, datos) => { setFormularios(v => ({ ...v, [id]: { ...v[id], ...datos } })); setDirty(true); };
  const volver = () => { if (!sinGuardar || window.confirm('Hay cantidades sin guardar. ¿Quieres descartarlas y volver al listado?')) onVolver(); };
  useEffect(() => {
    if (!sinGuardar) return undefined;
    const avisar = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar); return () => window.removeEventListener('beforeunload', avisar);
  }, [sinGuardar]);
  const guardar = async e => {
    e.preventDefault(); setError('');
    try {
      const datos = lineas.map(l => {
        try { const cantidad = convertirConteo(formularios[l.id], l); return { id: l.id, empaques:cantidad.empaques,sueltas:cantidad.sueltas,contado_en:cantidad.contado_en,observacion:formularios[l.id].observacion }; }
        catch (e) { throw new Error(`Renglón ${l.numero} · ${l.nombre}: ${mensaje(e)}`, { cause:e }); }
      });
      await onAccion('guardar', { lineas: datos, observacion });
    } catch (e) { setError(mensaje(e)); }
  };
  const buscar = async e => {
    e.preventDefault(); const consulta = ++seq.current; setBuscando(true); setError('');
    try {
      const result = await operarReporte('buscar', null, { sucursal_id: r.sucursal_id, fecha: r.fecha, busqueda });
      if (consulta === seq.current) setResultados(result.items);
    } catch (e) { if (consulta === seq.current) setError(mensaje(e)); }
    finally { if (consulta === seq.current) setBuscando(false); }
  };
  const verificar = async e => {
    e.preventDefault(); setError('');
    try {
      const cantidad = convertirConteo(verForm, seleccion);
      if (cantidad.contado_en == null) throw new Error('Completa el conteo de recepción.');
      await onAccion('verificar', { linea_id:seleccion.id,empaques:cantidad.empaques,sueltas:cantidad.sueltas,contado_en:cantidad.contado_en,observacion:verForm.observacion });
    } catch (e) { setError(mensaje(e)); }
  };
  const abrirMovimientos = async l => {
    setError('');
    const consulta = ++seq.current;
    try { const data = await operarReporte('movimientos', r.id, { linea_id: l.id }); if (consulta === seq.current) setMovimientos({ linea: l, items: data.movimientos }); }
    catch (e) { setError(mensaje(e)); }
  };
  const prepararRevision = async () => {
    if (revisionLock.current || busy || sinGuardar) return;
    revisionLock.current = true; setPreparandoRevision(true); setAvisoRevision('');
    try {
      const actualizado = await onAccion('actualizar_alcance', {});
      if (!actualizado) return;
      const faltantes = actualizado.lineas.filter(l => l.declarado == null && !l.observacion?.trim());
      if (faltantes.length) {
        setAvisoRevision(`Hay ${faltantes.length} producto(s) nuevos por contar. Continúa el recorrido antes de comparar.`);
        return;
      }
      await onAccion('comparar', { version: actualizado.reporte.version });
    } finally { revisionLock.current = false; setPreparandoRevision(false); }
  };
  return <section className={`rp-detail${r.editable && modo === 'rapido' ? ' is-quick' : ''}`}>
    <div className="rp-detail-top"><button type="button" disabled={busy} onClick={volver}><ArrowLeft size={16} />Volver</button><span className="rp-badge">{ESTADOS[r.estado]}</span></div>
    <div className="rp-section-heading"><div><h3>{r.folio} · {TURNOS_ALMACEN[r.turno].nombre}</h3><p>{r.fecha} · {r.responsable} · {TURNOS_ALMACEN[r.turno].inicio} - {TURNOS_ALMACEN[r.turno].fin}</p></div>{(!r.editable || modo === 'papel') && <button type="button" disabled={busy} onClick={() => onImprimir(false)}><Printer size={16} />Imprimir / Guardar PDF</button>}</div>
    {detalle.anterior && <div className="rp-alert"><div className="rp-section-heading"><span>Turno anterior: {detalle.anterior.fecha} · {TURNOS_ALMACEN[detalle.anterior.turno].nombre} · {detalle.anterior.responsable} · {ESTADOS[detalle.anterior.estado]}</span><button type="button" disabled={busy || sinGuardar} onClick={() => onAbrir(detalle.anterior.id)}>Leer entrega anterior</button></div></div>}
    {error && <p role="alert" className="rp-alert is-error">{error}</p>}
    {(!r.editable || modo === 'papel') && <div className="rp-stats"><span><strong>{lineas.length}</strong> renglones asignados</span><span><strong>{lineas.filter(l => l.declarado != null).length}</strong> contados</span><span><strong>{r.estado === 'BORRADOR' ? '—' : pendientes.length}</strong> pendientes de revisión</span></div>}
    {r.editable ? <>
      <div className="rp-tools rp-capture-modes" role="group" aria-label="Forma de contar"><button type="button" aria-pressed={modo === 'rapido'} disabled={busy || sinGuardar} onClick={() => setModo('rapido')}>Conteo rápido</button><button type="button" aria-pressed={modo === 'papel'} disabled={busy || sinGuardar} onClick={() => setModo('papel')}>Transcribir papel</button></div>
      {modo === 'papel' && <><div className="rp-alert">Ingresa las cantidades y la hora física escritas en el papel; después de confirmar la captura podrás comparar y redactar la entrega.</div><div className="rp-tools"><button type="button" disabled={busy || sinGuardar} onClick={() => onAccion('actualizar_alcance', {})}>Actualizar alcance del turno</button><span className="rp-help">Añade ítems movidos después de abrir el reporte. Conserva el número de los renglones existentes.</span></div></>}
      {modo === 'rapido' ? <>{avisoRevision && <p className="rp-alert" role="status">{avisoRevision}</p>}<ConteoRapidoTurno reporte={r} lineas={lineas} busy={busy || preparandoRevision} onBorrador={setQuickDirty} onComparar={prepararRevision} onGuardar={linea => { setAvisoRevision(''); return onAccion('guardar', { lineas: [linea], observacion: r.observacion || '' }); }} /></> : <form onSubmit={guardar} className="rp-capture-form"><div className="rp-line-list">{lineas.map(l => <fieldset key={l.id} className="rp-capture"><legend>{l.numero}. {l.nombre}</legend><div className="rp-line-meta"><span>{l.ubicacion} · {l.sku || `Producto ${l.producto_id}`}</span><span>{ORIGENES[l.origen]} · 1 {l.empaque} = {fmt(l.factor)} {l.unidad}</span></div><CamposConteo linea={l} valor={formularios[l.id]} onChange={datos => cambiar(l.id, datos)} disabled={busy} id={`captura-${l.id}`} /></fieldset>)}</div>
        <label className="rp-note-label">Observación de entrega<textarea value={observacion} maxLength={4000} onChange={e => {setObservacion(e.target.value);setDirty(true);}} disabled={busy} placeholder="Qué debe verificar el siguiente almacenero y dónde está el respaldo." /></label>
        <div className="rp-tools"><button className="rp-primary" disabled={busy} type="submit">Guardar cantidades del papel</button><button type="button" disabled={busy || dirty} onClick={() => onAccion('comparar', {})}>Confirmar captura y comparar</button><span className="rp-help">{dirty ? 'Cambios sin guardar' : 'Compara las cantidades guardadas antes de preparar la entrega.'}</span></div>
      </form>}
      {modo === 'rapido' && <details className="rp-card rp-quick-options"><summary>Opciones del reporte</summary><p className="rp-help">Antes de entregar, actualiza el alcance para incluir productos movidos después de abrir el reporte. La cantidad del sistema se muestra después de confirmar la captura.</p><div className="rp-tools"><button type="button" disabled={busy || sinGuardar} onClick={() => onAccion('actualizar_alcance', {})}>Actualizar alcance del turno</button><button type="button" disabled={busy} onClick={() => onImprimir(false)}><Printer size={16} />Imprimir / Guardar PDF</button></div></details>}
      <details className="rp-card"><summary>Agregar un producto al recorrido</summary><form className="rp-tools" onSubmit={buscar}><label>Producto o SKU<input value={busqueda} onChange={e => setBusqueda(e.target.value)} disabled={busy || buscando} maxLength={100} /></label><button type="submit" disabled={busy || buscando || !busqueda.trim()}>Buscar</button></form><div className="rp-list">{resultados.map(l => <div className="rp-search-row" key={`${l.producto_id}:${l.ubicacion_id}`}><span>{l.nombre}<small>{l.ubicacion}</small></span><button type="button" disabled={busy || sinGuardar || lineas.some(x => x.producto_id === l.producto_id && x.ubicacion_id === l.ubicacion_id)} onClick={() => onAccion('agregar', { producto_id: l.producto_id, ubicacion_id: l.ubicacion_id })}>Agregar a hoja</button></div>)}</div></details>
    </> : <>
      <p className="rp-help">Comparación por producto y ubicación a la hora física del conteo. El documento entregado conserva sus cantidades.</p>
      <div className="rp-table-wrap"><table><thead><tr><th>Ítem / ubicación</th><th>Sistema a hora del conteo</th><th>Declarado</th><th>Resultado</th><th>Verificación de recepción</th><th>Acciones</th></tr></thead><tbody>{lineas.map(l => <tr key={l.id}><td><strong>{l.numero}. {l.nombre}</strong><small>{l.ubicacion}</small><small>{fechaHoraReporte(l.contado_en)}</small><small>{l.observacion}</small></td><td>{fmt(l.esperado)} {l.unidad}<small>{l.esperado != null && equivalenciaReporte(l.esperado,l)}</small></td><td>{fmt(l.declarado)} {l.unidad}<small>{equivalenciaReporte(l.declarado,l)}</small></td><td><Resultado linea={l} /></td><td>{l.ver_en ? <><strong>{fmt(l.ver_declarado)} {l.unidad}</strong><small>{fechaHoraReporte(l.ver_en)}</small><small>Sistema: {fmt(l.ver_esperado)} · Diferencia: {fmt(diferencia(l.ver_declarado,l.ver_esperado))}</small><small>{l.movimientos_antes_verificar ? `${l.movimientos_antes_verificar} movimiento(s) desde el cierre; revisar antes de atribuir la diferencia.` : 'Sin movimientos desde el cierre.'}</small><small>{l.ver_nota}</small></> : 'Sin verificación'}</td><td><div className="rp-actions"><button type="button" disabled={busy} onClick={() => abrirMovimientos(l)}>Ver respaldo</button>{puedeRecibir && l.pendiente && <button type="button" disabled={busy} onClick={() => {setSeleccion(l);setVerForm(formularioLinea(l,true));}}>Verificar</button>}{l.pendiente && <button type="button" disabled={busy} onClick={() => {nav.irAConteo({productoId:l.producto_id,ubicacionId:l.ubicacion_id});}}>Abrir conteo controlado</button>}{puedeResolver && l.pendiente && <button type="button" disabled={busy} onClick={() => setResolver(l)}>Vincular resolución</button>}</div></td></tr>)}</tbody></table></div>
      <div className="rp-card"><h4>{r.estado==='REVISION'?'Preparación de entrega':'Entrega'} de {r.responsable}</h4><p>{r.observacion || 'Sin observaciones.'}</p>{r.entregado_en && <small>{fechaHoraReporte(r.entregado_en)}</small>}{r.recibido_en && <><h4>Recepción de {r.receptor}</h4><p>{r.recepcion_nota}</p><small>{fechaHoraReporte(r.recibido_en)}</small></>}</div>
      {r.estado==='REVISION' && r.creado_por===usuario.id && <>
        <form className="rp-card" onSubmit={e=>{e.preventDefault();onAccion('entregar',{observacion});}}><h4>Preparar entrega al siguiente turno</h4><label>Observación de entrega<textarea value={observacion} maxLength={4000} onChange={e=>{setObservacion(e.target.value);setDirty(true);}} disabled={busy} /></label><p className="rp-help">Revisa las diferencias y deja instrucciones. La entrega se confirma al terminar el turno.</p><button type="submit" className="rp-primary" disabled={busy}>Confirmar arqueo y entregar</button></form>
        <details className="rp-card"><summary>Corregir una transcripción antes de entregar</summary><form className="rp-tools" onSubmit={e=>{e.preventDefault();onAccion('reabrir',{observacion:resolucion});}}><label>Motivo de corrección<input value={resolucion} onChange={e=>setResolucion(e.target.value)} required maxLength={2000} disabled={busy} /></label><button type="submit" disabled={busy}>Reabrir captura</button></form></details>
      </>}
      {puedeRecibir && <>
        {pendientes.length > 0 && <button type="button" disabled={busy} onClick={() => onImprimir(true)}><Printer size={16} />Imprimir pendientes para verificar</button>}
        {seleccion && verForm && <form className="rp-card" onSubmit={verificar}><h4>Verificar {seleccion.nombre}</h4><p>{seleccion.ubicacion} · Anota el conteo al recibir, antes de mover este ítem.</p><CamposConteo linea={seleccion} valor={verForm} onChange={datos => setVerForm(v => ({...v,...datos}))} disabled={busy} id="verificacion" /><button type="submit" className="rp-primary" disabled={busy}>Guardar verificación</button></form>}
        <form className="rp-card" onSubmit={e => {e.preventDefault();onAccion('recibir',{observacion:recepcionNota});}}><h4>Constancia de recepción</h4><label>Observaciones<textarea value={recepcionNota} onChange={e => setRecepcionNota(e.target.value)} required maxLength={4000} disabled={busy} /></label><p className="rp-help">Recibir confirma la entrega. Las diferencias siguen abiertas hasta que supervisión vincule su resolución.</p><button type="submit" className="rp-primary" disabled={busy || pendientes.some(l => !l.ver_en)}>Recibir reporte con sus observaciones</button></form>
      </>}
      {resolver && <form className="rp-card" onSubmit={e => {e.preventDefault();onAccion('resolver',{linea_id:resolver.id,sesion_id:Number(sesion),observacion:resolucion});}}><h4>Resolución de {resolver.nombre}</h4><p className="rp-help">Vincula un conteo controlado aplicado para este producto y ubicación, posterior a la entrega.</p><div className="rp-tools"><label>Número de sesión aplicada<input type="number" min="1" step="1" required value={sesion} onChange={e => setSesion(e.target.value)} disabled={busy} /></label><label>Motivo<input value={resolucion} onChange={e => setResolucion(e.target.value)} maxLength={2000} required disabled={busy} /></label><button type="submit" disabled={busy}>Registrar resolución</button></div></form>}
    </>}
    {movimientos && <MovimientosReporte key={movimientos.linea.id} linea={movimientos.linea} items={movimientos.items} reporte={r} onCerrar={() => { ++seq.current; setMovimientos(null); }} />}
    <details className="rp-card"><summary>Historial del reporte</summary><ul className="rp-events">{eventos.map(e => <li key={e.id}>{fechaHoraReporte(e.creado_en)} · {e.actor} · {e.accion}</li>)}</ul></details>
  </section>;
}

function CamposConteo({ linea, valor, onChange, disabled, id }) {
  let total = null;
  try { total = convertirConteo(valor,linea).total; } catch { /* Se valida al guardar; las casillas permanecen editables. */ }
  return <div className="rp-count-fields">
    {Number(linea.factor) > 1 && <label htmlFor={`${id}-empaques`}>{linea.empaque} completos<input id={`${id}-empaques`} type="number" min="0" max="999999999999" step="1" inputMode="numeric" value={valor.empaques} onChange={e => onChange({empaques:e.target.value})} disabled={disabled} /></label>}
    <label htmlFor={`${id}-sueltas`}>{Number(linea.factor)>1 ? 'Sueltas' : 'Cantidad'} ({linea.unidad})<input id={`${id}-sueltas`} type="number" min="0" max="999999999999.9999" step="0.0001" inputMode="decimal" value={valor.sueltas} onChange={e => onChange({sueltas:e.target.value})} disabled={disabled} /></label>
    <label htmlFor={`${id}-hora`}>Fecha y hora real (Bolivia)<input id={`${id}-hora`} type="datetime-local" value={valor.contado_en} onChange={e => onChange({contado_en:e.target.value})} disabled={disabled} /></label>
    <label htmlFor={`${id}-nota`}>Observación / motivo si no se contó<input id={`${id}-nota`} value={valor.observacion} maxLength={2000} onChange={e => onChange({observacion:e.target.value})} disabled={disabled} /></label>
    <p className="rp-conversion" aria-live="polite">Total: <strong>{fmt(total)} {linea.unidad}</strong></p>
  </div>;
}

function Resultado({ linea }) {
  if (linea.resuelta_en) return <span className="rp-good">Resuelto<small>Conteo #{linea.sesion_resolucion}</small><small>{linea.resolucion}</small></span>;
  if (linea.declarado == null) return <span className="rp-warning">Sin contar · pendiente</span>;
  const delta = diferencia(linea.declarado,linea.esperado);
  return <span className={delta === 0 ? 'rp-good' : 'rp-difference'}>{delta === 0 ? 'Cuadra' : `${delta>0?'+':''}${fmt(delta)} ${linea.unidad}`}<small>{delta !== 0 && 'Por revisar'}</small></span>;
}

function Plan({ data, puedeProgramar, busy, onProgramar }) {
  const [filtro, setFiltro] = useState(''), [dias, setDias] = useState({});
  const items = data.items.filter(l => `${l.nombre} ${l.sku || ''} ${l.ubicacion}`.toLocaleLowerCase('es').includes(filtro.toLocaleLowerCase('es')));
  return <section><h3>Cobertura del conteo cíclico</h3><p className="rp-help">Primero se incluyen movimientos y diferencias anteriores. La hoja agrega hasta 10 ítems sin movimiento cuyo conteo está vencido. Frecuencia inicial: 30 días, ajustable por supervisión.</p><label className="rp-filter">Buscar producto o ubicación<input value={filtro} onChange={e => setFiltro(e.target.value)} /></label><p className="rp-help">Mostrando {Math.min(items.length,100)} de {items.length} coincidencias · Alcance: ubicaciones de inventario disponible.</p><div className="rp-table-wrap"><table><thead><tr><th>Ítem / ubicación</th><th>Último conteo declarado</th><th>Prioridad</th><th>Frecuencia (días)</th></tr></thead><tbody>{items.slice(0,100).map(l => { const key=`${l.producto_id}:${l.ubicacion_id}`;return <tr key={key}><td><strong>{l.nombre}</strong><small>{l.ubicacion}</small></td><td>{fechaHoraReporte(l.ultimo_conteo)}</td><td>{l.pendiente ? 'Diferencia abierta' : l.movido ? 'Con movimiento hoy' : 'Rotación cíclica'}</td><td>{puedeProgramar ? <form className="rp-tools" onSubmit={e => {e.preventDefault();onProgramar({producto_id:l.producto_id,ubicacion_id:l.ubicacion_id,frecuencia_dias:Number(dias[key]??l.frecuencia_dias)});}}><input aria-label={`Frecuencia de ${l.nombre} en ${l.ubicacion}`} className="rp-days" type="number" min="1" max="365" step="1" value={dias[key]??l.frecuencia_dias} onChange={e => setDias(v => ({...v,[key]:e.target.value}))} required disabled={busy} /><button type="submit" disabled={busy}>Guardar</button></form> : l.frecuencia_dias}</td></tr>;})}</tbody></table></div><p className="rp-help">Un conteo declarado ayuda a programar recorridos. La existencia solo se regulariza mediante el conteo controlado aprobado.</p></section>;
}
