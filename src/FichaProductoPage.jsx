import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, MapPin, Printer, AlertTriangle, Boxes } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { controlEfectivo } from './lib/control';
import { cargarFichaProducto, resumirUbicaciones, sucursalDeFicha, textoUbicacion } from './lib/fichaProducto';
import ImagenProducto from './ImagenProducto';
import EtiquetasDialog from './EtiquetasDialog';
import './fichas.css';

const cantidadFmt = n => n == null ? 'Sin registro' : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 }).format(n);
const fechaFmt = fecha => fecha ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(fecha)) : 'Sin registro';

export default function FichaProductoPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { usuario } = useAuth();
  const { sucursales, sucursalActivaId, cargando, puedeElegir, error: errorCargaSucursal, reintentarSucursales } = useSucursal();
  if (cargando) return <div className="ficha-route"><p role="status">Cargando almacenes y tiendas…</p></div>;
  if (errorCargaSucursal) return <div className="ficha-route"><p className="fichas-alert" role="alert">{errorCargaSucursal}</p><button className="fichas-button" onClick={reintentarSucursales}>Reintentar</button></div>;
  let sucursalId, error;
  try {
    if (!/^[1-9]\d*$/.test(id)) throw new Error('El enlace del producto no es válido.');
    sucursalId = sucursalDeFicha(params.get('sucursal'), usuario.sucursalId, sucursalActivaId, sucursales);
  } catch (e) { error = e.message; }
  return <div className="ficha-route">
    <header className="ficha-route-nav">
      <Link to="/?tab=catalogo" className="fichas-button"><ArrowLeft size={16} /> Catálogo</Link>
      {puedeElegir && <label className="fichas-field">Sucursal
        <select aria-label="Sucursal de la ficha" value={sucursalId ?? ''} onChange={e => setParams({ sucursal: e.target.value })}>
          <option value="" disabled>Seleccionar</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label>}
    </header>
    {error ? <p className="fichas-alert" role="alert">{error}</p> : <ConsultaFicha key={`${id}:${sucursalId}`} productoId={id} sucursal={sucursales.find(s => Number(s.id) === sucursalId)} />}
  </div>;
}

function ConsultaFicha({ productoId, sucursal }) {
  const [revision, setRevision] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [imprimiendo, setImprimiendo] = useState(false);
  useEffect(() => {
    let activo = true;
    cargarFichaProducto(supabase, productoId, sucursal.id)
      .then(ficha => { if (activo) setResultado({ ficha }); })
      .catch(error => { if (activo) setResultado({ error: error.message }); });
    return () => { activo = false; };
  }, [productoId, sucursal.id, revision]);
  const actualizar = () => { setResultado(null); setRevision(r => r + 1); };
  if (!resultado) return <p role="status" className="fichas-loading">Consultando información actual del producto…</p>;
  if (resultado.error) return <section className="fichas-panel"><p role="alert" className="fichas-alert">{resultado.error}</p><button className="fichas-button" onClick={actualizar}>Reintentar</button></section>;
  const { ficha } = resultado;
  const { producto, errores } = ficha;
  const { ubicaciones, total } = resumirUbicaciones(ficha.asignaciones, ficha.stock, sucursal.id, !errores.stock);
  const control = errores.control ? null : controlEfectivo(ficha.control?.control_stock, sucursal.control_stock_default);
  const sinValidar = control !== 'ESTRICTO';
  const principal = ubicaciones.find(u => u.es_principal) ?? ubicaciones[0];
  return <article className="ficha-producto">
    <header className={`ficha-hero${producto.imagen_url ? '' : ' ficha-hero-no-photo'}`}>
      {producto.imagen_url && <div className="ficha-photo"><ImagenProducto ampliable url={producto.imagen_url} nombre={producto.nombre} /></div>}
      <div><span className="fichas-eyebrow">FICHA DE ALMACÉN · {sucursal.nombre}</span><h1>{producto.nombre}</h1>
        <p>{producto.marca} {producto.marca && '·'} {producto.sku_interno || `Producto ${producto.id}`}</p>
        <p>Unidad base: <strong>{producto.unidad_base}</strong>{producto.activo === false && ' · Producto inactivo'}</p>
        <div className="fichas-actions"><button className="fichas-button" onClick={actualizar}><RefreshCw size={16} /> Actualizar</button><button className="fichas-button" onClick={() => setImprimiendo(true)}><Printer size={16} /> Etiqueta</button></div>
        <p className="fichas-note">Última consulta: {fechaFmt(ficha.consultadoEn)}</p>
      </div>
    </header>
    {Object.keys(errores).length > 0 && <div className="fichas-alert" role="alert"><AlertTriangle size={18} /><span>Información incompleta. {Object.values(errores).join(' ')} Actualiza para reintentar.</span></div>}
    {sinValidar && <p className="fichas-alert">{errores.control ? 'No se pudo verificar el control de inventario.' : 'Inventario sin control estricto: comprueba la cantidad física antes de entregar.'}</p>}
    <section className="fichas-panel ficha-primary-location"><span className="fichas-eyebrow">DÓNDE ENCONTRARLO</span>
      <h2><MapPin size={22} /> {errores.asignaciones ? 'Ubicación principal sin consultar' : textoUbicacion(principal)}</h2>
      <p>{errores.asignaciones ? 'Las cantidades por ubicación se muestran abajo si pudieron consultarse.' : principal?.es_principal ? 'Ubicación principal asignada' : principal ? 'Ubicación con registro · sin principal asignada' : 'Solicita al encargado que asigne una ubicación.'}</p>
    </section>
    <div className="ficha-stock-grid">
      <section className="fichas-panel"><span>Existencia registrada · {sucursal.nombre}</span><strong>{errores.stock ? 'No disponible' : cantidadFmt(total)}</strong><small>{producto.unidad_base}{sinValidar && ' · pendiente de validar'}</small></section>
      <section className="fichas-panel"><span>Reservas de pedidos · todas las sucursales</span><strong>{errores.disponibilidad || !ficha.disponibilidad ? 'No disponible' : cantidadFmt(ficha.disponibilidad.reservado)}</strong><small>{producto.unidad_base}</small></section>
      <section className="fichas-panel"><span>Disponible para pedidos · {sucursal.nombre}</span><strong>{errores.disponibilidad || !ficha.disponibilidad || total == null || sinValidar ? 'Sin validar' : cantidadFmt(ficha.disponibilidad.vendible)}</strong><small>{producto.unidad_base}</small></section>
    </div>
    {ficha.disponibilidad?.motivo && <p className="fichas-note">Reservado para: {ficha.disponibilidad.motivo}</p>}
    <section className="fichas-panel"><h2><Boxes size={19} /> Ubicaciones y cantidades</h2>
      {!ubicaciones.length && <p>{errores.stock || errores.asignaciones ? 'No se pudieron consultar las ubicaciones.' : 'Sin ubicaciones ni existencias registradas en esta sucursal.'}</p>}
      <ul className="ficha-locations">{ubicaciones.map(u => <li key={u.id}><div><strong>{textoUbicacion(u)}</strong>{u.es_principal && <span className="fichas-badge">Principal</span>}<small>{u.actualizado_en ? `Registro actualizado: ${fechaFmt(u.actualizado_en)}` : 'Sin cantidad registrada en esta ubicación'}</small></div><span>{errores.stock ? 'No disponible' : cantidadFmt(u.cantidad)}{u.cantidad != null && !errores.stock && ` ${producto.unidad_base}`}</span></li>)}</ul>
    </section>
    <div className="ficha-details-grid">
      <section className="fichas-panel"><h2>Identificación y presentaciones</h2>
        {errores.atributos && <p>{errores.atributos}</p>}
        <dl className="ficha-attributes">{(ficha.atributos || []).map((a, i) => <div key={i}><dt>{a.atributo_valor?.atributo?.nombre}</dt><dd>{a.atributo_valor?.valor}</dd></div>)}</dl>
        {errores.presentaciones ? <p>{errores.presentaciones}</p> : <ul className="ficha-presentations">{(ficha.presentaciones || []).filter(p => p.activo !== false).map(p => <li key={p.id}><strong>{p.nombre}</strong><span>{cantidadFmt(p.factor_unidad_base)} {producto.unidad_base}{p.es_base && ' · base'}</span>{(p.identificador || []).filter(i => i.activo !== false).map(i => <small key={i.id}>{i.tipo}: {i.valor}</small>)}</li>)}</ul>}
        {producto.ficha_md && <details><summary>Información técnica</summary><p className="ficha-technical">{producto.ficha_md}</p></details>}
      </section>
      <section className="fichas-panel"><h2>Verificación física</h2>
        <p>{errores.conteo ? errores.conteo : ficha.conteo ? `Último conteo conciliado aplicado: ${fechaFmt(ficha.conteo.creado_en)}` : 'Sin conteo conciliado aplicado registrado.'}</p>
        {ficha.conteo && <p>Aplicado por: {ficha.conteo.creado_por || 'Sin responsable registrado'}</p>}
        {ficha.control?.inventariado_en && <p>Inventariado: {fechaFmt(ficha.control.inventariado_en)} · {ficha.control.inventariado_por || 'Sin responsable registrado'}</p>}
        <p className="fichas-note">La verificación corresponde a la ubicación contada; las existencias actuales incluyen los movimientos posteriores.</p>
      </section>
    </div>
    <section className="fichas-panel"><h2>Últimos movimientos · {sucursal.nombre}</h2>
      {errores.movimientos ? <p>{errores.movimientos}</p> : !ficha.movimientos?.length ? <p>Sin movimientos registrados.</p> : <ul className="ficha-movements">{ficha.movimientos.map(m => <li key={m.id}><div><strong>{m.tipo_movimiento} · {cantidadFmt(m.cantidad)} {producto.unidad_base}</strong><span>{textoUbicacion(m.ubicacion)}</span><small>{m.referencia}</small></div><div><span>{fechaFmt(m.creado_en)}</span><small>{m.creado_por || 'Sin responsable registrado'}</small></div></li>)}</ul>}
    </section>
    {imprimiendo && <EtiquetasDialog productoId={productoId} sucursalId={sucursal.id} onClose={() => setImprimiendo(false)} />}
  </article>;
}
