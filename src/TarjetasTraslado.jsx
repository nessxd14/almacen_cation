import {useState} from 'react';
import {CheckCircle2,ChevronLeft,ChevronRight,Package,Warehouse} from 'lucide-react';
import CantidadPedido from './CantidadPedido';
import {textoCantidadEnvio} from './lib/envioPedido';
import './pedido-tarjetas.css';

export default function TarjetasTraslado({lineas,revision,ocupado,accion,setEditor,stock,lineaInicial,version}) {
  const [seleccion,setSeleccion]=useState(lineaInicial);
  const procesada=l=>revision?l.revisada_base!=null:l.confirmada;
  const pendientes=lineas.filter(l=>!procesada(l));
  const actual=seleccion==='resumen'?null:lineas.find(l=>l.pedido_linea_id===seleccion)||pendientes[0];
  const indice=actual?lineas.indexOf(actual):-1;
  const [editada,setEditada]=useState(false);
  async function guardar(payload){
    const ok=await accion(revision?'guardar_revision':'guardar_preparacion',payload);
    if(ok!==false){setEditada(false);setEditor(null);setSeleccion(pendientes.find(l=>l.pedido_linea_id!==actual.pedido_linea_id)?.pedido_linea_id||'resumen');}
    return ok;
  }
  return <section className="pt-flujo" aria-label="Productos del traslado">
    <div className="pt-cabecera"><h2>{actual?`Producto ${indice+1} de ${lineas.length}`:'Productos comprobados'}</h2><strong>{lineas.filter(procesada).length}/{lineas.length} listos</strong></div>
    <progress max={lineas.length||1} value={lineas.filter(procesada).length} aria-label="Avance del traslado"/>
    {actual?<>
      <article className="pt-tarjeta pt-origen-almacen" aria-label={`Producto ${indice+1}: ${actual.snapshot.nombre}`}>
        <header className="pt-origen-base"><Warehouse size={20}/><strong>{revision?'Material alistado':'Almacén de origen'}</strong></header>
        <div className="at-producto"><Package size={42}/><div><small>{actual.snapshot.sku||'TRASLADO'}</small><h3>{actual.snapshot.nombre}</h3><strong>{textoCantidadEnvio(revision?actual.preparada_base:actual.snapshot.pendiente_base,actual.snapshot)}</strong></div></div>
      </article>
      <CantidadPedido key={`${version}:${actual.pedido_linea_id}:${revision}`} linea={revision?{...actual,snapshot:{...actual.snapshot,pendiente_base:actual.preparada_base}}:actual} revision={revision} ocupado={ocupado} bloqueada={false} stock={stock} lineasStock={lineas} traslado onEditar={()=>{setEditada(true);setEditor(actual.pedido_linea_id);}} onCancelar={()=>{setEditada(false);setEditor(null);}} onGuardar={guardar}/>
      <nav className="pt-navegacion" aria-label="Recorrer productos"><button disabled={ocupado||editada||indice===0} onClick={()=>setSeleccion(lineas[indice-1].pedido_linea_id)}><ChevronLeft size={17}/>Anterior</button><button disabled={ocupado||editada} onClick={()=>setSeleccion(indice<lineas.length-1?lineas[indice+1].pedido_linea_id:'resumen')}>Siguiente<ChevronRight size={17}/></button></nav>
    </>:pendientes.length?<div className="pt-resumen"><p>{pendientes.length===1?'Queda':'Quedan'} {pendientes.length} {pendientes.length===1?'producto':'productos'} por {revision?'comprobar':'registrar'}.</p><button className="om-primary" disabled={ocupado} onClick={()=>setSeleccion(pendientes[0].pedido_linea_id)}>Continuar recorrido</button></div>:<p className="ae-productos-listos"><CheckCircle2 size={22}/> Productos registrados. El avance quedó guardado.</p>}
    <details className="pt-lista"><summary>Productos del traslado · {lineas.length}</summary>{lineas.map(l=><button key={l.pedido_linea_id} disabled={ocupado||editada} onClick={()=>setSeleccion(l.pedido_linea_id)}><span>{l.snapshot.nombre}<small>{textoCantidadEnvio(revision?l.revisada_base??l.preparada_base:l.preparada_base,l.snapshot)}</small></span>{procesada(l)&&<CheckCircle2 size={17}/>}</button>)}</details>
  </section>;
}
