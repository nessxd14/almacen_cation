/**
 * lib/pedidoBorrador.js — Carrito en memoria para "Agregar a pedido" (Catálogo)
 * → armador de pedido (tab Pedidos). Store mínimo con suscripción, sin
 * dependencias externas — vive solo mientras dura la sesión del navegador.
 */

const listeners = new Set();
let lineas = []; // [{producto_id, nombre, sku_interno, unidad_base, cantidad_base}]

function notificar() {
  for (const fn of listeners) fn(lineas);
}

export function obtenerBorrador() {
  return lineas;
}

export function agregarAlBorrador(producto, cantidadBase = 1) {
  const existente = lineas.find((l) => l.producto_id === producto.id);
  if (existente) {
    lineas = lineas.map((l) =>
      l.producto_id === producto.id
        ? { ...l, cantidad_base: Number(l.cantidad_base) + Number(cantidadBase) }
        : l
    );
  } else {
    lineas = [...lineas, {
      producto_id: producto.id,
      nombre: producto.nombre,
      sku_interno: producto.sku_interno,
      unidad_base: producto.unidad_base,
      cantidad_base: Number(cantidadBase),
    }];
  }
  notificar();
}

export function quitarDelBorrador(productoId) {
  lineas = lineas.filter((l) => l.producto_id !== productoId);
  notificar();
}

export function actualizarCantidadBorrador(productoId, cantidadBase) {
  lineas = lineas.map((l) =>
    l.producto_id === productoId ? { ...l, cantidad_base: Number(cantidadBase) } : l
  );
  notificar();
}

export function limpiarBorrador() {
  lineas = [];
  notificar();
}

export function suscribirBorrador(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
