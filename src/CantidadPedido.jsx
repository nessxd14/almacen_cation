import { useState } from 'react';
import { CircleSlash } from 'lucide-react';
import { cantidadOperacion, cantidadTexto } from './lib/operacionesMovil';

export default function CantidadPedido({linea,revision,ocupado,bloqueada,onEditar,onCancelar,onGuardar,abastecimiento=false}) {
  const s=linea.snapshot;
  const factor=Number(s.factor)>0?Number(s.factor):1;
  const inicial=Number(revision ? linea.revisada_base ?? linea.preparada_base : linea.confirmada ? linea.preparada_base : s.preparable ? s.pendiente_base : 0);
  const baseInicial=Math.abs(Math.round(inicial/factor*1e6)/1e6*factor-inicial)>1e-8;
  const [enBase,setEnBase]=useState(baseInicial);
  const [valor,setValor]=useState(String(inicial/(baseInicial?1:factor)));
  const [nota,setNota]=useState(revision?linea.observacion_revision||'':linea.observacion||'');
  const [pendienteTipo,setPendienteTipo]=useState(linea.pendiente_tipo||'');
  const [error,setError]=useState('');
  const [editada,setEditada]=useState(false);
  const n=Number(valor.replace(',','.'))*(enBase?1:factor);
  const requiereNota=revision?n!==Number(linea.preparada_base):n<Number(s.pendiente_base);
  const confirmada=revision?linea.revisada_base!=null:linea.confirmada;
  const disabled=ocupado||bloqueada;
  function editar(){setEditada(true);onEditar();}
  async function guardar(event) {
    event.preventDefault();setError('');
    try {
      const cantidad=cantidadOperacion(valor)*(enBase?1:factor),base=Math.round(cantidad*1e6)/1e6;
      if(Math.abs(base-cantidad)>1e-8)throw new Error('Usa unidades base para indicar esta cantidad exacta.');
      if(base>Number(s.pendiente_base))throw new Error('La cantidad supera lo pendiente del pedido.');
      if(requiereNota && !nota.trim())throw new Error(revision?'Indica el motivo de la diferencia.':'Indica el motivo del faltante.');
      if(abastecimiento&&!revision&&requiereNota&&base>0&&!pendienteTipo)throw new Error('Declara qué se hará con el faltante.');
      const ok=await onGuardar({linea_id:linea.pedido_linea_id,cantidad_base:base,observacion:nota.trim(),...(revision?{metodo:'visual'}:abastecimiento?{pendiente_tipo:base===0?pendienteTipo||'POR_COMPLETAR':pendienteTipo||null}:{})});
      if(ok!==false){setEditada(false);onCancelar();}
    } catch(e){setError(e.message);}
  }
  function cancelar(){setValor(String(inicial/(baseInicial?1:factor)));setEnBase(baseInicial);setNota(revision?linea.observacion_revision||'':linea.observacion||'');setPendienteTipo(linea.pendiente_tipo||'');setEditada(false);setError('');onCancelar();}
  return <form className="om-cantidad-pedido" onSubmit={guardar}>
    <div className="om-cantidad-pedido-campos"><label>{revision?'Voy a retirar':'Cantidad alistada'}<input aria-label={`${revision?'Cantidad a retirar':'Cantidad alistada'} de ${s.nombre}`} type="text" inputMode="decimal" enterKeyHint="done" pattern="[0-9]+([.,][0-9]{1,6})?" value={valor} disabled={disabled}
      onFocus={e=>e.target.select()} onChange={e=>{setValor(e.target.value);editar();}} autoComplete="off" required /></label>
      {factor!==1?<label>Unidad<select value={enBase?'base':'presentacion'} disabled={disabled} onChange={e=>{const base=e.target.value==='base';setValor(valor===''?'':String(Math.round(n/(base?1:factor)*1e6)/1e6));setEnBase(base);editar();}}><option value="presentacion">{s.presentacion||s.unidad_base}</option><option value="base">{s.unidad_base}</option></select></label>:<span>{s.unidad_base}</span>}
    </div>
    {requiereNota && <label>{revision?'Motivo de la diferencia':'Motivo del faltante'}<input value={nota} maxLength={1000} disabled={disabled} onChange={e=>{setNota(e.target.value);editar();}} placeholder={revision?'Qué encontraste al revisar':'Qué quedó pendiente'} /></label>}
    {abastecimiento&&n===0&&<><p className="om-pendiente-entrega">No sale en esta entrega · {cantidadTexto(Number(s.pendiente_base)/factor)} {s.presentacion||s.unidad_base} pendientes con el mismo QR.</p><div className="om-reason-options" aria-label="Motivos para otra entrega">{['Se enviará después','No se alistó a tiempo','Falta material'].map(m=><button key={m} type="button" disabled={disabled} aria-pressed={nota===m} onClick={()=>{setNota(m);setPendienteTipo('POR_COMPLETAR');editar();}}>{m}</button>)}</div></>}
    {abastecimiento&&!revision&&requiereNota&&n!==0&&<label>Qué se hará con el faltante<select aria-label={`Situación pendiente de ${s.nombre}`} value={pendienteTipo} disabled={disabled} onChange={e=>{setPendienteTipo(e.target.value);editar();}} required><option value="">Elegir situación</option><option value="POR_COMPLETAR">Se enviará después</option><option value="TIENDA">Por traer de Tienda</option><option value="COMPRA_RAPIDA">Pendiente de compra rápida</option><option value="COMPRA_GESTIONADA">Compra gestionada</option></select></label>}
    {Number.isFinite(n) && n>=0 && n<=Number(s.pendiente_base) && <p className="om-muted">Quedarán pendientes: {cantidadTexto((Number(s.pendiente_base)-n)/(enBase?1:factor))} {enBase?s.unidad_base:s.presentacion||s.unidad_base}</p>}
    {error && <p className="om-error-text" role="alert">{error}</p>}
    <div className="om-input-row"><button className="om-secondary" disabled={disabled||confirmada&&!editada}>{editada?'Guardar ajuste':confirmada?'Cantidad confirmada':'Confirmar cantidad'}</button>{editada ? <button className="om-secondary" type="button" disabled={disabled} onClick={cancelar}>Cancelar ajuste</button> : n>0 && <button className={`om-secondary ${abastecimiento?'om-icon-action':''}`} type="button" aria-label={abastecimiento?'Dejar para otra entrega':undefined} title={abastecimiento?'Dejar para otra entrega':undefined} disabled={disabled} onClick={()=>{setValor('0');editar();}}>{abastecimiento?<CircleSlash size={20} aria-hidden="true"/>:revision?'Sin salida':'No se alistó'}</button>}</div>
  </form>;
}
