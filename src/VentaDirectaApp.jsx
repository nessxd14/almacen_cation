import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScanLine, RefreshCw, PackageCheck } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useSucursal } from './lib/useSucursal';
import EscanerCodigo from './EscanerCodigo';
import { interpretarCodigoOperacion, rutaDocumentoMovil, solicitarDocumentoMovil } from './lib/operacionesMovil';

const SELECT_VENTA = `
  id, numero, estado, total, creado_en, ubicacion_id, cobro_exigible, pago_posterior,
  ubicacion:ubicacion_id!inner ( id, codigo_zona, estante, nivel, compartimiento, sucursal_id ),
  cliente:cliente_id ( nombre ),
  venta_pago ( id ),
  venta_linea (
    id, producto_id, presentacion_id, cantidad, cantidad_presentacion,
    producto:producto_id ( nombre, unidad_base ),
    presentacion:presentacion_id ( nombre )
  )
`;


export default function VentaDirectaApp() {
  const { sucursalActivaId } = useSucursal();
  const navigate = useNavigate();
  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [codigo, setCodigo] = useState('');
  const [scanner, setScanner] = useState(false);
  const lectura = useRef(false);
  const cargar = useCallback(async () => {
    if (!sucursalActivaId) return;
    setCargando(true); setError('');
    try {
      const { data, error: fallo } = await supabase.from('venta').select(SELECT_VENTA).eq('estado','ABIERTA').eq('ubicacion.sucursal_id',sucursalActivaId).order('creado_en',{ ascending:true });
      if (fallo) throw fallo;
      setVentas((data || []).filter(v => v.numero?.startsWith('VTD-') || v.ubicacion?.codigo_zona?.toUpperCase() === 'VENTAS DIRECTAS'));
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [sucursalActivaId]);
  // Inicia la consulta de la bandeja y su indicador de carga.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void cargar(); }, [cargar]);
  const abrir = useCallback(async texto => {
    setError('');
    try {
      const c = interpretarCodigoOperacion(texto);
      let id;
      if (c.tipo === 'vtd' && c.id) id = c.id;
      else if (c.tipo === 'vtd' && c.numero) {
        const res = await solicitarDocumentoMovil(supabase, { tipo:'vtd', accion:'resolver_vtd', datos:{ numero:c.numero } }); id=res.venta_id;
      } else if (/^#?[1-9]\d*$/.test(texto.trim())) id=texto.trim().replace(/^#/,'');
      else throw new Error('Escanea el QR del ticket VTD o sus barras antiguas.');
      navigate(rutaDocumentoMovil('vtd',id,true));
    } catch (e) { setError(e.message); }
  }, [navigate]);
  const detectar = useCallback(texto => {
    if (lectura.current) return;
    lectura.current=true; setScanner(false); void abrir(texto);
  }, [abrir]);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-lg font-semibold"><PackageCheck size={20} /> Venta directa de almacén</h1><button className="om-secondary" onClick={cargar} disabled={cargando}><RefreshCw size={18} /> Actualizar</button></div>
    <p className="text-sm text-slate-600">El ticket lo genera Caja. La primera persona prepara y la siguiente verifica. El verificador autoriza la entrega con el checklist guardado.</p>
    <div className="flex flex-wrap gap-3"><button className="om-primary" onClick={() => { lectura.current=false;setScanner(true); }}><ScanLine size={18} /> Escanear ticket</button><Link className="om-secondary" to="/operaciones">Operaciones móvil</Link></div>
    <form className="om-input-row" onSubmit={e => { e.preventDefault();void abrir(codigo); }}><label>QR, número VTD o ID<input aria-label="QR, número VTD o ID" className="rounded-md border p-2" value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="off" /></label><button className="om-secondary" disabled={!codigo.trim()}>Abrir ticket</button></form>
    {error && <p className="om-aviso om-error" role="alert">{error}</p>}
    {cargando ? <p role="status">Cargando tickets…</p> : !ventas.length ? <p>No hay ventas directas abiertas en esta sucursal.</p> : <div className="space-y-2">{ventas.map(v => <Link className="om-task" key={v.id} to={rutaDocumentoMovil('vtd',v.id)}><div><strong>{v.numero || `#${v.id}`}</strong><span>{v.cliente?.nombre || 'Sin cliente registrado'} · {v.venta_linea?.length || 0} líneas</span><small>{new Date(v.creado_en).toLocaleString('es-BO')}</small></div><span className="om-badge">{v.venta_pago?.length ? 'PAGADO' : v.pago_posterior ? 'PAGO POSTERIOR' : v.cobro_exigible === false ? 'HISTÓRICO' : 'POR COBRAR'}</span></Link>)}</div>}
    {scanner && <EscanerCodigo onDetect={detectar} onClose={() => setScanner(false)} />}
  </section>;
}
