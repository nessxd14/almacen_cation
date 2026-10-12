export function esEAN13Valido(valor) {
  const texto = String(valor ?? '');
  if (!/^\d{13}$/.test(texto)) return false;
  const suma = [...texto.slice(0, 12)].reduce((total, digito, i) => total + Number(digito) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - suma % 10) % 10 === Number(texto[12]);
}

export function resolverSimbologia(valor, seleccion = 'automatico') {
  if (seleccion === 'EAN13') {
    if (!esEAN13Valido(valor)) throw new Error('EAN-13 requiere 13 dígitos con un dígito de control válido. Elige Automático o Code 128 para conservar el código registrado.');
    return 'EAN13';
  }
  if (seleccion === 'CODE128') return 'CODE128';
  if (seleccion !== 'automatico') throw new Error('La simbología seleccionada no es válida.');
  return esEAN13Valido(valor) ? 'EAN13' : 'CODE128';
}

// Un hijo puede desbordar un contenedor que aún conserva su tamaño.
export function tieneDesbordeEtiqueta(etiqueta) {
  const borde = etiqueta.getBoundingClientRect();
  const escala = borde.width / etiqueta.offsetWidth || 1;
  const tolerancia = Math.max(0.5, escala);
  if (etiqueta.scrollWidth > etiqueta.clientWidth + 1 || etiqueta.scrollHeight > etiqueta.clientHeight + 1) return true;
  return [...etiqueta.querySelectorAll('[data-label-field], .label-qr, .label-barcode, .label-header')].some(campo => {
    const rect = campo.getBoundingClientRect();
    return campo.scrollWidth > campo.clientWidth + 1 || campo.scrollHeight > campo.clientHeight + 1
      || rect.left < borde.left - tolerancia || rect.top < borde.top - tolerancia
      || rect.right > borde.right + tolerancia || rect.bottom > borde.bottom + tolerancia;
  });
}
