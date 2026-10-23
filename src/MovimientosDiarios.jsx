import { useLayoutEffect, useRef, useState } from 'react';
import { AppWindow, ArrowLeft, FileText, PanelRight, Search, X } from 'lucide-react';
import CatalogDialog from './CatalogDialog';
import ComprobantesDiarios from './ComprobantesDiarios';
import { MovimientosDia } from './MovimientosReporte';
import { equivalenciaReporte, fechaHoraReporte, fmtReporte as fmt } from './lib/reporteTurno';

const VISTAS = [
  { id: 'pagina', nombre: 'Página', Icono: FileText },
  { id: 'panel', nombre: 'Panel lateral', Icono: PanelRight },
  { id: 'ventana', nombre: 'Ventana', Icono: AppWindow },
];
function SelectorVista({ valor, onChange }) {
  return <div className="rp-view-selector"><span>Ver detalle en</span><div role="group" aria-label="Presentación del detalle de movimientos">{VISTAS.map(({ id, nombre, Icono }) => <button key={id} type="button" aria-pressed={valor === id} onClick={() => onChange(id)}><Icono size={16} aria-hidden="true" />{nombre}</button>)}</div></div>;
}
function preferenciaInicial(clave) {
  try { const valor = localStorage.getItem(clave); return VISTAS.some(v => v.id === valor) ? valor : 'pagina'; }
  catch { return 'pagina'; }
}
function posicionLista(elemento) {
  const padres = [];
  for (let el = elemento?.parentElement; el; el = el.parentElement) padres.push({ el, top: el.scrollTop, left: el.scrollLeft });
  return { padres, x: window.scrollX, y: window.scrollY };
}

export default function MovimientosDiarios({ data, fecha, sucursalId, preferenciaId = 'local' }) {
  const clave = `wms_reportes_vista_movimientos_v1:${preferenciaId}`;
  const [modo, setModo] = useState(() => preferenciaInicial(clave));
  const [agrupacion, setAgrupacion] = useState('productos');
  const [seleccion, setSeleccion] = useState(null), [busqueda, setBusqueda] = useState('');
  const origen = useRef(null), posicion = useRef(null), anterior = useRef({ seleccion: null, modo });
  const detalleRef = useRef(null);
  const cambiarModo = valor => {
    setModo(valor);
    try { localStorage.setItem(clave, valor); } catch { /* La preferencia sigue activa durante esta consulta. */ }
  };
  const abrir = (linea, evento) => {
    origen.current = evento.currentTarget;
    posicion.current = posicionLista(evento.currentTarget);
    setSeleccion(linea);
  };
  const cerrar = () => setSeleccion(null);
  useLayoutEffect(() => {
    if (!seleccion && anterior.current.seleccion) {
      const previa = posicion.current;
      if (previa) {
        for (const { el, top, left } of previa.padres) if (el.isConnected) { el.scrollTop = top; el.scrollLeft = left; }
        if (window.scrollX !== previa.x || window.scrollY !== previa.y) window.scrollTo({ left: previa.x, top: previa.y, behavior: 'instant' });
      }
      if (origen.current?.isConnected) origen.current.focus({ preventScroll: true });
    } else if (seleccion && (seleccion !== anterior.current.seleccion || modo !== anterior.current.modo)) {
      if (detalleRef.current) detalleRef.current.scrollTop = 0;
      if (modo === 'pagina' || modo === 'panel' && detalleRef.current && window.getComputedStyle(detalleRef.current).position !== 'sticky') detalleRef.current?.scrollIntoView?.({ block: 'start' });
    }
    anterior.current = { seleccion, modo };
  }, [seleccion, modo]);

  const selector = <SelectorVista valor={modo} onChange={cambiarModo} />;
  const query = busqueda.trim().toLocaleLowerCase('es');
  const items = data.items.filter(l => `${l.nombre} ${l.sku || ''} ${l.ubicacion}`.toLocaleLowerCase('es').includes(query));
  const mostrarLista = !seleccion || modo !== 'pagina';
  const presentar = contenido => {
    const esPagina = modo === 'pagina';
    const cabecera = <div className="rp-daily-detail-toolbar"><button type="button" className="rp-detail-back" onClick={cerrar}>{esPagina ? <ArrowLeft size={17} aria-hidden="true" /> : <X size={17} aria-hidden="true" />}{esPagina ? 'Volver a movimientos diarios' : modo === 'panel' ? 'Cerrar panel' : 'Cerrar ventana'}</button>{selector}</div>;
    if (modo === 'ventana') return <CatalogDialog label={`Detalle de movimientos de ${seleccion.nombre}`} className="rp-movements-dialog" onClose={cerrar}><div className="rp-app rp-dialog-content">{cabecera}{contenido}</div></CatalogDialog>;
    return <section ref={detalleRef} className={`rp-daily-detail rp-daily-detail-${modo}`} aria-label={esPagina ? 'Página de detalle de movimientos' : 'Panel de detalle de movimientos'}>{cabecera}{contenido}</section>;
  };
  return <section className="rp-diario" onKeyDown={e => { if (e.key === 'Escape' && seleccion && modo !== 'ventana') { e.preventDefault(); cerrar(); } }}>
    <div className="rp-daily-heading"><div><h3>Movimientos del día</h3><p className="rp-help">{fecha} · Corte: {fechaHoraReporte(data.hasta)} · {agrupacion === 'productos' ? 'Por producto y ubicación.' : 'Por comprobante.'}</p></div>{agrupacion === 'productos' && !seleccion && selector}</div>
    <div className="rp-tools rp-group-selector" role="group" aria-label="Agrupar movimientos por"><button type="button" aria-pressed={agrupacion === 'productos'} onClick={() => setAgrupacion('productos')}>Productos</button><button type="button" aria-pressed={agrupacion === 'comprobantes'} onClick={() => { cerrar(); setAgrupacion('comprobantes'); }}>Comprobantes</button></div>
    {agrupacion === 'comprobantes' && <ComprobantesDiarios fecha={fecha} hasta={data.hasta} sucursalId={sucursalId} />}
    <div hidden={agrupacion !== 'productos'} className={`rp-diario-layout is-${modo}${seleccion ? ' has-selection' : ''}`}>
      <div className="rp-diario-list" hidden={!mostrarLista}>
        <label className="rp-daily-search"><span><Search size={16} aria-hidden="true" />Buscar producto o ubicación</span><input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre, SKU o ubicación" maxLength={150} /></label>
        <div className="rp-table-wrap"><table className="rp-daily-summary"><thead><tr><th>Ítem / ubicación</th><th>Inicial</th><th className="rp-col-entrada">Entradas</th><th className="rp-col-salida">Salidas</th><th className="rp-col-ajuste">Ajustes</th><th>Sistema al corte</th><th>Fuera de turno</th></tr></thead><tbody>{items.map(l => {
          const actual = seleccion?.producto_id === l.producto_id && seleccion?.ubicacion_id === l.ubicacion_id;
          return <tr key={`${l.producto_id}:${l.ubicacion_id}`} className={actual ? 'is-selected' : ''}><td><strong>{l.nombre}</strong><small>{l.ubicacion} · {l.unidad}</small><button type="button" className="rp-open-movements" aria-label={`Ver movimientos de ${l.nombre} en ${l.ubicacion}`} aria-current={actual ? 'true' : undefined} onClick={e => abrir(l, e)}>Ver movimientos</button></td><td data-label="Inicial">{fmt(l.inicial)}</td><td data-label="Entradas" className="rp-col-entrada">+{fmt(l.entradas)}</td><td data-label="Salidas" className="rp-col-salida">−{fmt(l.salidas)}</td><td data-label="Ajustes" className="rp-col-ajuste">{fmt(l.ajustes)}</td><td data-label="Sistema al corte">{fmt(l.sistema)}<small>{equivalenciaReporte(l.sistema, l)}</small></td><td data-label="Fuera de turno">{l.fuera_turno || '—'}</td></tr>;
        })}</tbody></table></div>
        {!items.length && <p className="rp-empty">{data.items.length ? 'No hay productos para esta búsqueda.' : 'No hay movimientos registrados para esta fecha.'}</p>}
        <details className="rp-card rp-outside-hours"><summary>Actividad fuera de horario · {data.fuera_turno.length} registro(s)</summary><p className="rp-help">Antes de 07:30, entre 12:30 y 14:30 o desde 21:30. No se asigna automáticamente a un turno.</p><div className="rp-table-wrap"><table><thead><tr><th>Hora</th><th>Ítem</th><th>Cantidad</th><th>Referencia</th><th>Registrado por</th></tr></thead><tbody>{data.fuera_turno.map(m => <tr key={m.id}><td>{fechaHoraReporte(m.creado_en)}</td><td>{m.nombre}</td><td>{fmt(m.cantidad)}</td><td>{m.referencia}</td><td>{m.autor || m.creado_por || 'Sin autor registrado'}</td></tr>)}</tbody></table></div>{!data.fuera_turno.length && <p className="rp-empty">Sin movimientos fuera de horario.</p>}</details>
      </div>
      {seleccion && <MovimientosDia key={`${seleccion.producto_id}:${seleccion.ubicacion_id}`} linea={seleccion} fecha={fecha} hasta={data.hasta} sucursalId={sucursalId} onCerrar={cerrar} presentar={presentar} mostrarCerrar={false} autoScroll={false} />}
    </div>
  </section>;
}
