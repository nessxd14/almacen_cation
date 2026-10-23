import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ScanLine, ClipboardCheck, History, LogOut, RefreshCw, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import EscanerCodigo from './EscanerCodigo';
import CarritoTrasladoVirtual from './CarritoTrasladoVirtual';
import RecepcionTrasladoVirtual from './RecepcionTrasladoVirtual';
import CodigoDocumentoQr from './CodigoDocumentoQr';
import ConfirmarRestoPreparacion from './ConfirmarRestoPreparacion';
import VtdCajaAlmacen from './VtdCajaAlmacen';
import EvidenciaOperacion from './EvidenciaOperacion';
import { operarEvidenciaOperacion, subirEvidenciaOperacion } from './lib/evidenciaOperacion';
import { cantidadTexto, etiquetaDocumento, idOperacion, interpretarCodigoOperacion, listarDocumentosMovil, nombresEstadoOperacion, operarDocumentoMovil, resumenOperacion, rolesAlmacen, rolesOperacionesMovil, rutaDocumentoMovil, solicitarDocumentoMovil } from './lib/operacionesMovil';
import './operaciones-movil.css';
import './preparacion-checklist.css';
import PreparacionChecklist, { EtapasEntrega } from './PreparacionChecklist';
import {OrigenesMaterial, ResumenEntregasPedido} from './AbastecimientoLinea';

const fecha = valor => valor ? new Date(valor).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : '';
const tituloPedido = p => p?.numero || `#${p?.id}`;
const eventos = { CARRITO_CREADO: 'Comenzó el carrito', AGREGAR: 'Añadió un producto', EDITAR: 'Corrigió una cantidad', QUITAR: 'Quitó un producto', ENVIAR: 'Terminó el alistado y lo envió a verificar', DEVOLVER: 'Devolvió el alistado para corregir', AUTORIZAR: 'Autorizó y registró la salida', RECIBIR: 'Confirmó la recepción en Tienda', PREPARACION_INICIADA: 'Tomó la preparación', GUARDAR_PREPARACION: 'Guardó una línea de preparación', PREPARADO: 'Terminó la preparación', TOMAR_REVISION: 'Tomó la verificación', GUARDAR_REVISION: 'Comprobó un producto y su cantidad', VERIFICADO: 'Confirmó la revisión de esta entrega', SINCRONIZAR: 'Actualizó los cambios del documento', REABRIR: 'Reabrió la preparación', REASIGNAR: 'Tomó a su cargo la preparación', ANULAR: 'Anuló la preparación', DESPACHO_REGISTRADO: 'Registró el despacho ya realizado' };

eventos.RESTO_PREPARACION_CONFIRMADO = 'Confirmó las líneas completas restantes';
eventos.RETIRO_TRANSPORTE = 'Retiró el pedido para transporte';
eventos.RESTO_REVISION_CONFIRMADO = 'Confirmó que el resto coincide';
eventos.REVISION_Y_RETIRO = 'Verificó y retiró el material';

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
  const [fotos, setFotos] = useState([]);
  const [evidenciaInfo, setEvidenciaInfo] = useState(null);
  const [revisionEvidencia, setRevisionEvidencia] = useState(0);
  const [destinoRetiro, setDestinoRetiro] = useState('');
  const [evidenciaPendiente, setEvidenciaPendiente] = useState(false);
  const loteEvidencia = useRef(null);
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
    if (bloqueado.current) return false;
    bloqueado.current = true; setOcupado(true); setError(''); setAviso('');
    try {
      if (dosActores && ['preparado','confirmar_retiro'].includes(nombre)) {
        if (!evidenciaInfo?.activo) throw new Error('Actualiza las fotos antes de confirmar esta etapa.');
        if (loteEvidencia.current?.rpcIntentado) {
          const actual=await operarDocumentoMovil(supabase,{tipo,documentoId:pedidoId,sucursalId:sucursalDocumento,tareaId:datos.tarea.id,accion:'consultar'});
          const evidencia=await operarEvidenciaOperacion(supabase,{tipo,documentoId:pedidoId,entregaId:datos.tarea.id});
          if (evidencia.envios.some(e=>e.id===loteEvidencia.current.id)) {
            setDatos(actual);setFotos([]);loteEvidencia.current=null;setEvidenciaPendiente(false);setEvidenciaInfo(evidencia);setRevisionEvidencia(n=>n+1);setAviso('La confirmación ya estaba guardada. Recuperamos esta entrega.');return true;
          }
        }
        if (!loteEvidencia.current || loteEvidencia.current.version!==datos.tarea.version) loteEvidencia.current={id:crypto.randomUUID(),version:datos.tarea.version};
        const evidenciaId=await subirEvidenciaOperacion(supabase,{tipo,documentoId:pedidoId,entregaId:datos.tarea.id,version:datos.tarea.version,loteId:loteEvidencia.current.id,fotos});
        payload=loteEvidencia.current.payload || {...payload,evidencia_id:evidenciaId};
        loteEvidencia.current.payload=payload;loteEvidencia.current.rpcIntentado=true;setEvidenciaPendiente(true);
      }
      if (nombre === 'autorizar' && tipo === 'traslado_virtual') {
        if (evidenciaInfo === null) throw new Error('Actualiza la evidencia antes de autorizar el traslado.');
        if (loteEvidencia.current?.rpcIntentado) {
          const actual = await operarDocumentoMovil(supabase, { tipo, documentoId: pedidoId, sucursalId: sucursalDocumento, accion: 'consultar' });
          if (['EN_TRANSITO','RECIBIDO'].includes(actual.tarea?.estado)) { setDatos(actual); setFotos([]); loteEvidencia.current=null; setEvidenciaPendiente(false); setRevisionEvidencia(n=>n+1); return true; }
        }
        if (evidenciaInfo.activo) {
          if (!loteEvidencia.current || loteEvidencia.current.version !== datos.tarea.version) loteEvidencia.current={ id:crypto.randomUUID(),version:datos.tarea.version };
          payload = { ...payload, evidencia_id:await subirEvidenciaOperacion(supabase, { tipo,documentoId:pedidoId,entregaId:datos.tarea.id,version:datos.tarea.version,loteId:loteEvidencia.current.id,fotos }) };
          loteEvidencia.current.rpcIntentado=true;
          setEvidenciaPendiente(true);
        }
      }
      const d = await operarDocumentoMovil(supabase, { tipo, documentoId: pedidoId, sucursalId: sucursalDocumento, tareaId: datos?.tarea?.id, accion: nombre, version: datos?.tarea?.version, datos: payload, dosActores });
      if (!vigente.current) return;
      setDatos(d); setEditor(null); setGestion(''); setMotivo('');
      if (nombre === 'autorizar' || dosActores && ['preparado','confirmar_retiro'].includes(nombre) || d.tarea?.id !== datos?.tarea?.id) { setFotos([]); loteEvidencia.current=null; setEvidenciaPendiente(false); setEvidenciaInfo(null); setDestinoRetiro(''); setRevisionEvidencia(n=>n+1); }
      setAviso(dosActores && nombre==='preparado' ? 'Alistado enviado a verificación. El aviso y las fotos quedaron pendientes de envío a Telegram.' : nombre==='confirmar_retiro' ? 'Revisión y retiro confirmados. La salida ya está registrada.' : nombre==='confirmar_resto_revision' ? 'El resto quedó verificado. Se conservaron las diferencias que registraste.' : nombre === 'confirmar_resto' ? (d.confirmacion_preparacion?.confirmadas || 0) + ' líneas completas confirmadas. Se conservaron los faltantes guardados.' : nombre === 'verificado' ? 'Verificación guardada. La entrega está lista para autorizar su salida.' : 'Avance guardado en el almacén.');
      return true;
    } catch (e) {
      if (dosActores && ['P0001','40001','42501'].includes(e.code)) { if(loteEvidencia.current){loteEvidencia.current.rpcIntentado=false;delete loteEvidencia.current.payload;}setEvidenciaPendiente(false); }
      if (vigente.current) setError(e.message); return false;
    }
    finally { bloqueado.current = false; if (vigente.current) setOcupado(false); }
  }
  async function retirarPedido() {
    if (bloqueado.current) return;
    bloqueado.current=true; setOcupado(true); setError('');
    try {
      const referencia={ tipo,documentoId:pedidoId,entregaId:datos.tarea.id };
      if (loteEvidencia.current?.rpcIntentado) {
        const actual=await operarEvidenciaOperacion(supabase,referencia);
        if (actual.retiro) { setEvidenciaInfo(actual); setDatos(prev=>({...prev,retiro:actual.retiro})); setFotos([]); loteEvidencia.current=null; setEvidenciaPendiente(false); setRevisionEvidencia(n=>n+1); return; }
      }
      if (!loteEvidencia.current || loteEvidencia.current.version!==datos.tarea.version) loteEvidencia.current={ id:crypto.randomUUID(),version:datos.tarea.version };
      const evidenciaId=await subirEvidenciaOperacion(supabase,{...referencia,version:datos.tarea.version,loteId:loteEvidencia.current.id,fotos});
      loteEvidencia.current.rpcIntentado=true;
      setEvidenciaPendiente(true);
      const result=await operarEvidenciaOperacion(supabase,{...referencia,accion:'retirar',datos:{version:datos.tarea.version,evidencia_id:evidenciaId,destino:destinoRetiro.trim()}});
      setEvidenciaInfo(result); setDatos(prev=>({...prev,retiro:result.retiro})); setFotos([]); loteEvidencia.current=null; setEvidenciaPendiente(false);
      setRevisionEvidencia(n=>n+1); setAviso('Retiro registrado. Esta entrega está en transporte; la recepción en destino es un paso distinto.');
    } catch(e) { setError(e.message); }
    finally { bloqueado.current=false;setOcupado(false); }
  }
  const abrirCodigo = useCallback(async texto => {
    setError('');
    try {
      const c = interpretarCodigoOperacion(texto);
      if (['pedido', 'vtd', 'traslado', 'traslado_virtual'].includes(c.tipo)) {
        if (!['traslado','traslado_virtual'].includes(c.tipo) && !esAlmacen) throw new Error('Este documento se prepara y verifica desde Almacén.');
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
  }, [scanner, abrirCodigo, setScanner, setEditor]);

  const tarea = datos?.tarea;
  const dosActores = tipo==='pedido' && datos?.pedido_dos_actores===true;
  const retiro = datos?.retiro || (evidenciaInfo?.retiro && evidenciaInfo.retiro.preparacion_id === tarea?.id ? evidenciaInfo.retiro : null);
  const retiroPrevio = dosActores && tarea?.salida_previa && tarea.estado==='DESPACHADO' && !retiro;
  const lineas = (datos?.lineas || []).filter(l => l.vigente);
  const resumen = resumenOperacion(lineas, dosActores);
  const cambios = (datos?.cambios || []).length > 0;
  const cerrado = tarea && ['ANULADO', 'DESPACHADO', 'EN_TRANSITO', 'RECIBIDO'].includes(tarea.estado);
  const pedidoCerrado = datos?.pedido?.estado !== 'ABIERTO';
  const soyPreparador = tarea?.preparador_id === usuario.id;
  const encargado = ['admin', 'gerente'].includes(usuario.rol);
  const soyRevisor = tarea?.revisor_id === usuario.id;
  const puedePreparar = esAlmacen && tipo !== 'traslado_virtual' && tarea?.estado === 'PREPARANDO' && soyPreparador && !cambios && !pedidoCerrado;
  const puedeRevisar = esAlmacen && !soyPreparador && tarea?.estado === 'REVISANDO' && soyRevisor && !cambios && !pedidoCerrado;
  const tareas = lista.filter(t => vista === 'historial' ? ['DESPACHADO','ANULADO','RECIBIDO'].includes(t.estado) : !['DESPACHADO','ANULADO','RECIBIDO'].includes(t.estado) && (t.preparador_id === usuario.id || t.revisor_id === usuario.id || t.estado === 'PREPARADO' || t.estado === 'EN_TRANSITO' || ['SOLICITADO','EN_CAJA','RETORNO_PENDIENTE'].includes(t.estado)));

  if (datos?.cajaAlmacen) return <VtdCajaAlmacen registro={datos.cajaAlmacen} ventaId={pedidoId} onChanged={registro => setDatos({ cajaAlmacen: registro })} />;

  return <>
    {error && <div className="om-aviso om-error" role="alert"><AlertTriangle size={19} /><span>{error}</span></div>}
    {aviso && <div className="om-aviso om-exito" role="status"><CheckCircle2 size={19} /><span>{aviso}</span></div>}
    {cargando ? <p className="om-loading" role="status">Consultando el almacén…</p> : !pedidoId ? <>
      <nav className="om-tabs" aria-label="Operaciones de almacén">{[['escanear','Escanear',ScanLine],['tareas','Mis tareas',ClipboardCheck],['historial','Historial',History]].map(([id,label,Icon]) => <button key={id} aria-current={vista === id ? 'page' : undefined} onClick={() => setVista(id)}><Icon size={20} />{label}</button>)}</nav>
      {vista === 'escanear' ? <section className="om-inicio"><div className="om-scan-icon"><ScanLine size={42} /></div><h2>Escanea y comienza</h2><p>Escanea el QR de un Pedido, VTD o Traslado virtual. El estado del documento determina si preparas, verificas o consultas su entrega.</p><button className="om-primary" onClick={() => abrirScanner({ tipo: 'inicio' })}><ScanLine size={21} /> Abrir cámara</button><Link className="om-secondary om-wide om-cart-entry" to="/operaciones/carrito">Armar Traslado virtual para Tienda</Link><form onSubmit={e => { e.preventDefault(); abrirCodigo(codigo); }}><label htmlFor="om-codigo">QR de documento o ID de pedido</label><div className="om-input-row"><input id="om-codigo" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Pedido, VTD o traslado virtual" autoComplete="off" /><button className="om-secondary" disabled={!codigo.trim()}>Abrir</button></div></form><small>La cámara requiere permiso y una conexión HTTPS en el celular.</small></section> : <section className="om-lista"><div className="om-section-title"><h2>{vista === 'historial' ? 'Últimas entregas' : 'Tu trabajo y entregas listas'}</h2><button onClick={cargar} className="om-icon" aria-label="Actualizar tareas"><RefreshCw size={20} /></button></div><p className="om-muted">Se muestran preparaciones y traslados recientes de {sucursal.nombre}.</p>{tareas.length === 0 ? <p className="om-vacio">No hay preparaciones en esta lista.</p> : tareas.map(t => <Link className="om-task" key={`${t.tipo}:${t.id}`} to={t.estado === 'BORRADOR' ? `/operaciones/carrito/${t.documento_id}` : `${rutaDocumentoMovil(t.tipo, t.documento_id)}${t.tipo === 'pedido' ? `?preparacion=${t.id}` : ''}`}><div><strong>{etiquetaDocumento(t.tipo)} {tituloPedido(t.pedido)}</strong><span>{t.pedido?.cliente?.nombre || t.pedido?.referencia || 'Sin cliente registrado'}</span><small>{t.preparador_nombre} · {fecha(t.actualizado_en)}</small></div><span className={`om-badge om-${t.estado.toLowerCase()}`}>{nombresEstadoOperacion[t.estado]}</span></Link>)}</section>}
    </> : datos ? <>
      <div className="om-section-title"><Link to="/operaciones" className="om-text-link"><ArrowLeft size={17} /> Inicio</Link><button className="om-secondary" onClick={cargar} disabled={ocupado || Boolean(editor)}><RefreshCw size={16} /> Actualizar</button></div>
      <section className="om-pedido"><div className="om-section-title"><h2>{etiqueta} {tituloPedido(datos.pedido)}</h2><span className={`om-badge om-${(tarea?.estado || '').toLowerCase()}`}>{cambios && !datos.entregada && !cerrado ? 'Revisión desactualizada' : tarea ? nombresEstadoOperacion[tarea.estado] : 'Sin preparación'}</span></div><p>{datos.pedido.cliente || (tipo === 'traslado_virtual' ? 'Traslado para Tienda' : 'Sin cliente registrado')}</p>{datos.pedido.referencia && <p className="om-muted">{datos.pedido.referencia}</p>}{tipo !== 'pedido' && <p className="om-muted">Origen: {sucursales.find(s => String(s.id) === String(sucursalDocumento))?.nombre || `Sucursal ${sucursalDocumento}`}</p>}{datos.documento?.pago && <p className="om-aviso">{datos.documento.pago}</p>}<div className="om-responsables"><span>Preparó: <strong>{tarea?.preparador_nombre || 'Sin asignar'}</strong></span><span>Revisó: <strong>{tarea?.revisor_nombre || 'Sin asignar'}</strong></span></div>{Number(datos.otras_sucursales) > 0 && <p className="om-aviso">Hay {datos.otras_sucursales} líneas pendientes de otra sucursal. Esta entrega cubre sólo {sucursal.nombre}.</p>}</section>
      {tipo==='pedido'&&<ResumenEntregasPedido datos={datos} pedidoId={pedidoId} sucursalId={sucursalDocumento}/>}
      {pedidoCerrado && !datos.entregada && <p className="om-aviso" role="alert">{etiqueta} está {datos.pedido.estado.toLowerCase()}. La preparación se conserva como registro y no puede confirmarse.</p>}
      {cambios && !cerrado && !datos.entregada && <div className="om-aviso" role="alert"><div><strong>El documento cambió</strong><p>{datos.cambios.length} líneas necesitan comprobarse de nuevo. Se conservarán las cantidades de las líneas que no cambiaron.</p>{tipo !== 'traslado_virtual' && (soyPreparador || encargado) && !pedidoCerrado && <button className="om-secondary" disabled={ocupado || Boolean(editor)} onClick={() => accion('sincronizar')}>Actualizar preparación</button>}</div></div>}
      {datos.entregada && tarea && <p className="om-aviso om-exito">La salida de esta entrega ya está registrada.</p>}
      {tipo === 'pedido' && datos.retiros_pendientes?.some(t=>t.id!==tarea?.id) && <section className="om-pedido"><h3>Otras entregas pendientes de retiro</h3><p>Consulta la entrega que vas a transportar.</p>{datos.retiros_pendientes.filter(t=>t.id!==tarea?.id).map(t=><Link className="om-task" key={t.id} to={`/operaciones/pedidos/${pedidoId}?sucursal=${sucursalDocumento}&preparacion=${t.id}`}><span>Entrega #{t.id} · {t.preparador} / {t.revisor}</span><strong>Abrir retiro</strong></Link>)}</section>}
      {!tarea && !pedidoCerrado && esAlmacen && <button className="om-primary om-wide" disabled={ocupado || (tipo === 'pedido' && !lineas.length)} onClick={() => accion('crear')}>Tomar preparación</button>}
      {tipo === 'vtd' && tarea?.estado === 'ANULADO' && !pedidoCerrado && esAlmacen && <button className="om-primary om-wide" disabled={ocupado} onClick={() => accion('crear')}>Retomar preparación de VTD</button>}
      {tipo === 'pedido' && cerrado && !pedidoCerrado && !tareaSolicitada && <button className="om-primary om-wide" disabled={ocupado} onClick={() => accion('crear')}>Crear una nueva preparación</button>}
      {tipo === 'traslado_virtual' && tarea && tarea.estado !== 'ANULADO' && <CodigoDocumentoQr tipo={tipo} documentoId={pedidoId} />}
      {tipo === 'traslado_virtual' && tarea?.estado === 'BORRADOR' && soyPreparador && <Link className="om-primary om-wide" to={`/operaciones/carrito/${tarea.id}`}>Continuar o corregir el carrito</Link>}
      {tarea?.estado === 'PREPARANDO' && !soyPreparador && <p className="om-aviso">{tarea.preparador_nombre} está preparando este documento. Podrás verificarlo cuando termine.</p>}
      {tarea?.estado === 'PREPARADO' && soyPreparador && <p className="om-aviso">Presenta el QR a otra persona de Almacén para que verifique tu alistado.</p>}
      {tarea?.estado === 'REVISANDO' && !soyRevisor && <p className="om-aviso">{tarea.revisor_nombre} tiene a cargo la verificación.</p>}
      {tarea?.observacion && <p className="om-aviso">{tarea.observacion}</p>}
      <EtapasEntrega estado={tarea?.estado} entregada={datos.entregada} />
      <PreparacionChecklist lineas={lineas} tipo={tipo} tarea={tarea} puedePreparar={puedePreparar} puedeRevisar={puedeRevisar} ocupado={ocupado || evidenciaPendiente} editor={editor} setEditor={setEditor} accion={accion} abrirScanner={abrirScanner} ubicaciones={ubicaciones} ubicacionesListas={ubicacionesClave === idsProductos} errorUbicaciones={errorUbicaciones} sucursalId={sucursalDocumento} esAlmacen={esAlmacen} dosActores={dosActores} abastecimiento={Boolean(datos.abastecimiento)} sucursales={sucursales} onComprobante={foto=>setFotos(prev=>[...prev,foto])} fotosCantidad={fotos.length} />
      {puedePreparar && <ConfirmarRestoPreparacion lineas={lineas} ocupado={ocupado || evidenciaPendiente || Boolean(editor)} onConfirmar={() => accion('confirmar_resto')} dosActores={dosActores} />}
      {dosActores && puedeRevisar && resumen.revisadas<resumen.revisar && <section className="om-preparacion-rapida"><button className="om-primary om-wide" disabled={ocupado||evidenciaPendiente||Boolean(editor)} onClick={()=>accion('confirmar_resto_revision')}>Todo lo demás coincide</button><p>Confirma las líneas pendientes con las cantidades alistadas. Se conservan los ajustes que ya registraste.</p></section>}
      {tarea && !cerrado && !pedidoCerrado && !cambios && <div className="om-finalizar" aria-label="Siguiente paso de la entrega">
        {puedePreparar && resumen.preparadas !== resumen.total && <p className="om-muted">Registra las {resumen.total - resumen.preparadas} líneas sin alistar para poder terminar. Si no se prepararon, indica el motivo.</p>}
        {puedePreparar && resumen.preparadas === resumen.total && !resumen.revisar && <p className="om-muted">No hay cantidades alistadas para entregar. Puedes corregir la preparación o gestionarla más abajo.</p>}
        {puedePreparar && !dosActores && <button className="om-primary om-wide" disabled={ocupado || Boolean(editor) || resumen.preparadas !== resumen.total || !resumen.revisar || (tipo === 'vtd' && resumen.parcial)} onClick={() => accion('preparado')}>Terminar preparación</button>}
        {tarea.estado === 'PREPARADO' && esAlmacen && <button className="om-primary om-wide" disabled={ocupado || soyPreparador} onClick={() => accion('tomar_revision')}>Tomar revisión</button>}
        {puedeRevisar && !dosActores && <button className="om-primary om-wide" disabled={ocupado || Boolean(editor) || resumen.revisadas !== resumen.revisar || !resumen.revisar} onClick={() => accion('verificado')}>Confirmar revisión de esta entrega</button>}
        {tarea.estado === 'VERIFICADO' && !dosActores && <p className="om-aviso om-exito"><CheckCircle2 size={20} /><span>Esta entrega está verificada{resumen.parcial ? '. Quedan cantidades pendientes en el pedido' : ''}.{datos.salida_qr_legada&&' Confirma su salida aquí y luego registra el retiro con las fotos del circuito anterior.'}</span></p>}
        {datos.salida_qr_legada&&soyRevisor&&<section className="om-preparacion-rapida"><h3>Salida de la preparación anterior</h3><ul>{datos.plan_salida?.map(p=><li key={p.linea_id}><strong>{lineas.find(l=>l.pedido_linea_id===p.linea_id)?.snapshot.nombre}</strong>{p.error?<span role="alert">{p.error}</span>:p.asignaciones.map(a=><span key={a.ubicacion_id}>{a.nombre} · {cantidadTexto(a.cantidad_base)} unidades base</span>)}</li>)}</ul><button className="om-primary om-wide" disabled={ocupado||Boolean(editor)||!datos.plan_salida?.length||datos.plan_salida.some(p=>p.error)} onClick={()=>accion('confirmar_salida_legada',{plan:datos.plan_salida})}><CheckCircle2 size={18}/> Confirmar salida por QR</button></section>}
        {tipo === 'pedido' && tarea.estado === 'VERIFICADO' && datos.entregada && !tareaSolicitada && <button className="om-secondary om-wide" disabled={ocupado} onClick={() => accion('crear')}>Preparar otra entrega pendiente</button>}
      </div>}
      {tipo === 'vtd' && resumen.parcial && !cerrado && <p className="om-aviso">La VTD debe coincidir con el ticket completo. Si falta material, Caja debe corregir el ticket; después actualiza la preparación.</p>}
      {tipo === 'pedido' && tarea?.estado === 'DESPACHADO' && (evidenciaInfo?.activo || retiro) && <>
        {retiro ? <section className="om-pedido"><h3>En transporte</h3><p>Transporta: <strong>{retiro.transportista_nombre}</strong></p><p>Destino: {retiro.destino}</p><small>Retirado: {fecha(retiro.retirado_en)}</small><p className="om-muted">El retiro conserva la salida de stock ya registrada. La recepción en destino queda por confirmar.</p></section>
          : !dosActores && <section className="om-pedido"><h3>Retiro para transporte</h3><p>Una tercera persona distinta de quien preparó y revisó confirma el retiro con su propia cuenta.</p>
            {evidenciaInfo?.activo && evidenciaInfo.contexto?.puede_capturar && <><p>Transporta: <strong>{usuario.nombre}</strong></p><label>Destino de la entrega<input maxLength={300} value={destinoRetiro} disabled={ocupado || evidenciaPendiente} onChange={e=>setDestinoRetiro(e.target.value)} placeholder="Lugar designado para este pedido" /></label></>}
          </section>}
      </>}
      {dosActores && soyRevisor && (['REVISANDO','VERIFICADO'].includes(tarea?.estado)||retiroPrevio) && <section className="om-pedido om-retiro-pedido"><h3>Revisar y retirar</h3><p>Revisa: <strong>{usuario.nombre}</strong> · esta misma persona retira el material.</p>
        <label>Destino de la entrega<input maxLength={300} value={destinoRetiro} disabled={ocupado||evidenciaPendiente} onChange={e=>setDestinoRetiro(e.target.value)} placeholder="Lugar designado para el pedido" /></label>
        <h4>{retiroPrevio?'Salida ya registrada':'Ubicaciones de salida'}</h4>{retiroPrevio?<p>Este material ya se despachó. Confirmar el retiro no volverá a descontar stock.</p>:datos.plan_salida?.length ? <ul>{datos.plan_salida.map(p=><li key={p.linea_id}><strong>{lineas.find(l=>l.pedido_linea_id===p.linea_id)?.snapshot.nombre}</strong>{p.origenes&&<OrigenesMaterial origenes={p.origenes} snapshot={lineas.find(l=>l.pedido_linea_id===p.linea_id)?.snapshot||{}}/>}{p.error?<p role="alert" className="om-error-text">{p.error}</p>:p.asignaciones.length?p.asignaciones.map(a=><span key={a.ubicacion_id}>{a.nombre} · {cantidadTexto(a.cantidad_base)} en unidades base</span>):<span>Material asignado al pedido · sin movimiento de stock de catálogo</span>}</li>)}</ul>:<p className="om-muted">Confirma las cantidades para ver de dónde saldrá el material.</p>}
      </section>}
      {((tipo === 'pedido' && (tarea?.estado === 'DESPACHADO' || dosActores && ['PREPARANDO','PREPARADO','REVISANDO','VERIFICADO'].includes(tarea?.estado))) || (tipo === 'traslado_virtual' && ['VERIFICADO','EN_TRANSITO','RECIBIDO'].includes(tarea?.estado))) && <EvidenciaOperacion
        key={`${tipo}:${tarea.id}:${dosActores?tarea.estado:''}`} tipo={tipo} documentoId={pedidoId} entregaId={tarea.id} version={tarea.version} revision={revisionEvidencia}
        fotos={fotos} onFotos={next=>{setFotos(next);loteEvidencia.current=null;setEvidenciaPendiente(false);}} onDatos={setEvidenciaInfo} busy={ocupado || evidenciaPendiente} />}
      {dosActores && puedePreparar && <button className="om-primary om-wide" disabled={ocupado||Boolean(editor)||resumen.preparadas!==resumen.total||!lineas.some(l=>Number(l.preparada_base)>0)||!fotos.length||!evidenciaInfo?.activo} onClick={()=>accion('preparado')}>{ocupado?'Enviando alistado…':'Enviar a verificación'}</button>}
      {dosActores && soyRevisor && (['REVISANDO','VERIFICADO'].includes(tarea?.estado)||retiroPrevio) && <button className="om-primary om-wide" disabled={ocupado||Boolean(editor)||resumen.revisadas!==resumen.revisar||!fotos.length||destinoRetiro.trim().length<3||!evidenciaInfo?.activo||!datos.plan_salida?.length||datos.plan_salida.some(p=>p.error)} onClick={()=>accion('confirmar_retiro',{destino:destinoRetiro.trim(),plan:datos.plan_salida})}>{ocupado?'Confirmando salida…':'Confirmar revisión y retirar'}</button>}
      {!dosActores && tipo === 'pedido' && tarea?.estado === 'DESPACHADO' && !retiro && evidenciaInfo?.activo && evidenciaInfo.contexto?.puede_capturar && <button className="om-primary om-wide"
        disabled={ocupado || !fotos.length || destinoRetiro.trim().length<3} onClick={retirarPedido}>{ocupado ? 'Registrando retiro…' : 'Confirmar retiro para transporte'}</button>}
      {tipo !== 'pedido' && tarea?.estado === 'VERIFICADO' && !datos.entregada && soyRevisor && !soyPreparador && esAlmacen && <button className="om-primary om-wide" disabled={ocupado || cambios || Boolean(editor) || (tipo === 'traslado_virtual' && (evidenciaInfo === null || (evidenciaInfo.activo && !fotos.length)))} onClick={() => accion('autorizar')}>{ocupado ? 'Registrando salida…' : tipo === 'vtd' ? 'Autorizar salida y entregar VTD' : 'Autorizar salida hacia Tienda'}</button>}
      {tipo === 'traslado_virtual' && datos.documento?.traslado_id && <p className="om-aviso om-exito">Traslado #{datos.documento.traslado_id} · {datos.documento.traslado_estado}</p>}
      {tipo === 'traslado_virtual' && tarea?.estado === 'EN_TRANSITO' && (usuario.sucursalId == null && encargado || String(usuario.sucursalId) === String(tarea.sucursal_destino_id)) && <RecepcionTrasladoVirtual lineas={datos.recepcion || []} ocupado={ocupado} onRecibir={payload => accion('recibir', payload)} />}
      <p className="om-stock-info">{dosActores?'El alistado no mueve stock. La salida se registra al confirmar revisión y retiro.':'Preparar y revisar guardan el checklist. El stock se actualiza al confirmar el despacho.'}</p>{tipo === 'pedido' && <Link className="om-secondary om-wide" to={`/pedidos/${pedidoId}${tarea ? `?preparacion=${tarea.id}&sucursal=${sucursalDocumento}` : ''}`}>{dosActores?'Ver pedido completo':'Abrir pedido y despacho'}</Link>}
      {tarea && !cerrado && (soyPreparador || encargado || (soyRevisor && ['REVISANDO','VERIFICADO'].includes(tarea.estado))) && <details className="om-gestion"><summary>Corregir o gestionar preparación</summary><div className="om-input-row"><select aria-label="Acción de gestión" value={gestion} onChange={e => setGestion(e.target.value)}><option value="">Elegir acción</option>{(soyPreparador || encargado) && !pedidoCerrado && <option value="reabrir">Reabrir y corregir</option>}{tipo === 'pedido' && encargado && !pedidoCerrado && <option value="reasignar">Tomar a mi cargo y reabrir</option>}{(soyPreparador || encargado) && <option value="anular">Anular esta preparación</option>}{soyRevisor && ['REVISANDO','VERIFICADO'].includes(tarea.estado) && <option value="devolver">Devolver para corregir</option>}</select></div><label>Motivo<textarea maxLength={1000} value={motivo} onChange={e => setMotivo(e.target.value)} /></label><button className="om-secondary" disabled={ocupado || Boolean(editor) || !gestion || !motivo.trim()} onClick={() => accion(gestion, { observacion: motivo.trim() })}>Guardar acción</button><p className="om-muted">Reabrir o reasignar elimina la revisión anterior. El motivo y el responsable quedan en el historial.</p></details>}
      {datos.eventos?.length > 0 && <details className="om-historial"><summary>Historial de esta preparación ({datos.eventos.length})</summary><ol>{datos.eventos.map(e => <li key={e.id}><strong>{eventos[e.accion] || e.accion}</strong><span>{e.actor_nombre} · {fecha(e.creado_en)}</span>{e.detalle?.linea_id && <small>Línea #{e.detalle.linea_id}{e.detalle.cantidad_base != null ? ` · ${cantidadTexto(e.detalle.cantidad_base)} en unidades base` : ''}{e.detalle.metodo ? ` · ${e.detalle.metodo}` : ''}</small>}{e.detalle?.observacion && <p>{e.detalle.observacion}</p>}</li>)}</ol></details>}
    </> : <button className="om-secondary" onClick={cargar}>Reintentar consulta</button>}
    {scanner && <EscanerCodigo onDetect={alDetectar} onClose={() => setScanner(null)} />}
  </>;
}
