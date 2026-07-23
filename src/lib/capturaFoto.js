// capturaFoto.js
// Compresión de fotos en el cliente antes de mandarlas a la Edge Function
// ingest-foto-producto. `sharp` es una librería de Node (binding nativo) y
// no corre en el navegador — acá se usa <canvas>, que sí.
export async function comprimirYCodificar(file, maxAncho = 1280, calidad = 0.8) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, maxAncho / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", calidad)
  );
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binario = "";
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario); // base64 SIN prefijo data:URL, listo para fotos_base64
}
