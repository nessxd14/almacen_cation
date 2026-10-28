import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabaseClient';
import {cantidadOperacion,cantidadTexto} from './lib/operacionesMovil';
import {etiquetaUbicacion} from './lib/ubicacionTexto';

export default function OrigenesPendientesPedido({pendientes,puedeDeclarar,ocupado,accion,sucursalId,sucursales,setEditor}) {
  const [abierta,setAbierta]=useState(null),[ubicaciones,setUbicaciones]=useState([]),[error,setError]=useState('');
  useEffect(()=>{
    let vigente=true;
    supabase.from('ubicacion').select('id,codigo_zona,estante,nivel,compartimiento').eq('sucursal_id',sucursalId).eq('excluye_disponible',false).order('id').then(({data,error})=>{
      if(vigente){setUbicaciones(data||[]);setError(error?'No se pudieron consultar las ubicaciones. Reabre esta tanda para reintentar.':'');}
    },()=>{if(vigente)setError('No se pudieron consultar las ubicaciones. Reabre esta tanda para reintentar.');});
    return()=>{vigente=false;};
  },[sucursalId]);
  if(!pendientes?.length)return null;
  function cerrar(){setAbierta(null);setEditor(null);}
  return <section className="pt-origenes" aria-label="Declaración de origen pendiente"><h3>Origen por declarar · {pendientes.length}</h3><p>El alistador debe indicar de dónde vino el material. Puede combinar Almacén, Tienda y compra. Esta tarea se conserva después de la salida.</p>{error&&<p role="alert">{error}</p>}
    {pendientes.map(l=><article key={l.linea_id}><strong>{l.nombre}</strong><div className="pt-origen-resumen">{cantidadTexto(l.cantidad_base)} {l.unidad_base} por distribuir</div>{puedeDeclarar?(abierta===l.linea_id?<FormularioOrigen key={`${l.linea_id}:${l.cantidad_base}`} linea={l} ubicaciones={ubicaciones} tiendas={sucursales.filter(s=>s.tipo!=='virtual'&&String(s.id)!==String(sucursalId))} ocupado={ocupado} guardar={async origenes=>{const ok=await accion('declarar_origen',{linea_id:l.linea_id,origenes});if(ok!==false)cerrar();return ok;}} onCerrar={cerrar}/>:<button className="om-secondary" disabled={ocupado||abierta!=null} onClick={()=>{setAbierta(l.linea_id);setEditor({lineaId:l.linea_id,intencion:'origen_posterior'});}}>Declarar origen</button>):<p className="om-muted">Tarea pendiente del alistador de esta tanda.</p>}</article>)}
  </section>;
}

function FormularioOrigen({linea,ubicaciones,tiendas,ocupado,guardar,onCerrar}) {
  const [cantidades,setCantidades]=useState({ALMACEN:'0',TIENDA:'0',COMPRA_RAPIDA:'0'});
  const [ubicacion,setUbicacion]=useState(''),[tienda,setTienda]=useState(''),[proveedor,setProveedor]=useState(''),[costo,setCosto]=useState(''),[error,setError]=useState('');
  const guardando=useRef(false);
  const total=Object.values(cantidades).reduce((n,q)=>n+(Number(q.replace(',','.'))||0),0);
  async function enviar(e){e.preventDefault();if(guardando.current)return;setError('');try{
    const origenes=[];
    for(const tipo of ['ALMACEN','TIENDA','COMPRA_RAPIDA']){
      const q=cantidadOperacion(cantidades[tipo]);if(!q)continue;
      if(tipo==='ALMACEN'&&linea.producto_id&&!ubicacion)throw new Error('Selecciona de qué ubicación de Almacén salió.');
      if(tipo==='TIENDA'&&!tienda)throw new Error('Selecciona la Tienda de origen.');
      if(tipo==='COMPRA_RAPIDA'&&!proveedor.trim())throw new Error('Indica el proveedor de la compra.');
      origenes.push({tipo,cantidad_base:q,...(tipo==='ALMACEN'&&linea.producto_id?{ubicacion_id:Number(ubicacion)}:{}),...(tipo==='TIENDA'?{sucursal_tienda_id:Number(tienda),referencia:tiendas.find(s=>String(s.id)===tienda)?.nombre}:{}),...(tipo==='COMPRA_RAPIDA'?{referencia:proveedor.trim(),...(costo===''?{}:{costo:cantidadOperacion(costo)})}:{})});
    }
    if(Math.abs(total-Number(linea.cantidad_base))>1e-8)throw new Error('Distribuye exactamente la cantidad física entre los orígenes.');
    guardando.current=true;
    if(await guardar(origenes)===false)setError('No se guardó el origen. Conservamos tus cantidades para reintentar.');
  }catch(e){setError(e.message);}finally{guardando.current=false;}}
  return <form className="pt-formulario" aria-label={`Origen de ${linea.nombre}`} onSubmit={enviar}>
    {Object.entries({ALMACEN:'De Almacén',TIENDA:'De Tienda',COMPRA_RAPIDA:'Comprado'}).map(([tipo,nombre])=><label key={tipo}>{nombre} · {linea.unidad_base}<input inputMode="decimal" value={cantidades[tipo]} disabled={ocupado} onChange={e=>setCantidades({...cantidades,[tipo]:e.target.value})} required/></label>)}
    {Number(cantidades.ALMACEN.replace(',','.'))>0&&linea.producto_id&&<label>Ubicación de Almacén<select value={ubicacion} disabled={ocupado} onChange={e=>setUbicacion(e.target.value)} required><option value="">Seleccionar ubicación</option>{ubicaciones.map(u=><option key={u.id} value={u.id}>{etiquetaUbicacion(u,{separador:' · '})}</option>)}</select></label>}
    {Number(cantidades.TIENDA.replace(',','.'))>0&&<label>Tienda de origen<select value={tienda} disabled={ocupado} onChange={e=>setTienda(e.target.value)} required><option value="">Seleccionar Tienda</option>{tiendas.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}
    {Number(cantidades.COMPRA_RAPIDA.replace(',','.'))>0&&<><label>Proveedor<input value={proveedor} disabled={ocupado} onChange={e=>setProveedor(e.target.value)} maxLength={200} required/></label><label>Costo (opcional)<input inputMode="decimal" value={costo} disabled={ocupado} onChange={e=>setCosto(e.target.value)}/></label></>}
    <p aria-live="polite">Distribuido: <strong>{cantidadTexto(total)} de {cantidadTexto(linea.cantidad_base)} {linea.unidad_base}</strong></p><p className="om-muted">La parte de Almacén se descuenta al confirmar la salida o al completar esta tarea si ya salió. El saldo puede quedar negativo.</p>
    {error&&<p role="alert" className="om-error-text">{error}</p>}<div className="om-input-row"><button className="om-primary" disabled={ocupado}>{ocupado?'Guardando…':'Guardar origen'}</button><button type="button" className="om-secondary" disabled={ocupado} onClick={onCerrar}>Cancelar</button></div>
  </form>;
}
