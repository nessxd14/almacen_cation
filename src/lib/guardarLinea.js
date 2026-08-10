// guardarLinea.js
// Lógica de sincronización de una línea de conteo físico, separada de
// ConteoApp para poder testearla sin React ni Supabase real.
//
// Orden: la fila (el dato del conteo) vale más que la foto, así que se
// guarda primero. Si falla, la línea queda "pending" y se avisa — nunca
// un ✓ de éxito cuando el servidor no tiene la fila. Si la fila se guarda
// pero la foto falla, la línea queda "sin_foto": recuperable, sin riesgo
// para el dato.

export function syncLinea({ isOnline, supabase, subirFotoConteo, lineDB, fotoBlob, rowAlreadySaved = false }) {
  if (!isOnline) {
    return Promise.resolve({
      syncState: "pending",
      flash: { type: "info", msg: "Guardada offline · se subirá al reconectar" },
    });
  }
  return syncOnline({ supabase, subirFotoConteo, lineDB, fotoBlob, rowAlreadySaved });
}

async function syncOnline({ supabase, subirFotoConteo, lineDB, fotoBlob, rowAlreadySaved }) {
  if (!rowAlreadySaved) {
    const { error } = await supabase
      .from("conteo_fisico_inicial")
      .upsert(lineDB, { onConflict: "cliente_uuid" });
    if (error) {
      console.error("upsert conteo falló:", error);
      return {
        syncState: "pending",
        flash: { type: "warn", msg: "Guardada solo en este equipo — sin conexión con el servidor" },
      };
    }
  }

  try {
    await subirFotoConteo({ sesionId: lineDB.sesion_id, clienteUuid: lineDB.cliente_uuid, archivo: fotoBlob });
    return { syncState: "ok", flash: { type: "ok", msg: "Línea guardada ✓" } };
  } catch (e) {
    console.error("subirFotoConteo falló:", e);
    return {
      syncState: "sin_foto",
      flash: { type: "neutral", msg: "Línea guardada · foto pendiente de subir" },
    };
  }
}
