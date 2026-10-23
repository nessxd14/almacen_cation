import {useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {Boxes, Store, ShoppingBag, Truck, Clock3, X, Check, Layers} from 'lucide-react';
import {cantidadOperacion, cantidadTexto} from './lib/operacionesMovil';

const origenTexto={ALMACEN:'Almacén',EXISTENCIA_PERSONALIZADA:'Almacén · personalizado',TIENDA:'Traído de Tienda',COMPRA_RAPIDA:'Compra rápida para este pedido'};
const pendientesTexto={POR_COMPLETAR:'Se enviará después · mismo pedido y QR',TIENDA:'Por traer de Tienda',COMPRA_RAPIDA:'Pendiente de compra rápida',COMPRA_GESTIONADA:'Compra gestionada'};
const acciones=[['origenes','Alistar por origen',Boxes],['tienda','Traído de Tienda',Store],['rapida','Compra rápida para este pedido',ShoppingBag],['formal','Compra gestionada',Truck],['pendiente','Declarar faltante pendiente',Clock3]];
const factor=s=>Number(s.factor)>0?Number(s.factor):1;

export function OrigenesMaterial({origenes=[],snapshot}) {
  return <div className="om-origenes-material">{origenes.filter(o=>Number(o.cantidad_base)>0).map((o,i)=><span className={`om-origen-etiqueta om-origen-${o.tipo.toLowerCase()}`} key={o.recepcion_id||`${o.tipo}:${i}`}><strong>{origenTexto[o.tipo]}</strong> · {cantidadTexto(Number(o.cantidad_base)/factor(snapshot))} {snapshot.presentacion||snapshot.unidad_base}{o.referencia?` · ${o.referencia}`:''}</span>)}</div>;
}

export function ResumenEntregasPedido({datos,pedidoId,sucursalId}) {
  const resumen=datos.resumen_pedido;
  if(!resumen)return null;
  const nombres={PENDIENTE:'Pendiente',PARCIAL:'Envío parcial · pendiente de completar',COMPLETADO:'Completado',CANCELADO:'Cancelado'};
  return <section className="om-pedido om-resumen-entregas"><div className="om-section-title"><h3>{nombres[resumen.estado]||resumen.estado}</h3>{datos.tarea&&<strong>Entrega {datos.numero_entrega}</strong>}</div><p className="om-muted">Un solo pedido y el mismo QR para completar las cantidades restantes.</p>
    {resumen.entregas?.length>0&&<details><summary>Entregas del pedido ({resumen.entregas.length})</summary>{resumen.entregas.map(e=><Link className="om-task" key={e.id} to={`/operaciones/pedidos/${pedidoId}?sucursal=${sucursalId}&preparacion=${e.id}`}><span>Entrega {e.numero} · {e.preparador||'Sin asignar'} / {e.revisor||'Sin verificar'}</span><strong>{e.estado==='DESPACHADO'?'Retirada':e.estado==='ANULADO'?'Anulada':e.estado}</strong></Link>)}</details>}
  </section>;
}

export default function AbastecimientoLinea({linea,revision,puedeEditar,ocupado,bloqueada,abierta,onAbrir,onCerrar,onGuardar,sucursales,sucursalId,onComprobante,fotosCantidad=0}) {
  const s=linea.snapshot,f=factor(s),personal=Boolean(s.es_personalizado);
  const recibidas=linea.recepciones||[];
  const originales=(revision?linea.origenes_revision??linea.origenes_preparacion:linea.origenes_preparacion)||[];
  const stockDeclarado=Number(originales.find(o=>['ALMACEN','EXISTENCIA_PERSONALIZADA'].includes(o.tipo))?.cantidad_base||0);
  const saldoRecibido=recibidas.reduce((n,r)=>n+Number(r.saldo),0);
  const faltante=Math.max(0,Number(s.pendiente_base)-stockDeclarado-saldoRecibido);
  const [modo,setModo]=useState('origenes');
  const [cantidad,setCantidad]=useState(String((faltante||Number(s.pendiente_base))/f));
  const [referencia,setReferencia]=useState(s.marca||'Tercero');
  const tiendas=sucursales.filter(t=>t.tipo!=='virtual'&&String(t.id)!==String(sucursalId));
  const [tienda,setTienda]=useState(tiendas[0]?.id?String(tiendas[0].id):'');
  const [costo,setCosto]=useState('');const [comprobante,setComprobante]=useState(null);
  const [nota,setNota]=useState(revision?linea.observacion_revision||'':linea.observacion||'');
  const [pendiente,setPendiente]=useState(linea.pendiente_tipo||'');
  const [cantidades,setCantidades]=useState(()=>{
    const mapa={ALMACEN:String(stockDeclarado/f)};
    for(const r of recibidas)mapa[r.id]=String(Number(originales.find(o=>o.recepcion_id===r.id)?.cantidad_base||0)/f);
    if(!revision||!originales.length){let resto=Number(linea.confirmada?linea.preparada_base:s.pendiente_base);for(const r of recibidas){const q=Math.min(resto,Number(r.saldo));mapa[r.id]=String(q/f);resto-=q;}mapa.ALMACEN=String(resto/f);}
    return mapa;
  });
  const [error,setError]=useState('');const intento=useRef(crypto.randomUUID());
  const disabled=ocupado||bloqueada;
  const total=Object.values(cantidades).reduce((n,v)=>n+(Number(String(v).replace(',','.'))||0)*f,0);
  function base(v){const n=cantidadOperacion(v)*f,q=Math.round(n*1e6)/1e6;if(Math.abs(n-q)>1e-8)throw new Error('Usa una cantidad exacta con hasta seis decimales en base.');return q;}
  async function guardar(event){
    event.preventDefault();setError('');
    try{
      let accion,payload;
      if(modo==='origenes'){
        const origenes=[];const almacen=base(cantidades.ALMACEN||'0');
        for(const r of recibidas){const q=base(cantidades[r.id]||'0');if(q>0)origenes.push({tipo:r.tipo,recepcion_id:r.id,cantidad_base:q});}
        if(almacen>0)origenes.push({tipo:personal?'EXISTENCIA_PERSONALIZADA':'ALMACEN',cantidad_base:almacen});
        const q=origenes.reduce((n,o)=>n+o.cantidad_base,0);
        if(q>Number(s.pendiente_base))throw new Error('La cantidad supera lo pendiente del pedido.');
        if(!revision&&q<Number(s.pendiente_base)&&(!(pendiente||q===0)||!nota.trim()))throw new Error('Declara qué se hará con el faltante y su motivo.');
        if(revision&&q!==Number(linea.preparada_base)&&!nota.trim())throw new Error('Indica el motivo de la diferencia.');
        accion=revision?'guardar_revision':'guardar_preparacion';payload={linea_id:linea.pedido_linea_id,cantidad_base:q,origenes,observacion:nota.trim(),...(revision?{metodo:'visual'}:{pendiente_tipo:pendiente||(q===0?'POR_COMPLETAR':null)})};
      }else if(modo==='pendiente'){
        accion='declarar_pendiente';payload={linea_id:linea.pedido_linea_id,pendiente_tipo:pendiente,observacion:nota.trim()};
      }else if(modo==='formal'){
        accion='gestionar_compra';payload={linea_id:linea.pedido_linea_id,cantidad_base:base(cantidad),observacion:nota.trim()||'Pendiente de compra gestionada'};
      }else{
        if(comprobante&&(fotosCantidad>=10||!['image/jpeg','image/png','image/webp'].includes(comprobante.type)||comprobante.size>20*1024*1024))throw new Error('Adjunta un comprobante JPEG, PNG o WebP de hasta 20 MB y deja espacio entre las diez fotos del alistado.');
        accion='registrar_abastecimiento';payload={id:intento.current,linea_id:linea.pedido_linea_id,tipo:modo==='tienda'?'TIENDA':'COMPRA_RAPIDA',cantidad_base:base(cantidad),referencia:modo==='tienda'?tiendas.find(t=>String(t.id)===tienda)?.nombre||'Tienda':referencia.trim()||'Tercero',...(modo==='tienda'?{sucursal_tienda_id:Number(tienda)}:{costo:costo===''?null:cantidadOperacion(costo),comprobante_en_alistado:Boolean(comprobante)})};
      }
      const ok=await onGuardar(accion,payload);
      if(ok!==false){if(comprobante&&modo==='rapida')onComprobante?.(comprobante);intento.current=crypto.randomUUID();onCerrar();}else setError('No se guardó. Conservamos tus datos para reintentar.');
    }catch(e){setError(e.message);}
  }
  return <div className="om-abastecimiento">
    <OrigenesMaterial origenes={originales} snapshot={s}/>
    {personal&&!linea.confirmada&&!saldoRecibido&&<p className="om-muted">Declara dónde está el material. Ser personalizado no implica una compra.</p>}
    {linea.pendiente_tipo&&<p className="om-muted">{pendientesTexto[linea.pendiente_tipo]}</p>}
    {linea.compras?.filter(c=>c.estado!=='CANCELADA').map(c=><p className="om-compra-vinculada" key={c.id}>Compra gestionada · {c.estado==='RECIBIDA'?'Recibida':c.estado==='COMPRADA'?'En curso':'Solicitada'} · {cantidadTexto(Number(c.cantidad_recibida)/f)} de {cantidadTexto(Number(c.cantidad_base)/f)} {s.presentacion||s.unidad_base} <Link to="/compras">Consultar compra</Link></p>)}
    {recibidas.some(r=>Number(r.saldo)>0)&&<p className="om-muted">Recepción del pedido · se reutiliza al alistar: {cantidadTexto(saldoRecibido/f)} {s.presentacion||s.unidad_base}</p>}
    {puedeEditar&&!abierta&&<button className="om-secondary om-icon-action" aria-label={revision?'Comprobar cantidades por origen':'Origen / resolver faltante'} title={revision?'Comprobar cantidades por origen':'Origen / resolver faltante'} disabled={disabled} onClick={onAbrir}><Layers size={20} aria-hidden="true"/></button>}
    {abierta&&<form className="om-editor" aria-label={`Abastecimiento de ${s.nombre}`} onSubmit={guardar}>
      {!revision&&<><div className="om-abastecimiento-actions" role="group" aria-label="Acción de abastecimiento">{acciones.map(([id,nombre,Icon])=><button key={id} type="button" className="om-icon-action" aria-label={nombre} title={nombre} aria-pressed={modo===id} disabled={disabled} onClick={()=>{setModo(id);setError('');intento.current=crypto.randomUUID();}}><Icon size={20} aria-hidden="true"/></button>)}</div><strong className="om-abastecimiento-heading">{acciones.find(([id])=>id===modo)?.[1]}</strong></>}
      {modo==='origenes'?<><label>{personal?'Almacén · personalizado':'Almacén'} · {s.presentacion||s.unidad_base}<input aria-label="Cantidad de Almacén" inputMode="decimal" value={cantidades.ALMACEN} disabled={disabled} onChange={e=>setCantidades({...cantidades,ALMACEN:e.target.value})}/></label>{recibidas.map(r=><label key={r.id}>{origenTexto[r.tipo]} · {r.referencia} · saldo {cantidadTexto(Number(r.saldo)/f)}<input aria-label={`Cantidad de ${r.referencia}`} inputMode="decimal" value={cantidades[r.id]||'0'} disabled={disabled} onChange={e=>setCantidades({...cantidades,[r.id]:e.target.value})}/></label>)}<p>Esta entrega: <strong>{cantidadTexto(total/f)} {s.presentacion||s.unidad_base}</strong> · quedan {cantidadTexto(Math.max(0,Number(s.pendiente_base)-total)/f)} pendientes.</p></>:modo!=='pendiente'&&<label>Cantidad · {s.presentacion||s.unidad_base}<input aria-label="Cantidad de abastecimiento" inputMode="decimal" value={cantidad} disabled={disabled} onFocus={e=>e.target.select()} onChange={e=>setCantidad(e.target.value)} required/></label>}
      {modo==='tienda'&&<><label>Tienda de origen<select value={tienda} disabled={disabled} required onChange={e=>setTienda(e.target.value)}><option value="">Seleccionar Tienda</option>{tiendas.map(t=><option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label><p className="om-muted">Declara material que ya trajiste a Almacén. No pide aprobación ni modifica el stock de Tienda.</p></>}
      {modo==='rapida'&&<><label>Marca / proveedor<input aria-label="Marca o proveedor" maxLength={200} value={referencia} disabled={disabled} onChange={e=>setReferencia(e.target.value)}/></label><div className="om-reason-options">{s.marca&&<button type="button" disabled={disabled} onClick={()=>setReferencia(s.marca)}>{s.marca}</button>}<button type="button" disabled={disabled} onClick={()=>setReferencia('Tercero')}>Tercero</button></div><details><summary>Costo y comprobante (opcionales)</summary><label>Costo<input inputMode="decimal" value={costo} disabled={disabled} onChange={e=>setCosto(e.target.value)}/></label><label>Foto del comprobante<input aria-label="Comprobante de compra rápida" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={e=>setComprobante(e.target.files?.[0]||null)}/></label><p className="om-muted">El comprobante se incluye entre las fotos del alistado.</p></details><p className="om-muted">Recibido exclusivamente para este pedido. Quedará pendiente de verificación y retiro.</p></>}
      {((modo==='origenes'&&!revision&&total<Number(s.pendiente_base))||modo==='pendiente')&&<label>Qué se hará con el faltante<select aria-label="Situación del faltante" value={pendiente} disabled={disabled} required onChange={e=>setPendiente(e.target.value)}><option value="">Elegir situación</option>{Object.entries(pendientesTexto).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
      {['origenes','pendiente','formal'].includes(modo)&&<label>{revision?'Motivo de la diferencia':'Motivo / observación'}<input maxLength={1000} value={nota} disabled={disabled} onChange={e=>setNota(e.target.value)}/></label>}
      {error&&<p role="alert" className="om-error-text">{error}</p>}
      <div className="om-input-row"><button className="om-primary" disabled={disabled}><Check size={18} aria-hidden="true"/> {ocupado?'Guardando…':modo==='rapida'||modo==='tienda'?'Recibido para este pedido':modo==='formal'?'Solicitar compra':modo==='pendiente'?'Guardar pendiente':revision?'Guardar verificación':'Guardar alistado'}</button><button className="om-secondary om-icon-action" type="button" aria-label="Cancelar" title="Cancelar" disabled={disabled} onClick={onCerrar}><X size={20} aria-hidden="true"/></button></div>
    </form>}
  </div>;
}
