import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { operarEvidenciaOperacion } from './lib/evidenciaOperacion';

const estados = { PENDIENTE: 'Pendiente de envío a Telegram', ENVIANDO: 'Enviando a Telegram', ENVIADO: 'Enviado a Telegram', ERROR: 'No se pudo enviar a Telegram', INCIERTO: 'Hay que comprobar el envío en Telegram' };
export default function EvidenciaOperacion({ tipo, documentoId, entregaId, version, revision, fotos, onFotos, onDatos, busy }) {
  const [datos, setDatos] = useState(null), [error, setError] = useState(''), [actualizar, setActualizar] = useState(0), [reintentando, setReintentando] = useState(false);
  useEffect(() => {
    let vigente = true, timer;
    async function cargar() {
      try {
        const r = await operarEvidenciaOperacion(supabase, { tipo, documentoId, entregaId });
        if (!vigente) return;
        setDatos(r); setError(''); onDatos(r);
        if (r.envios.some(e => ['PENDIENTE','ENVIANDO'].includes(e.estado))) timer = setTimeout(cargar, 15000);
      } catch (e) {
        if (!vigente) return;
        if (e.code === 'PGRST202') { onDatos({ activo: false }); return; }
        setError('No se pudo consultar la evidencia. Actualiza antes de confirmar.'); onDatos(null); timer = setTimeout(cargar, 30000);
      }
    }
    cargar();
    const refrescar = () => { clearTimeout(timer); cargar(); };
    window.addEventListener('focus', refrescar);
    return () => { vigente = false; clearTimeout(timer); window.removeEventListener('focus', refrescar); };
  }, [tipo, documentoId, entregaId, version, revision, actualizar, onDatos]);
  function agregar(event) {
    const nuevas = Array.from(event.target.files || []); event.target.value = '';
    if (fotos.length + nuevas.length > 10) { setError('Puedes adjuntar hasta 10 fotos.'); return; }
    if (nuevas.some(f => !['image/jpeg','image/png','image/webp'].includes(f.type) || f.size > 20 * 1024 * 1024)) { setError('Usa fotos JPEG, PNG o WebP de hasta 20 MB.'); return; }
    onFotos([...fotos, ...nuevas]); setError('');
  }
  async function reintentar(id) {
    setReintentando(true); setError('');
    try { await operarEvidenciaOperacion(supabase, { tipo, documentoId, entregaId, accion: 'reintentar', datos: { id } }); setActualizar(n => n + 1); }
    catch (e) { setError(e.message); }
    finally { setReintentando(false); }
  }
  if (datos && !datos.activo && !datos.envios.length && !error) return null;
  return <section className="om-pedido om-evidencia">
    <h3>{tipo==='traslado'?(datos?.contexto?.etapa==='PREPARACION'?'Fotos del alistado':'Fotos de la entrega y recepción'):tipo === 'pedido' ? datos?.contexto?.dos_actores && !datos.contexto.puede_capturar?'Evidencias de esta entrega':datos?.contexto?.etapa==='PREPARACION'?'Fotos del alistado':'Fotos del retiro del pedido' : 'Fotos del traslado'}</h3>
    {datos?.activo && datos.contexto.puede_capturar && <>
      <p>Adjunta entre 1 y 10 fotos del material. Se enviarán al tema {tipo==='traslado'?(datos.contexto.etapa==='PREPARACION'?'Traslados al terminar el alistado':'Traslados al confirmar la entrega y recepción'):tipo === 'pedido' ? datos.contexto.etapa==='PREPARACION'?'Pedidos al enviar a verificación':'Pedidos al confirmar el retiro' : 'Traslados al autorizar la salida'}.</p>
      <label>Tomar foto<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={agregar} /></label>
      <label>Elegir fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={agregar} /></label>
      <p aria-live="polite">{fotos.length} de 10 fotos seleccionadas</p>
      <div className="om-evidencia-fotos">{fotos.map((foto,i) => <Foto key={`${i}:${foto.name}`} foto={foto} indice={i} busy={busy} onQuitar={() => onFotos(fotos.filter((_,index) => index!==i))} />)}</div>
    </>}
    {datos?.envios.map(e => <div className="om-evidencia-estado" key={e.id}><strong>{e.etapa==='PREPARACION'?'📦 Alistado · ':e.etapa==='SALIDA'?'🚚 Salida · ':''}{estados[e.estado]}</strong><p>{e.cantidad} foto(s)</p>
      {e.enlace && <a href={e.enlace} target="_blank" rel="noreferrer">Ver evidencia en Telegram</a>}
      {e.estado === 'ERROR' && <><p>{e.error}</p><button disabled={busy || reintentando} onClick={() => reintentar(e.id)}>Reintentar envío de fotos</button></>}
      {e.estado === 'INCIERTO' && <p>Un administrador debe comprobar si el álbum se publicó antes de reintentarlo.</p>}
      {e.eliminado_en && <p>La copia temporal ya se eliminó.</p>}
    </div>)}
    {error && <p role="alert" className="om-aviso om-error">{error}</p>}
  </section>;
}
function Foto({ foto, indice, busy, onQuitar }) {
  const [url,setUrl] = useState('');
  useEffect(() => { const next=URL.createObjectURL(foto); setUrl(next); return () => URL.revokeObjectURL(next); }, [foto]); // eslint-disable-line react-hooks/set-state-in-effect
  return <figure><img src={url} alt={`Evidencia ${indice+1}`} /><button disabled={busy} onClick={onQuitar}>Quitar foto {indice+1}</button></figure>;
}
