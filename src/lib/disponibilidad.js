// lib/disponibilidad.js — aviso de disponibilidad en ArmadorPedido (brief
// W7), lógica pura separada para poder testearla sin Supabase ni React —
// mismo patrón que src/lib/control.js y src/lib/despacho.js.
//
// Los números salen de saldo_vendible (vendible ya neto de lo reservado por
// otros pedidos, más el motivo con los nombres de esos pedidos) — acá no se
// reimplementa ese cálculo, solo se arma el mensaje.

// -> { vendible, reservado, motivo, noAlcanza } | null si aún no llegó el dato
export function avisoDisponibilidad({ cantidadPedida, vendible, reservado, motivo }) {
  if (vendible == null) return null;
  const pedida = Number(cantidadPedida) || 0;
  const vend = Number(vendible) || 0;
  return {
    vendible: vend,
    reservado: Number(reservado) || 0,
    motivo: motivo || null,
    noAlcanza: Math.max(pedida - vend, 0),
  };
}

// Líneas cuyo aviso de disponibilidad indica que no alcanza — para el
// confirm al guardar ("N de M líneas no tienen stock suficiente").
export function lineasSinCobertura(lineas) {
  return lineas.filter((l) => {
    const aviso = avisoDisponibilidad({
      cantidadPedida: l.cantidadBaseIngresada,
      vendible: l.disponibilidad?.vendible,
      reservado: l.disponibilidad?.reservado,
      motivo: l.disponibilidad?.motivo,
    });
    return aviso != null && aviso.noAlcanza > 0;
  });
}
