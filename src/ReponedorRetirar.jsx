import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ScanLine } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useAuth } from './lib/useAuth';
import { useSucursal } from './lib/useSucursal';
import { interpretarCodigoOperacion, rutaDocumentoMovil } from './lib/operacionesMovil';
import { horaCorta, listarTrasladosPiso, MENSAJE_NO_TRASLADO, seccionesTrasladosPiso } from './lib/trasladosPiso';
import EscanerCodigo from './EscanerCodigo';
import './operaciones-tema.css';
import './operaciones-movil.css';

const REFRESCO_MS = 60000;

// Inicio del reponedor: escanea el QR del traslado o toca uno de la lista.
export default function ReponedorRetirar() {
  const { usuario, signOut } = useAuth();
  const { sucursales } = useSucursal();
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [actualizado, setActualizado] = useState('');
  const [escaner, setEscaner] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    try {
      const r = await listarTrasladosPiso(supabase);
      if (!vivo.current) return;
      setDatos(r); setError(''); setActualizado(horaCorta(new Date()));
    } catch (e) {
      if (vivo.current) setError(e.message);
    }
  }, []);

  // Una consulta por refresco: cada 60 s sólo con la pestaña visible y al
  // volver a enfocar la ventana.
  useEffect(() => {
    vivo.current = true;
    const visible = () => document.visibilityState === 'visible';
    let timer = null;
    const iniciar = () => { clearInterval(timer); timer = setInterval(() => { if (visible()) void cargar(); }, REFRESCO_MS); };
    const alVolver = () => { if (visible()) { void cargar(); iniciar(); } };
    // Consulta externa inicial, igual que el resto de pantallas móviles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    iniciar();
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo.current = false; clearInterval(timer);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  function alDetectar(valor) {
    setEscaner(false);
    let codigo = null;
    try { codigo = interpretarCodigoOperacion(valor); } catch { /* no es un código reconocido */ }
    if (codigo?.tipo === 'traslado') { setMensaje(''); navigate(rutaDocumentoMovil('traslado', codigo.id, true)); }
    else setMensaje(MENSAJE_NO_TRASLADO);
  }

  const sucursal = sucursales.find(s => String(s.id) === String(datos?.sucursalId ?? usuario.sucursalId));
  const { listo, todavia } = seccionesTrasladosPiso(datos?.traslados);
  const abrir = t => navigate(rutaDocumentoMovil('traslado', t.id, true));

  return <div className="om-app om-pedidos-ui">
    <header className="om-header"><div><small>CATION · ALMACÉN</small><h1>Retirar material</h1></div><button className="om-icon" onClick={signOut} aria-label="Cerrar sesión"><LogOut size={18} /></button></header>
    <div className="om-contexto"><span>{usuario.nombre} · reponedor{sucursal?.nombre ? ` · ${sucursal.nombre}` : ''}</span>{actualizado && <small>Actualizado {actualizado}</small>}</div>
    <main>
      <button className="om-primary om-wide" onClick={() => { setMensaje(''); setEscaner(true); }}><ScanLine size={20} /> Escanear QR del traslado</button>
      {mensaje && <p role="alert" className="om-aviso om-error">{mensaje}</p>}
      {error && <p role="alert" className="om-aviso om-error">{error}</p>}
      {!datos && !error && <p role="status">Cargando traslados…</p>}
      {datos && <>
        <section aria-label="Listo para retirar">
          <div className="om-section-title"><h2>Listo para retirar</h2></div>
          {listo.length === 0 && <p className="om-aviso">No tienes traslados listos para retirar.</p>}
          {listo.map(t => <article className="om-pedido" key={t.id}>
            <div className="om-section-title"><h3>Traslado {t.numero} · {t.lineas} productos</h3><span className="om-badge">TRASLADO</span></div>
            <p>Alistó {t.alista} {horaCorta(t.alistado_en)}{t.mio ? ' · lo pediste tú' : ''}</p>
            <button className="om-primary om-wide" onClick={() => abrir(t)}>{t.continuar ? 'Seguir comprobando' : 'Comprobar y retirar'}</button>
          </article>)}
        </section>
        {todavia.length > 0 && <section aria-label="Todavía en alistado">
          <div className="om-section-title"><h2>Todavía en alistado</h2></div>
          {todavia.map(t => <article className="om-pedido" key={t.id}>
            <div className="om-section-title"><h3>Traslado {t.numero} · {t.lineas} productos</h3><span className="om-badge">{t.etiqueta}</span></div>
            <p>{t.etiqueta === 'Pedido' ? 'Almacén aún no lo toma' : `${t.alista} lo está alistando`}</p>
          </article>)}
        </section>}
      </>}
      <p className="om-aviso">Solo ves los traslados que van a tu sucursal. No puedes alistar: eso lo hace el almacenero. Tú compruebas y retiras. Las ventas de almacén (VTD) siguen igual: el almacenero las alista y escanea su salida.</p>
    </main>
    {escaner && <EscanerCodigo onDetect={alDetectar} onClose={() => setEscaner(false)} />}
  </div>;
}
