import {useRef,useState} from 'react';
import {Undo2,Check,X} from 'lucide-react';
import {supabase} from './supabaseClient';
import {useUsuarioActual} from './lib/useAuth';

export default function CorreccionSalidaDocumental({evento,onCorregido}) {
  const usuario=useUsuarioActual();const [abierta,setAbierta]=useState(false);const [motivo,setMotivo]=useState('');const [error,setError]=useState('');const [ocupado,setOcupado]=useState(false);const intento=useRef(crypto.randomUUID());
  if(evento.revertido)return <small>Salida documental corregida{evento.correccion_documental_motivo?` · ${evento.correccion_documental_motivo}`:''}</small>;
  if(!['admin','gerente'].includes(usuario?.rol))return <small>Corrección a cargo de un encargado</small>;
  async function guardar(e){e.preventDefault();if(ocupado)return;setOcupado(true);setError('');try{const {data,error:fallo}=await supabase.rpc('corregir_salida_documental',{p_evento:evento.id,p_motivo:motivo.trim(),p_intento:intento.current});if(fallo)throw fallo;onCorregido(data);}catch(err){setError(err.message);}finally{setOcupado(false);}}
  return abierta?<form onSubmit={guardar} className="flex flex-wrap gap-2"><label className="text-xs">Motivo de la corrección<input value={motivo} minLength={3} maxLength={1000} required disabled={ocupado} onChange={e=>setMotivo(e.target.value)} className="rounded-lg border p-2"/></label><p className="w-full text-xs">Confirma que todo el material de esta salida volvió a quedar asignado al pedido. Se corregirá la cantidad entregada, sin movimientos de inventario.</p>{error&&<p role="alert" className="w-full text-xs text-red-600">{error}</p>}<button aria-label="Confirmar corrección documental" title="Confirmar corrección documental" disabled={ocupado} className="min-h-11 min-w-11 rounded-lg border p-3"><Check size={18}/></button><button type="button" aria-label="Cancelar corrección" title="Cancelar corrección" disabled={ocupado} onClick={()=>setAbierta(false)} className="min-h-11 min-w-11 rounded-lg border p-3"><X size={18}/></button></form>:<button type="button" aria-label="Corregir salida documental" title="Corregir salida documental" onClick={()=>setAbierta(true)} className="min-h-11 min-w-11 rounded-lg border p-3 text-orange-700"><Undo2 size={18}/></button>;
}
