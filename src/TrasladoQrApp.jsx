import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LogOut, RefreshCw, Truck } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { cantidadTexto, idOperacion } from './lib/operacionesMovil';
import { operarTrasladoQr } from './lib/trasladoQr';
import { operarEvidenciaOperacion, subirEvidenciaOperacion } from './lib/evidenciaOperacion';
import CantidadPedido from './CantidadPedido';
import EvidenciaOperacion from './EvidenciaOperacion';
import CodigoDocumentoQr from './CodigoDocumentoQr';
import './operaciones-movil.css';
import './preparacion-checklist.css';

const fecha=v=>v?new Date(v).toLocaleString('es-BO',{dateStyle:'short',timeStyle:'short'}):'';
const estados={PREPARANDO:'En alistado',PREPARADO:'Listo para recibir',REVISANDO:'Comprobando recepción',RECIBIDO:'Entregado y recibido',ANULADO:'Anulado'};
export default function TrasladoQrApp() {
 const {id}=useParams();
 return <ContenidoTraslado key={id} id={id}/>;
}
function ContenidoTraslado({id}) {
 const [params]=useSearchParams(),{usuario,signOut}=useAuth();
 const [datos,setDatos]=useState(null),[error,setError]=useState(''),[aviso,setAviso]=useState(''),[ocupado,setOcupado]=useState(false);
 const [fotos,setFotos]=useState([]),[evidencia,setEvidencia]=useState(null),[revision,setRevision]=useState(0),[editor,setEditor]=useState(null),[motivo,setMotivo]=useState('');
 const [pendiente,setPendiente]=useState(false);
 const intento=useRef(null),bloqueo=useRef(false),vivo=useRef(true),auto=useRef(false);
 useEffect(()=>{vivo.current=true;return()=>{vivo.current=false;};},[]);
 const cargar=useCallback(async()=>{
  try {const accion=!auto.current&&params.get('escanear')==='1'?'escanear':'consultar';auto.current=true;
   const r=await operarTrasladoQr(supabase,id,accion);if(vivo.current){setDatos(r);setError('');}
  }catch(e){if(vivo.current)setError(e.message);}
 },[id,params]);
 useEffect(()=>{
  // Consulta externa inicial y sus estados de respuesta, igual que Actualizar.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  void cargar();
 },[cargar]);
 async function accion(nombre,payload={}) {
  if(bloqueo.current)return false;
  bloqueo.current=true;setOcupado(true);setError('');setAviso('');
  try {
   const conFotos=['preparado','recibir'].includes(nombre);
   if(conFotos) {
    if(!evidencia?.activo)throw new Error('Actualiza la evidencia antes de confirmar.');
    if(intento.current?.enviado) {
     const r=await operarTrasladoQr(supabase,id);
     const e=await operarEvidenciaOperacion(supabase,{tipo:'traslado',documentoId:id,entregaId:id});
     if(e.envios.some(x=>x.id===intento.current.id)){setDatos(r);setEvidencia(e);setFotos([]);intento.current=null;setPendiente(false);setRevision(n=>n+1);setAviso('La confirmación ya estaba guardada. Recuperamos el avance.');return true;}
    }
    if(!intento.current||intento.current.version!==datos.tarea.version)intento.current={id:crypto.randomUUID(),version:datos.tarea.version};
    const evidencia_id=await subirEvidenciaOperacion(supabase,{tipo:'traslado',documentoId:id,entregaId:id,version:datos.tarea.version,loteId:intento.current.id,fotos});
    payload=intento.current.payload||{...payload,evidencia_id};intento.current.payload=payload;intento.current.enviado=true;setPendiente(true);
   }
   const r=await operarTrasladoQr(supabase,id,nombre,datos.tarea?.version??null,payload);
   if(!vivo.current)return false;
   setDatos(r);setEditor(null);setMotivo('');
   if(conFotos){setFotos([]);intento.current=null;setPendiente(false);setEvidencia(null);setRevision(n=>n+1);}
   setAviso(nombre==='preparado'?'Alistado guardado y fotos en cola de Telegram. El stock se moverá al recibir.':nombre==='recibir'?'Entrega y recepción confirmadas. El stock se movió una sola vez.':'Avance guardado.');
   return true;
  }catch(e){
   if(['40001','42501','P0001'].includes(e.code)&&intento.current){intento.current.enviado=false;delete intento.current.payload;setPendiente(false);}
   if(vivo.current)setError(e.message);return false;
  }finally{bloqueo.current=false;if(vivo.current)setOcupado(false);}
 }
 const t=datos?.tarea,s=datos?.solicitud,lineas=(datos?.lineas||[]).filter(l=>l.vigente);
 const preparador=t?.preparador_id===usuario.id,receptor=t?.receptor_id===usuario.id;
 const cambios=Boolean(datos?.cambios?.length);
 const alistar=preparador&&t.estado==='PREPARANDO'&&!cambios,recibir=receptor&&t.estado==='REVISANDO'&&!cambios;
 const completas=lineas.length>0&&lineas.every(l=>l.confirmada),revisadas=lineas.length>0&&lineas.every(l=>l.revisada_base!=null);
 const bloqueado=ocupado||Boolean(editor)||pendiente;
 return <div className="om-app">
  <header className="om-header"><Link className="om-back" to="/operaciones" aria-label="Volver"><ArrowLeft/></Link><div><small>CATION · ALMACÉN</small><h1>Entrega de traslado</h1></div><Truck/><button className="om-icon" onClick={signOut} aria-label="Cerrar sesión"><LogOut/></button></header>
  <div className="om-contexto"><span>{usuario.nombre}</span><button className="om-secondary" disabled={ocupado||Boolean(editor)} onClick={cargar}><RefreshCw size={16}/>Actualizar</button></div>
  {error&&<p role="alert" className="om-aviso om-error">{error}</p>}{aviso&&<p role="status" className="om-aviso om-exito">{aviso}</p>}
  {!idOperacion(id)?<p className="om-aviso">El QR no tiene una solicitud válida.</p>:!datos?(!error&&<p role="status">Cargando traslado…</p>):<main>
   <section className="om-pedido"><h2>{s.numero||`Traslado #${id}`}</h2><strong>{t?estados[t.estado]:s.estado}</strong><p>{datos.origen} → {datos.destino}</p><p>Solicitó: {s.solicitado_por}</p>
    {t&&<><p>Alista: <strong>{t.preparador_nombre}</strong></p><p>Recibe: <strong>{t.receptor_nombre||'Sin asignar'}</strong></p>{t.preparado_en&&<p>Alistado: {fecha(t.preparado_en)}</p>}{t.revision_en&&<p>Tomó revisión: {fecha(t.revision_en)}</p>}{t.recibido_en&&<p>Entrega y recepción: {fecha(t.recibido_en)}</p>}</>}
   </section>
   {t?.estado==='PREPARADO'&&<CodigoDocumentoQr tipo="traslado" documentoId={id} titulo="Presenta este QR a quien recibe"/>}
   {!t&&<><CodigoDocumentoQr tipo="traslado" documentoId={id} titulo="QR para alistar y recibir"/>
    {datos.legacy?<p className="om-aviso">Este traslado conserva su flujo anterior: su salida ya fue registrada. Consulta su recepción en la bandeja de Traslados.</p>:!datos.habilitado?<p className="om-aviso">El alistado por QR todavía no está habilitado para nuevas solicitudes.</p>:datos.puede_alistar?<button className="om-primary om-wide" disabled={ocupado} onClick={()=>accion('iniciar')}>Tomar alistado</button>:<p className="om-aviso">Almacén de origen debe alistar antes de que puedas recibir.</p>}
   </>}
   {cambios&&t?.estado!=='RECIBIDO'&&<section className="om-pedido"><p className="om-aviso">La solicitud cambió. El alistador debe actualizarla antes de continuar.</p>{preparador&&<><label>Motivo<input value={motivo} maxLength={1000} onChange={e=>setMotivo(e.target.value)}/></label><button className="om-secondary" disabled={bloqueado||motivo.trim().length<3} onClick={()=>accion('sincronizar',{observacion:motivo.trim()})}>Actualizar alistado</button></>}</section>}
   {lineas.map(l=>{const factor=Number(l.snapshot.factor)||1;const input=recibir?{...l,snapshot:{...l.snapshot,pendiente_base:l.preparada_base}}:l;
    return <section className="om-pedido" key={l.pedido_linea_id}><h3>{l.snapshot.nombre}</h3><p>Solicitado: {cantidadTexto(Number(l.snapshot.cantidad_base)/factor)} {l.snapshot.presentacion}</p>
     {t&&<p>Alistado: {cantidadTexto(Number(l.preparada_base)/factor)} {l.snapshot.presentacion}{l.observacion&&` · ${l.observacion}`}</p>}
     {(alistar||recibir)?<CantidadPedido key={`${t.version}:${l.pedido_linea_id}:${recibir}`} linea={input} revision={recibir} ocupado={ocupado||pendiente} bloqueada={Boolean(editor)&&editor!==l.pedido_linea_id} onEditar={()=>setEditor(l.pedido_linea_id)} onCancelar={()=>setEditor(null)} onGuardar={p=>accion(recibir?'guardar_revision':'guardar_preparacion',p)}/>:l.revisada_base!=null&&<p>Recibido: {cantidadTexto(Number(l.revisada_base)/factor)} {l.snapshot.presentacion}{l.observacion_revision&&` · ${l.observacion_revision}`}</p>}
    </section>;
   })}
   {alistar&&<button className="om-secondary om-wide" disabled={bloqueado} onClick={()=>accion('confirmar_resto')}>Todo lo demás preparado</button>}
   {t?.estado==='PREPARADO'&&datos.puede_recibir&&<button className="om-primary om-wide" disabled={ocupado} onClick={()=>accion('tomar_revision')}>Comprobar lo que recibo</button>}
   {recibir&&<button className="om-secondary om-wide" disabled={bloqueado} onClick={()=>accion('confirmar_resto_revision')}>Todo lo demás coincide</button>}
   {t&&<EvidenciaOperacion tipo="traslado" documentoId={id} entregaId={id} version={t.version} revision={revision} fotos={fotos} onFotos={setFotos} onDatos={setEvidencia} busy={ocupado||pendiente}/>}
   {alistar&&<button className="om-primary om-wide" disabled={ocupado||Boolean(editor)||!completas||!fotos.length||!evidencia?.activo} onClick={()=>accion('preparado')}>Terminar alistado y enviar fotos</button>}
   {recibir&&<><p className="om-aviso">Confirma al recibir los productos del almacenero. Se descontarán del origen y se acreditarán al destino ahora.</p><button className="om-primary om-wide" disabled={ocupado||Boolean(editor)||!revisadas||!lineas.some(l=>Number(l.revisada_base)>0)||!fotos.length||!evidencia?.activo} onClick={()=>accion('recibir')}>Confirmar recepción y traslado</button>
    {!pendiente&&<details className="om-gestion"><summary>Devolver para corregir</summary><label>Motivo<input maxLength={1000} value={motivo} onChange={e=>setMotivo(e.target.value)}/></label><button className="om-secondary" disabled={bloqueado||motivo.trim().length<3} onClick={()=>accion('devolver',{observacion:motivo.trim()})}>Devolver al alistador</button></details>}
   </>}
   {t?.estado==='RECIBIDO'&&<p className="om-aviso om-exito">Traslado entregado y recibido. Escanearlo otra vez sólo consulta el registro.</p>}
   {preparador&&['PREPARANDO','PREPARADO','REVISANDO'].includes(t?.estado)&&!pendiente&&<details className="om-gestion"><summary>Corregir o cancelar alistado</summary><label>Motivo<input value={motivo} maxLength={1000} onChange={e=>setMotivo(e.target.value)}/></label><button className="om-secondary" disabled={bloqueado||motivo.trim().length<3} onClick={()=>accion('sincronizar',{observacion:motivo.trim()})}>Reabrir para corregir</button><button className="om-secondary" disabled={bloqueado||motivo.trim().length<3} onClick={()=>accion('anular',{observacion:motivo.trim()})}>Anular solicitud</button></details>}
  </main>}
 </div>;
}
