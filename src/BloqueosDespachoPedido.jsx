import {useState} from 'react';
import {AlertTriangle,CheckCircle2,Package,SlidersHorizontal,Layers,Undo2} from 'lucide-react';
import {cantidadTexto} from './lib/operacionesMovil';
import ResolucionStockPedido from './ResolucionStockPedido';

const titulos={STOCK:'Stock de Almacén por resolver',RECEPCION:'Recepción del pedido por reutilizar',CANTIDAD:'Cantidad sin confirmar',REVISION:'Falta verificar el material',ORIGEN:'Origen por declarar',PLAN:'Salida por resolver'};
export default function BloqueosDespachoPedido({bloqueos,lineas,tarea,encargado,usuarioId,pedidoNumero,puedePreparar,puedeRevisar,ocupado,editor,setEditor,accion,renderLinea,onActualizado,onOcupado,evidencia,destino,children}) {
  const [vista,setVista]=useState('bloqueos'),[seleccion,setSeleccion]=useState(null),[ajustar,setAjustar]=useState(false);
  const materiales=bloqueos.filter(b=>b.linea_id!=null);
  const activo=materiales.find(b=>`${b.codigo}:${b.linea_id}`===seleccion)||materiales[0];
  const linea=lineas.find(l=>l.pedido_linea_id===activo?.linea_id);
  const otros=bloqueos.filter(b=>b.linea_id==null&&!['FOTOS','DESTINO'].includes(b.codigo));
  const editable=puedePreparar||puedeRevisar;
  const requiereDevolver=!puedePreparar&&['ORIGEN','RECEPCION'].includes(activo?.codigo);
  const motivo=`Resolver ${activo?.codigo==='RECEPCION'?'la recepción asignada':'el origen del material'} antes de retirar.`;
  const faltaOrigenPersonal=linea?.snapshot.es_personalizado&&!linea.origenes_preparacion?.length&&(linea.recepciones||[]).reduce((n,r)=>n+Number(r.saldo),Number(linea.compra_recibida_base||0))<Number(linea.snapshot.pendiente_base);
  const disabled=ocupado||Boolean(editor);
  const cantidades=lineas.map(l=>Number(l.revisada_base??l.preparada_base??0));
  const conMaterial=cantidades.filter(q=>q>0).length;
  const conSaldo=lineas.filter((l,i)=>cantidades[i]<Number(l.snapshot.pendiente_base)).length;
  return <section className="om-resolver" aria-label="Resolver despacho">
    <nav className="om-resolver-tabs" aria-label="Preparación y bloqueos"><button aria-pressed={vista==='bloqueos'} disabled={disabled} onClick={()=>setVista('bloqueos')}><AlertTriangle size={18}/> Bloqueos <strong>{bloqueos.length}</strong></button><button aria-pressed={vista==='productos'} disabled={disabled} onClick={()=>setVista('productos')}><Package size={18}/> Productos <strong>{lineas.length}</strong></button></nav>
    {vista==='bloqueos'?<>
      <div className="om-resolver-heading"><small className="om-eyebrow">RESOLVER PRIMERO</small><h2>{bloqueos.length?'Qué bloquea esta entrega':'Material listo para continuar'}</h2><p>{bloqueos.length?'Resuelve el motivo indicado aquí. Al guardar se vuelve a comprobar la entrega.':'Las cantidades y los orígenes están comprobados para el siguiente paso.'}</p></div>
      {materiales.length>1&&<div className="om-bloqueos-selector" aria-label="Productos con bloqueos">{materiales.map(b=><button key={`${b.codigo}:${b.linea_id}`} disabled={disabled} aria-pressed={b===activo} onClick={()=>{setSeleccion(`${b.codigo}:${b.linea_id}`);setAjustar(false);}}>{lineas.find(l=>l.pedido_linea_id===b.linea_id)?.snapshot.nombre} <span>{titulos[b.codigo]||'Por resolver'}</span></button>)}</div>}
      {activo&&linea&&<article className="om-bloqueo" aria-label={`Bloqueo de ${linea.snapshot.nombre}`}><div className="om-bloqueo-heading"><AlertTriangle size={20}/><div><strong>{titulos[activo.codigo]||'Salida por resolver'}</strong><h3>{linea.snapshot.nombre}</h3></div></div><p>{activo.detalle}</p>
        {activo.codigo==='STOCK'&&<><div className="om-bloqueo-cantidades"><span>De Almacén en esta entrega<strong>{cantidadTexto(Number(activo.almacen_base??activo.cantidad_base)/(Number(linea.snapshot.factor)||1))} {linea.snapshot.presentacion||linea.snapshot.unidad_base}</strong></span><span>Disponible registrado<strong>{cantidadTexto(Number(activo.disponible_base||0)/(Number(linea.snapshot.factor)||1))}</strong></span></div><ResolucionStockPedido key={`${linea.pedido_linea_id}:stock`} linea={linea} encargado={encargado} usuarioId={usuarioId} pedidoNumero={pedidoNumero} onActualizado={onActualizado} onOcupado={onOcupado}/></>}
        {requiereDevolver?<><p className="om-muted">El origen lo corrige el alistador. Después otra persona verifica de nuevo.</p>{puedeRevisar&&<button className="om-secondary" disabled={disabled} onClick={()=>accion('devolver',{observacion:motivo})}><Undo2 size={18}/> Devolver al alistador</button>}</>:
          editable&&<>{activo.codigo==='STOCK'&&!ajustar?<button className="om-secondary" disabled={disabled} onClick={()=>setAjustar(true)}><SlidersHorizontal size={18}/> Ajustar cantidad / dejar para otra entrega</button>:<>{faltaOrigenPersonal&&!editor&&<button className="om-secondary" disabled={disabled} onClick={()=>setEditor({lineaId:linea.pedido_linea_id,tipo:'preparacion',intencion:'abastecimiento'})}><Layers size={18}/> Declarar origen del personalizado</button>}{renderLinea(linea)}</>}</>}
        {!editable&&!requiereDevolver&&<p className="om-muted">{tarea.estado==='PREPARANDO'?'El alistador asignado debe confirmar esta línea.':'La persona que verifica debe corregir o devolver esta preparación.'}</p>}
      </article>}
      {!materiales.length&&<p className="om-material-listo"><CheckCircle2 size={20}/> {lineas.length} líneas sin bloqueos de material.</p>}
      {otros.map(b=><p className="om-aviso" key={b.codigo} role="status">{b.detalle}{b.codigo==='CAMBIOS'&&<button className="om-secondary" disabled={disabled} onClick={()=>accion('sincronizar')}>Actualizar preparación</button>}</p>)}
      {materiales.length>0&&<p className="om-muted">{new Set(materiales.map(b=>b.linea_id)).size} productos requieren resolución. Las demás líneas conservan su avance.</p>}
    </>:<div>{children}</div>}
    <p className="om-resumen-previsto" aria-live="polite">Previsto: <strong>{conMaterial} {conMaterial===1?'línea con material':'líneas con material'}</strong>{conSaldo>0&&<> · <strong>{conSaldo} por completar</strong> con el mismo QR</>}</p>
    {(puedePreparar||puedeRevisar)&&<div className="om-requisitos-entrega"><h3>Antes de continuar</h3>{bloqueos.filter(b=>['DESTINO','FOTOS'].includes(b.codigo)).map(b=><p className="om-muted" role="status" key={b.codigo}>{b.detalle}</p>)}{destino}{evidencia}</div>}
  </section>;
}
