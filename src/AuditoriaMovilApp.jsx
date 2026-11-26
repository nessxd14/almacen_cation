import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, House, ScanLine, RefreshCw } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { cantidadTexto, idOperacion, interpretarCodigoOperacion, rolesAlmacen } from './lib/operacionesMovil';
import { peticionAcotada } from './lib/peticionAcotada';
import CantidadEmpaque from './CantidadEmpaque';
import ImagenProducto from './ImagenProducto';
import EscanerCodigo from './EscanerCodigo';
import './operaciones-tema.css';
import './operaciones-movil.css';
import './preparacion-checklist.css';
import './auditoria-movil.css';

const estados = {
  PENDIENTE: ['Pendiente', ''],
  RECONTEO: ['Reconteo pendiente', 'om-revisando'],
  DIFERENCIA: ['Diferencia', 'om-anulado'],
  VERIFICADO: ['Verificado', 'om-verificado'],
};
const formatoFecha = new Intl.DateTimeFormat('es-BO', {
  day: 'numeric', month: 'long', timeZone: 'America/La_Paz',
});
const formatoHora = new Intl.DateTimeFormat('es-BO', {
  hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz',
});

async function operar(accion, sucursal, datos) {
  const { data, error } = await peticionAcotada(supabase.rpc('operar_auditoria_almacen', {
    p_accion: accion, p_sucursal_id: sucursal, p_datos: datos,
  }), { incierta: accion === 'contar' });
  if (error) {
    const fallo = new Error(error.message || 'No se pudo consultar Auditoría diaria.');
    fallo.code = error.code;
    throw fallo;
  }
  if (!data) throw new Error('No se recibió la jornada de auditoría.');
  return data;
}

export default function AuditoriaMovilApp() {
  const { usuario } = useAuth();
  const { sucursalActiva, sucursales, cargando, error, reintentarSucursales, puedeElegir, setSucursalActiva } = useSucursal();
  if (!rolesAlmacen.has(usuario?.rol)) {
    return <main className="om-app om-pedidos-ui"><Cabecera />
      <p role="alert" className="om-aviso">Tu perfil no tiene acceso a Auditoría diaria.</p>
    </main>;
  }
  return <main className="om-app om-pedidos-ui auditoria-movil">
    {sucursalActiva && !cargando && !error ? <Auditoria key={sucursalActiva.id} sucursal={sucursalActiva} usuario={usuario}
      opciones={puedeElegir ? sucursales : []} cambiarSucursal={setSucursalActiva} /> : <>
      <Cabecera />
      {cargando ? <p role="status">Cargando sucursales…</p> : <div className="om-aviso" role="alert">
        <span>No se pudo obtener una sucursal física.</span>
        <button type="button" className="om-secondary" onClick={reintentarSucursales}>Reintentar</button>
      </div>}
    </>}
  </main>;
}

function Cabecera({ detalle = false, volver }) {
  return <header className="om-header">
    {detalle ? <button type="button" className="om-back auditoria-volver" onClick={volver} aria-label="Volver a la lista"><ArrowLeft size={21} /></button>
      : <Link to="/operaciones" className="om-back auditoria-volver" aria-label="Volver a Operaciones"><ArrowLeft size={21} /></Link>}
    <div><small>CATION · ALMACÉN</small><h1>{detalle ? 'Conteo diario' : 'Auditoría diaria'}</h1></div>
  </header>;
}

function Auditoria({ sucursal, usuario, opciones, cambiarSucursal }) {
  const [params, setParams] = useSearchParams();
  const itemId = idOperacion(params.get('item'));
  const lista = params.get('vista') === 'lista';
  const [criterios, setCriterios] = useState({ filtro: 'abiertos' });
  const [busqueda, setBusqueda] = useState('');
  const [consulta, setConsulta] = useState(null);
  const [revision, setRevision] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState('');
  const clave = JSON.stringify([itemId, criterios, revision]);
  const data = consulta?.clave === clave ? consulta.data : null;
  const error = consulta?.clave === clave ? consulta.error : '';

  useEffect(() => {
    let vigente = true;
    const accion = itemId ? 'detalle' : 'listar';
    operar(accion, sucursal.id, itemId ? { item_id: itemId } : criterios).then(
      datos => { if (vigente) setConsulta({ clave, data: datos }); },
      fallo => { if (vigente) setConsulta({ clave, error: fallo.message }); },
    );
    return () => { vigente = false; };
  }, [clave, criterios, itemId, sucursal.id]);

  function recargar() {
    setAviso('');
    setRevision(valor => valor + 1);
  }

  function navegar(vista, id) {
    setAviso('');
    const destino = new URLSearchParams();
    if (vista === 'lista' || id) destino.set('vista', 'lista');
    if (id) destino.set('item', id);
    setParams(destino);
  }

  async function mas() {
    setAviso('');
    setOcupado(true);
    try {
      const pagina = await operar('listar', sucursal.id, { ...criterios, cursor: data.siguiente });
      setConsulta(anterior => anterior?.clave === clave ? { clave, data: { ...pagina, items: [...anterior.data.items, ...pagina.items] } } : anterior);
    } catch (fallo) {
      setAviso(fallo.message);
    } finally {
      setOcupado(false);
    }
  }

  function buscar(event) {
    event.preventDefault();
    setCriterios({ filtro: criterios.filtro, busqueda: busqueda.trim() });
  }

  function escanear(codigo) {
    setEscaneando(false);
    try {
      const etiqueta = interpretarCodigoOperacion(codigo);
      if (etiqueta.sucursalId && String(sucursal.id) !== etiqueta.sucursalId) {
        throw new Error('La etiqueta corresponde a otra sucursal.');
      }
      const coincidencia = { filtro: 'todos' };
      if (etiqueta.tipo === 'producto') coincidencia.producto_id = etiqueta.id;
      else if (etiqueta.tipo === 'ubicacion') coincidencia.ubicacion_id = etiqueta.id;
      else if (etiqueta.tipo === 'barras' || /^\d+$/.test(codigo)) coincidencia.busqueda = codigo.trim();
      else throw new Error('Escanea una etiqueta de producto o ubicación.');
      setAviso('');
      setBusqueda(coincidencia.busqueda || '');
      setCriterios(coincidencia);
    } catch (fallo) {
      setAviso(fallo.message);
    }
  }

  async function guardar(cantidad, solicitud) {
    const item = data.items[0];
    const siguiente = await operar('contar', sucursal.id, {
      item_id: item.id, cantidad, solicitud, captura_id: item.captura_id,
      version_movimiento: item.version_movimiento,
    });
    setConsulta({ clave, data: siguiente });
  }

  const item = itemId ? data?.items[0] : null;
  return <>
    <Cabecera detalle={Boolean(itemId)} volver={() => navegar('lista')} />
    <div className="om-contexto">
      <span>{usuario.nombre}</span>
      {opciones.length > 0 && !itemId ? <label>
        <span className="sr-only">Sucursal de auditoría</span>
        <select value={sucursal.id} onChange={e => cambiarSucursal(Number(e.target.value))}>
          {opciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label> : <strong>{sucursal.nombre}</strong>}
    </div>
    {!itemId && <nav className="om-tabs auditoria-tabs" aria-label="Auditoría diaria">
      <button type="button" onClick={() => navegar('inicio')} aria-current={!lista ? 'page' : undefined}><House size={18} /> Inicio</button>
      <button type="button" onClick={() => navegar('lista')} aria-current={lista ? 'page' : undefined}><ClipboardCheck size={18} /> Conteo</button>
    </nav>}
    {aviso && <p role="alert" className="om-aviso om-error">{aviso}</p>}
    {error ? <div role="alert" className="om-aviso om-error auditoria-error">
      <p>{error}</p><button type="button" className="om-secondary" onClick={itemId ? () => navegar('lista') : recargar}>{itemId ? 'Volver a la lista' : 'Reintentar'}</button>
    </div> : !data ? <p className="om-loading" role="status">Consultando la jornada…</p> : item ? <>
      <Avance resumen={data.resumen} />
      <Ficha key={JSON.stringify([item.id, item.captura_id, item.version_movimiento])} item={item} guardar={guardar} recargar={recargar} continuar={() => navegar('lista')} />
    </> : lista ? <>
      <div className="om-section-title"><h2>Lista del día</h2>
        <button type="button" className="om-icon" onClick={recargar} disabled={ocupado} aria-label="Actualizar lista"><RefreshCw size={18} /></button>
      </div>
      <form className="om-pedido auditoria-busqueda" onSubmit={buscar}>
        <label>Nombre, SKU o ubicación<input type="search" value={busqueda} maxLength={120} onChange={e => setBusqueda(e.target.value)} /></label>
        <div className="auditoria-par">
          <button type="submit" className="om-secondary">Buscar</button>
          <button type="button" className="om-secondary" onClick={() => setEscaneando(true)}><ScanLine size={19} /> Escanear etiqueta</button>
        </div>
        <label>Estado<select value={criterios.filtro} onChange={e => setCriterios({ ...criterios, filtro: e.target.value })}>
          <option value="abiertos">Por resolver</option><option value="todos">Todos</option>
          <option value="verificados">Verificados</option><option value="diferencias">Con diferencia</option>
        </select></label>
        {(criterios.producto_id || criterios.ubicacion_id || criterios.busqueda) && <button type="button" className="om-secondary" onClick={() => {
          setBusqueda(''); setCriterios({ filtro: criterios.filtro });
        }}>Limpiar búsqueda</button>}
      </form>
      <Lista items={data.items} abrir={id => navegar('lista', id)} />
      {data.siguiente && <button type="button" className="om-secondary om-wide" disabled={ocupado} onClick={mas}>{ocupado ? 'Cargando…' : 'Cargar más productos'}</button>}
    </> : <>
      <section className="om-pedido auditoria-resumen">
        <div className="om-section-title"><h2>Resumen de la jornada</h2><time dateTime={data.fecha}>{formatoFecha.format(new Date(data.fecha + 'T12:00:00Z'))}</time></div>
        <dl className="auditoria-par">
          {[
            ['Arrastrados al día', data.resumen.arrastrados],
            ['Con movimientos', data.resumen.movimientos],
            ['Conteos periódicos', data.resumen.ciclicos],
            ['Total programado', data.resumen.total],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <Avance resumen={data.resumen} />
        <button type="button" className="om-primary om-wide" onClick={() => navegar('lista')}><ClipboardCheck size={19} /> Ir al conteo</button>
      </section>
      <div className="om-section-title"><h2>Pendientes atrasados</h2>
        <button type="button" className="om-icon" onClick={recargar} aria-label="Actualizar auditoría"><RefreshCw size={18} /></button>
      </div>
      <Lista items={data.items.filter(i => i.origen === 1 && i.estado !== 'VERIFICADO').slice(0, 3)} abrir={id => navegar('lista', id)} vacio="No hay pendientes atrasados en este recorrido." />
      <p className="om-muted">La lista incluye los movimientos desde las 00:00, hora de Bolivia.</p>
    </>}
    {escaneando && <EscanerCodigo onDetect={escanear} onClose={() => setEscaneando(false)} />}
  </>;
}

function Avance({ resumen }) {
  return <div className="auditoria-avance">
    <div><span>Avance de resolución</span><strong>{resumen.verificados} de {resumen.total}</strong></div>
    <progress aria-label="Avance de resolución" max={resumen.total || 1} value={resumen.verificados} />
  </div>;
}

function Lista({ items, abrir, vacio = 'No hay productos con estos filtros.' }) {
  if (!items.length) return <p className="om-vacio">{vacio}</p>;
  return <ul className="auditoria-lista">
    {items.map(item => <li key={item.id}><button type="button" className="om-task auditoria-tarea" onClick={() => abrir(item.id)}>
      <ImagenProducto url={item.imagen_url} nombre={item.nombre} className="auditoria-foto" />
      <span className="auditoria-identidad"><strong>{item.nombre}</strong><small>{item.ubicacion}{item.sku && ' · ' + item.sku}</small></span>
      <span className={'om-badge ' + estados[item.estado][1]}>{estados[item.estado][0]}</span>
    </button></li>)}
  </ul>;
}

function Ficha({ item, guardar, recargar, continuar }) {
  const [cantidad, setCantidad] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const intento = useRef(null);
  const bloqueado = useRef(false);
  const pendiente = item.estado === 'PENDIENTE' || item.estado === 'RECONTEO';
  const hora = item.contado_en && formatoHora.format(new Date(item.contado_en));

  async function enviar(event) {
    event.preventDefault();
    if (bloqueado.current) return;
    if (!/^\d+(\.\d{1,4})?$/.test(cantidad) || Number(cantidad) >= 1e12) {
      setError({ message: 'Ingresa una cantidad válida, con hasta cuatro decimales. Escribe 0 si confirmaste que no hay existencias.' });
      return;
    }
    if (intento.current?.cantidad !== cantidad) intento.current = { cantidad, id: crypto.randomUUID() };
    bloqueado.current = true;
    setOcupado(true);
    setError(null);
    try { await guardar(cantidad, intento.current.id); }
    catch (fallo) { setError(fallo); }
    finally { bloqueado.current = false; setOcupado(false); }
  }

  return <section className="om-linea auditoria-ficha">
    <div className="auditoria-cabecera-producto">
      <ImagenProducto url={item.imagen_url} nombre={item.nombre} className="auditoria-foto" />
      <div><h2>{item.nombre}</h2><p className="om-muted">{item.sku && item.sku + ' · '}{item.ubicacion}</p></div>
    </div>
    {item.estado === 'RECONTEO' && <div className="om-aviso">
      <div><strong>Reconteo pendiente</strong><p>Hubo movimientos después del conteo de {cantidadTexto(item.cantidad)} {item.unidad_base} a las {hora}.</p></div>
    </div>}
    {pendiente ? <form className="auditoria-captura" onSubmit={enviar}>
      <CantidadEmpaque valor={cantidad} onValor={setCantidad} factor={item.factor} presentacion={item.presentacion}
        unidadBase={item.unidad_base} etiqueta="Contado ·" ariaLabel="Cantidad contada" disabled={ocupado} />
      <p className="om-muted">Ingresa 0 si verificaste que no hay unidades. El saldo esperado aparece al guardar.</p>
      {error && <div className="om-aviso om-error auditoria-error" role="alert">
        <span>{error.message}</span>
        {error.code === '40001' && <button type="button" className="om-secondary" onClick={recargar}>Actualizar conteo</button>}
      </div>}
      <button type="submit" className="om-primary om-wide" disabled={ocupado || error?.code === '40001'}>{ocupado ? 'Guardando…' : 'Guardar y comparar'}</button>
    </form> : <>
      <div className="om-cantidades auditoria-comparacion">
        {[
          ['Esperado', item.esperado],
          ['Contado', item.cantidad],
          ['Diferencia', Number(item.cantidad) - Number(item.esperado)],
        ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{cantidadTexto(value)}</strong></div>)}
      </div>
      <div role="status" className={'om-aviso ' + (item.estado === 'VERIFICADO' ? 'om-exito' : 'om-error')}>
        <div><strong>{item.estado === 'VERIFICADO' ? 'Verificado correctamente' : 'Diferencia registrada'}</strong><p>Conteo guardado a las {hora}.</p></div>
      </div>
      <button type="button" className="om-primary om-wide" onClick={continuar}>Volver a la lista</button>
    </>}
  </section>;
}
