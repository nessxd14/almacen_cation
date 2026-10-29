import {useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft, ArrowRight, Check, CheckCircle2, Camera, ClipboardCheck, Clock3, Send} from 'lucide-react';
import ResumenEnvioPedido from './ResumenEnvioPedido';
import {textoCantidadEnvio} from './lib/envioPedido';
import './asistente-envio.css';

export default function AsistenteEnvioPedido({lineas,revision=false,numero=1,usuario,ocupado=false,editando=false,confirmacionPendiente=false,evidenciaLista=false,fotos=[],destino='',onDestino,onConfirmar,onConfirmarNoSale,renderProductos,evidencia,motivoBloqueo=''}) {
  const [paso,setPaso]=useState(1),[edicion,setEdicion]=useState({id:null,numero:0}),[error,setError]=useState('');
  const enviando=useRef(false),cabecera=useRef(null),inicio=useRef(null),pasoAnterior=useRef(1);
  const vigentes=lineas.filter(l=>l.vigente);
  const salen=vigentes.filter(l=>Number(l.preparada_base)>0);
  const noSalen=revision?vigentes.filter(l=>Number(l.preparada_base)===0):[];
  const completas=vigentes.length>0&&vigentes.every(l=>l.confirmada&&!l.incidencia_pendiente&&(!revision||l.revisada_base!=null&&Number(l.revisada_base)===Number(l.preparada_base)));
  const productosListos=completas&&salen.length>0;
  const registrados=vigentes.filter(l=>l.confirmada&&!l.incidencia_pendiente&&(!revision||l.revisada_base!=null&&Number(l.revisada_base)===Number(l.preparada_base))).length;
  const fotosListas=fotos.length>=1&&fotos.length<=10;
  const destinoListo=!revision||destino.trim().length>=3&&destino.trim().length<=300;
  // Si se invalida una línea o se quita una foto, el siguiente paso no puede
  // seguir mostrando una confirmación que ya dejó de ser válida.
  const visible=!productosListos&&paso>1?1:paso===3&&(!fotosListas||!destinoListo)?2:paso;
  useLayoutEffect(()=>{
    if(pasoAnterior.current!==visible){inicio.current?.scrollIntoView?.({block:'start',behavior:'auto'});cabecera.current?.focus({preventScroll:true});}
    pasoAnterior.current=visible;
  },[visible]);
  const nombres=revision?['Revisar','Fotos y destino','Confirmar salida']:['Productos','Fotos','Confirmar'];
  const titulos=revision?['Comprueba lo que sale','Documenta la salida','Confirma este envío']:['Prepara los productos','Fotos del alistado','Revisa antes de enviar'];
  const bloqueado=ocupado||editando||confirmacionPendiente;
  const cambiar=n=>{if(bloqueado||n>1&&!productosListos||n>2&&(!fotosListas||!destinoListo))return;setPaso(n);setError('');};
  function editar(id){if(bloqueado)return;setEdicion(e=>({id,numero:e.numero+1}));cambiar(1);}
  async function confirmar(){
    if(enviando.current||ocupado||!productosListos||!fotosListas||!destinoListo||!evidenciaLista||motivoBloqueo)return;
    enviando.current=true;setError('');
    try{if(await onConfirmar()===false)setError('No se recibió confirmación. Conservamos el avance y las fotos para reintentar.');}
    catch(e){setError(e.message||'No se pudo confirmar. Puedes reintentar.');}
    finally{enviando.current=false;}
  }
  return <section ref={inicio} className="ae-asistente" aria-label={revision?'Asistente de verificación y salida':'Asistente de alistado'}>
    <header className="ae-cabecera" tabIndex={-1} ref={cabecera}><small>{revision?'VERIFICACIÓN Y SALIDA':'ALISTADO'} · ENVÍO {numero}</small><p className="ae-paso" aria-live="polite">Paso {visible} de 3</p>
      <nav aria-label="Pasos de este recorrido"><ol>{nombres.map((nombre,i)=><li key={nombre} className={i+1<visible?'ae-completo':i+1===visible?'ae-activo':''}><button type="button" aria-current={i+1===visible?'step':undefined} disabled={bloqueado||i>0&&!productosListos||i>1&&(!fotosListas||!destinoListo)} onClick={()=>cambiar(i+1)}><span>{i+1<visible?<Check size={15}/>:i+1}</span>{nombre}</button></li>)}</ol></nav>
    </header>
    <h2 className="ae-titulo">{titulos[visible-1]}</h2>
    <div hidden={visible!==1} className="ae-panel" data-paso="productos">
      <p className="ae-instruccion">{revision?'Compara el material físico con lo alistado. Si encuentras una diferencia, devuelve la línea para corregirla.':'Confirma un producto a la vez. Almacén tiene prioridad; puedes enviar lo disponible y conservar el faltante.'}</p>
      {renderProductos({lineas:revision?salen:vigentes,lineaInicial:edicion.id,edicion:edicion.numero})}
      {noSalen.length>0&&<section className="ae-no-sale" aria-label="Productos que no salen"><h3><Clock3 size={17}/> No sale en este envío</h3><p>Estas cantidades siguen pendientes en el mismo pedido.</p>{noSalen.map(l=><div className="ae-no-sale-fila" key={l.pedido_linea_id}><div><strong>{l.snapshot.nombre}</strong><small>{textoCantidadEnvio(Number(l.snapshot.pendiente_base),l.snapshot)} pendientes</small></div>{l.revisada_base!=null?<span><CheckCircle2 size={16}/> No sale</span>:<button className="om-secondary" disabled={ocupado||editando} onClick={()=>onConfirmarNoSale(l.pedido_linea_id)}>Confirmar que no sale</button>}</div>)}</section>}
      {!salen.length&&completas&&<p className="om-aviso">No hay material alistado para este envío. Las líneas siguen pendientes; no se registra una salida vacía.</p>}
      <footer className="ae-acciones"><p className={productosListos?'ae-listo':''} aria-live="polite">{productosListos?<><CheckCircle2 size={16}/> Todo listo. Continúa con las fotos.</>:<>{registrados} de {vigentes.length} productos {revision?'comprobados':'registrados'}. {revision?'Comprueba también las líneas que no salen.':'Incluye los que quedan en cero.'}</>}</p><button className="om-primary om-wide" disabled={bloqueado||!productosListos} onClick={()=>cambiar(2)}>Continuar a {revision?'fotos y destino':'fotos'} <ArrowRight size={18}/></button></footer>
    </div>
    {/* Conservamos ambos paneles montados: volver no borra fotos ni formularios. */}
    <div hidden={visible!==2} className="ae-panel" data-paso="fotos">
      <p className="ae-instruccion">{revision?'Fotografía el material que sale y confirma a dónde se lleva.':'Fotografía únicamente el material preparado para este envío. Las cantidades pendientes se conservan.'}</p>
      {revision&&<section className="ae-destino"><label>Destino de este envío<input value={destino} onChange={e=>onDestino(e.target.value)} disabled={bloqueado} maxLength={300} placeholder="Lugar designado para el pedido" autoComplete="off"/></label><p>Verifica y retira: <strong>{usuario}</strong></p></section>}
      {evidencia}
      {!fotosListas&&<p className="ae-ayuda"><Camera size={17}/> Añade al menos una foto para continuar.</p>}
      {revision&&!destinoListo&&<p className="ae-ayuda">Indica el destino con al menos tres caracteres.</p>}
      <footer className="ae-acciones"><button className="om-primary om-wide" disabled={bloqueado||!productosListos||!fotosListas||!destinoListo} onClick={()=>cambiar(3)}>Revisar {revision?'salida':'alistado'} <ArrowRight size={18}/></button><button className="ae-volver" disabled={bloqueado} onClick={()=>cambiar(1)}><ArrowLeft size={16}/> Volver a {revision?'revisar productos':'productos'}</button></footer>
    </div>
    <div hidden={visible!==3} className="ae-panel" data-paso="confirmar">
      <ResumenEnvioPedido sinCabecera lineas={vigentes} revision={revision} numero={numero} onEditar={editar} ocupado={bloqueado}/>
      <section className="ae-confirmacion"><div><ClipboardCheck size={20}/><span>{revision?'Verifica y retira':'Alista'}<strong>{usuario}</strong></span></div>{revision&&<div><Send size={20}/><span>Destino<strong>{destino.trim()}</strong></span></div>}<div><Camera size={20}/><span>Evidencia<strong>{fotos.length} {fotos.length===1?'foto adjunta':'fotos adjuntas'}</strong></span></div><div className="ae-miniaturas">{fotos.map((foto,i)=><Miniatura key={`${i}:${foto.name}`} foto={foto} numero={i+1}/>)}</div><button className="ae-volver" disabled={bloqueado} onClick={()=>cambiar(2)}>Revisar fotos{revision?' y destino':''}</button></section>
      <p className="ae-ayuda">{revision?'Al confirmar se registra la salida una sola vez. Lo pendiente permanece en el pedido.':'Al enviar se avisa al verificador. El inventario todavía no se descuenta.'}</p>
      {motivoBloqueo&&<p className="om-aviso" role="alert">{motivoBloqueo}</p>}
      {!evidenciaLista&&<p className="om-aviso" role="status">Esperando la comprobación de las fotos. Conserva esta pantalla.</p>}
      {error&&<p className="om-aviso om-error" role="alert">{error}</p>}
      <footer className="ae-acciones"><button className="om-primary om-wide" disabled={ocupado||editando||!productosListos||!fotosListas||!destinoListo||!evidenciaLista||Boolean(motivoBloqueo)} onClick={confirmar}>{ocupado?'Confirmando…':confirmacionPendiente?'Reintentar confirmación':revision?'Verificar y registrar salida':'Enviar a verificación'} {!ocupado&&<CheckCircle2 size={18}/>}</button><button className="ae-volver" disabled={bloqueado} onClick={()=>cambiar(1)}>Volver a {revision?'revisar productos':'productos'}</button></footer>
    </div>
  </section>;
}

function Miniatura({foto,numero}) {
  const imagen=useRef(null);
  // El nodo controla la URL de esta miniatura sin compartirla con la captura.
  return <img ref={nodo=>{if(imagen.current)URL.revokeObjectURL(imagen.current);imagen.current=nodo?URL.createObjectURL(foto):null;if(nodo)nodo.src=imagen.current;}} alt={`Foto adjunta ${numero}`}/>;
}
