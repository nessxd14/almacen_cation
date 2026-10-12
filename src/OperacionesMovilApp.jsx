import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ScanLine, ClipboardCheck, Package, History, LogOut, RefreshCw, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import EscanerCodigo from './EscanerCodigo';
import CarritoTrasladoVirtual from './CarritoTrasladoVirtual';
import RecepcionTrasladoVirtual from './RecepcionTrasladoVirtual';
import CodigoDocumentoQr from './CodigoDocumentoQr';
import { cantidadOperacion, cantidadTexto, etiquetaDocumento, idOperacion, interpretarCodigoOperacion, listarDocumentosMovil, nombresEstadoOperacion, operarDocumentoMovil, resumenOperacion, rolesAlmacen, rolesOperacionesMovil, rutaDocumentoMovil, solicitarDocumentoMovil } from './lib/operacionesMovil';
import './operaciones-movil.css';

const fecha = valor => valor ? new Date(valor).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : '';
const tituloPedido = p => p?.numero || `#${p?.id}`;
const unidad = s => s.presentacion || s.unidad_base;
const factor = s => Number(s.factor) > 0 ? Number(s.factor) : 1;
const cantidadEnPresentacion = (n, s) => `${cantidadTexto(Number(n) / factor(s))} ${unidad(s)}`;
const eventos = { CARRITO_CREADO: 'Comenzó el carrito', AGREGAR: 'Añadió un producto', EDITAR: 'Corrigió una cantidad', QUITAR: 'Quitó un producto', ENVIAR: 'Terminó el alistado y lo envió a verificar', DEVOLVER: 'Devolvió el alistado para corregir', AUTORIZAR: 'Autorizó y registró la salida', RECIBIR: 'Confirmó la recepción en Tienda', PREPARACION_INICIADA: 'Tomó la preparación', GUARDAR_PREPARACION: 'Guardó una línea de preparación', PREPARADO: 'Terminó la preparación', TOMAR_REVISION: 'Tomó la verificación', GUARDAR_REVISION: 'Comprobó un producto y su cantidad', VERIFICADO: 'Confirmó la revisión de esta entrega', SINCRONIZAR: 'Actualizó los cambios del documento', REABRIR: 'Reabrió la preparación', REASIGNAR: 'Tomó a su cargo la preparación', ANULAR: 'Anuló la preparación', DESPACHO_REGISTRADO: 'Registró el despacho ya realizado' };

export default function OperacionesMovilApp({ tipoDocumento = 'pedido' }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { usuario, signOut } = useAuth();
  const { sucursalActivaId, sucursales, puedeElegir, setSucursalActiva, cargando, error, reintentarSucursales } = useSucursal();
  const sucursalSolicitada = idOperacion(params.get('sucursal'));
  const sucursalId = sucursalSolicitada || sucursalActivaId;
  const sucursal = sucursales.find(s => String(s.id) === String(sucursalId) && s.tipo !== 'virtual');
  const autorizada = ['carrito', 'traslado_virtual'].includes(tipoDocumento) || usuario.sucursalId == null || String(usuario.sucursalId) === String(sucursalId);
  function cambiarSucursal(valor) {
    setSucursalActiva(Number(valor));
    if (params.has('sucursal')) {
      const nueva = new URLSearchParams(params); nueva.set('sucursal', String(valor)); nueva.delete('preparacion'); setParams(nueva);
    }
  }
  return <div className="om-app">
    <header className="om-header"><a href="/?tab=pedidos" className="om-back" aria-label="Volver a Almacén"><ArrowLeft size={21} /></a><div><small>CATION · ALMACÉN</small><h1>Operaciones</h1></div><Smartphone size={23} /><button className="om-icon" onClick={signOut} aria-label="Cerrar sesión"><LogOut size={18} /></button></header>
    <div className="om-contexto"><span>{usuario.nombre}</span>{puedeElegir ? <label><span className="sr-only">Sucursal de operaciones</span><select aria-label="Sucursal de operaciones" value={sucursalId ?? ''} onChange={e => cambiarSucursal(e.target.value)} disabled={cargando}>{sucursales.filter(s => s.tipo !== 'virtual').map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label> : <strong>{autorizada ? sucursal?.nombre || 'Sin sucursal disponible' : 'Sucursal no autorizada'}</strong>}</div>
    {!rolesOperacionesMovil.has(usuario.rol) ? <p className="om-aviso" role="alert">Tu perfil no tiene acceso a Operaciones. Un administrador puede habilitarte como almacenero u operario.</p> : id && !rolesAlmacen.has(usuario.rol) && !['carrito','traslado_virtual'].includes(tipoDocumento) ? <p className="om-aviso" role="alert">Tu perfil puede armar traslados para Tienda. Los pedidos y VTD los prepara Almacén.</p> : !autorizada ? <p className="om-aviso" role="alert">Esta preparación pertenece a otra sucursal. Tu perfil permite operar sólo en tu sucursal asignada.</p> : cargando ? <p role="status">Cargando sucursales…</p> : !sucursal || error ? <div className="om-aviso" role="alert">No se pudo obtener tu sucursal física.<button onClick={reintentarSucursales}>Reintentar</button></div> : id && !idOperacion(id) ? <p className="om-aviso" role="alert">El pedido indicado no es válido.</p> : tipoDocumento === 'carrito' ? <CarritoTrasladoVirtual key={`${usuario.id}:${id || 'nuevo'}`} carritoId={id || null} usuario={usuario} /> : <ContenidoOperacion key={`${usuario.id}:${tipoDocumento}:${sucursal.id}:${id || 'inicio'}:${params.get('preparacion') || ''}`} tipo={tipoDocumento} pedidoId={id || null} sucursal={sucursal} sucursales={sucursales} usuario={usuario} />}
  </div>;
}

function ContenidoOperacion({ tipo, pedidoId, sucursal, sucursales, usuario }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tareaSolicitada = idOperacion(params.get('preparacion'));
  const esAlmacen = rolesAlmacen.has(usuario.rol);
  const etiqueta = etiquetaDocumento(tipo);
  const entradaEscaneada = useRef(false);
  const [vista, setVista] = useState('escanear');
  const [codigo, setCodigo] = useState('');
  const [datos, setDatos] = useState(null);
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [scanner, setScanner] = useState(null);
  const [editor, setEditor] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [gestion, setGestion] = useState('');
  const [ubicaciones, setUbicaciones] = useState({});
  const [ubicacionesClave, setUbicacionesClave] = useState('');
  const [errorUbicaciones, setErrorUbicaciones] = useState(false);
  const bloqueado = useRef(false);
  const lecturaConsumida = useRef(false);
  const vigente = useRef(true);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      if (pedidoId) { const auto = params.get('escanear') === '1' && !entradaEscaneada.current;
        entradaEscaneada.current = true;
        const d = await operarDocumentoMovil(supabase, { tipo, documentoId: pedidoId, sucursalId: sucursal.id, tareaId: tareaSolicitada, accion: auto ? 'escanear' : 'consultar' }); if (vigente.current) setDatos(d); }
      else { const ls = await listarDocumentosMovil(supabase, sucursal.id, usuario.rol); if (vigente.current) setLista(ls); }
    } catch (e) { if (vigente.current) setError(e.message); }
    finally { if (vigente.current) setCargando(false); }
  }, [pedidoId, sucursal.id, tareaSolicitada, tipo, usuario.rol, params]);
  useEffect(() => {
    // Inicio de la consulta externa; el indicador también se usa al actualizar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  const sucursalDocumento = datos?.documento?.sucursal_origen_id || sucursal.id;
  const idsProductos = [...new Set((datos?.lineas || []).filter(l => l.vigente && l.snapshot.producto_id).map(l => l.snapshot.producto_id))].join(',');
  useEffect(() => {
    if (!idsProductos) return;
    let actual = true;
    supabase.from('producto_ubicacion').select('producto_id, es_principal, ubicacion:ubicacion_id!inner(id, codigo_zona, estante, nivel, compartimiento, sucursal_id)').in('producto_id', idsProductos.split(',')).eq('ubicacion.sucursal_id', sucursalDocumento).order('es_principal', { ascending: false }).then(({ data, error }) => {
      if (!actual) return;
      const mapa = {};
      for (const row of data || []) (mapa[row.producto_id] ||= []).push(row.ubicacion);
      setUbicaciones(mapa); setUbicacionesClave(idsProductos); setErrorUbicaciones(Boolean(error));
    }, () => { if (actual) { setUbicacionesClave(idsProductos); setErrorUbicaciones(true); } });
    return () => { actual = false; };
  }, [idsProductos, sucursalDocumento]);

  async function accion(nombre, payload = {}) {
    if (bloqueado.current) return;
    bloqueado.current = true; setOcupado(true); setError(''); setAviso('');
    try {
      const d = await operarDocumentoMovil(supabase, { tipo, documentoId: pedidoId, sucursalId: sucursal.id, tareaId: datos?.tarea?.id, accion: nombre, version: datos?.tarea?.version, datos: payload });
      if (!vigente.current) return;
      setDatos(d); setEditor(null); setGestion(''); setMotivo('');
      setAviso(nombre === 'verificado' ? 'Verificación guardada. La entrega está lista para autorizar su salida.' : 'Avance guardado en el almacén.');
    } catch (e) { if (vigente.current) setError(e.message); }
    finally { bloqueado.current = false; if (vigente.current) setOcupado(false); }
  }
  const abrirCodigo = useCallback(async texto => {
    setError('');
    try {
      const c = interpretarCodigoOperacion(texto);
      if (['pedido', 'vtd', 'traslado_virtual'].includes(c.tipo)) {
        if (c.tipo !== 'traslado_virtual' && !esAlmacen) throw new Error('Este documento se prepara y verifica desde Almacén.');
        let documentoId = c.id;
        if (c.tipo === 'vtd' && c.numero) {
          const resuelto = await solicitarDocumentoMovil(supabase, { tipo: 'vtd', accion: 'resolver_vtd', datos: { numero: c.numero } });
          documentoId = resuelto.venta_id;
        }
        navigate(rutaDocumentoMovil(c.tipo, documentoId, true));
      }
      else if (['producto', 'ubicacion'].includes(c.tipo)) {
        if (!esAlmacen) {
          navigate('/operaciones/carrito?' + new URLSearchParams({ ...(c.tipo === 'producto' ? { codigo: texto } : { ubicacion: c.id }), ...(c.sucursalId ? { origen: c.sucursalId } : {}) })); return;
        }
        if (c.sucursalId && c.sucursalId !== String(sucursal.id)) throw new Error('La etiqueta es de otra sucursal. Selecciona esa sucursal antes de abrirla.');
        const query = new URLSearchParams({ sucursal: String(sucursal.id) });
        if (c.tipo === 'producto' && c.presentacionId) query.set('presentacion', c.presentacionId);
        navigate(`/${c.tipo === 'producto' ? 'productos' : 'ubicaciones'}/${c.id}/ficha?${query}`);
      } else throw new Error('Para abrir un pedido escanea su QR de Seller o ingresa su ID. Las barras de producto se usan durante la revisión.');
    } catch (e) { setError(e.message); }
  }, [navigate, sucursal.id, esAlmacen]);
  function abrirScanner(opcion) { lecturaConsumida.current = false; setScanner(opcion); }
  const alDetectar = useCallback(texto => {
    if (lecturaConsumida.current) return;
    lecturaConsumida.current = true;
    setScanner(null);
    if (scanner?.tipo === 'revision') setEditor({ lineaId: scanner.lineaId, tipo: 'revision', metodo: 'escaneo', codigo: texto });
    else abrirCodigo(texto);
  }, [scanner, abrirCodigo]);

  const tarea = datos?.tarea;
  const lineas = (datos?.lineas || []).filter(l => l.vigente);
  const resumen = resumenOperacion(lineas);
  const cambios = (datos?.cambios || []).length > 0;
  const cerrado = tarea && ['ANULADO', 'DESPACHADO', 'EN_TRANSITO', 'RECIBIDO'].includes(tarea.estado);
  const pedidoCerrado = datos?.pedido?.estado !== 'ABIERTO';
  const soyPreparador = tarea?.preparador_id === usuario.id;
  const encargado = ['admin', 'gerente'].includes(usuario.rol);
  const soyRevisor = tarea?.revisor_id === usuario.id;
  const puedePreparar = esAlmacen && tipo !== 'traslado_virtual' && tarea?.estado === 'PREPARANDO' && soyPreparador && !cambios && !pedidoCerrado;
  const puedeRevisar = esAlmacen && !soyPreparador && tarea?.estado === 'REVISANDO' && soyRevisor && !cambios && !pedidoCerrado;
  const tareas = lista.filter(t => vista === 'historial' ? ['DESPACHADO','ANULADO','RECIBIDO'].includes(t.estado) : !['DESPACHADO','ANULADO','RECIBIDO'].includes(t.estado) && (t.preparador_id === usuario.id || t.revisor_id === usuario.id || t.estado === 'PREPARADO' || t.estado === 'EN_TRANSITO'));

  return <>
    {error && <div className="om-aviso om-error" role="alert"><AlertTriangle size={19} /><span>{error}</span></div>}
    {aviso && <div className="om-aviso om-exito" role="status"><CheckCircle2 size={19} /><span>{aviso}</span></div>}
    {cargando ? <p className="om-loading" role="status">Consultando el almacén…</p> : !pedidoId ? <>
      <nav className="om-tabs" aria-label="Operaciones de almacén">{[['escanear','Escanear',ScanLine],['tareas','Mis tareas',ClipboardCheck],['historial','Historial',History]].map(([id,label,Icon]) => <button key={id} aria-current={vista === id ? 'page' : undefined} onClick={() => setVista(id)}><Icon size={20} />{label}</button>)}</nav>
      {vista === 'escanear' ? <section className="om-inicio"><div className="om-scan-icon"><ScanLine size={42} /></div><h2>Escanea y comienza</h2><p>Escanea el QR de un Pedido, VTD o Traslado virtual. El estado del documento determina si preparas, verificas o consultas su entrega.</p><button className="om-primary" onClick={() => abrirScanner({ tipo: 'inicio' })}><ScanLine size={21} /> Abrir cámara</button><Link className="om-secondary om-wide om-cart-entry" to="/operaciones/carrito">Armar Traslado virtual para Tienda</Link><form onSubmit={e => { e.preventDefault(); abrirCodigo(codigo); }}><label htmlFor="om-codigo">QR de documento o ID de pedido</label><div className="om-input-row"><input id="om-codigo" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Pedido, VTD o traslado virtual" autoComplete="off" /><button className="om-secondary" disabled={!codigo.trim()}>Abrir</button></div></form><small>La cámara requiere permiso y una conexión HTTPS en el celular.</small></section> : <section className="om-lista"><div className="om-section-title"><h2>{vista === 'historial' ? 'Últimas entregas' : 'Tu trabajo y entregas listas'}</h2><button onClick={cargar} className="om-icon" aria-label="Actualizar tareas"><RefreshCw size={20} /></button></div><p className="om-muted">Se muestran preparaciones y traslados recientes de {sucursal.nombre}.</p>{tareas.length === 0 ? <p className="om-vacio">No hay preparaciones en esta lista.</p> : tareas.map(t => <Link className="om-task" key={`${t.tipo}:${t.id}`} to={t.estado === 'BORRADOR' ? `/operaciones/carrito/${t.documento_id}` : `${rutaDocumentoMovil(t.tipo, t.documento_id)}${t.tipo === 'pedido' ? `?preparacion=${t.id}` : ''}`}><div><strong>{etiquetaDocumento(t.tipo)} {tituloPedido(t.pedido)}</strong><span>{t.pedido?.cliente?.nombre || t.pedido?.referencia || 'Sin cliente registrado'}</span><small>{t.preparador_nombre} · {fecha(t.actualizado_en)}</small></div><span className={`om-badge om-${t.estado.toLowerCase()}`}>{nombresEstadoOperacion[t.estado]}</span></Link>)}</section>}
    </> : datos ? <>
      <div className="om-section-title"><Link to="/operaciones" className="om-text-link"><ArrowLeft size={17} /> Inicio</Link><button className="om-secondary" onClick={cargar} disabled={ocupado || Boolean(editor)}><RefreshCw size={16} /> Actualizar</button></div>
      <section className="om-pedido"><div className="om-section-title"><h2>{etiqueta} {tituloPedido(datos.pedido)}</h2><span className={`om-badge om-${(tarea?.estado || '').toLowerCase()}`}>{cambios && !datos.entregada && !cerrado ? 'Revisión desactualizada' : tarea ? nombresEstadoOperacion[tarea.estado] : 'Sin preparación'}</span></div><p>{datos.pedido.cliente || (tipo === 'traslado_virtual' ? 'Traslado para Tienda' : 'Sin cliente registrado')}</p>{datos.pedido.referencia && <p className="om-muted">{datos.pedido.referencia}</p>}{tipo !== 'pedido' && <p className="om-muted">Origen: {sucursales.find(s => String(s.id) === String(sucursalDocumento))?.nombre || `Sucursal ${sucursalDocumento}`}</p>}{datos.documento?.pago && <p className="om-aviso">{datos.documento.pago}</p>}<div className="om-responsables"><span>Preparó: <strong>{tarea?.preparador_nombre || 'Sin asignar'}</strong></span><span>Revisó: <strong>{tarea?.revisor_nombre || 'Sin asignar'}</strong></span></div>{Number(datos.otras_sucursales) > 0 && <p className="om-aviso">Hay {datos.otras_sucursales} líneas pendientes de otra sucursal. Esta entrega cubre sólo {sucursal.nombre}.</p>}</section>
      {pedidoCerrado && !datos.entregada && <p className="om-aviso" role="alert">{etiqueta} está {datos.pedido.estado.toLowerCase()}. La preparación se conserva como registro y no puede confirmarse.</p>}
      {cambios && !cerrado && !datos.entregada && <div className="om-aviso" role="alert"><div><strong>El documento cambió</strong><p>{datos.cambios.length} líneas necesitan comprobarse de nuevo. Se conservarán las cantidades de las líneas que no cambiaron.</p>{tipo !== 'traslado_virtual' && (soyPreparador || encargado) && !pedidoCerrado && <button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => accion('sincronizar')}>Actualizar preparación</button>}</div></div>}
      {datos.entregada && tarea && <p className="om-aviso om-exito">La salida de esta entrega ya está registrada.</p>}
      {!tarea && !pedidoCerrado && esAlmacen && <button className="om-primary om-wide" disabled={ocupado || (tipo === 'pedido' && !lineas.length)} onClick={() => accion('crear')}>Tomar preparación</button>}
      {tipo === 'vtd' && tarea?.estado === 'ANULADO' && !pedidoCerrado && esAlmacen && <button className="om-primary om-wide" disabled={ocupado} onClick={() => accion('crear')}>Retomar preparación de VTD</button>}
      {tipo === 'pedido' && cerrado && !pedidoCerrado && !tareaSolicitada && <button className="om-primary om-wide" disabled={ocupado} onClick={() => accion('crear')}>Crear una nueva preparación</button>}
      {tipo === 'traslado_virtual' && tarea && tarea.estado !== 'ANULADO' && <CodigoDocumentoQr tipo={tipo} documentoId={pedidoId} />}
      {tipo === 'traslado_virtual' && tarea?.estado === 'BORRADOR' && soyPreparador && <Link className="om-primary om-wide" to={`/operaciones/carrito/${tarea.id}`}>Continuar o corregir el carrito</Link>}
      {tarea?.estado === 'PREPARANDO' && !soyPreparador && <p className="om-aviso">{tarea.preparador_nombre} está preparando este documento. Podrás verificarlo cuando termine.</p>}
      {tarea?.estado === 'PREPARADO' && soyPreparador && <p className="om-aviso">Presenta el QR a otra persona de Almacén para que verifique tu alistado.</p>}
      {tarea?.estado === 'REVISANDO' && !soyRevisor && <p className="om-aviso">{tarea.revisor_nombre} tiene a cargo la verificación.</p>}
      {tarea?.observacion && <p className="om-aviso">{tarea.observacion}</p>}
      {tarea && <div className="om-progreso"><span>{resumen.preparadas}/{resumen.total} líneas preparadas</span><span>{resumen.revisadas}/{resumen.revisar} revisadas</span>{resumen.parcial && <strong>Entrega parcial</strong>}</div>}
      {lineas.length === 0 && <p className="om-vacio">No hay líneas pendientes en esta sucursal.</p>}
      <div className="om-lineas">{lineas.map(l => <article className={`om-linea ${l.revisada_base != null ? 'om-linea-ok' : ''}`} key={l.pedido_linea_id}>
        <div className="om-linea-title"><Package size={20} /><div><h3>{l.snapshot.nombre}</h3><small>{l.snapshot.sku || (l.snapshot.es_personalizado ? 'Producto personalizado' : 'Sin SKU')} · {unidad(l.snapshot)}</small></div>{l.revisada_base != null && <CheckCircle2 size={23} className="om-check" />}</div>
        {l.snapshot.presentacion && <p className="om-equivalencia">1 {l.snapshot.presentacion} = {cantidadTexto(factor(l.snapshot))} {l.snapshot.unidad_base}</p>}
        {l.snapshot.nota && <p className="om-aviso">{l.snapshot.nota}</p>}
        <div className="om-cantidades"><div><small>{tipo === 'traslado_virtual' ? 'Declarado' : 'Pendiente al preparar'}</small><strong>{cantidadEnPresentacion(l.snapshot.pendiente_base, l.snapshot)}</strong></div><div><small>En esta entrega</small><strong>{cantidadEnPresentacion(l.preparada_base, l.snapshot)}</strong></div></div>
        {l.snapshot.ubicacion && <p className="om-origen"><strong>Retirado de:</strong> {l.snapshot.ubicacion}</p>}{l.snapshot.producto_id && esAlmacen && <div className="om-ubicaciones"><small>Ubicación asignada</small>{ubicacionesClave !== idsProductos ? <span>Consultando ubicaciones…</span> : errorUbicaciones ? <span>No se pudo consultar</span> : ubicaciones[l.snapshot.producto_id]?.length ? ubicaciones[l.snapshot.producto_id].map(u => <Link key={u.id} to={`/ubicaciones/${u.id}/ficha?sucursal=${sucursalDocumento}`}>{[u.codigo_zona,u.estante,u.nivel,u.compartimiento].filter(Boolean).join(' · ')}</Link>) : <span>Sin ubicación registrada</span>}<Link to={`/productos/${l.snapshot.producto_id}/ficha?sucursal=${sucursalDocumento}${l.snapshot.presentacion_id ? `&presentacion=${l.snapshot.presentacion_id}` : ''}`}>Ver ficha del producto</Link></div>}
        {!l.snapshot.preparable && <p className="om-muted">{l.snapshot.estado === 'POR_COMPRAR' ? 'Pendiente de compra: registra 0 y el motivo para continuar con una entrega parcial.' : 'Resuelve el estado o la presentación de esta línea en el pedido antes de prepararla.'}</p>}
        {l.observacion && <p className="om-nota"><strong>Observación:</strong> {l.observacion}</p>}
        {l.confirmada && <p className="om-muted">Preparación guardada{l.revisada_base != null ? ` · ${l.revisor_nombre || 'Revisor'} comprobó por ${l.metodo_revision === 'escaneo' ? 'escaneo' : 'revisión visual'}` : ''}</p>}
        {editor?.lineaId === l.pedido_linea_id ? <EditorLinea key={`${l.pedido_linea_id}:${editor.tipo}:${editor.codigo || ''}`} linea={l} editor={editor} ocupado={ocupado} onCancel={() => setEditor(null)} onGuardar={payload => accion(editor.tipo === 'preparacion' ? 'guardar_preparacion' : 'guardar_revision', payload)} /> : <div className="om-linea-actions">
          {puedePreparar && <button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'preparacion' })}>{l.confirmada ? 'Editar preparación' : 'Preparar esta línea'}</button>}
          {puedeRevisar && Number(l.preparada_base) > 0 && <><button className="om-primary" disabled={ocupado || Boolean(editor)} onClick={() => abrirScanner({ tipo: 'revision', lineaId: l.pedido_linea_id })}><ScanLine size={18} /> Escanear y contar</button><button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'revision', metodo: 'visual', codigo: '' })}>Comprobar visualmente</button><button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => setEditor({ lineaId: l.pedido_linea_id, tipo: 'revision', metodo: 'escaneo', codigo: '' })}>Ingresar código</button></>}
        </div>}
      </article>)}</div>
      {tarea && !cerrado && !pedidoCerrado && !cambios && <div className="om-finalizar">
        {puedePreparar && <button className="om-primary om-wide" disabled={ocupado || Boolean(editor) || resumen.preparadas !== resumen.total || !resumen.revisar || (tipo === 'vtd' && resumen.parcial)} onClick={() => accion('preparado')}>Terminar preparación</button>}
        {tarea.estado === 'PREPARADO' && esAlmacen && <button className="om-primary om-wide" disabled={ocupado || soyPreparador} onClick={() => accion('tomar_revision')}>Tomar revisión</button>}
        {puedeRevisar && <button className="om-primary om-wide" disabled={ocupado || Boolean(editor) || resumen.revisadas !== resumen.revisar || !resumen.revisar} onClick={() => accion('verificado')}>Confirmar revisión de esta entrega</button>}
        {tarea.estado === 'VERIFICADO' && <p className="om-aviso om-exito"><CheckCircle2 size={20} /><span>Esta entrega está verificada{resumen.parcial ? '. Quedan cantidades pendientes en el pedido' : ''}.</span></p>}
        {tipo === 'pedido' && tarea.estado === 'VERIFICADO' && datos.entregada && !tareaSolicitada && <button className="om-secondary om-wide" disabled={ocupado} onClick={() => accion('crear')}>Preparar otra entrega pendiente</button>}
      </div>}
      {tipo === 'vtd' && resumen.parcial && !cerrado && <p className="om-aviso">La VTD debe coincidir con el ticket completo. Si falta material, Caja debe corregir el ticket; después actualiza la preparación.</p>}
      {tipo !== 'pedido' && tarea?.estado === 'VERIFICADO' && !datos.entregada && soyRevisor && !soyPreparador && esAlmacen && <button className="om-primary om-wide" disabled={ocupado || cambios || Boolean(editor)} onClick={() => accion('autorizar')}>{ocupado ? 'Registrando salida…' : tipo === 'vtd' ? 'Autorizar salida y entregar VTD' : 'Autorizar salida hacia Tienda'}</button>}
      {tipo === 'traslado_virtual' && datos.documento?.traslado_id && <p className="om-aviso om-exito">Traslado #{datos.documento.traslado_id} · {datos.documento.traslado_estado}</p>}
      {tipo === 'traslado_virtual' && tarea?.estado === 'EN_TRANSITO' && (usuario.sucursalId == null && encargado || String(usuario.sucursalId) === String(tarea.sucursal_destino_id)) && <RecepcionTrasladoVirtual lineas={datos.recepcion || []} ocupado={ocupado} onRecibir={payload => accion('recibir', payload)} />}
      <p className="om-stock-info">Preparar y revisar guardan el checklist. El stock se actualiza al confirmar el despacho.</p>{tipo === 'pedido' && <Link className="om-secondary om-wide" to={`/pedidos/${pedidoId}${tarea ? `?preparacion=${tarea.id}&sucursal=${sucursalDocumento}` : ''}`}>Abrir pedido y despacho</Link>}
      {tarea && !cerrado && (soyPreparador || encargado || (soyRevisor && ['REVISANDO','VERIFICADO'].includes(tarea.estado))) && <details className="om-gestion"><summary>Corregir o gestionar preparación</summary><div className="om-input-row"><select aria-label="Acción de gestión" value={gestion} onChange={e => setGestion(e.target.value)}><option value="">Elegir acción</option>{(soyPreparador || encargado) && !pedidoCerrado && <option value="reabrir">Reabrir y corregir</option>}{tipo === 'pedido' && encargado && !pedidoCerrado && <option value="reasignar">Tomar a mi cargo y reabrir</option>}{(soyPreparador || encargado) && <option value="anular">Anular esta preparación</option>}{soyRevisor && ['REVISANDO','VERIFICADO'].includes(tarea.estado) && <option value="devolver">Devolver para corregir</option>}</select></div><label>Motivo<textarea maxLength={1000} value={motivo} onChange={e => setMotivo(e.target.value)} /></label><button className="om-secondary" disabled={ocupado || Boolean(editor) || !gestion || !motivo.trim()} onClick={() => accion(gestion, { observacion: motivo.trim() })}>Guardar acción</button><p className="om-muted">Reabrir o reasignar elimina la revisión anterior. El motivo y el responsable quedan en el historial.</p></details>}
      {datos.eventos?.length > 0 && <details className="om-historial"><summary>Historial de esta preparación ({datos.eventos.length})</summary><ol>{datos.eventos.map(e => <li key={e.id}><strong>{eventos[e.accion] || e.accion}</strong><span>{e.actor_nombre} · {fecha(e.creado_en)}</span>{e.detalle?.linea_id && <small>Línea #{e.detalle.linea_id}{e.detalle.cantidad_base != null ? ` · ${cantidadTexto(e.detalle.cantidad_base)} en unidades base` : ''}{e.detalle.metodo ? ` · ${e.detalle.metodo}` : ''}</small>}{e.detalle?.observacion && <p>{e.detalle.observacion}</p>}</li>)}</ol></details>}
    </> : <button className="om-secondary" onClick={cargar}>Reintentar consulta</button>}
    {scanner && <EscanerCodigo onDetect={alDetectar} onClose={() => setScanner(null)} />}
  </>;
}

function EditorLinea({ linea, editor, ocupado, onCancel, onGuardar }) {
  const s = linea.snapshot;
  const preparacion = editor.tipo === 'preparacion';
  const cantidadInicial = Number(linea.confirmada ? linea.preparada_base : s.preparable ? s.pendiente_base : 0);
  const iniciarEnBase = Math.abs(Math.round(cantidadInicial / factor(s) * 1e6) / 1e6 * factor(s) - cantidadInicial) > Number.EPSILON * Math.max(1, cantidadInicial) * 8;
  const [enBase, setEnBase] = useState(iniciarEnBase);
  const [cantidad, setCantidad] = useState(preparacion ? String(cantidadInicial / (iniciarEnBase ? 1 : factor(s))) : '');
  const [observacion, setObservacion] = useState(linea.observacion || '');
  const [codigo, setCodigo] = useState(editor.codigo || '');
  const [error, setError] = useState('');
  async function guardar(e) {
    e.preventDefault(); setError('');
    try {
      const n = cantidadOperacion(cantidad) * (enBase ? 1 : factor(s));
      const base = Math.round(n * 1e6) / 1e6;
      if (Math.abs(base-n) > Number.EPSILON * Math.max(1, n) * 8) throw new Error('La conversión debe dar una cantidad con hasta 6 decimales en unidades base.');
      if (preparacion && base > Number(s.pendiente_base)) throw new Error('La cantidad supera lo pendiente del pedido.');
      if (preparacion && base < Number(s.pendiente_base) && !observacion.trim()) throw new Error('Indica el motivo de la cantidad que queda pendiente.');
      if (!preparacion && base !== Number(linea.preparada_base)) throw new Error('La cantidad contada no coincide con la preparada. Reabre la preparación para corregirla.');
      if (!preparacion && editor.metodo === 'escaneo' && !codigo.trim()) throw new Error('Ingresa o escanea el código de este producto.');
      await onGuardar({ linea_id: linea.pedido_linea_id, cantidad_base: base, ...(preparacion ? { observacion: observacion.trim() } : { metodo: editor.metodo, codigo: codigo.trim() }) });
    } catch (e) { setError(e.message); }
  }
  return <form className="om-editor" onSubmit={guardar}>
    <strong>{preparacion ? 'Cantidad preparada para esta entrega' : 'Comprueba el producto, la presentación y cuenta lo preparado'}</strong>
    {!preparacion && editor.metodo === 'escaneo' && <label>Código leído<input value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="off" maxLength={2048} /></label>}
    {factor(s) !== 1 && <label>Unidad de conteo<select value={enBase ? 'base' : 'presentacion'} disabled={ocupado} onChange={e => { const base = e.target.value === 'base'; setEnBase(base); setCantidad(preparacion ? String(cantidadInicial / (base ? 1 : factor(s))) : ''); }}><option value="presentacion">{unidad(s)} · {cantidadTexto(factor(s))} {s.unidad_base}</option><option value="base">{s.unidad_base} (unidad base)</option></select></label>}
    <label>{preparacion ? 'Preparado' : 'Cantidad contada'} en {enBase ? s.unidad_base : unidad(s)}<input autoFocus inputMode="decimal" value={cantidad} onChange={e => setCantidad(e.target.value)} required autoComplete="off" disabled={ocupado} /></label>
    {preparacion && <label>Observación o motivo del faltante<textarea maxLength={1000} value={observacion} onChange={e => setObservacion(e.target.value)} /></label>}
    {!preparacion && <p className="om-muted">Escanear identifica el producto. Confirma también su empaque y la cantidad que tienes delante.</p>}
    {error && <p className="om-error-text" role="alert">{error}</p>}
    <div className="om-input-row"><button className="om-primary" disabled={ocupado}>{ocupado ? 'Guardando…' : preparacion ? 'Guardar preparación' : 'Guardar comprobación'}</button><button type="button" className="om-secondary" disabled={ocupado} onClick={onCancel}>Cancelar</button></div>
  </form>;
}
