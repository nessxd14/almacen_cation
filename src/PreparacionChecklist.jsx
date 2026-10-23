import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, AlertTriangle, Package, ScanLine, Search, X, MapPin, MinusCircle } from 'lucide-react';
import { cantidadOperacion, cantidadTexto } from './lib/operacionesMovil';
import { coincideLineaPreparacion, estadoPreparacion, resumenChecklist, revisionCompleta } from './lib/preparacionUI';
import { etiquetaUbicacion } from './lib/ubicacionTexto';
import CantidadPedido from './CantidadPedido';
import AbastecimientoLinea from './AbastecimientoLinea';

const unidad = s => s.presentacion || s.unidad_base;
const factor = s => Number(s.factor) > 0 ? Number(s.factor) : 1;
const cantidad = (n, s) => `${cantidadTexto(Number(n) / factor(s))} ${unidad(s)}`;
const etiquetas = { pendiente: 'Sin alistar', completo: 'Completo', faltante: 'Con faltante', no_alistado: 'No alistado' };

export function EtapasEntrega({ estado, entregada }) {
  const paso = entregada || ['DESPACHADO', 'EN_TRANSITO', 'RECIBIDO'].includes(estado) ? 3 : estado === 'VERIFICADO' ? 2 : ['PREPARADO', 'REVISANDO'].includes(estado) ? 1 : 0;
  return <ol className="om-etapas" aria-label="Etapas de la entrega">{['Alistar', 'Verificar', 'Despachar'].map((nombre, i) => <li key={nombre} className={i < paso ? 'is-done' : i === paso ? 'is-current' : ''} aria-current={i === paso ? 'step' : undefined}><span>{i < paso ? <Check size={14} /> : i + 1}</span>{nombre}</li>)}</ol>;
}

export default function PreparacionChecklist({ lineas, tipo, tarea, puedePreparar, puedeRevisar, ocupado, editor, setEditor, accion, abrirScanner, ubicaciones, ubicacionesListas, errorUbicaciones, sucursalId, esAlmacen, dosActores = false, abastecimiento = false, sucursales = [], onComprobante, fotosCantidad = 0, compacta = false }) {
  const [filtro, setFiltro] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const r = resumenChecklist(lineas, dosActores);
  const revision = ['PREPARADO', 'REVISANDO', 'VERIFICADO'].includes(tarea?.estado);
  const filtros = revision
    ? [['todas', 'Todos', r.total], ['por_revisar', 'Por verificar', r.por_revisar], ['revisado', 'Verificados', r.revisado], ['faltante', 'Con faltante', r.faltante], ['no_alistado', dosActores?'Sin salida':'No alistados', r.no_alistado]]
    : [['todas', 'Todos', r.total], ['pendiente', 'Sin alistar', r.pendiente], ['completo', 'Completos', r.completo], ['faltante', 'Con faltante', r.faltante], ['no_alistado', 'No alistados', r.no_alistado]];
  const visibles = lineas.filter(l => coincideLineaPreparacion(l, filtro, busqueda, dosActores));
  const hechas = revision ? r.revisado : r.total - r.pendiente;
  const total = revision ? r.revisado + r.por_revisar : r.total;
  return <section className={`om-checklist${compacta?' om-checklist-compacta':''}`} aria-label="Checklist de productos">
    <div className="om-checklist-heading"><div><small className="om-eyebrow">{revision ? 'CONTROL DE ENTREGA' : 'MESA DE PREPARACIÓN'}</small><h2>{revision ? 'Verifica lo alistado' : 'Alista producto por producto'}</h2><p>{revision ? 'Comprueba el producto y cuenta la cantidad que tienes delante.' : 'Marca lo completo y registra lo que falta o no se alistó.'}</p></div><span className="om-count">{r.total} ítems</span></div>
    {tarea && <div className="om-checklist-progress"><div><strong>{hechas} de {total}</strong><span>{revision ? 'líneas verificadas' : 'líneas registradas'}</span><span className="om-progress-remaining">{revision ? r.por_revisar : r.pendiente} pendientes</span></div><progress aria-label={revision ? 'Avance de verificación' : 'Avance de alistado'} max={total || 1} value={hechas} /></div>}
    <div className="om-checklist-tools"><label className="om-search"><Search size={18} /><span className="sr-only">Buscar producto en la preparación</span><input value={busqueda} disabled={Boolean(editor)} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto o SKU…" />{busqueda && <button type="button" aria-label="Limpiar búsqueda de productos" disabled={Boolean(editor)} onClick={() => setBusqueda('')}><X size={17} /></button>}</label><div className="om-filters" aria-label="Filtrar productos">{filtros.map(([id, nombre, n]) => <button key={id} aria-pressed={filtro === id} disabled={Boolean(editor)} onClick={() => setFiltro(id)}>{nombre}<span>{n}</span></button>)}</div></div>
    <p className="om-results" role="status">{visibles.length} de {r.total} productos{r.faltante + r.no_alistado > 0 && <span><AlertTriangle size={13} /> {r.faltante + r.no_alistado} con cantidades pendientes</span>}</p>
    {!visibles.length && <div className="om-empty-filter"><Package size={28} /><strong>{lineas.length ? 'No hay productos en esta vista' : 'No hay líneas pendientes en esta sucursal'}</strong>{lineas.length > 0 && <button className="om-secondary" onClick={() => { setBusqueda(''); setFiltro('todas'); }}>Ver todos los productos</button>}</div>}
    <div className="om-lineas">{lineas.map((l, index) => {
      const s = l.snapshot;
      const estado = estadoPreparacion(l, dosActores);
      const revisada = revisionCompleta(l, dosActores);
      const faltante = l.confirmada ? Math.max(0, Number(s.pendiente_base) - Number(dosActores && l.revisada_base!=null ? l.revisada_base : l.preparada_base)) : null;
      return <article hidden={!visibles.includes(l)} className={`om-linea om-linea-${estado} ${revisada ? 'om-linea-ok' : ''}`} key={l.pedido_linea_id} aria-label={`${s.nombre}: ${etiquetas[estado]}`}>
        <div className="om-linea-title"><span className="om-item-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{s.nombre}</h3><small>{s.sku || (s.es_personalizado ? 'Producto personalizado' : 'Sin SKU')}{s.presentacion ? ` · ${s.presentacion}` : ''}</small></div><span className={`om-item-state om-state-${revisada ? 'revisado' : estado}`}>{revisada ? <CheckCircle2 size={14} /> : estado === 'faltante' ? <AlertTriangle size={14} /> : estado === 'no_alistado' ? <MinusCircle size={14} /> : null}{revisada ? 'Verificado' : etiquetas[estado]}</span></div>
        {s.presentacion && factor(s) !== 1 && <p className="om-equivalencia">1 {s.presentacion} = {cantidadTexto(factor(s))} {s.unidad_base}</p>}
        {s.nota && <p className="om-nota"><strong>Nota del pedido:</strong> {s.nota}</p>}
        {abastecimiento && l.confirmada && Number(l.revisada_base??l.preparada_base)===0 && <p className="om-pendiente-entrega">No sale en esta entrega · saldo pendiente con el mismo QR.</p>}{abastecimiento && <p className="om-acumulado">Solicitado en la línea: {cantidad(s.cantidad_base,s)} · Entregado antes: {cantidad(s.cantidad_despachada||0,s)}</p>}
        {s.es_personalizado && <p className="om-nota">Alista este personalizado y verifica su descripción y cantidad. No requiere código de barras; se incluyen fotos en ambas etapas de la entrega.</p>}
        <div className="om-cantidades"><div><small>{tipo === 'traslado_virtual' ? 'Declarado' : 'Por entregar'}</small><strong>{cantidad(s.pendiente_base, s)}</strong></div><div><small>Alistado</small><strong>{l.confirmada ? cantidad(l.preparada_base, s) : 'Sin confirmar'}</strong></div><div className={faltante > 0 ? 'om-quantity-missing' : ''}><small>Queda pendiente</small><strong>{faltante == null ? '—' : cantidad(faltante, s)}</strong></div></div>
        {s.ubicacion && <p className="om-origen"><strong>Retirado de:</strong> {s.ubicacion}</p>}
        {s.producto_id && esAlmacen && <div className="om-ubicaciones"><MapPin size={14} /><small>Ubicación</small>{!ubicacionesListas ? <span>Consultando…</span> : errorUbicaciones ? <span>No se pudo consultar</span> : ubicaciones[s.producto_id]?.length ? ubicaciones[s.producto_id].map(u => <Link key={u.id} to={`/ubicaciones/${u.id}/ficha?sucursal=${sucursalId}`}>{etiquetaUbicacion(u, { separador: ' · ' })}</Link>) : <span>Sin ubicación registrada</span>}<Link className="om-product-link" to={`/productos/${s.producto_id}/ficha?sucursal=${sucursalId}${s.presentacion_id ? `&presentacion=${s.presentacion_id}` : ''}`}>Ver ficha ↗</Link></div>}
        {!s.preparable && <p className="om-muted">{s.estado === 'POR_COMPRAR' ? 'Pendiente de compra: registra que no se alistó y el motivo.' : 'Resuelve el estado o la presentación en el pedido antes de alistar esta línea.'}</p>}
        {l.observacion && <p className="om-nota"><strong>Motivo / observación:</strong> {l.observacion}</p>}
        {revisada && <p className="om-muted">{l.revisor_nombre || 'Revisor'} comprobó por {l.metodo_revision === 'escaneo' ? 'escaneo' : 'revisión visual'}</p>}
        {dosActores && l.observacion_revision && l.revisada_base!=null && <p className="om-nota"><strong>Diferencia en revisión:</strong> {l.observacion_revision}</p>}
        {abastecimiento && <AbastecimientoLinea key={`origen:${l.pedido_linea_id}:${tarea?.version}`} linea={l} revision={revision} puedeEditar={puedePreparar||puedeRevisar} ocupado={ocupado} bloqueada={Boolean(editor&&(editor.lineaId!==l.pedido_linea_id||editor.intencion!=='abastecimiento'))} abierta={editor?.lineaId===l.pedido_linea_id&&editor.intencion==='abastecimiento'} onAbrir={()=>setEditor({lineaId:l.pedido_linea_id,tipo:puedePreparar?'preparacion':'revision',intencion:'abastecimiento'})} onCerrar={()=>setEditor(null)} onGuardar={accion} sucursales={sucursales} sucursalId={sucursalId} onComprobante={onComprobante} fotosCantidad={fotosCantidad}/>}
        {editor?.lineaId === l.pedido_linea_id && !['cantidad_rapida','abastecimiento'].includes(editor.intencion) ? <EditorLinea dosActores={dosActores} key={`${l.pedido_linea_id}:${editor.tipo}:${editor.intencion || ''}:${editor.codigo || ''}`} linea={l} editor={editor} ocupado={ocupado} onCancel={() => setEditor(null)} onGuardar={payload => accion(editor.tipo === 'preparacion' ? 'guardar_preparacion' : 'guardar_revision', payload)} /> : <>
          {dosActores && (puedePreparar || puedeRevisar && s.preparable) && <CantidadPedido key={`${l.pedido_linea_id}:${tarea.version}`} linea={l} revision={puedeRevisar} abastecimiento={abastecimiento} ocupado={ocupado||editor?.intencion==='abastecimiento'} bloqueada={Boolean(editor && editor.lineaId!==l.pedido_linea_id)}
            onEditar={()=>setEditor({lineaId:l.pedido_linea_id,tipo:puedePreparar?'preparacion':'revision',intencion:'cantidad_rapida'})} onCancelar={()=>setEditor(null)} onGuardar={payload=>accion(puedePreparar?'guardar_preparacion':'guardar_revision',payload)} />}
          <div className="om-linea-actions">
            {!dosActores && puedePreparar && <>{!l.confirmada && s.preparable && <button className="om-complete" disabled={ocupado || Boolean(editor)} onClick={() => accion('guardar_preparacion', { linea_id: l.pedido_linea_id, cantidad_base: Number(s.pendiente_base), observacion: l.observacion || '' })}><Check size={18} /> Completo</button>}<button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'preparacion', intencion: l.confirmada ? 'editar' : 'parcial' })}>{l.confirmada ? 'Editar preparación' : 'Registrar faltante'}</button>{!l.confirmada && <button className="om-not-picked" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'preparacion', intencion: 'ninguno' })}><MinusCircle size={16} /> No se alistó</button>}</>}
            {puedeRevisar && Number(l.preparada_base) > 0 && <>{!s.es_personalizado && <button className="om-primary" disabled={ocupado || Boolean(editor)} onClick={() => abrirScanner({ tipo: 'revision', lineaId: l.pedido_linea_id })}><ScanLine size={18} /> Escanear y contar</button>}{(!dosActores || s.es_personalizado) && <button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'revision', metodo: 'visual', codigo: '' })}>Comprobar visualmente</button>}{!s.es_personalizado && <button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'revision', metodo: 'escaneo', codigo: '' })}>Ingresar código</button>}</>}
          </div>
        </>}
      </article>;
    })}</div>
  </section>;
}

function EditorLinea({ linea, editor, ocupado, onCancel, onGuardar, dosActores = false }) {
  const s = linea.snapshot;
  const preparacion = editor.tipo === 'preparacion';
  const ninguno = editor.intencion === 'ninguno';
  const parcial = editor.intencion === 'parcial';
  const cantidadInicial = ninguno ? 0 : dosActores && !preparacion ? Number(linea.revisada_base ?? linea.preparada_base) : Number(linea.confirmada ? linea.preparada_base : s.preparable ? s.pendiente_base : 0);
  const iniciarEnBase = Math.abs(Math.round(cantidadInicial / factor(s) * 1e6) / 1e6 * factor(s) - cantidadInicial) > Number.EPSILON * Math.max(1, cantidadInicial) * 8;
  const [enBase, setEnBase] = useState(iniciarEnBase);
  const [valor, setValor] = useState(dosActores ? String(cantidadInicial / (iniciarEnBase ? 1 : factor(s))) : preparacion ? parcial ? '' : String(cantidadInicial / (iniciarEnBase ? 1 : factor(s))) : '');
  const [observacion, setObservacion] = useState(!preparacion && dosActores ? linea.observacion_revision || '' : linea.observacion || '');
  const [codigo, setCodigo] = useState(editor.codigo || '');
  const [error, setError] = useState('');
  const ingresado = Number(String(valor).replace(',', '.')) * (enBase ? 1 : factor(s));
  async function guardar(e) {
    e.preventDefault(); setError('');
    try {
      const n = cantidadOperacion(valor) * (enBase ? 1 : factor(s));
      const base = Math.round(n * 1e6) / 1e6;
      if (Math.abs(base - n) > Number.EPSILON * Math.max(1, n) * 8) throw new Error('La conversión debe dar una cantidad con hasta 6 decimales en unidades base.');
      if (preparacion && base > Number(s.pendiente_base)) throw new Error('La cantidad supera lo pendiente del pedido.');
      if (preparacion && base < Number(s.pendiente_base) && !observacion.trim()) throw new Error('Indica el motivo de la cantidad que queda pendiente.');
      if (!preparacion && !dosActores && base !== Number(linea.preparada_base)) throw new Error('La cantidad contada no coincide con la preparada. Reabre la preparación para corregirla.');
      if (!preparacion && dosActores && (base>Number(s.pendiente_base) || base!==Number(linea.preparada_base) && !observacion.trim())) throw new Error('Comprueba la cantidad solicitada e indica el motivo de la diferencia.');
      if (!preparacion && editor.metodo === 'escaneo' && !codigo.trim()) throw new Error('Ingresa o escanea el código de este producto.');
      const guardado = await onGuardar({ linea_id: linea.pedido_linea_id, cantidad_base: base, ...(preparacion ? { observacion: observacion.trim() } : { metodo: editor.metodo, codigo: codigo.trim(), ...(dosActores?{observacion:observacion.trim()}:{}) }) });
      if (guardado === false) setError('No se guardó la línea. Conservamos tus datos para que puedas reintentar.');
    } catch (e) { setError(e.message); }
  }
  return <form className="om-editor" onSubmit={guardar}>
    <strong>{preparacion ? ninguno ? 'Registrar producto no alistado' : parcial ? 'Registrar faltante de esta entrega' : 'Cantidad preparada para esta entrega' : 'Comprueba el producto, la presentación y cuenta lo preparado'}</strong>
    {!preparacion && editor.metodo === 'escaneo' && <label>Código leído<input value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="off" maxLength={2048} disabled={ocupado} /></label>}
    {factor(s) !== 1 && !ninguno && <label>Unidad de conteo<select value={enBase ? 'base' : 'presentacion'} disabled={ocupado} onChange={e => { const base = e.target.value === 'base'; setEnBase(base); setValor(valor === '' ? '' : String(Math.round(ingresado / (base ? 1 : factor(s)) * 1e6) / 1e6)); }}><option value="presentacion">{unidad(s)} · {cantidadTexto(factor(s))} {s.unidad_base}</option><option value="base">{s.unidad_base} (unidad base)</option></select></label>}
    {ninguno ? <p className="om-editor-missing">Se guardarán <strong>0 {s.unidad_base} alistadas</strong>. {cantidad(s.pendiente_base, s)} quedan pendientes.</p> : <label>{preparacion ? 'Preparado' : 'Cantidad contada'} en {enBase ? s.unidad_base : unidad(s)}<input autoFocus inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} required autoComplete="off" disabled={ocupado} /></label>}
    {preparacion && valor !== '' && Number.isFinite(ingresado) && ingresado >= 0 && ingresado <= Number(s.pendiente_base) && !ninguno && <p className="om-editor-missing">Quedarán pendientes: <strong>{cantidad(Math.max(0, Number(s.pendiente_base) - ingresado), s)}</strong></p>}
    {preparacion && <><label>Observación o motivo del faltante<textarea autoFocus={ninguno} maxLength={1000} value={observacion} onChange={e => setObservacion(e.target.value)} disabled={ocupado} placeholder="Explica qué quedó pendiente…" /></label><div className="om-reason-options" aria-label="Motivos frecuentes">{['Stock insuficiente', 'No se encontró', 'Pendiente de compra', 'No se alistó a tiempo'].map(m => <button type="button" disabled={ocupado} key={m} aria-pressed={observacion === m} onClick={() => setObservacion(m)}>{m}</button>)}</div></>}
    {!preparacion && <p className="om-muted">{s.es_personalizado ? 'Comprueba que el material corresponde a la descripción del pedido y cuenta lo que vas a retirar.' : 'Escanear identifica el producto. Confirma también su empaque y la cantidad que tienes delante.'}</p>}
    {!preparacion && dosActores && ingresado!==Number(linea.preparada_base) && <label>Motivo de la diferencia<input maxLength={1000} value={observacion} onChange={e=>setObservacion(e.target.value)} disabled={ocupado} required /></label>}
    {error && <p className="om-error-text" role="alert">{error}</p>}
    <div className="om-input-row"><button className="om-primary" disabled={ocupado}>{ocupado ? 'Guardando…' : preparacion ? 'Guardar preparación' : 'Guardar comprobación'}</button><button type="button" className="om-secondary" disabled={ocupado} onClick={onCancel}>Cancelar</button></div>
  </form>;
}
