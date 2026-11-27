import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, MapPin, Package, Pause, Play, ScanLine,
} from 'lucide-react';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { cargarPendientesAuditoria } from './lib/auditoriaAlmacen';
import { cantidadTexto, rolesAlmacen } from './lib/operacionesMovil';
import './auditoria-spotlight.css';

const REFRESCO_MS = 30000;
const ROTACION_MS = 6000;
const FORMATO_TV = '(min-width: 900px) and (not (pointer: coarse))';
const MINIATURAS = 5;
const FORMATO_DIA = new Intl.DateTimeFormat('es-BO', {
  day: 'numeric', month: 'long', timeZone: 'America/La_Paz',
});
const FORMATO_HORA = new Intl.DateTimeFormat('es-BO', {
  hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz',
});
const ESTADOS = {
  RECONTEO: { etiqueta: 'Reconteo pendiente', tono: 'ambar', orden: 0, accion: 'Volver a contar en esta ubicación' },
  DIFERENCIA: { etiqueta: 'Con diferencia', tono: 'rojo', orden: 1, accion: 'Revisar el último conteo' },
  PENDIENTE: { etiqueta: 'Por contar', tono: 'azul', orden: 2, accion: 'Registrar el conteo físico' },
};
const MOVIMIENTOS = { ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste' };

function fechaJornada(fecha) {
  return fecha ? FORMATO_DIA.format(new Date(fecha + 'T12:00:00Z')) : '';
}

function enRevision(item) {
  return item.estado === 'RECONTEO' || item.estado === 'DIFERENCIA';
}

function usePendientesAuditoria(sucursalId) {
  const [datos, setDatos] = useState({ jornada: null, error: '', actualizado: null });
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    const controlador = new AbortController();
    const { signal } = controlador;
    let timer;
    let cargando = false;

    async function cargar() {
      if (signal.aborted || document.hidden || cargando) return;
      clearTimeout(timer);
      cargando = true;
      try {
        const jornada = await cargarPendientesAuditoria(sucursalId, signal);
        if (!signal.aborted) setDatos({ jornada, error: '', actualizado: new Date() });
      } catch (fallo) {
        if (!signal.aborted) setDatos(anterior => ({ ...anterior, error: fallo.message || 'No se pudo consultar la jornada.' }));
      } finally {
        cargando = false;
        if (!signal.aborted && !document.hidden) timer = setTimeout(cargar, REFRESCO_MS);
      }
    }

    function alCambiarVisibilidad() {
      clearTimeout(timer);
      if (!document.hidden) void cargar();
    }

    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    void cargar();
    return () => {
      controlador.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [sucursalId, reintento]);

  return { ...datos, reintentar: () => setReintento(n => n + 1) };
}

export default function AuditoriaSpotlight() {
  const { usuario } = useAuth();
  const { sucursalActiva, sucursales, puedeElegir, setSucursalActiva, cargando, error, reintentarSucursales } = useSucursal();

  if (!rolesAlmacen.has(usuario?.rol)) {
    return <main className="spotlight-root"><div className="spotlight-window">
      <CabeceraSpotlight />
      <p className="spotlight-empty" role="alert">Tu perfil no tiene acceso a Auditoría diaria.</p>
    </div></main>;
  }
  if (cargando || error || !sucursalActiva) {
    return <main className="spotlight-root"><div className="spotlight-window">
      <CabeceraSpotlight />
      {cargando ? <p className="spotlight-empty" role="status">Cargando almacén…</p> :
        <div className="spotlight-empty" role="alert"><p>No se pudo obtener una sucursal física.</p>
          <button type="button" className="spotlight-button" onClick={reintentarSucursales}>Reintentar</button>
        </div>}
    </div></main>;
  }
  return <Spotlight key={sucursalActiva.id} sucursal={sucursalActiva}
    sucursales={puedeElegir ? sucursales : []} cambiarSucursal={setSucursalActiva} />;
}

function CabeceraSpotlight({ sucursal, sucursales = [], cambiarSucursal }) {
  return <header className="spotlight-header">
    <div className="spotlight-marca">
      <Link to="/operaciones/auditoria" className="spotlight-button spotlight-icon" aria-label="Volver a Auditoría diaria"><ArrowLeft size={18} /></Link>
      <div><h1><strong>ROARI</strong><span aria-hidden="true">/</span> Spotlight</h1><p>Auditoría diaria</p></div>
    </div>
    {sucursal && (sucursales.length > 1 ? <label className="spotlight-sucursal">
      <MapPin size={15} aria-hidden="true" />
      <select aria-label="Sucursal de auditoría" value={sucursal.id} onChange={e => cambiarSucursal(Number(e.target.value))}>
        {sucursales.map(opcion => <option key={opcion.id} value={opcion.id}>{opcion.nombre}</option>)}
      </select>
    </label> : <p className="spotlight-sucursal"><MapPin size={15} aria-hidden="true" />{sucursal.nombre}</p>)}
  </header>;
}

function Spotlight({ sucursal, sucursales, cambiarSucursal }) {
  const { jornada, error, actualizado, reintentar } = usePendientesAuditoria(sucursal.id);
  const [filtro, setFiltro] = useState('todos');
  const [elegidoId, setElegidoId] = useState(null);
  const [detalleIdAbierto, setDetalleIdAbierto] = useState(null);
  const [rotacion, setRotacion] = useState(false);
  const pantalla = useRef(null);
  const gesto = useRef(null);
  const soloDeslizar = useRef(false);
  const detalleId = useId();

  const pendientes = useMemo(() => (jornada?.items || [])
    .filter(item => ESTADOS[item.estado])
    .sort((a, b) => ESTADOS[a.estado].orden - ESTADOS[b.estado].orden
      || String(a.pendiente_desde).localeCompare(String(b.pendiente_desde))), [jornada]);
  const porRevisar = useMemo(() => pendientes.filter(enRevision), [pendientes]);
  const visibles = filtro === 'revision' ? porRevisar : pendientes;
  const posicion = Math.max(0, visibles.findIndex(item => item.id === elegidoId));
  const actual = visibles[posicion];
  const ventana = Math.min(visibles.length, MINIATURAS);
  const centro = Math.floor(ventana / 2);
  const miniaturas = Array.from({ length: ventana }, (_, i) =>
    visibles[(posicion - centro + i + visibles.length) % visibles.length]);

  useEffect(() => { pantalla.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!rotacion) return;
    const formato = window.matchMedia(FORMATO_TV);
    function pausarSiSeOculta() {
      if (document.hidden || !formato.matches) setRotacion(false);
    }
    document.addEventListener('visibilitychange', pausarSiSeOculta);
    formato.addEventListener('change', pausarSiSeOculta);
    return () => {
      document.removeEventListener('visibilitychange', pausarSiSeOculta);
      formato.removeEventListener('change', pausarSiSeOculta);
    };
  }, [rotacion]);

  useEffect(() => {
    if (!rotacion || visibles.length < 2) return;
    const timer = setInterval(() => {
      setElegidoId(anterior => {
        const indice = Math.max(0, visibles.findIndex(item => item.id === anterior));
        return visibles[(indice + 1) % visibles.length].id;
      });
    }, ROTACION_MS);
    return () => clearInterval(timer);
  }, [rotacion, visibles]);

  function elegir(id) {
    setRotacion(false);
    setDetalleIdAbierto(null);
    setElegidoId(id);
  }

  function mover(paso) {
    if (visibles.length < 2) return;
    const siguiente = (posicion + paso + visibles.length) % visibles.length;
    elegir(visibles[siguiente].id);
  }

  function cambiarFiltro(valor) {
    elegir(actual?.id ?? null);
    setFiltro(valor);
  }

  function alternarDetalle() {
    setRotacion(false);
    setDetalleIdAbierto(abierto => abierto === actual.id ? null : actual.id);
  }

  function navegarConTeclado(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || event.target.closest('select,input,textarea,[contenteditable="true"]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      if (visibles.length < 2) return;
      event.preventDefault();
      mover(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Enter' && actual && !event.target.closest('button,a')) {
      event.preventDefault();
      alternarDetalle();
    }
  }

  function iniciarGesto(event) {
    const punto = event.touches[0];
    gesto.current = punto ? { x: punto.clientX, y: punto.clientY } : null;
    soloDeslizar.current = false;
  }

  function terminarGesto(event) {
    const punto = event.changedTouches[0];
    const inicio = gesto.current;
    gesto.current = null;
    if (!punto || !inicio) return;
    const dx = punto.clientX - inicio.x;
    const dy = punto.clientY - inicio.y;
    if (Math.abs(dx) < 44 || Math.abs(dx) <= Math.abs(dy)) return;
    soloDeslizar.current = true;
    mover(dx < 0 ? 1 : -1);
  }

  const halo = actual ? ['azul', 'verde', 'violeta'][Math.abs(Number(actual.producto_id) || 0) % 3] : 'azul';
  return <main className="spotlight-root" ref={pantalla} tabIndex={-1} onKeyDown={navegarConTeclado} aria-label="Spotlight de Auditoría diaria">
    <div className="spotlight-window" data-halo={halo}>
      <CabeceraSpotlight sucursal={sucursal} sucursales={sucursales} cambiarSucursal={cambiarSucursal} />
      {error && <div className="spotlight-aviso" role="alert">
        <span>{actualizado ? 'Datos de las ' + FORMATO_HORA.format(actualizado) + '. ' : ''}{error}</span>
        <button type="button" className="spotlight-button" onClick={reintentar}>Reintentar</button>
      </div>}
      {!jornada ? (!error && <p className="spotlight-empty" role="status">Consultando pendientes…</p>) : <>
        <div className="spotlight-toolbar">
          <div className="spotlight-filtros" role="group" aria-label="Filtrar pendientes">
            <button type="button" aria-pressed={filtro === 'todos'} onClick={() => cambiarFiltro('todos')}>Todos <span>{pendientes.length}</span></button>
            <button type="button" aria-pressed={filtro === 'revision'} onClick={() => cambiarFiltro('revision')}>En revisión <span>{porRevisar.length}</span></button>
          </div>
          <div className="spotlight-controles">
            <div className="spotlight-posicion" aria-label="Posición del producto">
              {String(actual ? posicion + 1 : 0).padStart(2, '0')} / {String(visibles.length).padStart(2, '0')}
            </div>
            <button type="button" className="spotlight-button spotlight-rotacion" disabled={!rotacion && visibles.length < 2}
              onClick={() => { setDetalleIdAbierto(null); setRotacion(activa => !activa); }}>
              {rotacion ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {rotacion ? 'Pausar rotación' : 'Iniciar rotación'}
            </button>
          </div>
        </div>
        {actual ? <>
          <article className="spotlight-hero" key={actual.id} aria-label={actual.nombre}>
            <div className="spotlight-stage" onTouchStart={iniciarGesto} onTouchEnd={terminarGesto}>
              <FotoProducto producto={actual} />
            </div>
            <div className="spotlight-info">
              <FichaProducto producto={actual} detalle={detalleIdAbierto === actual.id} detalleId={detalleId} alternarDetalle={alternarDetalle} />
            </div>
          </article>
          <section className="spotlight-explorador" aria-label="Explorador de pendientes">
            <div className="spotlight-explorador-cabecera">
              <h2>Pendientes de la jornada</h2>
              <div className="spotlight-flechas">
                <button type="button" aria-label="Producto anterior" className="spotlight-button spotlight-icon" disabled={visibles.length < 2} onClick={() => mover(-1)}><ChevronLeft size={19} /></button>
                <button type="button" aria-label="Producto siguiente" className="spotlight-button spotlight-icon" disabled={visibles.length < 2} onClick={() => mover(1)}><ChevronRight size={19} /></button>
              </div>
            </div>
            <div className="spotlight-carrusel" onTouchStart={iniciarGesto} onTouchEnd={terminarGesto}>
              {miniaturas.map((item, indice) => <button type="button" key={item.id}
                className="spotlight-miniatura" aria-pressed={item.id === actual.id}
                data-lateral={Math.abs(indice - centro) > 1 ? 'true' : undefined}
                aria-label={item.nombre + ' · ' + item.ubicacion + ' · ' + ESTADOS[item.estado].etiqueta}
                onClick={e => {
                  if (soloDeslizar.current && e.detail > 0) { soloDeslizar.current = false; return; }
                  elegir(item.id);
                }}>
                <span className="spotlight-punto" data-tono={ESTADOS[item.estado].tono} aria-hidden="true" />
                <FotoProducto producto={item} />
                <span className="spotlight-miniatura-nombre">{item.nombre}</span>
              </button>)}
            </div>
          </section>
        </> : <p className="spotlight-empty" role="status">{filtro === 'revision' ? 'No hay productos por revisar en esta jornada.' : 'No hay productos pendientes en esta jornada.'}</p>}
        <footer className="spotlight-footer">
          <span>{visibles.length} {visibles.length === 1 ? 'pendiente' : 'pendientes'} · {fechaJornada(jornada.fecha)}</span>
          {actual && <span className="spotlight-atajos"><kbd>←</kbd> <kbd>→</kbd> Navegar <kbd>Enter</kbd> Detalle</span>}
        </footer>
      </>}
    </div>
  </main>;
}

function FotoProducto({ producto }) {
  const [errorUrl, setErrorUrl] = useState(null);
  return producto.imagen_url && producto.imagen_url !== errorUrl
    ? <img className="spotlight-foto" src={producto.imagen_url} alt="" draggable={false}
      onError={() => setErrorUrl(producto.imagen_url)} />
    : <span className="spotlight-foto spotlight-foto-placeholder" aria-hidden="true"><Package strokeWidth={1.2} /></span>;
}

function FichaProducto({ producto, detalle, detalleId, alternarDetalle }) {
  const estado = ESTADOS[producto.estado];
  const tieneDiferencia = producto.estado === 'DIFERENCIA' && producto.esperado != null && producto.cantidad != null;
  const diferencia = tieneDiferencia ? Number(producto.cantidad) - Number(producto.esperado) : null;
  const magnitud = diferencia == null ? null : cantidadTexto(Math.abs(diferencia));
  const titulo = diferencia == null ? estado.accion : diferencia < 0 ? 'Faltan ' + magnitud : 'Sobran ' + magnitud;
  const conteo = producto.contado_en ? new Date(producto.contado_en) : null;
  const movimiento = producto.ultimo_movimiento;
  return <>
    <p className="spotlight-identidad">{producto.sku || 'Producto de almacén'}</p>
    <h2>{producto.nombre}</h2>
    <div className="spotlight-vidrio spotlight-estado" data-tono={estado.tono}>
      <div className="spotlight-estado-cabecera">
        <span>Estado de auditoría</span>
        <strong><i className="spotlight-punto" aria-hidden="true" />{estado.etiqueta}</strong>
      </div>
      <p className="spotlight-accion">{titulo}{magnitud != null && producto.unidad_base && <small>{' '}{producto.unidad_base}</small>}</p>
      {tieneDiferencia ? <dl className="spotlight-comparacion">
        <div><dt>Esperado</dt><dd>{cantidadTexto(producto.esperado)}</dd></div>
        <div><dt>Contado</dt><dd>{cantidadTexto(producto.cantidad)}</dd></div>
      </dl> : producto.estado === 'RECONTEO' && <p className="spotlight-secundario">
        {movimiento
          ? `${MOVIMIENTOS[movimiento.tipo] ?? 'Movimiento'} de ${cantidadTexto(Math.abs(movimiento.cantidad))} ${producto.unidad_base ?? ''} · ${FORMATO_HORA.format(new Date(movimiento.registrado_en))}`
          : 'Se registraron movimientos después del último conteo.'}
      </p>}
    </div>
    <div className="spotlight-vidrio spotlight-ubicacion">
      <MapPin size={18} aria-hidden="true" />
      <div><span>Ubicación</span><strong>{producto.ubicacion || 'Sin ubicación registrada'}</strong></div>
    </div>
    <div className="spotlight-ficha-acciones">
      <Link className="spotlight-button spotlight-principal" to={'/operaciones/auditoria?vista=lista&item=' + producto.id}>
        <ScanLine size={16} aria-hidden="true" /> Abrir en Auditoría <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
      <button type="button" className="spotlight-button" aria-expanded={detalle} aria-controls={detalleId} onClick={alternarDetalle}>
        {detalle ? 'Ocultar detalle' : 'Ver detalle'} <ChevronDown size={15} aria-hidden="true" />
      </button>
    </div>
    <div id={detalleId} className="spotlight-vidrio spotlight-detalle" hidden={!detalle}>
      <dl>
        <div><dt>Último conteo</dt><dd>{conteo ? FORMATO_DIA.format(conteo) + ' · ' + FORMATO_HORA.format(conteo) : 'Pendiente de captura'}</dd></div>
        {producto.cantidad != null && <div><dt>Cantidad registrada</dt><dd>{cantidadTexto(producto.cantidad)} {producto.unidad_base}</dd></div>}
        {producto.presentacion && Number(producto.factor) > 1 && <div><dt>Presentación</dt><dd>{producto.presentacion} · {cantidadTexto(producto.factor)} {producto.unidad_base}</dd></div>}
      </dl>
    </div>
  </>;
}
