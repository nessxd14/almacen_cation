import { describe, it, expect, vi } from "vitest";
import { syncLinea } from "./guardarLinea";

function fakeSupabase(upsertResult) {
  return {
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue(upsertResult),
    })),
  };
}

const lineDB = {
  cliente_uuid: "uuid-1",
  sesion_id: "sesion-1",
  foto_ref: "sesion_sesion-1/uuid-1.jpg",
};
const fotoBlob = { type: "image/jpeg" };

describe("syncLinea", () => {
  it("foto falla + fila OK → estado sin_foto, sin flash de éxito verde", async () => {
    const supabase = fakeSupabase({ error: null });
    const subirFotoConteo = vi.fn().mockRejectedValue(new Error("bucket no existe"));

    const { syncState, flash } = await syncLinea({ isOnline: true, supabase, subirFotoConteo, lineDB, fotoBlob });

    expect(syncState).toBe("sin_foto");
    expect(flash.type).not.toBe("ok");
  });

  it("fila falla → estado pending, flash de advertencia", async () => {
    const supabase = fakeSupabase({ error: { message: "network error" } });
    const subirFotoConteo = vi.fn();

    const { syncState, flash } = await syncLinea({ isOnline: true, supabase, subirFotoConteo, lineDB, fotoBlob });

    expect(syncState).toBe("pending");
    expect(flash.type).toBe("warn");
    expect(subirFotoConteo).not.toHaveBeenCalled();
  });

  it("ambas OK → estado ok, flash de éxito", async () => {
    const supabase = fakeSupabase({ error: null });
    const subirFotoConteo = vi.fn().mockResolvedValue(lineDB.foto_ref);

    const { syncState, flash } = await syncLinea({ isOnline: true, supabase, subirFotoConteo, lineDB, fotoBlob });

    expect(syncState).toBe("ok");
    expect(flash.type).toBe("ok");
  });

  it("offline → estado pending, mensaje de offline (no de error)", async () => {
    const supabase = fakeSupabase({ error: null });
    const subirFotoConteo = vi.fn();

    const { syncState, flash } = await syncLinea({ isOnline: false, supabase, subirFotoConteo, lineDB, fotoBlob });

    expect(syncState).toBe("pending");
    expect(flash.type).toBe("info");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(subirFotoConteo).not.toHaveBeenCalled();
  });

  it("rowAlreadySaved: no reintenta el upsert, sólo la foto", async () => {
    const supabase = fakeSupabase({ error: null });
    const subirFotoConteo = vi.fn().mockResolvedValue(lineDB.foto_ref);

    const { syncState } = await syncLinea({
      isOnline: true, supabase, subirFotoConteo, lineDB, fotoBlob, rowAlreadySaved: true,
    });

    expect(syncState).toBe("ok");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
