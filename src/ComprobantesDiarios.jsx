import { useEffect, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { movimientosComprobantesDia } from './lib/reportesAlmacen';
import { agruparComprobantes, TIPOS_COMPROBANTE } from './lib/comprobantesAlmacen';
import { fechaHoraReporte, fmtReporte as fmt } from './lib/reporteTurno';

export default function ComprobantesDiarios({ fecha, hasta, sucursalId }) {
  const [estado, setEstado] = useState({ cargando: true });
  const [revision, setRevision] = useState(0);
  const [filtros, setFiltros] = useState({ periodo: 'dia', tipo: '', busqueda: '' });
  useEffect(() => {
    let vigente = true;
    movimientosComprobantesDia({ fecha, hasta, sucursalId })
      .then(data => { if (vigente) setEstado({ ...data, cargando: false }); })
      .catch(e => { if (vigente) setEstado({ error: e.message || 'No se pudieron consultar los comprobantes.', cargando: false }); });
    return () => { vigente = false; };
  }, [fecha, hasta, sucursalId, revision]);
  const cambiar = (campo, valor) => setFiltros(prev => ({ ...prev, [campo]: valor }));
  if (estado.cargando) return <p role="status">Cargando comprobantes del día…</p>;
  if (estado.error) return <div className="rp-card" role="alert"><p className="rp-alert is-error">{estado.error}</p><button type="button" onClick={() => { setEstado({ cargando: true }); setRevision(v => v + 1); }}>Reintentar comprobantes</button></div>;
  const grupos = agruparComprobantes(estado.items, filtros);
  const tipos = [...new Set(estado.items.map(m => m.comprobante.tipo))];
  return <section className="rp-documents" aria-label="Comprobantes del día">
    <p className="rp-help">Comprobantes con entradas, salidas o ajustes de existencias registrados en este día y sucursal. Abre cada comprobante para revisar sus productos y ubicaciones.</p>
    <div className="rp-tools rp-document-filters">
      <label className="rp-daily-search"><span><Search size={16} aria-hidden="true" />Buscar comprobante o producto</span><input value={filtros.busqueda} onChange={e => cambiar('busqueda', e.target.value)} placeholder="Número, producto, ubicación o responsable" maxLength={150} /></label>
      <label>Periodo<select aria-label="Periodo de comprobantes" value={filtros.periodo} onChange={e => cambiar('periodo', e.target.value)}><option value="dia">Día completo</option><option value="MANANA">Mañana · 07:30–12:30</option><option value="TARDE">Tarde · 14:30–21:30</option><option value="fuera">Fuera de horario</option></select></label>
      <label>Tipo de comprobante<select aria-label="Tipo de comprobante" value={filtros.tipo} onChange={e => cambiar('tipo', e.target.value)}><option value="">Todos los comprobantes</option>{tipos.map(t => <option key={t} value={t}>{TIPOS_COMPROBANTE[t] || t}</option>)}</select></label>
    </div>
    {estado.incompleto && <p className="rp-alert" role="status">Consulta incompleta: se cargaron {estado.items.length} movimientos{estado.total != null ? ` de ${estado.total}` : ''}. Algunos comprobantes pueden tener líneas pendientes de cargar. Los filtros y contadores solo incluyen los registros cargados.</p>}
    <p className="rp-help" role="status">{grupos.length} comprobante(s) · {grupos.reduce((n, g) => n + g.items.length, 0)} movimiento(s) en esta selección. Horas de Bolivia.</p>
    <div className="rp-document-list">{grupos.map(g => <details className="rp-card rp-document" key={g.clave}>
      <summary><span className="rp-document-title"><FileText size={19} aria-hidden="true" /><strong>{g.numero}</strong><span className="rp-badge">{TIPOS_COMPROBANTE[g.tipo] || g.tipo}</span></span><span className="rp-document-meta">{fechaHoraReporte(g.creado_en)} · {new Set(g.items.map(m => m.producto_id)).size} producto(s) · {g.items.length} movimiento(s)</span><span className="rp-document-authors">{[...new Set(g.items.map(m => m.autor))].join(' · ')}</span></summary>
      <div className="rp-table-wrap"><table className="rp-document-lines"><thead><tr><th>Hora / movimiento</th><th>Producto / ubicación</th><th>Cantidad</th><th>Referencia / responsable</th></tr></thead><tbody>{g.items.map(m => <tr key={m.id} data-movimiento={m.tipo_movimiento}>
        <td>{fechaHoraReporte(m.creado_en)}<small>{({ TRASLADO: Number(m.cantidad) < 0 ? 'Traslado de salida' : 'Traslado de entrada', ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste', INV_INICIAL: 'Inventario inicial' })[m.tipo_movimiento] || m.tipo_movimiento}</small></td>
        <td><strong>{m.nombre}</strong><small>{m.sku || `Producto #${m.producto_id}`} · {m.ubicacion}</small></td>
        <td className="rp-movement-amount">{Number(m.cantidad) > 0 ? '+' : ''}{fmt(m.cantidad)} {m.unidad}</td>
        <td>{m.referencia || 'Sin referencia'}<small>{m.autor}</small>{m.motivo && <small>{m.motivo}</small>}</td>
      </tr>)}</tbody></table></div>
    </details>)}</div>
    {!grupos.length && <p className="rp-empty">{estado.items.length ? 'No hay comprobantes para estos filtros.' : estado.incompleto ? 'No se recibieron líneas de comprobantes. Actualiza el reporte para reintentar la consulta.' : 'No hay comprobantes con movimientos de existencias para esta fecha.'}</p>}
  </section>;
}
