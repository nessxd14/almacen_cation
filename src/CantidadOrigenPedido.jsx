import StockSistema from './StockSistema';
import {useState} from 'react';
import {Warehouse, ShoppingCart, Clock3} from 'lucide-react';
import {cantidadOperacion, cantidadTexto} from './lib/operacionesMovil';
import {textoCantidadEnvio} from './lib/envioPedido';

export default function CantidadOrigenPedido({linea,ocupado,guardar,onCerrar,sucursales=[],sucursalId,stock,lineasStock=[]}) {
  const originales=linea.origenes_declarados;
  const f=Number(linea.reemplazo?.factor ?? 1);
  const presentacion=linea.reemplazo?1:Number(linea.snapshot.factor)||1;
  const unidad=linea.reemplazo?.unidad_base||linea.snapshot.presentacion||linea.snapshot.unidad_base;
  const pedido=Number(linea.snapshot.pendiente_base)*f;
  const deAlmacen=originales?.filter(o=>o.tipo==='ALMACEN').reduce((n,o)=>n+Number(o.cantidad_base),0);
  const externo=originales?.find(o=>o.tipo!=='ALMACEN');
  const [almacen,setAlmacen]=useState(String((deAlmacen??Number(linea.propuesta_almacen_base??0))/presentacion));
  const [fuera,setFuera]=useState(String(Number(externo?.cantidad_base??0)/presentacion));
  const [tipo,setTipo]=useState(externo?.tipo||'COMPRA_RAPIDA');
  const [tienda,setTienda]=useState(String(externo?.sucursal_tienda_id||''));
  const [referencia,setReferencia]=useState(externo?.referencia||'');
  const [nota,setNota]=useState(''),[error,setError]=useState('');
  const qa=Number(almacen.replace(',','.'))*presentacion,qe=Number(fuera.replace(',','.'))*presentacion;
  const valido=Number.isFinite(qa)&&Number.isFinite(qe)&&qa>=0&&qe>=0&&qa+qe<=pedido;
  const pendiente=valido?Math.round((pedido-qa-qe)*1e6)/1e6:null;
  const tiendas=sucursales.filter(s=>s.tipo!=='virtual'&&String(s.id)!==String(sucursalId));
  async function enviar(e){e.preventDefault();setError('');try{
    const a=cantidadOperacion(almacen)*presentacion,b=cantidadOperacion(fuera)*presentacion;
    if(a+b>pedido)throw new Error('La suma supera lo pendiente del pedido.');
    if(b>0&&tipo==='COMPRA_RAPIDA'&&!referencia.trim())throw new Error('Indica de dónde se consiguió el material.');
    if(b>0&&tipo==='TIENDA'&&!tienda)throw new Error('Selecciona la Tienda de origen.');
    const ok=await guardar('guardar_alistado',{almacen_base:Math.round(a*1e6)/1e6,externa_base:Math.round(b*1e6)/1e6,observacion:nota.trim(),...(b>0?{tipo_externo:tipo,referencia:tipo==='TIENDA'?tiendas.find(s=>String(s.id)===tienda)?.nombre:referencia.trim(),...(tipo==='TIENDA'?{sucursal_tienda_id:Number(tienda)}:{})}:{})});
    if(ok===false)setError('No se guardó. Conservamos tus cantidades para reintentar.');
  }catch(e){setError(e.message);}}
  return <form className="pt-formulario pt-cantidades-origen" onSubmit={enviar} aria-label="Cantidades y origen del alistado">
    <h3>¿Cuánto está preparado?</h3>
    <p className="om-muted">Almacén tiene prioridad. Confirma las cantidades físicas; lo que falte se solicita en Compras.</p>
    <label><span><Warehouse size={17}/> De Almacén · {unidad}</span><input autoFocus inputMode="decimal" value={almacen} onChange={e=>setAlmacen(e.target.value)} disabled={ocupado} required/></label>
    <label><span><ShoppingCart size={17}/> Conseguido por fuera · {unidad}</span><input inputMode="decimal" value={fuera} onChange={e=>setFuera(e.target.value)} disabled={ocupado} required/></label>
    <small className="om-muted">Solo cuenta aquí material que ya se consiguió y está preparado.</small>
    {qe>0&&<><label>Procedencia<select value={tipo} onChange={e=>setTipo(e.target.value)} disabled={ocupado}><option value="COMPRA_RAPIDA">Compra para este pedido</option>{tiendas.length>0&&<option value="TIENDA">Traído de Tienda</option>}</select></label>
      {tipo==='TIENDA'?<label>Tienda de origen<select value={tienda} onChange={e=>setTienda(e.target.value)} disabled={ocupado} required><option value="">Seleccionar Tienda</option>{tiendas.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>:<label>Proveedor o procedencia<input value={referencia} onChange={e=>setReferencia(e.target.value)} disabled={ocupado} maxLength={200} required/></label>}</>}
    <StockSistema stock={stock} linea={linea} lineas={lineasStock} cantidad={qa}/>
    {pendiente!=null&&<div className={`pt-origen-balance${pendiente>0?' pt-origen-balance-pendiente':''}`} role="status"><strong>Preparado: {cantidadTexto((qa+qe)/presentacion)} {unidad}</strong><span><Clock3 size={16}/>{pendiente>0?`Pendiente de compra: ${textoCantidadEnvio(pendiente/f,linea.snapshot)}`:'Toda la cantidad está preparada'}</span>{qa+qe===0&&<small>No sale esta línea. Sigue pendiente; el rechazo lo decide el vendedor o gerente.</small>}</div>}
    {linea.compra_existente?.some(c=>!c.automatica||c.estado==='COMPRADA')&&<p className="om-aviso">Esta línea tiene una compra en gestión. Se conserva su seguimiento en Compras.</p>}
    <label>Observación (opcional)<input value={nota} onChange={e=>setNota(e.target.value)} disabled={ocupado} maxLength={1000}/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="om-input-row"><button className="om-primary" disabled={ocupado||!valido}>{ocupado?'Guardando…':'Guardar y siguiente'}</button><button type="button" className="om-secondary" disabled={ocupado} onClick={onCerrar}>Cancelar</button></div>
  </form>;
}
