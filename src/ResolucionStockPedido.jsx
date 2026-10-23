import {useRef,useState} from 'react';
import {Camera,LockKeyhole,Check,RefreshCw} from 'lucide-react';
import {operarConteo,dispositivoConteo,sincronizarCaptura} from './lib/conteoControlado';
import {cantidadOperacion,cantidadTexto} from './lib/operacionesMovil';
import {comprimirFotoVtd} from './lib/evidenciaVtd';

// Reutiliza el conteo controlado: foto, corte, reconteo, aprobación y aplicación.
// Ningún total se deduce de la cantidad del pedido.
export default function ResolucionStockPedido({linea,encargado,usuarioId,pedidoNumero,onActualizado,onOcupado}) {
  const ubicaciones=linea.stock_almacen||[];
  const [ubicacionId,setUbicacionId]=useState(String(ubicaciones[0]?.ubicacion_id||''));
  const [detalle,setDetalle]=useState(null),[cantidad,setCantidad]=useState(''),[motivo,setMotivo]=useState(''),[foto,setFoto]=useState(null);
  const [recontado,setRecontado]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[capturaIniciada,setCapturaIniciada]=useState(false);
  const solicitud=useRef(crypto.randomUUID()),captura=useRef(null),guardando=useRef(false);
  const ubicacion=ubicaciones.find(u=>String(u.ubicacion_id)===ubicacionId);
  async function ejecutar(fn){if(guardando.current)return;guardando.current=true;setBusy(true);onOcupado(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{guardando.current=false;setBusy(false);onOcupado(false);}}
  const abrir=()=>ejecutar(async()=>{
    let d=ubicacion.conteo_id?await operarConteo('detalle',ubicacion.conteo_id):await operarConteo('crear',null,{nombre:`Resolver despacho ${pedidoNumero}`,ubicacion_id:Number(ubicacionId),metodo:'SIMPLE',tipo:'VERIFICACION',alcance:'PARCIAL',producto_ids:[linea.snapshot.producto_id],solicitud:solicitud.current});
    setDetalle(d);
    if(d.sesion.estado==='CAPTURA'&&d.sesion.metodo==='SIMPLE'&&d.productos.length===1&&String(d.productos[0].producto_id)===String(linea.snapshot.producto_id)){
      const mia=d.rondas.find(r=>r.mia),otra=d.rondas.find(r=>!r.mia);
      if(!otra&&!mia){d=await operarConteo('tomar_ronda',d.sesion.id,{ronda:1,dispositivo:dispositivoConteo()});setDetalle(d);}
    }
    await onActualizado();
  });
  const guardar=event=>{event.preventDefault();void ejecutar(async()=>{
    const previas=detalle.capturas.filter(c=>!c.anulada);
    if(previas.length){const d=await operarConteo('finalizar_ronda',detalle.sesion.id,{dispositivo:dispositivoConteo(),confirmo_sin_pendientes:true,capturas:previas.map(c=>c.uuid)});setDetalle(d);return;}
    const n=cantidadOperacion(cantidad);
    if(n>=1e10||Math.round(n*1e4)/1e4!==n)throw new Error('Indica el total físico en unidades base, con hasta cuatro decimales.');
    if(!foto)throw new Error('Adjunta la foto de este conteo.');
    if(!['image/jpeg','image/png','image/webp'].includes(foto.type)||foto.size>20*1024*1024)throw new Error('Usa una foto JPEG, PNG o WebP de hasta 20 MB.');
    if(!ubicacion.presentacion_base_id)throw new Error('Falta una presentación base activa para registrar el conteo.');
    const uuid=captura.current?.uuid||crypto.randomUUID();
    if(!captura.current)captura.current={uuid,usuarioId,sesionId:detalle.sesion.id,foto:await comprimirFotoVtd(foto),datos:{uuid,dispositivo:dispositivoConteo(),presentacion_id:ubicacion.presentacion_base_id,cantidad:n,foto_ref:`sesion_${detalle.sesion.id}/${uuid}.jpg`}};
    setCapturaIniciada(true);
    let d=await sincronizarCaptura(captura.current);setDetalle(d);
    d=await operarConteo('finalizar_ronda',d.sesion.id,{dispositivo:dispositivoConteo(),confirmo_sin_pendientes:true,capturas:d.capturas.filter(c=>!c.anulada).map(c=>c.uuid)});setDetalle(d);
  });};
  const aplicar=event=>{event.preventDefault();void ejecutar(async()=>{
    const actual=await operarConteo('detalle',detalle.sesion.id);
    if(actual.sesion.estado==='APLICADA'){setDetalle(actual);await onActualizado();return;}
    if(actual.sesion.version!==detalle.sesion.version)throw new Error('El conteo cambió. Actualízalo y comprueba la revisión antes de aplicar.');
    if(!recontado||motivo.trim().length<5)throw new Error('Confirma el reconteo físico e indica un motivo de al menos cinco caracteres.');
    let d=await operarConteo('resolver',detalle.sesion.id,{version:detalle.sesion.version,producto_id:linea.snapshot.producto_id,cantidad_base:Number(detalle.productos[0].conteo_1),motivo:motivo.trim(),reconteo_confirmado:true});setDetalle(d);
    d=await operarConteo('aplicar',d.sesion.id,{version:d.sesion.version});setDetalle(d);await onActualizado();
  });};
  if(!encargado)return <p className="om-muted"><LockKeyhole size={16} aria-hidden="true"/> Un encargado debe comprobar y aplicar el conteo aquí con su propia cuenta. El origen sigue siendo Almacén.</p>;
  const compatible=detalle?.sesion.metodo==='SIMPLE'&&detalle.productos.length===1&&String(detalle.productos[0].producto_id)===String(linea.snapshot.producto_id);
  const mia=detalle?.rondas.find(r=>r.mia&&!r.finalizada&&r.dispositivo===dispositivoConteo());
  const capturada=detalle?.capturas.some(c=>!c.anulada);
  return <div className="om-resolver-stock">
    {!detalle?<><label>Ubicación física<select value={ubicacionId} disabled={busy} onChange={e=>{setUbicacionId(e.target.value);solicitud.current=crypto.randomUUID();}}><option value="">Seleccionar ubicación</option>{ubicaciones.map(u=><option key={u.ubicacion_id} value={u.ubicacion_id}>{u.nombre} · registrado {cantidadTexto(u.cantidad_base)}</option>)}</select></label><p className="om-muted">El conteo bloquea movimientos de esta ubicación hasta aplicarlo o cancelarlo. Se registra el total físico, incluido el material alistado.</p><button className="om-secondary" disabled={busy||!ubicacion} onClick={abrir}><LockKeyhole size={18}/> {ubicacion?.conteo_id?'Continuar conteo':'Iniciar conteo de esta ubicación'}</button></>:
      <><p>Conteo #{detalle.sesion.id} · {detalle.sesion.estado}</p>
      {!compatible?<p className="om-aviso">Esta ubicación ya tiene un conteo con más productos o dos rondas. Debe terminarse con su alcance original en Conteo físico.</p>:
      detalle.sesion.estado==='CAPTURA'&&mia?<form onSubmit={guardar}>{capturada?<p>La captura ya está guardada. Continúa con su revisión.</p>:<><label>Total físico en la ubicación · {linea.snapshot.unidad_base}<input aria-label="Total físico en la ubicación" inputMode="decimal" required value={cantidad} disabled={busy||capturaIniciada} onChange={e=>setCantidad(e.target.value)}/></label><label><Camera size={18}/> Foto del conteo<input aria-label="Foto del conteo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy||capturaIniciada} onChange={e=>setFoto(e.target.files?.[0]||null)}/></label></>}<button className="om-secondary" disabled={busy}><Check size={18}/> {capturada?'Continuar con la captura guardada':'Registrar y revisar conteo'}</button></form>:
      detalle.sesion.estado==='REVISION'?<form onSubmit={aplicar}><p>Registrado: {cantidadTexto(detalle.productos[0].teorico)} · Contado: <strong>{cantidadTexto(detalle.productos[0].conteo_1)} {linea.snapshot.unidad_base}</strong></p><label>Motivo de la resolución<input aria-label="Motivo del conteo" value={motivo} minLength={5} maxLength={1000} required disabled={busy} onChange={e=>setMotivo(e.target.value)}/></label><label className="om-checkbox"><input type="checkbox" checked={recontado} disabled={busy} onChange={e=>setRecontado(e.target.checked)}/> Confirmé el reconteo físico de esta diferencia.</label><button className="om-primary" disabled={busy}><Check size={18}/> Aplicar conteo y revalidar</button></form>:
      detalle.sesion.estado==='APLICADA'?<p role="status">Conteo aplicado. Se volvió a consultar el despacho.</p>:<p className="om-muted">La ronda está asignada a otra persona o dispositivo.</p>}
      {['CAPTURA','REVISION'].includes(detalle.sesion.estado)&&<><button className="om-secondary om-icon-action" title="Actualizar conteo" aria-label="Actualizar conteo" disabled={busy} onClick={()=>ejecutar(async()=>setDetalle(await operarConteo('detalle',detalle.sesion.id)))}><RefreshCw size={18}/></button><button className="om-secondary" disabled={busy} onClick={()=>ejecutar(async()=>{await operarConteo('cancelar',detalle.sesion.id,{motivo:'Cancelar resolución desde despacho del pedido'});setDetalle(null);captura.current=null;setCapturaIniciada(false);solicitud.current=crypto.randomUUID();await onActualizado();})}>Cancelar conteo y liberar ubicación</button></>}
      </>}
    {error&&<p className="om-error-text" role="alert">{error}</p>}
  </div>;
}
