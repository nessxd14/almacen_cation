import { useEffect, useRef, useState } from 'react';
import { operarEvidenciaVtd, MAX_FOTOS_VTD } from './lib/evidenciaVtd';
import { supabase } from './supabaseClient';

const estados = { PENDIENTE: 'Pendiente de envío a Telegram', ENVIANDO: 'Enviando a Telegram', ENVIADO: 'Enviado a Telegram', ERROR: 'No se pudo enviar a Telegram', INCIERTO: 'Hay que comprobar el envío en Telegram' };

export default function EvidenciaVtd({ ventaId, estadoEntrega, busy, fotos, onFotos, onConfiguracion, revision = 0 }) {
  const [datos, setDatos] = useState(null), [error, setError] = useState(''), [reintentando, setReintentando] = useState(false);
  const [actualizacion, setActualizacion] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    let vigente = true, timer;
    async function cargar() {
      try {
        const result = await operarEvidenciaVtd(supabase, 'consultar', ventaId);
        if (vigente) {
          setDatos(result); setError(''); onConfiguracion(result.activo);
          if (result.envios?.some(e => ['PENDIENTE', 'ENVIANDO'].includes(e.estado))) timer = setTimeout(cargar, 15000);
        }
      } catch { if (vigente) { setError('No se pudo consultar la evidencia. Actualiza antes de enviar.'); onConfiguracion(null); timer = setTimeout(cargar, 30000); } }
    }
    cargar();
    const refrescar = () => { clearTimeout(timer); cargar(); };
    window.addEventListener('focus', refrescar);
    return () => { vigente = false; clearTimeout(timer); window.removeEventListener('focus', refrescar); };
  }, [ventaId, estadoEntrega, revision, onConfiguracion, actualizacion]);
  function agregar(event) {
    const nuevas = Array.from(event.target.files || []);
    event.target.value = '';
    if (fotos.length + nuevas.length > MAX_FOTOS_VTD) { setError('Puedes adjuntar hasta 10 fotos.'); return; }
    if (nuevas.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 20 * 1024 * 1024)) { setError('Usa fotos JPEG, PNG o WebP de hasta 20 MB.'); return; }
    onFotos([...fotos, ...nuevas]); setError('');
  }
  async function reintentar(id) {
    setReintentando(true); setError('');
    try { setDatos(await operarEvidenciaVtd(supabase, 'reintentar', ventaId, { id })); setActualizacion(n => n + 1); }
    catch (e) { setError(e.message); }
    finally { setReintentando(false); }
  }
  return <section className="om-pedido om-evidencia">
    <h3>Fotos de la salida</h3>
    {datos?.activo && estadoEntrega === 'SOLICITADO' && <>
      <p>Adjunta al menos una foto del material que envías a Caja. Se enviará al tema VTD de Telegram al registrar la salida.</p>
      <label>Tomar foto<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={agregar} /></label>
      <label>Elegir fotos<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={agregar} /></label>
      <p aria-live="polite">{fotos.length} de {MAX_FOTOS_VTD} fotos seleccionadas</p>
      <div className="om-evidencia-fotos">{fotos.map((foto, i) => <Foto key={`${i}:${foto.name}`} foto={foto} indice={i} busy={busy} onQuitar={() => onFotos(fotos.filter((_, index) => index !== i))} />)}</div>
    </>}
    {datos && !datos.activo && <p>El envío de evidencias a Telegram está pendiente de activación.</p>}
    {datos?.envios?.map(e => <div key={e.id} className="om-evidencia-estado">
      <strong>{estados[e.estado]}</strong><p>{e.cantidad} foto(s) · Salida de Almacén hacia Caja</p>
      {e.enlace && <a href={e.enlace} target="_blank" rel="noreferrer">Ver evidencia en Telegram</a>}
      {e.estado === 'ERROR' && <><p>{e.error}</p><button disabled={reintentando || busy} onClick={() => reintentar(e.id)}>Reintentar envío de fotos</button></>}
      {e.estado === 'INCIERTO' && <p>Revisa el tema VTD. No repetimos automáticamente un envío cuya respuesta se perdió. Un administrador debe resolverlo.</p>}
      {e.eliminado_en && <p>La copia temporal ya se eliminó de Supabase.</p>}
    </div>)}
    {error && <p role="alert" className="om-aviso om-error">{error}</p>}
  </section>;
}

function Foto({ foto, indice, busy, onQuitar }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(foto); setUrl(next); return () => URL.revokeObjectURL(next); }, [foto]); // eslint-disable-line react-hooks/set-state-in-effect
  return <figure><img src={url} alt={`Evidencia ${indice + 1}`} /><button type="button" disabled={busy} onClick={onQuitar}>Quitar foto {indice + 1}</button></figure>;
}
