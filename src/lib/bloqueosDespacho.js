export function bloqueosEntrega({datos,puedePreparar,puedeRevisar,fotos,destino,evidencia,editor}) {
  const lineas=(datos.lineas||[]).filter(l=>l.vigente);
  const bloqueos=[...(datos.bloqueos_despacho||[])];
  const add=(codigo,detalle,linea_id=null)=>{if(!bloqueos.some(b=>b.codigo===codigo&&b.linea_id===linea_id))bloqueos.push({codigo,detalle,linea_id});};
  if(datos.cambios?.length)add('CAMBIOS','El pedido cambió. Actualiza la preparación para comprobar las cantidades vigentes.');
  if(puedePreparar||puedeRevisar){
    for(const l of lineas){
      if(!l.confirmada)add('CANTIDAD','Confirma cuánto sale ahora. El 0 deja esta línea para otra entrega.',l.pedido_linea_id);
      else if(puedeRevisar&&Number(l.preparada_base)>0&&l.revisada_base==null)add('REVISION','Comprueba el material y la cantidad que vas a retirar.',l.pedido_linea_id);
    }
    if(!lineas.some(l=>Number(puedeRevisar?l.revisada_base??l.preparada_base:l.preparada_base)>0))add('VACIA','No hay material para retirar. Dejar todo en 0 conserva el pedido pendiente y no genera una salida.');
    if(!fotos.length)add('FOTOS',puedeRevisar?'Falta la foto de esta verificación y retiro.':'Falta la foto del material alistado.');
    if(!evidencia?.activo)add('EVIDENCIA','No se ha podido habilitar la evidencia. Actualiza su consulta para continuar.');
    if(puedeRevisar&&destino.trim().length<3)add('DESTINO','Indica el destino de esta entrega.');
  }
  for(const p of datos.plan_salida||[])if(p.error&&!bloqueos.some(b=>b.linea_id===p.linea_id))add('PLAN',p.error,p.linea_id);
  if(editor)add('BORRADOR','Guarda o cancela el ajuste abierto antes de continuar.');
  return bloqueos;
}
