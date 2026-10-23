import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle, ListChecks, MapPin, ScanBarcode } from 'lucide-react';
import EscanerCodigo from './EscanerCodigo';
import { interpretarCodigoOperacion } from './lib/operacionesMovil';
import { capturaRapidaTurno, corregirCapturaTurno, fechaHoraReporte, fmtReporte as fmt, turnoEnCurso } from './lib/reporteTurno';
import { basesRecorridoTurno, notaSinVerificacionEmpaques, observacionEmpaquesTurno, ordenarRecorridoTurno, tieneVerificacionEmpaques, ubicacionRecorridoTurno } from './lib/recorridoTurno';
import './conteo-turno.css';

const vacio = () => ({ empaques: '', sueltas: '', observacion: '', empaquesVerificados: false });
const realizada = l => l.declarado != null || !!l.observacion?.trim();
const ordenar = ordenarRecorridoTurno;
const MOTIVOS = ['No pude acceder al producto', 'No alcancé a contar', 'Necesita revisión'];

export default function ConteoRapidoTurno({ reporte, lineas, busy, onGuardar, onBorrador, onComparar }) {
  const recorrido = ordenar(lineas);
  const [seleccion, setSeleccion] = useState(() => recorrido.find(l => !realizada(l))?.id ?? null);
  const [baseSeleccionada, setBaseSeleccionada] = useState(() => ubicacionRecorridoTurno(recorrido.find(l => !realizada(l)) || recorrido[0] || {}).id);
  const [borradores, setBorradores] = useState({});
  const [filtro, setFiltro] = useState('pendientes'), [busqueda, setBusqueda] = useState('');
  const [ubicacion, setUbicacion] = useState(''), [productoQr, setProductoQr] = useState(null);
  const [scanning, setScanning] = useState(false), [listando, setListando] = useState(false);
  const [salida, setSalida] = useState(null), [regreso, setRegreso] = useState(null);
  const [error, setError] = useState(''), [ultimo, setUltimo] = useState(null), [omitir, setOmitir] = useState(false);
  const [guardando, setGuardando] = useState(false), [confirmarCero, setConfirmarCero] = useState(false);
  const lock = useRef(false), campo = useRef(null), sueltas = useRef(null), panel = useRef(null);
  const linea = recorrido.find(l => l.id === seleccion);
  const valor = borradores[seleccion] ?? vacio();
  const corrigiendo = valor.tipo === 'correccion';
  const guardado = linea?.declarado != null && !borradores[seleccion];
  const hayBorrador = Object.keys(borradores).length > 0;
  const contados = lineas.filter(l => l.declarado != null).length;
  const omitidos = lineas.filter(l => l.declarado == null && l.observacion?.trim()).length;
  const faltantes = lineas.length - contados - omitidos;
  const listo = lineas.length > 0 && faltantes === 0 && !hayBorrador;
  const deshabilitado = busy || guardando;
  const enHorario = turnoEnCurso(reporte);
  const ubicaciones = [...new Map(recorrido.map(l => [l.ubicacion_id, l.ubicacion])).entries()];
  const enUbicacion = linea ? recorrido.filter(l => l.ubicacion_id === linea.ubicacion_id) : [];
  const bases = basesRecorridoTurno(recorrido);
  const baseActiva = bases.find(b => b.id === baseSeleccionada) || bases[0];
  const paradas = [...new Map((baseActiva?.lineas || []).map(l => [l.ubicacion_id, l])).values()];

  useEffect(() => { onBorrador(hayBorrador); }, [hayBorrador, onBorrador]);
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
    campo.current?.focus({ preventScroll: true });
    if (corrigiendo) campo.current?.select();
  }, [seleccion, corrigiendo, omitir]);

  const cambiar = datos => {
    setBorradores(prev => ({ ...prev, [seleccion]: { ...(prev[seleccion] ?? vacio()), ...('empaques' in datos ? { empaquesVerificados: false } : {}), ...datos } }));
    setError(''); setConfirmarCero(false);
  };
  const elegir = id => {
    setSeleccion(id); setError(''); setOmitir(false); setSalida(null); setConfirmarCero(false);
    const elegida = recorrido.find(l => l.id === id);
    if (elegida) setBaseSeleccionada(ubicacionRecorridoTurno(elegida).id);
    setListando(id == null); setRegreso(null);
  };
  const elegirBase = base => {
    const siguiente = base.lineas.find(l => !realizada(l) || borradores[l.id]) || base.lineas[0];
    setUbicacion(''); setBusqueda(''); setProductoQr(null);
    elegir(siguiente?.id ?? null); setBaseSeleccionada(base.id);
  };
  const abrirLista = (nuevoFiltro = filtro) => { elegir(null); setFiltro(nuevoFiltro); };
  const retomar = () => {
    if (continuarLinea) elegir(continuarLinea.id);
  };
  const editar = l => {
    setRegreso({ seleccion: seleccion === l.id ? null : seleccion, salida, listando, baseSeleccionada });
    setSeleccion(l.id); setSalida(null); setOmitir(false); setError(''); setConfirmarCero(false);
    setBaseSeleccionada(ubicacionRecorridoTurno(l).id);
    setBorradores(prev => ({ ...prev, [l.id]: prev[l.id] ?? {
      empaques: String(l.empaques ?? 0), sueltas: String(l.sueltas ?? 0), observacion: notaSinVerificacionEmpaques(l.observacion), empaquesVerificados: tieneVerificacionEmpaques(l.observacion), tipo: 'correccion', horaOriginal: l.contado_en,
    } }));
  };
  const quitarBorrador = id => setBorradores(prev => { const next = { ...prev }; delete next[id]; return next; });
  const cancelarEdicion = () => {
    quitarBorrador(seleccion); setError(''); setConfirmarCero(false);
    if (regreso) { setSeleccion(regreso.seleccion); setSalida(regreso.salida); setListando(regreso.listando); setBaseSeleccionada(regreso.baseSeleccionada); setRegreso(null); }
  };

  const guardar = async (e, datos = valor, dejarPendiente = omitir) => {
    e?.preventDefault();
    if (lock.current || !linea) return;
    setError('');
    let captura;
    try {
      if (dejarPendiente) {
        if (!datos.motivo?.trim()) throw new Error('Elige un motivo o escribe por qué no pudiste contar.');
        captura = { id: linea.id, empaques: null, sueltas: null, contado_en: null, observacion: datos.motivo.trim() };
      } else {
        captura = datos.tipo === 'correccion'
          ? corregirCapturaTurno(datos, { ...linea, contado_en: datos.horaOriginal }, reporte)
          : capturaRapidaTurno(datos, linea, reporte);
        captura.observacion = observacionEmpaquesTurno(datos, linea);
      }
    } catch (e) { setError(e.message); campo.current?.focus(); return; }
    lock.current = true; setGuardando(true);
    try {
      const data = await onGuardar(captura);
      if (!data) { setError('No se guardó este producto. Lo escrito sigue aquí. Revisa el aviso del reporte y vuelve a intentar.'); return; }
      quitarBorrador(linea.id);
      setUltimo({ id: linea.id, nombre: linea.nombre, pendiente: dejarPendiente });
      setOmitir(false); setConfirmarCero(false);
      if (datos.tipo === 'correccion' && regreso) {
        setSeleccion(regreso.seleccion); setSalida(regreso.salida); setListando(regreso.listando); setBaseSeleccionada(regreso.baseSeleccionada); setRegreso(null);
        return;
      }
      const siguientes = ordenar(data.lineas).filter(l => l.id !== linea.id && (!realizada(l) || borradores[l.id]));
      const mismaUbicacion = siguientes.find(l => l.ubicacion_id === linea.ubicacion_id);
      const baseOrigen = ubicacionRecorridoTurno(linea);
      const mismaBase = siguientes.find(l => ubicacionRecorridoTurno(l).id === baseOrigen.id);
      const siguiente = mismaUbicacion || mismaBase;
      if (siguiente) { setSeleccion(siguiente.id); setSalida(null); }
      else {
        setSeleccion(null);
        setSalida(siguientes.length ? { base: baseOrigen.id, nombre: baseOrigen.nombre, siguienteId: siguientes[0].id, siguienteUbicacion: siguientes[0].ubicacion, siguienteBase: ubicacionRecorridoTurno(siguientes[0]).nombre } : null);
      }
      setListando(false);
    } catch (e) { setError(e.message || 'No se pudo guardar. Lo escrito sigue aquí para reintentar.'); }
    finally { lock.current = false; setGuardando(false); }
  };
  const guardarCero = () => {
    const datos = { ...valor, empaques: '0', sueltas: '0' };
    setBorradores(prev => ({ ...prev, [seleccion]: datos }));
    void guardar(null, datos, false);
  };
  const escanear = codigo => {
    setScanning(false); setError('');
    try {
      const etiqueta = interpretarCodigoOperacion(codigo);
      if (!['producto', 'ubicacion'].includes(etiqueta.tipo)) throw new Error('Escanea el QR de un producto o ubicación del almacén. También puedes buscar por nombre o SKU.');
      if (etiqueta.sucursalId && String(etiqueta.sucursalId) !== String(reporte.sucursal_id)) throw new Error('La etiqueta corresponde a otra sucursal.');
      const matches = recorrido.filter(l => String(etiqueta.tipo === 'producto' ? l.producto_id : l.ubicacion_id) === etiqueta.id);
      if (!matches.length) throw new Error('La etiqueta no está en este recorrido. Agrégala en las opciones del reporte.');
      if (etiqueta.tipo === 'producto' && matches.length === 1) elegir(matches[0].id);
      else { abrirLista('todos'); setUbicacion(etiqueta.tipo === 'ubicacion' ? String(matches[0].ubicacion_id) : ''); setProductoQr(etiqueta.tipo === 'producto' ? etiqueta.id : null); setBusqueda(''); }
    } catch (e) { setError(e.message); }
  };
  const query = busqueda.trim().toLocaleLowerCase('es');
  const visibles = recorrido.filter(l => (!ubicacion || String(l.ubicacion_id) === ubicacion)
    && (!productoQr || String(l.producto_id) === productoQr)
    && `${l.nombre} ${l.sku || ''} ${l.ubicacion}`.toLocaleLowerCase('es').includes(query)
    && (filtro === 'todos' || (filtro === 'borradores' ? !!borradores[l.id] : filtro === 'contados' ? l.declarado != null : filtro === 'omitidos' ? l.declarado == null && !!l.observacion?.trim() : !realizada(l))));
  const continuarLinea = recorrido.find(l => (!ubicacion || String(l.ubicacion_id) === ubicacion)
    && (!productoQr || String(l.producto_id) === productoQr)
    && `${l.nombre} ${l.sku || ''} ${l.ubicacion}`.toLocaleLowerCase('es').includes(query)
    && (!realizada(l) || borradores[l.id]));
  let total = null;
  if (valor.empaques !== '' || valor.sueltas !== '') {
    const calculado = Number(valor.empaques || 0) * Number(linea?.factor || 1) + Number(valor.sueltas || 0);
    if (Number.isFinite(calculado)) total = calculado;
  }
  const siguienteMismaUbicacion = linea && recorrido.find(l => l.id !== linea.id && l.ubicacion_id === linea.ubicacion_id && (!realizada(l) || borradores[l.id]));
  const siguienteMismaBase = linea && recorrido.find(l => l.id !== linea.id && ubicacionRecorridoTurno(l).id === ubicacionRecorridoTurno(linea).id && (!realizada(l) || borradores[l.id]));
  const ultimoGuardado = ultimo && lineas.find(l => l.id === ultimo.id);
  const errorVisible = error && <p className="rp-alert is-error" role="alert">{error}</p>;

  return <section className="rp-quick rp-quick-zoned" aria-label="Conteo rápido del turno">
    <header className="rp-count-header"><div><h4>Conteo de material</h4><p>Recorrido por ubicación base</p></div><span className="rp-badge">{lineas.length} renglones</span></header>
    <div className="rp-count-layout">
    <aside className="rp-count-bases" aria-label="Ubicaciones base del recorrido"><h5>Tu recorrido</h5><div className="rp-count-base-options">{bases.map((base, index) => {
      const registrados = base.lineas.filter(realizada).length;
      const conMotivo = base.lineas.filter(l => l.declarado == null && l.observacion?.trim()).length;
      const sinGuardar = base.lineas.some(l => borradores[l.id]);
      return <button key={base.id} type="button" disabled={deshabilitado} aria-pressed={baseActiva?.id === base.id} onClick={() => elegirBase(base)}><span className="rp-count-step">{registrados === base.lineas.length && !conMotivo && !sinGuardar ? <CheckCircle size={18} /> : index + 1}</span><span><strong>{base.nombre}</strong><small>{registrados}/{base.lineas.length} registrados{conMotivo ? ` · ${conMotivo} con motivo` : ''}{sinGuardar ? ' · Sin guardar' : ''}</small></span></button>;
    })}</div><p>Termina los muebles de una zona antes de pasar a la siguiente.</p></aside>
    <div className="rp-count-work">
    <div className="rp-count-zone-heading"><strong>{baseActiva?.nombre || 'Recorrido'}</strong><span>{baseActiva?.lineas.filter(realizada).length || 0} de {baseActiva?.lineas.length || 0} registrados en esta zona</span></div>
    <nav className="rp-count-stops" aria-label="Ubicaciones dentro de la zona">{paradas.map(parada => {
      const enParada = baseActiva.lineas.filter(l => l.ubicacion_id === parada.ubicacion_id);
      const siguiente = enParada.find(l => !realizada(l) || borradores[l.id]) || parada;
      return <button key={parada.ubicacion_id} type="button" disabled={deshabilitado} aria-pressed={linea?.ubicacion_id === parada.ubicacion_id} onClick={() => elegir(siguiente.id)}><span>{ubicacionRecorridoTurno(parada).detalle}</span><small>{enParada.filter(realizada).length}/{enParada.length}</small></button>;
    })}</nav>
    <div className="rp-tools"><button type="button" disabled={deshabilitado} onClick={() => abrirLista()}><ListChecks size={18} />Ver recorrido</button><button type="button" disabled={deshabilitado} onClick={() => setScanning(true)}><ScanBarcode size={18} />Escanear QR</button></div>
    {scanning && <EscanerCodigo onDetect={escanear} onClose={() => setScanning(false)} />}
    {ultimo && <div className="rp-save-ok"><span role="status"><CheckCircle size={17} />{ultimo.nombre}: {ultimo.pendiente ? 'pendiente con motivo guardado' : `conteo guardado · ${fmt(ultimoGuardado?.declarado)} ${ultimoGuardado?.unidad || ''}`}.</span>{ultimoGuardado?.declarado != null && ultimo.id !== seleccion && <button type="button" disabled={deshabilitado} onClick={() => editar(ultimoGuardado)}>Corregir último conteo</button>}</div>}
    {!linea && errorVisible}
    {!enHorario && <p className="rp-alert">El turno está fuera del horario de conteo en vivo. Puedes corregir cantidades ya registradas; para transcribir un conteo anterior usa «Transcribir papel».</p>}
    {linea ? <div className="rp-card rp-quick-entry" ref={panel}>
      <span className="rp-location"><MapPin size={16} /><span>{ubicacionRecorridoTurno(linea).nombre} / {ubicacionRecorridoTurno(linea).detalle}</span></span><small>{enUbicacion.filter(realizada).length} de {enUbicacion.length} registrados en esta ubicación</small>
      <h4>{linea.nombre}</h4><p className="rp-help">Renglón {linea.numero} · {linea.sku || `Producto ${linea.producto_id}`}</p>
      {guardado && errorVisible}
      {guardado ? <div className="rp-saved-entry">
        <p>Este producto ya está contado.</p><strong>{fmt(linea.declarado)} {linea.unidad}</strong><small>{fechaHoraReporte(linea.contado_en)}</small>{linea.observacion && <p>{linea.observacion}</p>}
        <div className="rp-tools"><button type="button" className="rp-primary" disabled={deshabilitado} onClick={() => editar(linea)}>Corregir cantidad</button><button type="button" disabled={deshabilitado || !enHorario} onClick={() => { cambiar(vacio()); setRegreso(null); }}>Volver a contar ahora</button></div><p className="rp-help">Corregir conserva la hora original. Volver a contar registra una nueva hora física.</p>
      </div> : <form onSubmit={guardar} noValidate>
        {corrigiendo && <p className="rp-alert">Estás corrigiendo lo anotado. Se conserva la hora del conteo: {fechaHoraReporte(valor.horaOriginal)}.</p>}
        {linea.declarado == null && linea.observacion?.trim() && <p className="rp-help">Pendiente anterior: {linea.observacion}. Cuenta ahora para resolver este pendiente de captura.</p>}
        {omitir ? <>
          <p className="rp-help">Elige el motivo y continúa. El producto quedará identificado para revisión.</p>
          <div className="rp-reason-options" role="group" aria-label="Motivos frecuentes">{MOTIVOS.map(motivo => <button key={motivo} type="button" disabled={deshabilitado} aria-pressed={valor.motivo === motivo} onClick={() => cambiar({ motivo })}>{motivo}</button>)}</div>
          <label>Motivo o detalle adicional<input ref={campo} id="rapido-motivo" value={valor.motivo || ''} maxLength={2000} onChange={e => cambiar({ motivo: e.target.value })} disabled={deshabilitado} aria-describedby={error ? 'rapido-error' : undefined} /></label>
        </> : <>
          <div className="rp-quick-quantities">
            {Number(linea.factor) > 1 && <label htmlFor="rapido-empaques"><span>Empaques completos</span><input ref={campo} id="rapido-empaques" type="number" min="0" max="999999999999" step="1" inputMode="numeric" enterKeyHint="next" placeholder="0" value={valor.empaques} onChange={e => cambiar({ empaques: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); sueltas.current?.focus(); sueltas.current?.select(); } }} disabled={deshabilitado} /><small>{linea.empaque} · {fmt(linea.factor)} {linea.unidad} por empaque</small></label>}
            <label htmlFor="rapido-sueltas"><span>{Number(linea.factor) > 1 ? 'Unidades sueltas' : 'Cantidad encontrada'} ({linea.unidad})</span><input ref={el => { sueltas.current = el; if (Number(linea.factor) <= 1) campo.current = el; }} id="rapido-sueltas" type="number" min="0" max="999999999999.9999" step="0.0001" inputMode="decimal" enterKeyHint="done" placeholder="0" value={valor.sueltas} onChange={e => cambiar({ sueltas: e.target.value })} disabled={deshabilitado} /><small>{Number(linea.factor) > 1 ? 'Cuenta el material abierto, sin repetir los empaques.' : 'Cuenta el material de esta ubicación.'}</small></label>
          </div>
          {Number(linea.factor) > 1 && <label className="rp-pack-check" htmlFor="rapido-empaques-verificados"><input id="rapido-empaques-verificados" type="checkbox" checked={!!valor.empaquesVerificados} onChange={e => cambiar({ empaquesVerificados: e.target.checked })} disabled={deshabilitado} /><span>Verifiqué los empaques completos y su presentación.</span></label>}
          <div className="rp-quick-total" aria-live="polite"><div><span>Cantidad que estás declarando</span><strong>{fmt(total)} <small>{linea.unidad}</small></strong></div>{total != null && Number(linea.factor) > 1 && <small>{fmt(Number(valor.empaques || 0))} × {fmt(linea.factor)} + {fmt(Number(valor.sueltas || 0))}</small>}</div>
        </>}
        {error && <div id="rapido-error">{errorVisible}</div>}
        <div className="rp-quick-save"><div className={`rp-quick-actions${corrigiendo ? ' is-correction' : ''}`}>{!corrigiendo && <button type="button" disabled={deshabilitado} onClick={() => { setOmitir(!omitir); setError(''); setConfirmarCero(false); }}>{omitir ? 'Volver a cantidades' : 'No puedo contar'}</button>}<button type="submit" className="rp-primary" disabled={deshabilitado || (!omitir && !corrigiendo && !enHorario)}>{guardando ? 'Guardando…' : corrigiendo ? 'Guardar corrección' : omitir ? 'Guardar pendiente y siguiente' : 'Guardar y siguiente'}<ArrowRight size={18} /></button></div><small>{corrigiendo ? 'La hora original se conserva.' : omitir ? 'Se guarda el motivo; la existencia queda sin declarar.' : siguienteMismaUbicacion ? `Después: ${siguienteMismaUbicacion.nombre}` : siguienteMismaBase ? `Después: ${ubicacionRecorridoTurno(siguienteMismaBase).detalle} · ${siguienteMismaBase.nombre}` : 'Después: resumen de esta ubicación base.'}</small></div>
        {!omitir && !corrigiendo && <>
          {confirmarCero ? <div className="rp-zero-confirm"><p>Habías escrito una cantidad. ¿Quieres reemplazarla por cero?</p><button type="button" disabled={deshabilitado || !enHorario} onClick={guardarCero}>Guardar cero y continuar</button><button type="button" disabled={deshabilitado} onClick={() => setConfirmarCero(false)}>Conservar cantidad</button></div> : <button type="button" className="rp-zero" disabled={deshabilitado || !enHorario} onClick={() => total > 0 ? setConfirmarCero(true) : guardarCero()}>No hay · Guardar cero</button>}
          <details><summary>Añadir observación</summary><label>Observación<input value={valor.observacion} maxLength={2000} onChange={e => cambiar({ observacion: e.target.value })} disabled={deshabilitado} /></label></details>
        </>}
        {borradores[seleccion] && <button type="button" disabled={deshabilitado} onClick={cancelarEdicion}>{corrigiendo ? 'Cancelar corrección' : 'Descartar lo escrito de este producto'}</button>}
      </form>}
    </div> : !listando && listo ? <div className="rp-card rp-completion" ref={panel}>
      <CheckCircle size={28} /><h4>Recorrido completado</h4><p>{contados} {contados === 1 ? 'producto contado' : 'productos contados'}{omitidos ? ` y ${omitidos} ${omitidos === 1 ? 'pendiente' : 'pendientes'} con motivo` : ''}.</p>
      {omitidos > 0 && <button type="button" disabled={deshabilitado} onClick={() => { setUbicacion(''); setBusqueda(''); setProductoQr(null); abrirLista('omitidos'); }}>Revisar pendientes con motivo</button>}
      <button type="button" className="rp-primary" disabled={deshabilitado} onClick={onComparar}>{busy ? 'Preparando revisión…' : 'Confirmar captura y comparar'}<ArrowRight size={18} /></button><small>Se comprueba si hay nuevos productos del turno antes de comparar. Después podrás revisar diferencias y preparar la entrega.</small>
    </div> : !listando && salida ? <div className="rp-card rp-location-complete" ref={panel}>
      <CheckCircle size={26} /><h4>Terminaste {salida.nombre}</h4><p>El recorrido de esta ubicación base quedó registrado.</p><ul className="rp-base-summary">{recorrido.filter(l => ubicacionRecorridoTurno(l).id === salida.base).map(l => <li key={l.id}><span>{l.nombre}<small>{ubicacionRecorridoTurno(l).detalle}</small></span><span>{l.declarado != null ? `${fmt(l.declarado)} ${l.unidad}` : 'Pendiente con motivo'}</span></li>)}</ul><p className="rp-help">Siguiente ubicación base: <strong>{salida.siguienteBase}</strong><br />{salida.siguienteUbicacion}</p><button type="button" className="rp-primary" disabled={deshabilitado} onClick={() => { setUbicacion(''); setProductoQr(null); setBusqueda(''); elegir(salida.siguienteId); }}>Continuar en {salida.siguienteBase}<ArrowRight size={18} /></button>
    </div> : <div className="rp-card rp-route">
      <div className="rp-section-heading"><h4>Recorrido por ubicación</h4>{continuarLinea && <button type="button" className="rp-primary" disabled={deshabilitado} onClick={retomar}>Continuar conteo<ArrowRight size={16} /></button>}{listo && <button type="button" disabled={deshabilitado} onClick={() => { setListando(false); setSalida(null); }}>Ir al resumen final</button>}</div>
      {hayBorrador && <p className="rp-alert">Hay {Object.keys(borradores).length} producto(s) con cambios sin guardar. <button type="button" disabled={deshabilitado} onClick={() => { setUbicacion(''); setBusqueda(''); setProductoQr(null); setFiltro('borradores'); }}>Ver cambios sin guardar</button></p>}
      {productoQr && <p className="rp-help">Elige dónde contar el producto del QR. <button type="button" onClick={() => setProductoQr(null)} disabled={deshabilitado}>Ver todos los productos</button></p>}
      <label>Buscar producto o SKU<input value={busqueda} onChange={e => { setBusqueda(e.target.value); setProductoQr(null); setFiltro('todos'); }} placeholder="Nombre, SKU o ubicación" disabled={deshabilitado} /></label>
      <label>Ubicación<select value={ubicacion} onChange={e => setUbicacion(e.target.value)} disabled={deshabilitado}><option value="">Todas las ubicaciones</option>{ubicaciones.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></label>
      <div className="rp-tools rp-route-filters" role="group" aria-label="Filtrar recorrido">{[['pendientes', `Por contar (${faltantes})`], ['omitidos', `Con motivo (${omitidos})`], ['contados', `Contados (${contados})`], ['todos', 'Todos']].map(([id, nombre]) => <button type="button" key={id} aria-pressed={filtro === id} onClick={() => setFiltro(id)} disabled={deshabilitado}>{nombre}</button>)}</div>
      {!visibles.length && <p className="rp-empty">No hay productos para estos filtros. <button type="button" disabled={deshabilitado} onClick={() => { setUbicacion(''); setBusqueda(''); setProductoQr(null); setFiltro('todos'); }}>Mostrar todo el recorrido</button></p>}
      <ul className="rp-route-list">{visibles.map((l, index) => <li key={l.id}>{(index === 0 || ubicacionRecorridoTurno(visibles[index - 1]).id !== ubicacionRecorridoTurno(l).id) && <h5 className="rp-route-base">{ubicacionRecorridoTurno(l).nombre}</h5>}{(index === 0 || visibles[index - 1].ubicacion_id !== l.ubicacion_id) && <h5>{ubicacionRecorridoTurno(l).detalle}</h5>}<button type="button" disabled={deshabilitado} onClick={() => elegir(l.id)}><span><strong>{l.numero}. {l.nombre}</strong><small>{l.sku}{borradores[l.id] ? ' · Sin guardar' : l.declarado != null ? ` · ${fmt(l.declarado)} ${l.unidad}` : l.observacion ? ` · ${l.observacion}` : ''}</small></span><span>{borradores[l.id] ? 'Retomar →' : l.declarado != null ? 'Ver conteo →' : l.observacion?.trim() ? 'Reintentar →' : 'Contar →'}</span></button></li>)}</ul>
    </div>}
    </div></div>
    <footer className="rp-count-footer"><div className="rp-progress"><div><strong>{contados} de {lineas.length} contados</strong><span>{faltantes} por contar{omitidos > 0 ? ` · ${omitidos} con motivo` : ''}</span></div><progress aria-label="Productos registrados, incluidos pendientes con motivo" value={contados + omitidos} max={Math.max(lineas.length, 1)} /></div><small>El saldo esperado se compara al confirmar el recorrido completo.</small></footer>
  </section>;
}
