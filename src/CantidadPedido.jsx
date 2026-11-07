import StockSistema from './StockSistema';
import { useState } from 'react';
import { CircleSlash } from 'lucide-react';
import { cantidadOperacion, cantidadTexto } from './lib/operacionesMovil';
import CantidadEmpaque from './CantidadEmpaque';
import { textoEmpaque } from './lib/empaque';

export default function CantidadPedido({linea,revision,ocupado,bloqueada,onEditar,onCancelar,onGuardar,abastecimiento=false,stock,lineasStock=[],traslado=false}) {
  const s=linea.snapshot;
  const factor=Number(s.factor)>0?Number(s.factor):1;
  const inicial=Number(revision ? linea.revisada_base ?? linea.preparada_base : linea.confirmada ? linea.preparada_base : s.preparable ? s.pendiente_base : 0);
  const [valor,setValor]=useState(String(inicial));
  const [nota,setNota]=useState(revision?linea.observacion_revision||'':linea.observacion||'');
  const [pendienteTipo,setPendienteTipo]=useState(linea.pendiente_tipo||'');
  const [error,setError]=useState('');
  const [editada,setEditada]=useState(false);
  const n=Number(valor);
  const objetivo=revision?Number(linea.preparada_base):Number(s.pendiente_base);
  const requiereNota=revision?n!==Number(linea.preparada_base):n<Number(s.pendiente_base);
  const confirmada=revision?linea.revisada_base!=null:linea.confirmada;
  const completa=valor!==''&&Number.isFinite(n)&&objetivo>0&&Math.abs(n-objetivo)<1e-9;
  const disabled=ocupado||bloqueada;
  function editar(){setEditada(true);onEditar();}
  async function guardar(event) {
    event.preventDefault();setError('');
    try {
      const base=Math.round(cantidadOperacion(valor)*1e6)/1e6;
      if(base>Number(s.pendiente_base))throw new Error('La cantidad supera lo pendiente del pedido.');
      if(requiereNota && !nota.trim())throw new Error(revision?'Indica el motivo de la diferencia.':'Indica el motivo del faltante.');
      if(abastecimiento&&!revision&&requiereNota&&base>0&&!pendienteTipo)throw new Error('Declara qué se hará con el faltante.');
      const ok=await onGuardar({linea_id:linea.pedido_linea_id,cantidad_base:base,observacion:nota.trim(),...(revision?{metodo:'visual'}:abastecimiento?{pendiente_tipo:base===0?pendienteTipo||'POR_COMPLETAR':pendienteTipo||null}:{})});
      if(ok!==false){setEditada(false);onCancelar();}
    } catch(e){setError(e.message);}
  }
  function cancelar(){setValor(String(inicial));setNota(revision?linea.observacion_revision||'':linea.observacion||'');setPendienteTipo(linea.pendiente_tipo||'');setEditada(false);setError('');onCancelar();}
  return <form className="om-cantidad-pedido" onSubmit={guardar}>
    <CantidadEmpaque valor={valor} onValor={v=>{setValor(v);editar();}} factor={factor} presentacion={s.presentacion} unidadBase={s.unidad_base} etiqueta={revision?(traslado?'Cantidad recibida':'Voy a retirar'):'Cantidad alistada'} ariaLabel={`${revision?'Cantidad a retirar':'Cantidad alistada'} de ${s.nombre}`} objetivo={objetivo} disabled={disabled}/>
    {requiereNota && <label>{revision?'Motivo de la diferencia':'Motivo del faltante'}<input value={nota} maxLength={1000} disabled={disabled} onChange={e=>{setNota(e.target.value);editar();}} placeholder={revision?'Qué encontraste al revisar':'Qué quedó pendiente'} /></label>}
    {abastecimiento&&n===0&&<><p className="om-pendiente-entrega">No sale en esta entrega · {cantidadTexto(Number(s.pendiente_base)/factor)} {s.presentacion||s.unidad_base} pendientes con el mismo QR.</p><div className="om-reason-options" aria-label="Motivos para otra entrega">{['Se enviará después','No se alistó a tiempo','Falta material'].map(m=><button key={m} type="button" disabled={disabled} aria-pressed={nota===m} onClick={()=>{setNota(m);setPendienteTipo('POR_COMPLETAR');editar();}}>{m}</button>)}</div></>}
    {abastecimiento&&!revision&&requiereNota&&n!==0&&<label>Qué se hará con el faltante<select aria-label={`Situación pendiente de ${s.nombre}`} value={pendienteTipo} disabled={disabled} onChange={e=>{setPendienteTipo(e.target.value);editar();}} required><option value="">Elegir situación</option><option value="POR_COMPLETAR">Se enviará después</option><option value="TIENDA">Por traer de Tienda</option><option value="COMPRA_RAPIDA">Pendiente de compra rápida</option><option value="COMPRA_GESTIONADA">Compra gestionada</option></select></label>}
    {valor!=='' && Number.isFinite(n) && n>=0 && n<Number(s.pendiente_base) && <p className="om-muted">Quedarán pendientes: {textoEmpaque(Number(s.pendiente_base)-n,s)}</p>}
    <StockSistema stock={stock} linea={linea} lineas={lineasStock} cantidad={n} traslado={traslado} revision={revision}/>
    {error && <p className="om-error-text" role="alert">{error}</p>}
    <div className="om-input-row"><button className={!editada&&!confirmada&&completa?'om-complete':'om-secondary'} disabled={disabled||confirmada&&!editada}>{editada?'Guardar ajuste':confirmada?'Cantidad confirmada':completa?`Completo · ${textoEmpaque(objetivo,s)}`:'Confirmar cantidad'}</button>{editada ? <button className="om-secondary" type="button" disabled={disabled} onClick={cancelar}>Cancelar ajuste</button> : n>0 && <button className={`om-secondary ${abastecimiento?'om-icon-action':''}`} type="button" aria-label={abastecimiento?'Dejar para otra entrega':undefined} title={abastecimiento?'Dejar para otra entrega':undefined} disabled={disabled} onClick={()=>{setValor('0');editar();}}>{abastecimiento?<CircleSlash size={20} aria-hidden="true"/>:revision?'Sin salida':'No se alistó'}</button>}</div>
  </form>;
}
