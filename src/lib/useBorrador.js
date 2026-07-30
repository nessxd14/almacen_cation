import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Brief H — useBorrador: autosave transversal de formularios (puerto JS del
 * mismo hook del POS, src/hooks/useBorrador.ts en nessxd14/seller — misma
 * clave, mismo comportamiento).
 *
 * cation:borrador:v1:<usuarioId>:<formulario>
 */
export const borradorKey = (formulario, usuarioId) => `cation:borrador:v1:${usuarioId}:${formulario}`;

// Todo acceso a localStorage pasa por acá: en modo privado de Safari `setItem`
// tira excepción, y no puede tumbar el formulario que lo llama.
const safeGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* cuota llena / modo privado */ } };
const safeRemove = (key) => { try { localStorage.removeItem(key); } catch { /* ver arriba */ } };

/**
 * @param {string} clave
 * @param {*} estado
 * @param {{ activo?: boolean, debounceMs?: number, ttlHoras?: number }} [opciones]
 */
export function useBorrador(clave, estado, opciones = {}) {
  const { activo = true, debounceMs = 500, ttlHoras = 24 } = opciones;
  const [borradorPendiente, setBorradorPendiente] = useState(null);
  const claveRef = useRef(clave);
  const initialSerializedRef = useRef(JSON.stringify(estado));
  const timeoutRef = useRef(null);

  useEffect(() => {
    claveRef.current = clave;
    initialSerializedRef.current = JSON.stringify(estado);
    const raw = safeGet(clave);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee localStorage una vez por montaje/cambio de clave, no una sincronización de estado derivado
    if (!raw) { setBorradorPendiente(null); return; }
    try {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.guardadoEn > ttlHoras * 3_600_000) {
        safeRemove(clave);
        setBorradorPendiente(null);
        return;
      }
      setBorradorPendiente(parsed);
    } catch {
      safeRemove(clave);
      setBorradorPendiente(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  useEffect(() => {
    if (!activo) return;
    if (JSON.stringify(estado) === initialSerializedRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      safeSet(clave, JSON.stringify({ datos: estado, guardadoEn: Date.now() }));
    }, debounceMs);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [estado, activo, clave, debounceMs]);

  const descartar = useCallback(() => {
    safeRemove(claveRef.current);
    setBorradorPendiente(null);
  }, []);

  const limpiar = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    safeRemove(claveRef.current);
    setBorradorPendiente(null);
  }, []);

  return { borradorPendiente, descartar, limpiar };
}
