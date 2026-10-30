import {AlertTriangle,RefreshCw,Warehouse} from 'lucide-react';
import {cantidadTexto} from './lib/operacionesMovil';
import {cantidadAlmacen} from './lib/stockOperacion';
import './stock-sistema.css';

export default function StockSistema({stock,linea,lineas=[],cantidad=0,traslado=false,revision=false}) {
  if(!stock||stock.estado==='inactivo'||linea.snapshot.es_personalizado&&!linea.reemplazo)return null;
  const id=Number(linea.reemplazo?.producto_id||linea.snapshot.producto_id);
  const factor=linea.reemplazo?1:Number(linea.snapshot.factor)||1;
  const unidad=linea.reemplazo?.unidad_base||linea.snapshot.presentacion||linea.snapshot.unidad_base||'unidades';
  const fmt=q=>`${cantidadTexto(q/factor)} ${unidad}`;
  const otros=lineas.filter(l=>l.vigente&&l.confirmada&&l.pedido_linea_id!==linea.pedido_linea_id&&Number(l.reemplazo?.producto_id||l.snapshot.producto_id)===id).reduce((n,l)=>n+cantidadAlmacen(l,traslado,revision),0);
  const total=stock.estado==='listo'?stock.mapa.get(id):null;
  const disponible=total==null?null:Math.max(0,total-otros),q=Number.isFinite(cantidad)?Math.max(0,cantidad):0;
  const insuficiente=disponible!=null&&q>disponible+1e-6;
  return <aside className={`ss-stock${disponible===0||insuficiente?' ss-alerta':''}`} aria-label={`Stock en sistema de ${linea.snapshot.nombre}`}>
    <div className="ss-titulo"><Warehouse size={16}/><strong>Stock en sistema</strong><button type="button" aria-label={`Actualizar stock de ${linea.snapshot.nombre}`} disabled={stock.estado==='cargando'} onClick={stock.reintentar}><RefreshCw size={15}/></button></div>
    {stock.estado==='cargando'?<p role="status">Consultando saldo registrado…</p>:stock.estado==='error'||total==null?<p role="alert">{stock.error||'No se pudo consultar este producto.'} No se considera stock cero.</p>:<>
      <dl><div><dt>Registrado</dt><dd>{fmt(total)}</dd></div><div><dt>Saldo tras este envío</dt><dd>{fmt(Math.max(0,total-otros-q))}</dd></div></dl>
      {otros>0&&<p>{fmt(otros)} destinados a otras líneas de este documento.</p>}
      {(disponible===0||insuficiente)&&<p role="alert"><AlertTriangle size={15}/>{disponible===0?'No hay stock disponible en sistema.':`Stock insuficiente: faltan ${fmt(q-disponible)}.`} Ajusta la cantidad o solicita regularizar el inventario.</p>}
      <small>Uso de Almacén en esta línea: {fmt(q)}. Última consulta: {stock.actualizado?.toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'})||'ahora'}.</small>
    </>}
  </aside>;
}
