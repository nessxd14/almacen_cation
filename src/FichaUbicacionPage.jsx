import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MapPin, RefreshCw, Boxes, AlertTriangle } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { sucursalDeFicha, textoUbicacion } from './lib/fichaProducto';
import { cargarFichaUbicacion } from './lib/fichaUbicacion';
import './fichas.css';
import { codigoUbicacion, nombreMueble } from './lib/ubicacionTexto';

const cantidadFmt = n => n == null ? 'Sin registro' : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 }).format(n);
const fechaFmt = fecha => fecha ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(fecha)) : 'Sin registro';
const textoBusqueda = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export default function FichaUbicacionPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { usuario } = useAuth();
  const { sucursales, sucursalActivaId, cargando, error: errorSucursal, reintentarSucursales } = useSucursal();
  if (cargando) return <div className="ficha-route"><p role="status">Cargando almacenes y tiendas…</p></div>;
  if (errorSucursal) return <div className="ficha-route"><p className="fichas-alert" role="alert">{errorSucursal}</p><button className="fichas-button" onClick={reintentarSucursales}>Reintentar</button></div>;
  let sucursalId, error;
  try {
    if (!/^[1-9]\d*$/.test(id)) throw new Error('El enlace de la ubicación no es válido.');
    sucursalId = sucursalDeFicha(params.get('sucursal'), usuario?.sucursalId, sucursalActivaId, sucursales);
  } catch (e) { error = e.message; }
  return <div className="ficha-route">
    <header className="ficha-route-nav"><Link to="/?tab=fichas" className="fichas-button"><ArrowLeft size={16} /> Fichas y etiquetas</Link></header>
    {error ? <p className="fichas-alert" role="alert">{error}</p> : <ConsultaUbicacion key={`${id}:${sucursalId}`} ubicacionId={id} sucursal={sucursales.find(s => Number(s.id) === sucursalId)} />}
  </div>;
}

function ConsultaUbicacion({ ubicacionId, sucursal }) {
  const [revision, setRevision] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => {
    let vigente = true;
    cargarFichaUbicacion(supabase, ubicacionId, sucursal.id)
      .then(ficha => { if (vigente) setResultado({ ficha }); })
      .catch(error => { if (vigente) setResultado({ error: error.message }); });
    return () => { vigente = false; };
  }, [ubicacionId, sucursal.id, revision]);
  const actualizar = () => { setResultado(null); setRevision(n => n + 1); };
  if (!resultado) return <p role="status" className="fichas-loading">Consultando ubicación y productos…</p>;
  if (resultado.error) return <section className="fichas-panel"><p className="fichas-alert" role="alert">{resultado.error}</p><button className="fichas-button" onClick={actualizar}>Reintentar</button></section>;
  const { ubicacion, productos, errores, consultadoEn } = resultado.ficha;
  const consulta = textoBusqueda(busqueda.trim());
  const filtrados = productos.filter(p => textoBusqueda(`${p.producto?.nombre || ''} ${p.producto?.sku_interno || ''}`).includes(consulta));
  const incompleta = Object.keys(errores).length > 0;
  return <article className="ficha-producto">
    <header className="ficha-hero ficha-hero-no-photo"><div>
      <span className="fichas-eyebrow">FICHA DE UBICACIÓN · {sucursal.nombre}</span>
      <h1><MapPin size={24} /> {textoUbicacion(ubicacion) || 'Ubicación sin descripción'}</h1>
      <dl className="ficha-attributes">{[['Zona', ubicacion.codigo_zona], ['Mueble', nombreMueble(ubicacion)], ['Compartimiento', ubicacion.compartimiento], ['Código', codigoUbicacion(ubicacion)]].map(([campo, valor]) => <div key={campo}><dt>{campo}</dt><dd>{valor == null || valor === '' ? 'Sin registrar' : valor}</dd></div>)}</dl>
      <div className="fichas-actions"><button className="fichas-button" onClick={actualizar}><RefreshCw size={16} /> Actualizar</button></div>
      <p className="fichas-note">Última consulta: {fechaFmt(consultadoEn)}</p>
    </div></header>
    {incompleta && <p className="fichas-alert" role="alert"><AlertTriangle size={18} /><span>Información incompleta. {Object.values(errores).join(' ')} Actualiza para reintentar.</span></p>}
    <section className="fichas-panel"><h2><Boxes size={20} /> Productos en esta ubicación</h2>
      <p className="fichas-note">Existencias registradas en {sucursal.nombre}. Las cantidades están expresadas en la unidad base de cada producto.</p>
      <label className="fichas-field">Buscar producto en esta ubicación<input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o SKU" /></label>
      {!filtrados.length && <p className="fichas-note">{consulta ? 'No hay productos que coincidan con la búsqueda.' : incompleta ? 'No se pudo completar la consulta de productos.' : 'Sin productos asignados ni existencias registradas en esta ubicación.'}</p>}
      <ul className="ficha-locations">{filtrados.map(fila => <li key={fila.producto_id}>
        <div>{fila.producto ? <Link to={`/productos/${fila.producto_id}/ficha?sucursal=${sucursal.id}`}><strong>{fila.producto.nombre}</strong></Link> : <strong>Producto sin información accesible</strong>}
          {fila.es_principal && <span className="fichas-badge">Ubicación principal</span>}
          <small>{fila.producto?.sku_interno || 'Sin SKU registrado'}{fila.producto?.activo === false && ' · Producto inactivo'}</small>
          <small>{errores.asignaciones ? 'Asignación sin consultar' : fila.asignado ? 'Producto asignado a esta ubicación' : 'Con registro de existencias, sin asignación'}</small>
          {fila.actualizado_en && <small>Registro actualizado: {fechaFmt(fila.actualizado_en)}</small>}
        </div>
        <span>Existencia registrada: <strong>{errores.stock ? 'No disponible' : cantidadFmt(fila.cantidad)}</strong>{!errores.stock && fila.cantidad != null && ` ${fila.producto?.unidad_base || ''}`}</span>
      </li>)}</ul>
    </section>
  </article>;
}
