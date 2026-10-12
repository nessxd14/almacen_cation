import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ScanLine, Trash2, Plus, Send, ShoppingCart } from 'lucide-react';
import { supabase } from './supabaseClient';
import EscanerCodigo from './EscanerCodigo';
import { adaptarDocumentoMovil, cantidadOperacion, cantidadTexto, interpretarCodigoOperacion, rutaDocumentoMovil, solicitarDocumentoMovil } from './lib/operacionesMovil';

export default function CarritoTrasladoVirtual({ carritoId, usuario }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [contexto, setContexto] = useState(null);
  const [carrito, setCarrito] = useState(null);
  const [origen, setOrigen] = useState(params.get('origen') || '');
  const [destino, setDestino] = useState('');
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [codigo, setCodigo] = useState(params.get('codigo') || '');
  const [scanner, setScanner] = useState(false);
  const [ubicacionContexto, setUbicacionContexto] = useState(params.get('ubicacion') || '');
  const [producto, setProducto] = useState(null);
  const [lineaEditando, setLineaEditando] = useState(null);
  const cerrado = carrito && (carrito.tarea.estado !== 'BORRADOR' || carrito.tarea.preparador_id !== usuario.id);
  const bloqueado = useRef(false);
  const lectura = useRef(false);
  const vivo = useRef(true);
  const abrirInicial = useRef(false);
  const datosRef = useRef(null);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let vigente = true;
    Promise.all([
      solicitarDocumentoMovil(supabase, { accion: 'contexto' }),
      carritoId ? solicitarDocumentoMovil(supabase, { documentoId: carritoId }) : Promise.resolve(null),
    ]).then(([ctx, data]) => {
      if (!vigente) return;
      setContexto(ctx);
      if (data) { const c = adaptarDocumentoMovil(data); datosRef.current = c; setCarrito(c); setOrigen(String(c.tarea.sucursal_origen_id)); setDestino(String(c.tarea.sucursal_destino_id)); }
      else {
        const tiendaAsignada = ['vendedor', 'cajero'].includes(usuario.rol) ? ctx.sucursal_asignada_id : null;
        setDestino(tiendaAsignada ? String(tiendaAsignada) : '');
        setOrigen(actual => actual || (['almacenero', 'operario'].includes(usuario.rol) && ctx.sucursal_asignada_id ? String(ctx.sucursal_asignada_id) : String(ctx.sucursales.find(s => String(s.id) !== String(tiendaAsignada))?.id || '')));
      }
      setCargando(false);
    }, e => { if (vigente) { setError(e.message); setCargando(false); } });
    return () => { vigente = false; };
  }, [carritoId, usuario.rol, intento]);

  const consultarProducto = useCallback(async ({ codigo: texto, productoId, presentacionId, editando = null }) => {
    setError(''); setAviso('');
    const data = await solicitarDocumentoMovil(supabase, { accion: 'producto', datos: { sucursal_id: datosRef.current?.tarea.sucursal_origen_id || Number(origen), ...(texto ? { codigo: texto } : { producto_id: productoId, presentacion_id: presentacionId }) } });
    if (!vivo.current) return;
    if (!data.presentaciones?.length) throw new Error('El producto necesita una presentación activa.');
    if (!data.ubicaciones?.length) throw new Error('Este producto necesita una ubicación de origen registrada antes de alistarlo.');
    setProducto(data); setLineaEditando(editando);
  }, [origen]);
  async function crear() {
    if (bloqueado.current) return;
    bloqueado.current = true; setOcupado(true); setError('');
    try {
      const d = adaptarDocumentoMovil(await solicitarDocumentoMovil(supabase, { accion: 'crear', datos: { sucursal_origen_id: Number(origen), sucursal_destino_id: Number(destino) } }));
      if (!vivo.current) return;
      datosRef.current = d; setCarrito(d);
      abrirInicial.current = true;
      if (codigo) await consultarProducto({ codigo });
      else if (params.get('producto')) await consultarProducto({ productoId: params.get('producto'), presentacionId: params.get('presentacion') });
    } catch (e) { if (vivo.current) setError(e.message); }
    finally { bloqueado.current = false; if (vivo.current) setOcupado(false); }
  }
  useEffect(() => {
    if (!carrito || abrirInicial.current || !params.get('producto') || cerrado) return;
    abrirInicial.current = true;
    consultarProducto({ productoId: params.get('producto'), presentacionId: params.get('presentacion') }).catch(e => { if (vivo.current) setError(e.message); });
  }, [carrito, params, consultarProducto, cerrado]);
  async function leerCodigo(texto) {
    setError('');
    try {
      let c;
      try { c = interpretarCodigoOperacion(texto); } catch { /* el servidor resolverá barras de producto */ }
      if (c?.tipo === 'ubicacion') {
        if (c.sucursalId && Number(c.sucursalId) !== Number(datosRef.current?.tarea.sucursal_origen_id || origen)) throw new Error('La ubicación pertenece a otra sucursal.');
        setUbicacionContexto(c.id); setAviso(`Ubicación #${c.id} seleccionada. Se comprobará con cada producto.`); return;
      }
      await consultarProducto({ codigo: texto });
    } catch (e) { if (vivo.current) setError(e.message); }
  }
  const detectar = useCallback(texto => {
    if (lectura.current) return;
    lectura.current = true; setScanner(false); void leerCodigo(texto);
    // El cierre del lector conserva el origen y el carrito de esta lectura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultarProducto, origen]);
  async function guardar(accion, payload = {}) {
    if (bloqueado.current || !datosRef.current) return;
    bloqueado.current = true; setOcupado(true); setError(''); setAviso('');
    try {
      const d = adaptarDocumentoMovil(await solicitarDocumentoMovil(supabase, { documentoId: datosRef.current.tarea.id, accion, version: datosRef.current.tarea.version, datos: payload }));
      if (!vivo.current) return;
      datosRef.current = d; setCarrito(d); setProducto(null); setLineaEditando(null); setCodigo(''); setAviso('Carrito guardado.');
      if (accion === 'enviar') navigate(rutaDocumentoMovil('traslado_virtual', d.tarea.id));
    } catch (e) { if (vivo.current) setError(e.message); }
    finally { bloqueado.current = false; if (vivo.current) setOcupado(false); }
  }
  const sucursales = contexto?.sucursales || [];
  const nombre = id => sucursales.find(s => String(s.id) === String(id))?.nombre || `Sucursal ${id}`;
  if (cargando) return <p role="status">Cargando tu carrito…</p>;
  return <section className="om-carrito">
    <Link className="om-text-link" to="/operaciones">← Operaciones</Link>
    <h2><ShoppingCart size={22} /> Traslado virtual para Tienda</h2>
    <p className="om-muted">Alista los productos, declara sus cantidades y presenta el QR al almacenero. El carrito conserva tu avance.</p>
    {error && <p role="alert" className="om-aviso om-error">{error}</p>}
    {!contexto && <button className="om-secondary" onClick={() => setIntento(i => i + 1)}>Reintentar consulta</button>}
    {aviso && <p role="status" className="om-aviso om-exito">{aviso}</p>}
    {!carrito ? <form className="om-editor" onSubmit={e => { e.preventDefault(); void crear(); }}>
      <label>Almacén de origen<select value={origen} onChange={e => setOrigen(e.target.value)} required disabled={ocupado || (['almacenero','operario'].includes(usuario.rol) && contexto?.sucursal_asignada_id != null)}><option value="">Seleccionar origen</option>{sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
      <label>Tienda destino<select value={destino} onChange={e => setDestino(e.target.value)} required disabled={ocupado || (['vendedor','cajero'].includes(usuario.rol) && contexto?.sucursal_asignada_id != null)}><option value="">Seleccionar Tienda</option>{sucursales.filter(s => String(s.id) !== String(origen)).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
      <button className="om-primary" disabled={ocupado || !origen || !destino || origen === destino}>Comenzar carrito</button>
    </form> : <>
      <div className="om-aviso">{nombre(carrito.tarea.sucursal_origen_id)} → {nombre(carrito.tarea.sucursal_destino_id)} · TV-{carrito.tarea.id}</div>
      {carrito.tarea.observacion && <p className="om-aviso"><strong>Observación del alistado:</strong> {carrito.tarea.observacion}</p>}
      <button className="om-secondary" disabled={ocupado || Boolean(producto)} onClick={async () => { try { const d = adaptarDocumentoMovil(await solicitarDocumentoMovil(supabase, { documentoId: carrito.tarea.id })); datosRef.current = d; setCarrito(d); setError(''); } catch (e) { setError(e.message); } }}>Actualizar carrito</button>
      {cerrado ? <><p>Este carrito ya está enviado. Consulta su QR, verificación y salida.</p><Link className="om-primary om-wide" to={rutaDocumentoMovil('traslado_virtual', carrito.tarea.id)}>Ver solicitud</Link></> : <>
        <button className="om-primary om-wide" disabled={ocupado || Boolean(producto)} onClick={() => { lectura.current = false; setScanner(true); }}><ScanLine size={20} /> Escanear producto o ubicación</button>
        <form className="om-manual-code" onSubmit={e => { e.preventDefault(); void leerCodigo(codigo); }}><label>QR o barras del producto<input value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="off" /></label><button className="om-secondary" disabled={ocupado || Boolean(producto) || !codigo.trim()}><Plus size={16} /> Añadir código</button></form>
        {ubicacionContexto && <p className="om-muted">Ubicación escaneada: #{ubicacionContexto} <button className="om-text-button" disabled={ocupado} onClick={() => setUbicacionContexto('')}>Quitar selección</button></p>}
        {producto && <ArticuloCarrito key={`${producto.producto.id}:${lineaEditando?.id || 'nuevo'}:${ubicacionContexto}`} datos={producto} ubicacionContexto={ubicacionContexto} linea={lineaEditando} ocupado={ocupado} onCancel={() => { setProducto(null); setLineaEditando(null); }} onGuardar={payload => guardar(lineaEditando ? 'editar' : 'agregar', { ...payload, ...(lineaEditando ? { linea_id: lineaEditando.id } : {}) })} />}
        <div className="om-lineas">{carrito.lineas.filter(l => l.vigente).map(l => <article key={l.id} className="om-linea"><h3>{l.snapshot.nombre}</h3><p>{cantidadTexto(l.declarada_base / Number(l.snapshot.factor))} {l.snapshot.presentacion} · {cantidadTexto(l.declarada_base)} {l.snapshot.unidad_base}</p><p className="om-muted">Origen: {l.snapshot.ubicacion}</p><div className="om-linea-actions"><button className="om-secondary" disabled={ocupado || Boolean(producto)} onClick={() => consultarProducto({ productoId: l.producto_id, presentacionId: l.presentacion_id, editando: l }).catch(e => setError(e.message))}>Editar cantidad</button><button className="om-secondary" aria-label={`Quitar ${l.snapshot.nombre}`} disabled={ocupado || Boolean(producto)} onClick={() => guardar('quitar', { linea_id: l.id })}><Trash2 size={17} /> Quitar</button></div></article>)}</div>
        {!carrito.lineas.length && <p className="om-vacio">Tu carrito todavía está vacío.</p>}
        <button className="om-primary om-wide om-enviar" disabled={ocupado || Boolean(producto) || !carrito.lineas.length} onClick={() => guardar('enviar')}><Send size={19} /> Terminar alistado y enviar a verificar</button>
        <p className="om-stock-info">Enviar guarda la declaración. El stock se mueve cuando el almacenero verifica y autoriza la salida.</p>
      </>}
    </>}
    {scanner && <EscanerCodigo onDetect={detectar} onClose={() => setScanner(false)} />}
  </section>;
}

function ArticuloCarrito({ datos, ubicacionContexto, linea, ocupado, onCancel, onGuardar }) {
  const [presentacion, setPresentacion] = useState(String(linea?.presentacion_id || datos.presentacion_id || datos.presentaciones.find(p => p.es_base)?.id || datos.presentaciones[0].id));
  const [ubicacion, setUbicacion] = useState(String(linea?.ubicacion_origen_id || (datos.ubicaciones.some(u => String(u.id) === String(ubicacionContexto)) ? ubicacionContexto : datos.ubicaciones.length === 1 ? datos.ubicaciones[0].id : '')));
  const factorActual = Number(datos.presentaciones.find(p => p.id === linea?.presentacion_id)?.factor || linea?.snapshot.factor || 1);
  const inicialBase = Boolean(linea && Math.abs(Math.round(linea.declarada_base / factorActual * 1e6) / 1e6 * factorActual - linea.declarada_base) > Number.EPSILON * Math.max(1, linea.declarada_base) * 8);
  const [cantidad, setCantidad] = useState(linea ? String(linea.declarada_base / (inicialBase ? 1 : factorActual)) : '1');
  const [enBase, setEnBase] = useState(inicialBase);
  const [error, setError] = useState('');
  const pr = datos.presentaciones.find(p => String(p.id) === presentacion);
  const ub = datos.ubicaciones.find(u => String(u.id) === ubicacion);
  async function guardar(e) {
    e.preventDefault(); setError('');
    try {
      if (!pr || !ub) throw new Error('Selecciona la presentación y la ubicación de donde lo estás retirando.');
      const n = cantidadOperacion(cantidad) * (enBase ? 1 : Number(pr.factor));
      const base = Math.round(n * 1e6) / 1e6;
      if (base <= 0 || Math.abs(n - base) > Number.EPSILON * Math.max(1, n) * 8) throw new Error('La cantidad debe ser positiva y tener hasta 6 decimales en unidades base.');
      if (Math.abs(base - Math.round(base * 1e4) / 1e4) > Number.EPSILON * Math.max(1, base) * 8) throw new Error('El stock admite hasta 4 decimales en unidades base.');
      await onGuardar({ producto_id: datos.producto.id, presentacion_id: pr.id, ubicacion_id: ub.id, cantidad_base: base });
    } catch (e) { setError(e.message); }
  }
  return <form className="om-articulo" onSubmit={guardar}>
    <h3>{datos.producto.nombre}</h3><p className="om-muted">{datos.producto.sku} · Unidad base: {datos.producto.unidad_base}</p>
    {ubicacionContexto && !datos.ubicaciones.some(u => String(u.id) === String(ubicacionContexto)) && <p className="om-aviso">El producto no está registrado en la ubicación escaneada. Selecciona su origen correcto.</p>}
    <label>Presentación<select value={presentacion} disabled={ocupado} onChange={e => { setPresentacion(e.target.value); setCantidad('1'); }}>{datos.presentaciones.map(p => <option key={p.id} value={p.id}>{p.nombre} · {cantidadTexto(p.factor)} {datos.producto.unidad_base}</option>)}</select></label>
    <label>Ubicación de origen<select value={ubicacion} onChange={e => setUbicacion(e.target.value)} required disabled={ocupado}><option value="">Seleccionar ubicación</option>{datos.ubicaciones.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
    {ub && <p className="om-muted">Stock registrado: {ub.cantidad_base == null ? 'Sin registro' : `${cantidadTexto(ub.cantidad_base)} ${datos.producto.unidad_base}`}</p>}
    {Number(pr?.factor) !== 1 && <label>Unidad para declarar<select value={enBase ? 'base' : 'presentacion'} disabled={ocupado} onChange={e => { setEnBase(e.target.value === 'base'); setCantidad(''); }}><option value="presentacion">{pr?.nombre}</option><option value="base">{datos.producto.unidad_base} (base)</option></select></label>}
    <label>Cantidad que estás alistando en {enBase ? datos.producto.unidad_base : pr?.nombre}<input inputMode="decimal" value={cantidad} onChange={e => setCantidad(e.target.value)} required disabled={ocupado} autoFocus /></label>
    {error && <p role="alert" className="om-error-text">{error}</p>}
    <div className="om-input-row"><button className="om-primary" disabled={ocupado}>{ocupado ? 'Guardando…' : linea ? 'Guardar cantidad' : 'Añadir al carrito'}</button><button type="button" className="om-secondary" disabled={ocupado} onClick={onCancel}>Cancelar</button></div>
  </form>;
}
