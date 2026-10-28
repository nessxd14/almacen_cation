import {useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,ImageOff,MapPin,Package,Undo2,X,Warehouse,Store,ShoppingCart,PenLine,HelpCircle} from 'lucide-react';
import ImagenProducto from './ImagenProducto';
import TypeaheadProducto from './TypeaheadProducto';
import {cantidadOperacion,cantidadTexto} from './lib/operacionesMovil';
import {etiquetaUbicacion} from './lib/ubicacionTexto';
import './pedido-tarjetas.css';

const motivos=['Solo hay una parte','No hay stock','Producto dañado','No lo encuentro','Otro'];
const factor=l=>Number(l.snapshot.factor)||1;
const texto=(q,l)=>`${cantidadTexto(Number(q)/factor(l))} ${l.snapshot.presentacion||l.snapshot.unidad_base}`;

// El origen base viene del pedido; el reparto real posterior puede ser mixto.
function origenBase(linea,sucursales) {
  const s=linea.snapshot;
  if(s.es_personalizado)return {clase:'personalizado',titulo:'Personalizado',Icono:PenLine};
  if(s.estado==='POR_COMPRAR')return {clase:'compra',titulo:'Por comprar',Icono:ShoppingCart};
  const sucursal=s.sucursal_origen_id==null?null:sucursales.find(v=>String(v.id)===String(s.sucursal_origen_id));
  const nombre=sucursal?.nombre||'';
  const normalizado=nombre.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(normalizado.includes('almacen'))return {clase:'almacen',titulo:'Almacén',detalle:nombre,Icono:Warehouse};
  if(normalizado.includes('tienda'))return {clase:'tienda',titulo:'Tienda',detalle:nombre,Icono:Store};
  return {clase:'pendiente',titulo:nombre||'Por definir',Icono:HelpCircle};
}

export default function PedidoTarjetas({lineas,revision,ocupado,accion,setEditor,ubicaciones={},numeroTanda,sucursales=[]}) {
  const [seleccion,setSeleccion]=useState(null),[formulario,setFormulario]=useState(null),[error,setError]=useState('');
  const [arrastre,setArrastre]=useState(0);
  const inicio=useRef(null),guardando=useRef(false);
  const procesada=l=>revision?l.revisada_base!=null:l.confirmada||l.incidencia_pendiente;
  const pendientes=lineas.filter(l=>!procesada(l));
  const incidencias=lineas.filter(l=>l.incidencia_pendiente);
  const actual=seleccion==='resumen'?null:lineas.find(l=>l.pedido_linea_id===seleccion)||pendientes[0];
  const origen=actual?origenBase(actual,sucursales):null;
  const IconoOrigen=origen?.Icono;
  const indice=actual?lineas.indexOf(actual):-1;
  const deshabilitado=ocupado||Boolean(formulario);
  function abrir(modo){setSeleccion(actual.pedido_linea_id);setError('');setFormulario(modo);setEditor({lineaId:actual.pedido_linea_id,intencion:'tarjeta'});}
  function cerrar(){setFormulario(null);setEditor(null);setError('');}
  async function guardar(nombre,payload){
    if(guardando.current||ocupado)return false;
    guardando.current=true;setError('');
    try{
      const ok=await accion(nombre,{linea_id:actual.pedido_linea_id,...payload});
      if(ok===false){setError('No se guardó. Puedes reintentar con los mismos datos.');return false;}
      cerrar();setSeleccion(pendientes.find(l=>l.pedido_linea_id!==actual.pedido_linea_id)?.pedido_linea_id||'resumen');return true;
    }finally{guardando.current=false;setArrastre(0);}
  }
  function completo(){return guardar(revision?'guardar_revision':'guardar_preparacion',{
    cantidad_base:revision?Number(actual.preparada_base)||Number(actual.snapshot.pendiente_base):Number(actual.snapshot.pendiente_base),
    ...(revision?{metodo:'visual',observacion:Number(actual.preparada_base)===0?'Material disponible al retirar':''}:{}),
  });}
  function terminarGesto(e){
    const p=inicio.current;inicio.current=null;setArrastre(0);
    if(!p||deshabilitado||e.type==='pointercancel')return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    if(Math.abs(dx)<85||Math.abs(dx)<Math.abs(dy)*1.4)return;
    if(dx>0)void completo();else abrir(revision?'ajuste':'incidencia');
  }
  return <section className="pt-flujo" aria-label={revision?'Tarjetas de salida':'Tarjetas de alistado'}>
    <div className="pt-cabecera"><div><small>TANDA {numeroTanda||1} · {revision?'VERIFICAR Y RETIRAR':'ALISTADO'}</small><h2>{revision?'Comprueba lo que sale':'Un producto a la vez'}</h2></div><strong>{lineas.filter(procesada).length}/{lineas.length}</strong></div>
    <progress aria-label={revision?'Avance de salida':'Avance de alistado'} max={lineas.length||1} value={lineas.filter(procesada).length}/>
    {actual?<>
      <article className={`pt-tarjeta pt-origen-${origen.clase} ${arrastre>45?'pt-derecha':arrastre< -45?'pt-izquierda':''}`} aria-label={`Producto ${indice+1}: ${actual.snapshot.nombre}`}
        style={{transform:`translateX(${arrastre*.35}px) rotate(${arrastre*.025}deg)`}}
        onPointerDown={e=>{if(!deshabilitado&&e.button===0&&!e.target.closest('button,input,select,textarea,a')){inicio.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture?.(e.pointerId);}}}
        onPointerMove={e=>{if(inicio.current)setArrastre(Math.max(-200,Math.min(200,e.clientX-inicio.current.x)));}}
        onPointerUp={terminarGesto} onPointerCancel={terminarGesto}>
        <header className="pt-origen-base"><span className="pt-origen-icono"><IconoOrigen size={20} aria-hidden="true"/></span><div><small>ORIGEN BASE</small><strong>{origen.titulo}</strong></div>{origen.detalle&&origen.detalle!==origen.titulo&&<span className="pt-origen-sucursal">{origen.detalle}</span>}</header>
        <div className="pt-foto">{actual.snapshot.es_personalizado&&!actual.reemplazo?<div className="pt-personalizado"><Package size={54}/><strong>Ítem personalizado</strong></div>:<><ImagenProducto url={actual.reemplazo?.imagen_url||actual.snapshot.imagen_url} nombre={actual.reemplazo?.nombre||actual.snapshot.nombre}/>{!actual.reemplazo?.imagen_url&&!actual.snapshot.imagen_url&&<span className="pt-sin-foto"><ImageOff size={15}/> Sin foto</span>}</>}</div>
        {arrastre>45&&<span className="pt-sello">{revision?'SALE':'ALISTADO'}</span>}{arrastre< -45&&<span className="pt-sello pt-sello-problema">REVISAR</span>}
        <div className="pt-contenido"><small>{String(indice+1).padStart(2,'0')} / {lineas.length} · {actual.snapshot.sku||'Sin código'}</small><h3>{actual.reemplazo?.nombre||actual.snapshot.nombre}</h3>
          {actual.reemplazo&&<p className="pt-nota">Reemplaza a {actual.snapshot.nombre} · Vendedor revisará el cambio.</p>}
          <strong className="pt-cantidad">{actual.reemplazo?`${cantidadTexto((revision?Number(actual.preparada_base)||Number(actual.snapshot.pendiente_base):Number(actual.snapshot.pendiente_base))*Number(actual.reemplazo.factor))} ${actual.reemplazo.unidad_base}`:texto(revision?Number(actual.preparada_base)||Number(actual.snapshot.pendiente_base):actual.snapshot.pendiente_base,actual)}</strong>
          {actual.reemplazo?<p>Cubre {texto(revision?Number(actual.preparada_base)||Number(actual.snapshot.pendiente_base):actual.snapshot.pendiente_base,actual)} de {actual.snapshot.nombre}.</p>:factor(actual)!==1&&<p>1 {actual.snapshot.presentacion} = {cantidadTexto(factor(actual))} {actual.snapshot.unidad_base}</p>}
          {revision&&<p>Alistado: {texto(actual.preparada_base,actual)} · Pendiente del pedido: {texto(actual.snapshot.pendiente_base,actual)}</p>}
          {actual.reemplazo&&<p>Equivalencia: {cantidadTexto(actual.reemplazo.factor)} {actual.reemplazo.unidad_base} del reemplazo por {actual.snapshot.unidad_base} solicitada.</p>}
          <p className="pt-ubicacion"><MapPin size={16}/>{(ubicaciones[actual.reemplazo?.producto_id||actual.snapshot.producto_id]||[]).map(u=>etiquetaUbicacion(u,{separador:' · '})).join(' / ')||'Sin ubicación registrada'}</p>
          {actual.snapshot.nota&&<p className="pt-nota">{actual.snapshot.nota}</p>}{actual.observacion&&<p className="pt-nota">{actual.observacion}</p>}
          {procesada(actual)&&<span className="pt-estado">{actual.incidencia_pendiente?'Por resolver al final':revision?'Verificado':'Alistado'} · {texto(revision?actual.revisada_base:actual.preparada_base,actual)}</span>}
        </div>
      </article>
      {!formulario?<><div className="pt-acciones"><button className="pt-problema" disabled={deshabilitado} onClick={()=>abrir(revision?'ajuste':'incidencia')}><span className="pt-accion-icono"><X/></span>{revision?'Ajustar salida':'Hay un problema'}</button><button className="pt-volver" disabled={deshabilitado||indice<=0} onClick={()=>setSeleccion(lineas[indice-1].pedido_linea_id)}><span className="pt-accion-icono"><Undo2/></span>Volver</button><button className="pt-confirmar" disabled={deshabilitado} onClick={completo}><span className="pt-accion-icono"><Check/></span>{ocupado?'Guardando…':revision?'Verificado · sale':'Alistado completo'}</button></div><p className="pt-ayuda">Desliza a la izquierda para {revision?'ajustar':'registrar un problema'} o a la derecha para confirmar.</p>{!revision&&actual.incidencia_pendiente&&<button className="om-primary om-wide" disabled={ocupado} onClick={()=>abrir('resolver')}>Resolver este producto</button>}</>:<FormularioTarjeta key={`${actual.pedido_linea_id}:${formulario}`} linea={actual} modo={formulario} revision={revision} ocupado={ocupado} guardar={guardar} onCerrar={cerrar}/>}
      {error&&<p role="alert" className="om-error-text">{error}</p>}
      <div className="pt-navegacion"><button disabled={deshabilitado||indice<=0} onClick={()=>setSeleccion(lineas[indice-1].pedido_linea_id)}><ChevronLeft size={18}/>Anterior</button><button disabled={deshabilitado} onClick={()=>setSeleccion(indice<lineas.length-1?lineas[indice+1].pedido_linea_id:'resumen')}>{indice<lineas.length-1?'Siguiente':'Ver resumen'}<ChevronRight size={18}/></button></div>
    </>:<div className="pt-resumen"><Package size={34}/><h3>{incidencias.length?'Resolver pendientes':'Recorrido terminado'}</h3><p>{incidencias.length?`${incidencias.length} productos necesitan una decisión antes de enviar a verificación.`:revision?'Comprueba el resumen, adjunta las fotos y confirma la salida.':'Adjunta las fotos y envía a verificación. Después declara el origen del material.'}</p>{pendientes.length>0&&<button className="om-primary" disabled={ocupado} onClick={()=>setSeleccion(pendientes[0].pedido_linea_id)}>Continuar recorrido · {pendientes.length} pendientes</button>}</div>}
    <details className="pt-lista" open={!actual}><summary>Productos de esta tanda · {lineas.length}</summary>{lineas.map(l=><button key={l.pedido_linea_id} disabled={ocupado||Boolean(formulario)} onClick={()=>{setSeleccion(l.pedido_linea_id);}}><span>{l.snapshot.nombre}<small>{texto(revision?l.revisada_base??l.preparada_base:l.preparada_base,l)}</small></span><span>{l.incidencia_pendiente?'Resolver':procesada(l)?<Check size={18}/>:<Undo2 size={18}/>}</span></button>)}</details>
  </section>;
}

function FormularioTarjeta({linea,modo,revision,ocupado,guardar,onCerrar}) {
  const [valor,setValor]=useState(String((revision?linea.revisada_base??linea.preparada_base:linea.preparada_base)/factor(linea)));
  const [motivo,setMotivo]=useState(linea.observacion||motivos[0]),[decision,setDecision]=useState('parcial');
  const [situacion,setSituacion]=useState(linea.pendiente_tipo||'POR_COMPLETAR'),[busqueda,setBusqueda]=useState(''),[producto,setProducto]=useState(null),[equivalencia,setEquivalencia]=useState('1');
  const [proveedor,setProveedor]=useState(''),[costo,setCosto]=useState(''),[error,setError]=useState('');
  async function enviar(e){e.preventDefault();setError('');try{
    let q=cantidadOperacion(valor)*factor(linea);q=Math.round(q*1e6)/1e6;
    if(q>Number(linea.snapshot.pendiente_base))throw new Error('La cantidad supera lo pendiente del pedido.');
    if(!motivo.trim())throw new Error('Indica qué ocurrió con este producto.');
    if(modo==='incidencia')return await guardar('registrar_incidencia',{cantidad_base:q,observacion:motivo});
    if(revision)return await guardar('guardar_revision',{cantidad_base:q,metodo:'visual',observacion:motivo});
    if(decision==='compra')return await guardar('gestionar_compra',{cantidad_base:q,observacion:motivo});
    if(decision==='comprado')return await guardar('recibir_compra_tarjeta',{cantidad_base:q,referencia:proveedor,costo:costo===''?null:cantidadOperacion(costo),observacion:motivo});
    if(decision==='reemplazo'){
      if(!producto)throw new Error('Selecciona el producto que vas a entregar.');
      return await guardar('reemplazar_material',{cantidad_base:q,producto_id:producto.id,factor:cantidadOperacion(equivalencia),observacion:motivo});
    }
    return await guardar('guardar_preparacion',{cantidad_base:decision==='faltante'?0:q,observacion:motivo,pendiente_tipo:situacion});
  }catch(e){setError(e.message);}}
  return <form className="pt-formulario" onSubmit={enviar} aria-label={revision?'Ajustar salida':modo==='incidencia'?'Registrar problema':'Resolver producto'}>
    <h3>{revision?'¿Cuánto sale ahora?':modo==='incidencia'?'Registra el problema y continúa':'Decide qué hacer con este producto'}</h3>
    {modo==='resolver'&&<label>Qué hacer<select value={decision} disabled={ocupado} onChange={e=>{setDecision(e.target.value);if(e.target.value==='compra')setValor(String((Number(linea.snapshot.pendiente_base)-Number(linea.preparada_base))/factor(linea)));else setValor(String(Number(linea.preparada_base)/factor(linea)));}}><option value="parcial">Enviar lo disponible y completar después</option><option value="faltante">Dejar todo como faltante</option><option value="comprado">Ya se compró y está disponible</option><option value="compra">Solicitar / gestionar compra</option><option value="reemplazo">Cambiar por otro producto</option></select></label>}
    {decision!=='faltante'&&<label>{decision==='compra'?'Cantidad a comprar':revision?'Cantidad que sale':'Cantidad disponible'} · {linea.snapshot.presentacion||linea.snapshot.unidad_base}<input autoFocus inputMode="decimal" value={valor} disabled={ocupado} onChange={e=>setValor(e.target.value)} required/></label>}
    <label>Motivo / observación<input value={motivo} maxLength={1000} disabled={ocupado} onChange={e=>setMotivo(e.target.value)} required/></label>
    {modo==='incidencia'&&<div className="om-reason-options">{(linea.snapshot.es_personalizado?['Hay que comprar','Gestionar compra','Cambiar por otro producto',...motivos]:motivos).map(m=><button type="button" key={m} disabled={ocupado} aria-pressed={motivo===m} onClick={()=>setMotivo(m)}>{m}</button>)}</div>}
    {modo==='resolver'&&['parcial','faltante'].includes(decision)&&<label>El resto queda<select value={situacion} disabled={ocupado} onChange={e=>setSituacion(e.target.value)}><option value="POR_COMPLETAR">Pendiente con el mismo QR</option><option value="TIENDA">Por traer de Tienda</option><option value="COMPRA_RAPIDA">Pendiente de compra rápida</option><option value="COMPRA_GESTIONADA">Pendiente de compra gestionada</option></select></label>}
    {modo==='resolver'&&decision==='comprado'&&<><label>Proveedor<input value={proveedor} disabled={ocupado} onChange={e=>setProveedor(e.target.value)} maxLength={200} required/></label><label>Costo (opcional)<input inputMode="decimal" value={costo} disabled={ocupado} onChange={e=>setCosto(e.target.value)}/></label></>}
    {modo==='resolver'&&decision==='reemplazo'&&<><TypeaheadProducto value={busqueda} onChange={setBusqueda} onSeleccionar={setProducto} label="Producto de reemplazo"/>{producto&&<p>Entregar: <strong>{producto.nombre}</strong></p>}<label>Unidades base del reemplazo por cada {linea.snapshot.unidad_base} solicitada<input inputMode="decimal" value={equivalencia} onChange={e=>setEquivalencia(e.target.value)} disabled={ocupado} required/></label><p className="om-muted">El cambio queda registrado para el vendedor. Los precios se conservan.</p></>}
    {error&&<p role="alert" className="om-error-text">{error}</p>}<div className="om-input-row"><button className="om-primary" disabled={ocupado}>{ocupado?'Guardando…':modo==='incidencia'?'Guardar y continuar':'Guardar decisión'}</button><button type="button" className="om-secondary" disabled={ocupado} onClick={onCerrar}>Cancelar</button></div>
  </form>;
}
