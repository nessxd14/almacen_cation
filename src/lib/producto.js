// Formatea la marca truncando si es muy larga. Devuelve "" si no hay marca.
export function marcaFmt(marca, max = 20) {
  if (!marca || !String(marca).trim()) return "";
  const m = String(marca).trim();
  return m.length > max ? m.slice(0, max - 1) + "…" : m;
}

// Devuelve la "línea meta" bajo el nombre: "Marca · SKU" o solo uno de los dos.
// Uso: <p className="text-xs text-slate-500">{metaProducto(producto)}</p>
export function metaProducto({ marca, sku_interno } = {}) {
  const partes = [];
  const m = marcaFmt(marca);
  if (m) partes.push(m);
  if (sku_interno && String(sku_interno).trim()) partes.push(String(sku_interno).trim());
  return partes.join(" · ");
}
