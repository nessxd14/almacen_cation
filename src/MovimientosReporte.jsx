import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, ArrowLeftRight, PackagePlus, FileText } from 'lucide-react';
import { fechaHoraReporte, fmtReporte as fmt, TURNOS_ALMACEN } from './lib/reporteTurno';
import { movimientosProductoDia } from './lib/reportesAlmacen';

const tipoTexto = m => ({ ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', INV_INICIAL: 'Inventario inicial', TRASLADO: Number(m.cantidad) < 0 ? 'Traslado de salida' : 'Traslado de entrada' }[m.tipo_movimiento] || m.tipo_movimiento || 'Sin tipo registrado');
const ICONOS = { ENTRADA: ArrowDownToLine, SALIDA: ArrowUpFromLine, AJUSTE: SlidersHorizontal, TRASLADO: ArrowLeftRight, INV_INICIAL: PackagePlus };
function TipoMovimiento({ movimiento }) {
  const Icono = ICONOS[movimiento.tipo_movimiento] || FileText;
  return <span className="rp-badge rp-movement-type"><Icono size={14} aria-hidden="true" />{tipoTexto(movimiento)}</span>;
}
function periodo(m) {
  const hora = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(m.creado_en));
  return hora >= '07:30' && hora < '12:30' ? 'MANANA' : hora >= '14:30' && hora < '21:30' ? 'TARDE' : 'fuera';
}

function conSaldos(items, inicial, mostrar) {
  let saldo = Number(inicial);
  const resultado = [];
  for (const m of items) {
    saldo = Math.round((saldo + Number(m.cantidad)) * 10000) / 10000;
    resultado.push({ ...m, saldo: mostrar ? saldo : null });
  }
  return resultado;
}

export function MovimientosDia({ linea, fecha, hasta, sucursalId, onCerrar, presentar, mostrarCerrar = true, autoScroll = true }) {
  const [estado, setEstado] = useState({ cargando: true });
  const [revision, setRevision] = useState(0);
  const [filtros, setFiltros] = useState({ periodo: 'dia', tipo: '' });
  useEffect(() => {
    let vigente = true;
    void movimientosProductoDia({ productoId: linea.producto_id, ubicacionId: linea.ubicacion_id, sucursalId, fecha, hasta })
      .then(data => { if (vigente) setEstado({ ...data, cargando: false }); })
      .catch(e => { if (vigente) setEstado({ error: e.message, cargando: false }); });
    return () => { vigente = false; };
  }, [linea.producto_id, linea.ubicacion_id, sucursalId, fecha, hasta, revision]);
  const contenido = estado.cargando || estado.error ? <section className="rp-card" aria-label={`Movimientos de ${linea.nombre}`}><div className="rp-section-heading"><h4>{linea.nombre} · {linea.ubicacion}</h4>{mostrarCerrar && <button type="button" onClick={onCerrar}>Cerrar movimientos</button>}</div>{estado.error ? <><p className="rp-alert is-error" role="alert">{estado.error}</p><button type="button" onClick={() => { setEstado({ cargando: true }); setRevision(v => v + 1); }}>Reintentar consulta</button></> : <p role="status">Cargando movimientos…</p>}</section>
    : <MovimientosReporte linea={linea} items={estado.items} total={estado.total} incompleto={estado.incompleto} hasta={hasta} onCerrar={onCerrar} filtros={filtros} onFiltros={setFiltros} mostrarCerrar={mostrarCerrar} autoScroll={autoScroll} />;
  return presentar ? presentar(contenido) : contenido;
}

export function MovimientosReporte({ linea, items, reporte, hasta, incompleto = false, total, onCerrar, filtros, onFiltros, mostrarCerrar = true, autoScroll = true }) {
  const [filtroLocal, setFiltro] = useState(reporte ? 'turno' : 'dia'), [tipoLocal, setTipo] = useState('');
  const filtro = filtros?.periodo ?? filtroLocal, tipo = filtros?.tipo ?? tipoLocal;
  const cambiarFiltro = (campo, valor) => {
    if (onFiltros) onFiltros(prev => ({ ...prev, [campo]: valor }));
    else if (campo === 'periodo') setFiltro(valor);
    else setTipo(valor);
  };
  const titulo = useRef(null);
  useEffect(() => { titulo.current?.focus({ preventScroll: true }); if (autoScroll) titulo.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, [autoScroll]);
  const finTurno = reporte ? new Date(reporte.fin || `${reporte.fecha}T${TURNOS_ALMACEN[reporte.turno].fin}:00-04:00`).getTime() : null;
  const ordenados = [...items].sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en) || a.id - b.id);
  const saldo = Number(linea.inicial);
  const suma = ordenados.reduce((sum, m) => sum + Number(m.cantidad), 0);
  const cuadra = !reporte && !incompleto && Number.isFinite(saldo) && Math.abs(saldo + suma - Number(linea.sistema)) < 0.00005;
  const filas = conSaldos(ordenados, saldo, cuadra).filter(m => {
    const enTurno = new Date(m.creado_en).getTime() < finTurno;
    return (!tipo || m.tipo_movimiento === tipo) && (reporte ? filtro === 'todos' || (filtro === 'turno' ? enTurno : !enTurno) : filtro === 'dia' || periodo(m) === filtro);
  });
  const limitado = incompleto || (reporte && items.length >= 1000);
  return <section className="rp-card rp-movement-detail" aria-label={`Movimientos de ${linea.nombre}`}>
    <div className="rp-section-heading"><div><span className="rp-eyebrow">DESGLOSE DE MOVIMIENTOS</span><h4 ref={titulo} tabIndex={-1}>{linea.nombre}</h4><p>{linea.ubicacion} · Cantidades en {linea.unidad}</p></div>{mostrarCerrar && <button type="button" onClick={onCerrar}>{reporte ? 'Cerrar respaldo' : 'Cerrar movimientos'}</button>}</div>
    {!reporte && <p className="rp-help">Inicial: {fmt(linea.inicial)} · Entradas: +{fmt(linea.entradas)} · Salidas: −{fmt(linea.salidas)} · Ajustes: {fmt(linea.ajustes)} · Saldo al corte: {fmt(linea.sistema)}. Corte: {fechaHoraReporte(hasta)}.</p>}
    {reporte && <p className="rp-help">Turno {TURNOS_ALMACEN[reporte.turno].nombre.toLowerCase()} · {reporte.fecha}. La actividad posterior al horario se consulta por separado.{linea.contado_en && ` Conteo físico: ${fechaHoraReporte(linea.contado_en)}.`}</p>}
    <div className="rp-tools rp-movement-filters"><label>Periodo<select aria-label="Periodo de movimientos" value={filtro} onChange={e => cambiarFiltro('periodo', e.target.value)}>{(reporte ? [['turno', 'Durante el turno'], ['posterior', 'Después del turno'], ['todos', 'Todo el respaldo']] : [['dia', 'Día completo'], ['MANANA', 'Mañana · 07:30–12:30'], ['TARDE', 'Tarde · 14:30–21:30'], ['fuera', 'Fuera de horario']]).map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}</select></label><label>Tipo de movimiento<select aria-label="Tipo de movimiento" value={tipo} onChange={e => cambiarFiltro('tipo', e.target.value)}><option value="">Todos los tipos</option>{[...new Set(items.map(m => m.tipo_movimiento).filter(Boolean))].map(t => <option key={t} value={t}>{({ ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', INV_INICIAL: 'Inventario inicial', TRASLADO: 'Traslado' })[t] || t}</option>)}</select></label></div>
    {limitado && <p className="rp-alert">Mostrando los primeros {items.length} movimientos{total != null ? ` de ${total}` : ''} del respaldo. Los filtros se aplican a los registros cargados; puede haber más actividad.</p>}
    {!reporte && !cuadra && !incompleto && <p className="rp-alert">El detalle no coincide con el corte del resumen. Actualiza el reporte para revisar el saldo; no se calculan saldos por movimiento con esta referencia.</p>}
    <p className="rp-help">{filas.length} movimiento(s) en esta selección. Horas de Bolivia.</p>
    <ol className="rp-movement-list">{filas.map(m => <li key={m.id} data-movimiento={m.tipo_movimiento || 'OTRO'}>
      <div className="rp-movement-time"><strong>{fechaHoraReporte(m.creado_en)}</strong><TipoMovimiento movimiento={m} />{reporte && new Date(m.creado_en).getTime() >= finTurno && <small>Posterior al turno</small>}{linea.contado_en && new Date(m.creado_en) > new Date(linea.contado_en) && <small>Después del conteo físico</small>}</div>
      <dl><div><dt>Cantidad</dt><dd className="rp-movement-amount">{Number(m.cantidad) > 0 ? '+' : ''}{fmt(m.cantidad)} {linea.unidad}</dd></div>{cuadra && <div><dt>Saldo después</dt><dd>{fmt(m.saldo)} {linea.unidad}</dd></div>}<div><dt>Documento / motivo</dt><dd>{m.referencia || 'Sin referencia'}{m.motivo && <small>{m.motivo}</small>}</dd></div><div><dt>Registrado por</dt><dd>{m.autor || m.creado_por || 'Sin autor registrado'}</dd></div></dl>
    </li>)}</ol>{!filas.length && <p className="rp-empty">No hay movimientos para estos filtros.</p>}
  </section>;
}
