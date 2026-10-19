// Lógica pura del modelo de presentaciones (unidad base + cadena + precio
// por presentación). La base de datos es la fuente de verdad: los triggers
// calculan factor_unidad_base de una cadena y validan precios/roles. Esto
// solo arma textos y chequeos del lado del cliente.

export const UNIDADES_RAPIDAS = ['Unidad', 'Hoja', 'Pieza', 'Lámina', 'Pliego', 'Metro', 'Rollo'];

// Columnas de precio propio en `presentacion` ↔ columna resuelta en
// v_presentacion_precio. El orden es el de la pantalla.
export const TIPOS_PRECIO = [
  { columna: 'precio', resuelto: 'precio_retail', label: 'Público' },
  { columna: 'precio_mayoreo', resuelto: 'precio_mayoreo', label: 'Mayoreo' },
  { columna: 'precio_institucion', resuelto: 'precio_institucion', label: 'Institución' },
  { columna: 'precio_corporativo', resuelto: 'precio_corporativo', label: 'Corporativo' },
  { columna: 'precio_municipal', resuelto: 'precio_municipal', label: 'Municipal' },
];

// Mismos roles que app_es_admin() en la base.
export function puedeEditarPrecios(rol) {
  return rol === 'admin' || rol === 'gerente';
}

const numero = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 3 });
const moneda = new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' });

export const formatearCantidad = (n) => numero.format(Number(n));
// Intl separa "Bs" con un espacio duro; se normaliza para textos y tests.
export const formatearBs = (n) => moneda.format(Number(n)).replace(/\s/gu, " ");

// Factor de una presentación encadenada: N × factor de la que contiene.
// null si falta algún dato (para no inventar un número).
export function factorDeCadena(presentaciones, contieneId, cantidad) {
  const contenida = presentaciones.find((p) => String(p.id) === String(contieneId));
  const n = Number(cantidad);
  if (!contenida || !Number.isFinite(n) || n <= 0) return null;
  return n * Number(contenida.factor_unidad_base);
}

// Presentaciones que pueden ir dentro de `selfId`: activas, del mismo
// producto (la lista ya viene filtrada), base incluida, y sin ciclos (nunca
// una que directa o indirectamente ya contiene a `selfId`).
export function opcionesContenedor(presentaciones, selfId) {
  const porId = new Map(presentaciones.map((p) => [String(p.id), p]));
  const contieneASelf = (p) => {
    const vistos = new Set();
    let actual = p;
    while (actual?.contiene_presentacion_id != null && !vistos.has(String(actual.id))) {
      vistos.add(String(actual.id));
      if (String(actual.contiene_presentacion_id) === String(selfId)) return true;
      actual = porId.get(String(actual.contiene_presentacion_id));
    }
    return false;
  };
  return presentaciones.filter((p) =>
    p.activo !== false && (selfId == null || (String(p.id) !== String(selfId) && !contieneASelf(p))));
}

// "1 CAJA MASTER = 24 PAQUETE = 12.000 Hoja". Sin cadena (o si contiene
// directamente a la base) queda "1 PAQUETE = 500 Hoja".
export function textoEquivalencia({ nombre, factor, baseNombre, contiene = null, cantidad = null }) {
  const unidad = baseNombre || 'Unidad';
  const partes = [`1 ${nombre?.trim() || 'presentación'}`];
  if (contiene && !contiene.es_base && cantidad != null) {
    partes.push(`${formatearCantidad(cantidad)} ${contiene.nombre}`);
  }
  if (factor != null && Number.isFinite(Number(factor))) {
    partes.push(`${formatearCantidad(factor)} ${unidad}`);
  }
  return partes.join(' = ');
}

// Precio que aplica si el input queda vacío: precio del producto para ese
// tipo (la fila base de la vista ya trae el fallback a precio_base) × factor.
export function precioCalculado(filaBase, resuelto, factor) {
  const unitario = filaBase?.[resuelto];
  if (unitario == null || factor == null) return null;
  return Number(unitario) * Number(factor);
}

// Aviso (no bloquea) cuando una presentación sale a menos de la mitad por
// unidad base que la unidad base suelta — el caso típico de un producto
// cargado con la base "hoja" pero el precio del paquete entero.
export function advertenciaPrecioBajo({ nombre, precio, factor, baseNombre, precioBase }) {
  const p = Number(precio);
  const f = Number(factor);
  const b = Number(precioBase);
  if (precio == null || precioBase == null || !(f > 0) || !(b > 0) || !Number.isFinite(p)) return null;
  const porUnidad = p / f;
  if (porUnidad >= b * 0.5) return null;
  const unidad = baseNombre || 'Unidad';
  // Redacción sin artículos (la Hoja / el Metro, esta CAJA / este PAQUETE).
  return `${nombre} sale a ${formatearBs(porUnidad)} por ${unidad}; 1 ${unidad} cuesta ${formatearBs(b)}. Revisá el precio de 1 ${unidad} o el de ${nombre}.`;
}
