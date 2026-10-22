import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabaseClient';
import EvidenciaVtd from './EvidenciaVtd';
import { subirEvidenciaVtd } from './lib/evidenciaVtd';

const nombres = { SOLICITADO: 'Pendiente de verificar', EN_CAJA: 'Material enviado a Caja', ENTREGADO: 'Entrega confirmada por Caja', RETORNO_PENDIENTE: 'Material en retorno a Almacén', RETORNADO: 'Retorno recibido', CANCELADO: 'Solicitud cancelada antes de salir' };

export default function VtdCajaAlmacen({ registro, ventaId, onChanged }) {
  const entrega = registro.vtds.find(v => String(v.venta_id) === String(ventaId));
  const [cantidades, setCantidades] = useState({});
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fotos, setFotos] = useState([]);
  const [evidenciaActiva, setEvidenciaActiva] = useState(null);
  const [reportando, setReportando] = useState(false);
  const [disponibles, setDisponibles] = useState({});
  const [motivoFaltante, setMotivoFaltante] = useState('');
  const [revisionEvidencia, setRevisionEvidencia] = useState(0);
  const lote = useRef(null), bloqueado = useRef(false);
  if (!entrega) return <p role="alert">La entrega ya no está disponible. Vuelve a consultar la operación.</p>;
  const lineas = entrega.lineas || [];
  const retorno = entrega.estado === 'RETORNO_PENDIENTE';
  const editable = retorno || entrega.estado === 'SOLICITADO';
  // Caja debe ajustar la VTD antes de que se despachen las cantidades viejas.
  const faltante = entrega.estado === 'SOLICITADO' && Array.isArray(entrega.faltante) && entrega.faltante.length > 0;
  const disponible = l => disponibles[l.linea_id] ?? String(l.cantidad_presentacion);
  const faltanteValido = lineas.length > 0 && lineas.every(l => { const n = Number(disponible(l)); return disponible(l) !== '' && Number.isFinite(n) && n >= 0 && n <= Number(l.cantidad_presentacion); })
    && lineas.some(l => Number(disponible(l)) < Number(l.cantidad_presentacion)) && motivoFaltante.trim().length >= 5;
  const completa = lineas.length > 0 && lineas.every(l => cantidades[l.linea_id] !== undefined && cantidades[l.linea_id] !== '' && Number(cantidades[l.linea_id]) === Number(l.cantidad_base));
  async function guardar(accion) {
    if (bloqueado.current) return;
    if (accion === 'enviar' && (evidenciaActiva === null || (evidenciaActiva && !fotos.length))) { setError('Adjunta al menos una foto y espera a que se compruebe la evidencia.'); return; }
    bloqueado.current = true;
    setBusy(true); setError('');
    try {
      if (accion === 'enviar' && lote.current?.rpcIntentado) {
        const actual = await supabase.rpc('operar_caja_almacen', { p_accion: 'consultar_vtd', p_datos: { venta_id: Number(ventaId) } });
        if (actual.error) throw new Error('No se pudo comprobar la salida anterior. Actualiza antes de reintentar.');
        if (['EN_CAJA', 'ENTREGADO'].includes(actual.data?.vtds?.find(v => String(v.venta_id) === String(ventaId))?.estado)) {
          onChanged(actual.data); setFotos([]); lote.current = null; setRevisionEvidencia(n => n + 1); return;
        }
      }
      let evidenciaId;
      if (accion === 'enviar' && evidenciaActiva) {
        if (!lote.current || lote.current.version !== entrega.version) lote.current = { id: crypto.randomUUID(), version: entrega.version };
        evidenciaId = await subirEvidenciaVtd(supabase, ventaId, entrega.version, lote.current.id, fotos);
      }
      if (evidenciaId) lote.current.rpcIntentado = true;
      const { data, error: fallo } = await supabase.rpc('operar_caja_almacen', {
        p_accion: accion, p_operacion_id: null, p_sesion_id: null,
        p_datos: { venta_id: Number(ventaId), version: entrega.version, motivo: motivo.trim(), cantidades: lineas.map(l => ({ linea_id: l.linea_id, cantidad_base: Number(cantidades[l.linea_id]) })).sort((a,b) => a.linea_id-b.linea_id), ...(evidenciaId ? { evidencia_id: evidenciaId } : {}) },
      });
      if (fallo) throw new Error(fallo.message);
      if (!data?.operacion) throw new Error('No se pudo comprobar el resultado. Actualiza y consulta antes de reintentar.');
      onChanged(data); setCantidades({}); setMotivo(''); setFotos([]); lote.current = null; setRevisionEvidencia(n => n + 1);
    } catch (e) { setError(e.message || 'No se pudo guardar la entrega.'); }
    finally { setBusy(false); bloqueado.current = false; }
  }
  async function reportarFaltante() {
    if (bloqueado.current || !faltanteValido) return;
    bloqueado.current = true;
    setBusy(true); setError('');
    try {
      const { data, error: fallo } = await supabase.rpc('operar_caja_almacen', {
        p_accion: 'reportar_faltante', p_operacion_id: null, p_sesion_id: null,
        p_datos: { venta_id: Number(ventaId), version: entrega.version, motivo: motivoFaltante.trim(), disponibles: lineas.map(l => ({ linea_id: l.linea_id, cantidad_presentacion: Number(disponible(l)) })).sort((a, b) => a.linea_id - b.linea_id) },
      });
      if (fallo) throw new Error(fallo.message);
      if (!data?.operacion) throw new Error('No se pudo comprobar el reporte. Actualiza y consulta antes de reintentar.');
      onChanged(data); setReportando(false); setDisponibles({}); setMotivoFaltante('');
    } catch (e) { setError(e.message || 'No se pudo reportar el faltante.'); }
    finally { setBusy(false); bloqueado.current = false; }
  }
  async function actualizar() {
    if (bloqueado.current) return;
    bloqueado.current = true;
    setBusy(true); setError('');
    try {
      const { data, error: fallo } = await supabase.rpc('operar_caja_almacen', { p_accion: 'consultar_vtd', p_operacion_id: null, p_sesion_id: null, p_datos: { venta_id: Number(ventaId) } });
      if (fallo || !data?.operacion) throw new Error(fallo?.message || 'No se pudo actualizar la entrega.');
      onChanged(data);
    } catch (e) { setError(e.message || 'No se pudo actualizar la entrega.'); }
    finally { setBusy(false); bloqueado.current = false; }
  }
  return <>
    <Link className="om-text-link" to="/operaciones">Volver a Operaciones</Link>
    <section className="om-pedido"><h2>{entrega.numero}</h2><strong>{nombres[entrega.estado]}</strong><p>{entrega.cliente || 'Cliente de mostrador'}</p>
      <p>Un único encargado verifica y envía el material a Caja. El cajero cobra el conjunto con la VTA y confirma la entrega al cliente.</p>
      {retorno && <p className="om-aviso">El rechazo no repuso el stock. Comprueba el material que realmente regresó antes de registrar su recepción.</p>}
      {entrega.motivo && <p className="om-aviso">Motivo: {entrega.motivo}</p>}
      {entrega.escaneado_en && <p className="om-muted">Documento escaneado: {new Date(entrega.escaneado_en).toLocaleString('es-BO')}</p>}
    </section>
    <div className="om-lineas">{lineas.map(l => <article className="om-linea" key={l.linea_id}><h3>{l.nombre}</h3><p>{l.cantidad_presentacion} {l.presentacion} · {l.cantidad_base} unidades base</p>
      {editable && <label>Cantidad base {retorno ? 'recibida' : 'verificada'}<input aria-label={`Cantidad ${retorno ? 'recibida' : 'verificada'} de ${l.nombre}`} type="number" min="0" step="any" value={cantidades[l.linea_id] ?? ''} disabled={busy} onChange={e => setCantidades(prev => ({ ...prev, [l.linea_id]: e.target.value }))} /></label>}
    </article>)}</div>
    <EvidenciaVtd ventaId={ventaId} estadoEntrega={entrega.estado} busy={busy} fotos={fotos} onFotos={next => { setFotos(next); lote.current = null; }} onConfiguracion={setEvidenciaActiva} revision={revisionEvidencia} />
    {editable && <section className="om-pedido">
      {!retorno && !entrega.escaneado_en && <label>Motivo de verificación sin escaneo<textarea maxLength={1000} value={motivo} disabled={busy} onChange={e => setMotivo(e.target.value)} placeholder="Explica por qué se regulariza ahora; se guardará la hora real." /></label>}
      {faltante ? <div className="om-aviso" role="status"><div><strong>Faltante reportado — esperando ajuste de Caja</strong>
        <p>{entrega.faltante.map(f => { const l = lineas.find(x => x.linea_id === f.linea_id); return l ? `${l.nombre}: ${f.cantidad_presentacion_disponible} de ${l.cantidad_presentacion}` : null; }).filter(Boolean).join(' · ')}</p>
        <button className="om-secondary" disabled={busy} onClick={actualizar}>Actualizar</button></div></div>
        : <p>Comprueba cada cantidad. Si hay diferencias, reporta el faltante y Caja ajustará la VTD.</p>}
      {!retorno && !faltante && (reportando
        ? <div className="om-editor"><strong>Cantidad disponible en Almacén</strong>
          {lineas.map(l => <label key={l.linea_id}>{l.nombre} (pedido: {l.cantidad_presentacion} {l.presentacion})
            <input aria-label={`Disponible de ${l.nombre}`} type="number" min="0" max={l.cantidad_presentacion} step="any" value={disponible(l)} disabled={busy} onChange={e => setDisponibles(prev => ({ ...prev, [l.linea_id]: e.target.value }))} /></label>)}
          <label>Motivo del faltante<textarea maxLength={1000} value={motivoFaltante} disabled={busy} onChange={e => setMotivoFaltante(e.target.value)} placeholder="Qué falta y por qué (mínimo 5 caracteres)." /></label>
          <div className="om-linea-actions"><button className="om-secondary" disabled={busy} onClick={() => setReportando(false)}>Cancelar</button>
            <button className="om-secondary" disabled={busy || !faltanteValido} onClick={reportarFaltante}>Enviar reporte a Caja</button></div></div>
        : <button className="om-secondary om-wide" disabled={busy} onClick={() => setReportando(true)}>Reportar faltante</button>)}
      <button className="om-primary om-wide" disabled={busy || faltante || !completa || (!retorno && (evidenciaActiva === null || (evidenciaActiva && !fotos.length))) || (!retorno && !entrega.escaneado_en && motivo.trim().length < 5)} onClick={() => guardar(retorno ? 'recibir_retorno' : 'enviar')}>{busy ? 'Guardando fotos y salida…' : retorno ? 'Confirmar recepción del retorno' : 'Verificar y enviar a Caja'}</button>
    </section>}
    {entrega.estado === 'EN_CAJA' && <p className="om-aviso om-exito">Salida registrada una sola vez. Falta que Caja complete o resuelva el rechazo de la operación.</p>}
    {error && <p className="om-aviso om-error" role="alert">{error}</p>}
  </>;
}
