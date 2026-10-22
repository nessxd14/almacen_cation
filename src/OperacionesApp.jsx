import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PackagePlus, ArrowLeftRight, SlidersHorizontal, AlertTriangle, CheckCircle,
  History, LoaderCircle, ScanLine, Package, MapPin, ArrowDownRight, X, RefreshCw } from 'lucide-react';
import { supabase } from './supabaseClient';
import EscanerCodigo from './EscanerCodigo';
import TypeaheadProducto from './TypeaheadProducto';
import ImagenProducto from './ImagenProducto';
import { ejecutarOperacion, asegurarAsignacion } from './lib/operaciones';
import { cargarDatosOperacion, leerStockOperacion, resumenOperacion, cantidadOperacion as fmt } from './lib/operacionDirecta';
import { useUsuarioActual } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { AppNavContext } from './lib/appNavContext';
import './operaciones.css';

const MODOS = [
  { id: 'ENTRADA', label: 'Entrada', detalle: 'Recibir mercadería', icon: PackagePlus },
  { id: 'TRASLADO', label: 'Traslado', detalle: 'Mover existencias', icon: ArrowLeftRight },
  { id: 'AJUSTE', label: 'Ajuste', detalle: 'Corregir un saldo', icon: SlidersHorizontal },
];
// Permisos existentes: el cambio visual no amplía el acceso a ajustes.
const ROLES_AJUSTE = new Set(['admin', 'gerente', 'almacenero']);
const mensajeError = error => error?.message || 'No se pudo completar la consulta. Intenta nuevamente.';

export default function OperacionesApp() {
  const usuario = useUsuarioActual();
  const sucursal = useSucursal();
  const navegacion = useContext(AppNavContext);
  const [modoElegido, setModo] = useState('ENTRADA');
  const [seleccion, setSeleccion] = useState(null);
  const [query, setQuery] = useState('');
  const [scanner, setScanner] = useState(false);
  const [resolviendo, setResolviendo] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [flash, setFlash] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [verTodos, setVerTodos] = useState(false);
  const escaneoEnCurso = useRef(false);
  const modos = MODOS.filter(m => m.id !== 'AJUSTE' || ROLES_AJUSTE.has(usuario?.rol));
  const modo = modos.some(m => m.id === modoElegido) ? modoElegido : 'ENTRADA';
  const ocupado = ejecutando || resolviendo;

  const elegirProducto = useCallback((producto, opciones = {}) => {
    setSeleccion(prev => producto ? { producto, opciones, version: (prev?.version || 0) + 1 } : null);
    setQuery(''); setFlash(null);
  }, []);

  const handleScan = async codigo => {
    setScanner(false);
    const code = (codigo || '').trim();
    if (!code || escaneoEnCurso.current) return;
    escaneoEnCurso.current = true; setResolviendo(true);
    try {
      const { data, error } = await supabase.rpc('resolver_identificador', { p_codigo: code });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      if (!rows.length) throw new Error(`Código no reconocido: ${code}`);
      if (new Set(rows.map(r => r.producto_id)).size !== 1) throw new Error('El código corresponde a varios productos. Selecciona el producto por nombre o SKU.');
      const { data: producto, error: errorProducto } = await supabase.from('producto')
        .select('id, nombre, sku_interno, marca, unidad_base, imagen_url').eq('id', rows[0].producto_id).single();
      if (errorProducto) throw errorProducto;
      if (!producto) throw new Error('No se pudo cargar el producto del código.');
      elegirProducto(producto, { presentacionIdPreferida: rows.length === 1 ? Number(rows[0].presentacion_id) : null, presentacionAmbigua: rows.length > 1 });
      if (rows.length > 1) setFlash({ tipo: 'aviso', texto: 'Este código corresponde a varias presentaciones. Elige cuál vas a mover.' });
    } catch (error) { setFlash({ tipo: 'error', texto: mensajeError(error) }); }
    finally { escaneoEnCurso.current = false; setResolviendo(false); }
  };

  const registrarExito = (movimiento, advertencia) => {
    setMovimientos(prev => [movimiento, ...prev]);
    const accion = movimiento.tipo === 'ENTRADA' ? 'Entrada registrada' : movimiento.tipo === 'TRASLADO' ? 'Traslado registrado' : 'Ajuste registrado';
    setFlash({ tipo: advertencia ? 'aviso' : 'ok', texto: `${accion}. Kardex #${movimiento.id}.${advertencia ? ` ${advertencia}` : ''}` });
  };

  return (
    <section className="operaciones-app" aria-label="Operaciones de inventario">
      <header className="operaciones-heading"><div><h2>Registrar un movimiento</h2><p>Elige la operación y revisa cómo quedarán las existencias.</p></div>
        <span className="operaciones-branch"><MapPin size={15} aria-hidden="true" />{sucursal.nombreSucursal(sucursal.sucursalActivaId) || 'Selecciona una sucursal'}</span></header>
      <div className="operaciones-modos" role="group" aria-label="Tipo de operación">
        {modos.map(({ id, label, detalle, icon: Icon }) => <button key={id} type="button" aria-pressed={modo === id} data-modo={id} disabled={ocupado} onClick={() => { setModo(id); setFlash(null); }}>
          <Icon size={20} aria-hidden="true" /><span><strong>{label}</strong><small>{detalle}</small></span></button>)}
      </div>
      {flash && <div className={`operaciones-feedback is-${flash.tipo}`} role={flash.tipo === 'ok' ? 'status' : 'alert'}>
        {flash.tipo === 'ok' ? <CheckCircle size={19} aria-hidden="true" /> : <AlertTriangle size={19} aria-hidden="true" />}
        <span>{flash.texto}</span><button type="button" aria-label="Cerrar mensaje" onClick={() => setFlash(null)}><X size={18} /></button></div>}
      <div className="operaciones-form-panel">
        <div className="operaciones-section-heading"><h3><span>1</span>Producto</h3><button type="button" className="operaciones-secondary" disabled={ocupado} onClick={() => setScanner(true)}>
          {resolviendo ? <LoaderCircle size={17} className="animate-spin" /> : <ScanLine size={17} />} {resolviendo ? 'Buscando…' : 'Escanear código'}</button></div>
        {seleccion ? <div className="operaciones-producto">
          {seleccion.producto.imagen_url ? <ImagenProducto url={seleccion.producto.imagen_url} nombre={seleccion.producto.nombre} className="operaciones-producto-image" /> : <span className="operaciones-producto-placeholder"><Package size={26} aria-hidden="true" /></span>}
          <div><strong>{seleccion.producto.nombre}</strong><small>{[seleccion.producto.marca, seleccion.producto.sku_interno && `SKU ${seleccion.producto.sku_interno}`].filter(Boolean).join(' · ') || 'Sin SKU'}<br />Unidad base: {seleccion.producto.unidad_base || 'unidad'}</small></div>
          <button type="button" className="operaciones-link" disabled={ocupado} onClick={() => elegirProducto(null)}>Cambiar producto</button>
        </div> : <TypeaheadProducto id="operacion-producto" value={query} onChange={setQuery} onSeleccionar={elegirProducto} placeholder="Buscar por nombre, SKU o leer un código…" />}
        {seleccion ? <FormularioOperacion key={`${sucursal.sucursalActivaId}:${modo}:${seleccion.version}:${seleccion.producto.id}`}
          producto={seleccion.producto} opciones={seleccion.opciones} modo={modo} usuario={usuario} sucursal={sucursal} onBusy={setEjecutando} onSuccess={registrarExito} />
          : <div className="operaciones-empty"><Package size={24} aria-hidden="true" /><div><strong>Selecciona un producto para comenzar</strong><p>Después podrás elegir la ubicación, indicar la cantidad y revisar el movimiento.</p></div></div>}
      </div>
      <section className="operaciones-history" aria-label="Movimientos registrados en esta pantalla">
        <header><h3><History size={17} aria-hidden="true" />Movimientos de esta sesión</h3><a href="?tab=historial" onClick={event => { if (navegacion?.setTab && !ocupado) { event.preventDefault(); navegacion.setTab('historial'); } else if (ocupado) event.preventDefault(); }}>Abrir historial completo</a></header>
        {!movimientos.length ? <p className="operaciones-history-empty">Los movimientos que registres aquí aparecerán en esta lista. El historial completo conserva los anteriores.</p> : <>
          <div className="operaciones-history-list">{(verTodos ? movimientos : movimientos.slice(0, 3)).map(m => {
            const meta = MODOS.find(tipo => tipo.id === m.tipo);
            return <article className="operaciones-history-row" key={`${m.tipo}:${m.id}`}><span className="operaciones-event-icon" data-modo={m.tipo}><meta.icon size={18} aria-hidden="true" /></span>
              <div><strong>{meta.label} · {m.producto}</strong><p>{m.ubicacion}{m.destino ? ` → ${m.destino}` : ''}</p><small>Kardex #{m.id}{m.referencia ? ` · ${m.referencia}` : ''}</small></div>
              <div className="operaciones-event-value"><strong>{m.cantidad}</strong><small>{m.hora}</small></div></article>;
          })}</div>
          {movimientos.length > 3 && <button type="button" className="operaciones-link" onClick={() => setVerTodos(!verTodos)}>{verTodos ? 'Ver menos' : `Ver los ${movimientos.length} movimientos`}</button>}
        </>}
      </section>
      {scanner && <EscanerCodigo onDetect={handleScan} onClose={() => setScanner(false)} />}
    </section>
  );
}

function FormularioOperacion({ producto, opciones, modo, usuario, sucursal, onBusy, onSuccess }) {
  const { sucursalActivaId, sucursales, nombreSucursal } = sucursal;
  const [carga, setCarga] = useState(null);
  const [intentoDatos, setIntentoDatos] = useState(0);
  const [presentacionId, setPresentacionId] = useState('');
  const [ubicacionId, setUbicacionId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [saldos, setSaldos] = useState(null);
  const [intentoStock, setIntentoStock] = useState(0);
  const [errorAccion, setErrorAccion] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const envio = useRef(null);
  const bloqueoEnvio = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let activo = true;
    cargarDatosOperacion({ productoId: producto.id, sucursalId: sucursalActivaId, sucursales, nombreSucursal }).then(datos => {
      if (!activo) return;
      setCarga({ clave: intentoDatos, datos });
      setPresentacionId(prev => {
        if (datos.presentaciones.some(p => String(p.id) === prev)) return prev;
        const preferida = datos.presentaciones.find(p => Number(p.id) === Number(opciones.presentacionIdPreferida));
        const base = datos.presentaciones.find(p => p.es_base);
        return opciones.presentacionAmbigua ? '' : String((preferida || base)?.id || '');
      });
    }).catch(error => { if (activo) setCarga({ clave: intentoDatos, error: mensajeError(error) }); });
    return () => { activo = false; };
  }, [producto.id, sucursalActivaId, sucursales, nombreSucursal, opciones, intentoDatos]);
  const datos = carga?.clave === intentoDatos ? carga.datos : null;
  const errorDatos = carga?.clave === intentoDatos ? carga.error : null;
  const origenes = (datos?.ubicaciones || []).filter(u => Number(u.sucursal_id) === Number(sucursalActivaId) && (modo !== 'TRASLADO' || u.stock > 0));
  const destinos = (datos?.ubicaciones || []).filter(u => Number(u.id) !== Number(ubicacionId));
  const origen = origenes.find(u => String(u.id) === ubicacionId);
  const destino = modo === 'TRASLADO' ? destinos.find(u => String(u.id) === destinoId) : null;
  const presentacion = datos?.presentaciones.find(p => String(p.id) === presentacionId);
  const claveStock = `${ubicacionId}:${modo === 'TRASLADO' ? destinoId : ''}:${intentoStock}`;
  const saldoListo = saldos?.clave === claveStock && !saldos.error;
  const stockOrigen = saldoListo ? saldos.origen : null;
  const stockDestino = saldoListo ? saldos.destino : null;
  const errorStock = saldos?.clave === claveStock ? saldos.error : null;
  useEffect(() => {
    if (!ubicacionId) return;
    let activo = true;
    Promise.all([leerStockOperacion({ productoId: producto.id, ubicacionId }), modo === 'TRASLADO' && destinoId ? leerStockOperacion({ productoId: producto.id, ubicacionId: destinoId }) : Promise.resolve(null)])
      .then(([origen, destino]) => { if (activo) setSaldos({ clave: claveStock, origen, destino }); })
      .catch(error => { if (activo) setSaldos({ clave: claveStock, error: mensajeError(error) }); });
    return () => { activo = false; };
  }, [producto.id, ubicacionId, destinoId, modo, claveStock]);
  const resumen = resumenOperacion({ modo, cantidad, cantidadObjetivo: objetivo, factor: presentacion?.factor_unidad_base, stockOrigen, stockDestino });
  const validacion = !datos ? errorDatos ? 'Vuelve a cargar los datos del producto.' : 'Cargando datos del producto…'
    : !origen ? 'Selecciona una ubicación de la sucursal activa.'
    : modo === 'TRASLADO' && !destino ? 'Selecciona una ubicación de destino diferente al origen.'
    : !saldoListo ? errorStock ? 'Actualiza las existencias antes de registrar.' : 'Consultando existencias…'
    : modo === 'TRASLADO' && stockDestino == null ? 'Consulta el stock de destino antes de continuar.'
    : resumen.error || (modo === 'AJUSTE' && !motivo.trim() ? 'Indica el motivo del ajuste para continuar.' : '');
  const unidad = producto.unidad_base || 'unidad';
  const meta = MODOS.find(m => m.id === modo);
  const editado = (setter, valor) => { setter(valor); setErrorAccion(null); };

  const registrar = async event => {
    event.preventDefault();
    if (bloqueoEnvio.current || validacion) return;
    if (modo === 'AJUSTE' && !ROLES_AJUSTE.has(usuario?.rol)) return;
    bloqueoEnvio.current = true; setGuardando(true); onBusy(true); setErrorAccion(null);
    try {
      // Si cambió el saldo revisado, mostrar el resultado actualizado antes de escribir.
      const [actual, destinoActual] = await Promise.all([leerStockOperacion({ productoId: producto.id, ubicacionId }), destino ? leerStockOperacion({ productoId: producto.id, ubicacionId: destinoId }) : Promise.resolve(null)]);
      if (!vivo.current) return;
      if (actual !== stockOrigen || destinoActual !== stockDestino) {
        setSaldos({ clave: claveStock, origen: actual, destino: destinoActual });
        throw new Error('Las existencias cambiaron. Revisa los nuevos saldos antes de registrar.');
      }
      const payload = { modo, productoId: producto.id, presentacionId, ubicacionId, ubicacionDestinoId: destinoId, cantidad, cantidadObjetivo: objetivo, motivo: motivo.trim(), referencia: referencia.trim(), usuario: usuario.nombre };
      const huella = JSON.stringify(payload);
      if (!envio.current || envio.current.huella !== huella) envio.current = { huella, id: crypto.randomUUID() };
      const { id, error } = await ejecutarOperacion({ ...payload, idempotencia: envio.current.id });
      if (error) throw error;
      let advertencia = '';
      try { if (modo !== 'AJUSTE') await asegurarAsignacion(producto.id, modo === 'TRASLADO' ? destinoId : ubicacionId, { estricto: true }); }
      catch { advertencia = 'No se pudo actualizar la asignación de ubicación. El movimiento ya quedó registrado; no lo repitas.'; }
      onSuccess({ id, tipo: modo, producto: producto.nombre, ubicacion: origen.label, destino: destino?.label, cantidad: `${modo === 'AJUSTE' ? '→ ' : modo === 'ENTRADA' ? '+' : ''}${fmt(resumen.cantidadBase)} ${unidad}`, referencia: referencia.trim(), hora: new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit' }).format(new Date()) }, advertencia);
      envio.current = null;
      if (vivo.current) { setCantidad(''); setObjetivo(''); setMotivo(''); setReferencia(''); setIntentoStock(n => n + 1); setIntentoDatos(n => n + 1); }
    } catch (error) { if (vivo.current) setErrorAccion(mensajeError(error)); }
    finally { bloqueoEnvio.current = false; if (vivo.current) setGuardando(false); onBusy(false); }
  };

  return <form className="operaciones-form" onSubmit={registrar} noValidate>
    <div className="operaciones-divider" /><div className="operaciones-section-heading"><h3><span>2</span>{modo === 'ENTRADA' ? 'Detalle de la entrada' : modo === 'TRASLADO' ? 'Origen, destino y cantidad' : 'Cantidad física verificada'}</h3></div>
    {errorDatos && <div className="operaciones-feedback is-error" role="alert"><span>No se pudieron cargar las ubicaciones y presentaciones: {errorDatos}</span><button type="button" onClick={() => setIntentoDatos(n => n + 1)}><RefreshCw size={15} />Reintentar</button></div>}
    {!datos && !errorDatos && <p className="operaciones-note" role="status"><LoaderCircle size={15} className="animate-spin" />Cargando ubicaciones y presentaciones…</p>}
    <fieldset disabled={guardando || !datos} className="operaciones-fields">
      <div className="operaciones-field is-wide"><label htmlFor="operacion-ubicacion">{modo === 'TRASLADO' ? 'Ubicación de origen' : modo === 'ENTRADA' ? 'Ubicación de destino' : 'Ubicación a ajustar'}</label>
        <select id="operacion-ubicacion" value={ubicacionId} onChange={e => { editado(setUbicacionId, e.target.value); setDestinoId(''); }}><option value="">Selecciona una ubicación</option>{origenes.map(u => <option key={u.id} value={u.id}>{u.label}{u.principal ? ' · principal' : ''}{modo === 'TRASLADO' ? ` · ${fmt(u.stock)} ${unidad}` : ''}</option>)}</select>
        {datos && !origenes.length && <p className="operaciones-note is-warning">{modo === 'TRASLADO' ? 'No hay stock registrado para trasladar desde esta sucursal.' : 'No hay ubicaciones registradas en esta sucursal.'}</p>}
        {origen && <p className="operaciones-note">{!saldoListo ? <>{!errorStock && <LoaderCircle size={14} className="animate-spin" />}{errorStock ? 'No se pudo consultar el stock.' : 'Consultando stock…'}</> : <>Stock en esta ubicación: <strong>{fmt(stockOrigen)} {unidad}</strong></>}</p>}
        {origen && modo === 'ENTRADA' && !origen.asignada && <p className="operaciones-note">La ubicación se asignará al producto al registrar la entrada.</p>}
      </div>
      {modo === 'TRASLADO' && <div className="operaciones-field is-wide"><label htmlFor="operacion-destino">Ubicación de destino</label><select id="operacion-destino" value={destinoId} disabled={!origen || guardando} onChange={e => editado(setDestinoId, e.target.value)}><option value="">Selecciona el destino</option>{destinos.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select>{destino && !destino.asignada && <p className="operaciones-note">Se asignará esta ubicación al producto al recibir el traslado.</p>}</div>}
      {modo !== 'AJUSTE' && <div className="operaciones-field"><label htmlFor="operacion-presentacion">Presentación</label><select id="operacion-presentacion" value={presentacionId} onChange={e => { editado(setPresentacionId, e.target.value); setCantidad(''); }}><option value="">Selecciona una presentación</option>{datos?.presentaciones.map(p => <option key={p.id} value={p.id}>{p.nombre} · ×{fmt(p.factor_unidad_base)} {unidad}</option>)}</select>{datos && !datos.presentaciones.length && <p className="operaciones-note is-warning">Este producto no tiene presentaciones activas. Actualízalo en Productos.</p>}</div>}
      <div className={`operaciones-field ${modo === 'AJUSTE' ? 'is-wide' : ''}`}><label htmlFor="operacion-cantidad">{modo === 'ENTRADA' ? 'Cantidad a recibir' : modo === 'TRASLADO' ? 'Cantidad a trasladar' : 'Cantidad física verificada'}</label>
        <div className="operaciones-quantity"><input id="operacion-cantidad" type="number" inputMode="decimal" step="any" min={modo === 'AJUSTE' ? '0' : '0.0001'} value={modo === 'AJUSTE' ? objetivo : cantidad} onChange={e => editado(modo === 'AJUSTE' ? setObjetivo : setCantidad, e.target.value)} placeholder="0" aria-describedby="operacion-equivalencia" /><span>{modo === 'AJUSTE' ? unidad : presentacion?.nombre || 'presentación'}</span></div>
        <p id="operacion-equivalencia" className="operaciones-equivalence" aria-live="polite">{modo === 'AJUSTE' ? resumen.delta == null ? `Indica el total físico en ${unidad}.` : `Diferencia: ${resumen.delta > 0 ? '+' : ''}${fmt(resumen.delta)} ${unidad}` : resumen.cantidadBase == null ? `La equivalencia en ${unidad} aparecerá aquí.` : `${fmt(cantidad)} × ${fmt(presentacion?.factor_unidad_base)} = ${fmt(resumen.cantidadBase)} ${unidad}`}</p>
      </div>
      {modo === 'AJUSTE' && <div className="operaciones-field is-wide"><label htmlFor="operacion-motivo">Motivo del ajuste <small>· obligatorio</small></label><textarea id="operacion-motivo" value={motivo} onChange={e => editado(setMotivo, e.target.value)} placeholder="Describe por qué se corrige el saldo" /></div>}
      <div className="operaciones-field is-wide"><label htmlFor="operacion-referencia">Referencia <small>· opcional</small></label><input id="operacion-referencia" value={referencia} onChange={e => editado(setReferencia, e.target.value)} placeholder="Factura, orden de compra o documento" /></div>
    </fieldset>
    <section className="operaciones-summary" data-modo={modo} aria-label="Resumen antes de registrar">
      <div className="operaciones-summary-detail"><h3>Resumen del movimiento</h3><p className="operaciones-note">Revisa antes de registrar</p>
        <div className="operaciones-summary-title">{resumen.cantidadBase == null ? 'Movimiento por completar' : modo === 'AJUSTE' ? `${fmt(stockOrigen)} → ${fmt(resumen.cantidadBase)} ${unidad}` : `${modo === 'ENTRADA' ? '+' : ''}${fmt(resumen.cantidadBase)} ${unidad}`}</div><p className="operaciones-summary-product">{producto.nombre}</p>
        <div className="operaciones-route"><MapPin size={17} aria-hidden="true" /><div><small>{modo === 'TRASLADO' ? 'Origen' : 'Ubicación'}</small>{origen?.label || 'Selecciona una ubicación'}</div></div>
        {modo === 'TRASLADO' && <div className="operaciones-route"><ArrowDownRight size={17} aria-hidden="true" /><div><small>Destino</small>{destino?.label || 'Selecciona una ubicación de destino'}</div></div>}
        {modo === 'AJUSTE' && motivo.trim() && <p className="operaciones-summary-reason"><strong>Motivo:</strong> {motivo.trim()}</p>}{referencia.trim() && <p className="operaciones-summary-reason"><strong>Referencia:</strong> {referencia.trim()}</p>}
      </div>
      <div className="operaciones-summary-result">
        {errorStock && <div className="operaciones-feedback is-error" role="alert"><span>No se pudieron consultar las existencias: {errorStock}</span><button type="button" disabled={guardando} onClick={() => setIntentoStock(n => n + 1)}>Reintentar</button></div>}
        <dl className="operaciones-balances"><div><dt>{modo === 'TRASLADO' ? 'Stock de origen' : 'Stock actual'}</dt><dd>{fmt(stockOrigen)} {unidad}</dd></div><div><dt>{modo === 'AJUSTE' ? 'Diferencia' : modo === 'ENTRADA' ? 'Entrada' : 'Salida de origen'}</dt><dd>{resumen.delta > 0 ? '+' : ''}{fmt(resumen.delta)} {unidad}</dd></div>
          {modo === 'TRASLADO' && <><div><dt>Origen quedará en</dt><dd>{fmt(resumen.origenFinal)} {unidad}</dd></div><div><dt>Destino actual</dt><dd>{fmt(stockDestino)} {unidad}</dd></div></>}
        </dl>
        <div className="operaciones-final" aria-live="polite"><div>{modo === 'TRASLADO' ? 'Destino quedará en' : 'Stock resultante'}<small>{unidad} · unidad base</small></div><strong>{fmt(modo === 'TRASLADO' ? resumen.destinoFinal : resumen.origenFinal)}</strong></div>
        {validacion && <p className="operaciones-validation">{validacion}</p>}{errorAccion && <p className="operaciones-action-error" role="alert">{errorAccion}</p>}
        <button type="submit" className="operaciones-primary" disabled={guardando || Boolean(validacion)}>{guardando ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <meta.icon size={18} aria-hidden="true" />}{guardando ? 'Registrando…' : `Registrar ${meta.label.toLowerCase()}`}</button><p className="operaciones-summary-footer">El movimiento quedará registrado en Kardex con tu usuario.</p>
      </div>
    </section>
  </form>;
}
