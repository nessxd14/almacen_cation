import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { FORMATO_INICIAL, FORMATOS_ETIQUETA, normalizarFormato, esEtiquetaDeEmpaque, esEtiquetaDeUbicacion } from './lib/formatosEtiqueta';

const grupos = ['Productos', 'Almacén', 'Recepción'];

export default function ConfiguracionEtiquetas({ formato, setFormato, guardados, guardar, eliminar, baseUrl, setBaseUrl, errorUrl, urlLocal, errores }) {
  const [nombre, setNombre] = useState('');
  const cambiar = (campo, valor) => setFormato(f => ({ ...f, [campo]: valor }));
  const esUbicacion = esEtiquetaDeUbicacion(formato.diseno);
  const esTira = formato.diseno === 'ubicacion_tira';
  const preset = FORMATOS_ETIQUETA.find(f => f.diseno === formato.diseno);
  const numeros = [
    ['ancho', 'Ancho (mm)', 35, 297], ['alto', 'Alto (mm)', 25, 420], ['fuente', 'Texto (pt)', 6, 24],
    ...(!esTira ? [['qr', 'QR (mm)', 14, 60]] : []), ['relleno', 'Margen de etiqueta (mm)', 1, 10],
    ...(formato.barras && !esUbicacion ? [['altoBarras', 'Altura de barras (mm)', 5, 35]] : []),
    ...(formato.papel === 'hoja' ? [['margen', 'Margen de hoja (mm)', 0, 30], ['separacion', 'Separación (mm)', 0, 20]] : []),
  ];
  const opciones = [['codigo', 'SKU del producto'], ['marca', 'Marca'], ['ubicacion', 'Sucursal y ubicación'], ['unidad', 'Unidad base'], ['presentacion', 'Presentación y equivalencia'], ['atributos', 'Características'], ['foto', 'Foto si existe'], ['barras', 'Código de barras de la presentación']];
  return <section className="fichas-panel fichas-settings"><h3>Formato de impresión</h3>
    <label className="fichas-field">Diseño de etiqueta<select aria-label="Formato" value={formato.diseno} onChange={e => {
      const elegido = FORMATOS_ETIQUETA.find(f => f.diseno === e.target.value);
      if (elegido) setFormato(f => ({ ...FORMATO_INICIAL, ...elegido, papel: f.papel, orientacion: f.orientacion, margen: f.margen, separacion: f.separacion, giroAutomatico: f.giroAutomatico, estilo: ['caja_grande', 'lectura_distancia', 'ubicacion_tira'].includes(elegido.diseno) ? elegido.estilo : f.estilo }));
    }}>{grupos.map(grupo => <optgroup key={grupo} label={grupo}>{FORMATOS_ETIQUETA.filter(f => f.grupo === grupo).map(f => <option key={f.id} value={f.diseno}>{f.nombre}</option>)}</optgroup>)}</select></label>
    <p className="fichas-note">{preset?.descripcion}</p>
    {guardados.length > 0 && <label className="fichas-field">Mis formatos<select aria-label="Mis formatos" value="" onChange={e => { const elegido = normalizarFormato(guardados[Number(e.target.value)]?.formato); if (elegido) setFormato(elegido); }}><option value="" disabled>Cargar un formato guardado</option>{guardados.map((g, i) => <option key={g.nombre} value={i}>{g.nombre}</option>)}</select></label>}
    <div className="fichas-fields-grid">
      {!esTira && <label className="fichas-field">Estilo<select aria-label="Estilo" value={formato.estilo} onChange={e => cambiar('estilo', e.target.value)}><option value="corporativo">ROARI</option><option value="industrial">Blanco y negro</option><option value="minimalista">Minimalista</option></select></label>}
      <label className="fichas-field">Papel<select aria-label="Papel" value={formato.papel} onChange={e => cambiar('papel', e.target.value)}><option value="hoja">Hoja A4</option><option value="rollo">Rollo / etiqueta individual</option></select></label>
    </div>
    {formato.papel === 'hoja' && <><label className="fichas-field">Orientación de hoja<select aria-label="Orientación de hoja" value={formato.orientacion} onChange={e => cambiar('orientacion', e.target.value)}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label><label className="fichas-check"><input type="checkbox" checked={formato.giroAutomatico} onChange={e => cambiar('giroAutomatico', e.target.checked)} /> Girar etiquetas para aprovechar la hoja</label></>}
    <details className="fichas-advanced"><summary>Ajustar medidas y contenido</summary>
      <div className="fichas-fields-grid">{numeros.map(([campo, label, min, max]) => <label className="fichas-field" key={campo}>{label}<input type="number" min={min} max={max} step="0.5" value={formato[campo]} onChange={e => cambiar(campo, Number(e.target.value))} /></label>)}</div>
      {!esUbicacion && <fieldset className="fichas-options"><legend>Contenido de la etiqueta</legend>{opciones.map(([campo, label]) => <label key={campo}><input type="checkbox" checked={campo === 'presentacion' && esEtiquetaDeEmpaque(formato.diseno) ? true : formato[campo]} disabled={campo === 'presentacion' && esEtiquetaDeEmpaque(formato.diseno)} onChange={e => cambiar(campo, e.target.checked)} />{label}</label>)}</fieldset>}
      {formato.barras && !esUbicacion && <label className="fichas-field">Tipo de código de barras<select aria-label="Tipo de código de barras" value={formato.simbologia} onChange={e => cambiar('simbologia', e.target.value)}><option value="automatico">Automático según el código</option><option value="CODE128">Code 128</option><option value="EAN13">EAN-13</option></select></label>}
    </details>
    {!esTira && <><p className="fichas-note">El QR abre la ficha actual. Las existencias se consultan en pantalla.</p>
    <label className="fichas-field">Dirección de Almacén para el QR<input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://tu-almacen…" /></label>
    {urlLocal && <p className="fichas-alert">Esta dirección solo funciona en este equipo. Para escanear desde celulares, escribe la dirección publicada de Almacén o una dirección accesible en tu red.</p>}
    {errorUrl && <p className="fichas-alert" role="alert">{errorUrl}</p>}</>}
    {errores.length > 0 && <ul className="fichas-alert" role="alert">{errores.map(e => <li key={e}>{e}</li>)}</ul>}
    <label className="fichas-field">Nombre para guardar (opcional)<input maxLength={60} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej.: Cajas de 12" /></label>
    <button className="fichas-button" disabled={!!errores.length || (!esTira && !!errorUrl)} onClick={() => { guardar(nombre.trim().slice(0, 60)); setNombre(''); }}><Save size={16} /> {esTira ? 'Guardar formato' : 'Guardar formato y dirección'}</button>
    {guardados.length > 0 && <details><summary>Administrar formatos guardados</summary>{guardados.map(g => <div className="fichas-saved" key={g.nombre}><span>{g.nombre}</span><button className="fichas-icon-button" aria-label={`Eliminar formato ${g.nombre}`} onClick={() => eliminar(g.nombre)}><Trash2 size={16} /></button></div>)}</details>}
  </section>;
}
