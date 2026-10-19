import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { cantidadTexto, nombresEstadoOperacion, operarPedidoMovil, resumenOperacion } from './lib/operacionesMovil';
import './despacho-ui.css';

// Informe de la entrega al entrar al despacho existente. No crea picks,
// selecciona líneas ni registra movimientos de stock.
export default function ResumenPreparacionDespacho({ pedidoId, preparacionId, sucursalId, nombreSucursal }) {
  const [consulta, setConsulta] = useState(null);
  const [intento, setIntento] = useState(0);
  const clave = `${pedidoId}:${preparacionId}:${sucursalId}:${intento}`;
  useEffect(() => {
    let vigente = true;
    operarPedidoMovil(supabase, { pedidoId, tareaId: preparacionId, sucursalId }).then(data => {
      if (vigente) setConsulta({ clave, data });
    }, error => { if (vigente) setConsulta({ clave, error: error.message }); });
    return () => { vigente = false; };
  }, [clave, pedidoId, preparacionId, sucursalId]);
  const resultado = consulta?.clave === clave ? consulta : null;
  const d = resultado?.data;
  const t = d?.tarea;
  const lineas = d?.lineas.filter(l => l.vigente) || [];
  const verificada = t?.estado === 'VERIFICADO' && d?.pedido.estado === 'ABIERTO' && !d?.cambios.length && !d?.entregada;
  return <section className="dispatch-preparation print:hidden" aria-label="Preparación para este despacho">
    <div className="dispatch-preparation-heading"><div><small>CHECKLIST DE ESTA ENTREGA</small><strong>Preparación #{preparacionId} · {nombreSucursal || `Sucursal ${sucursalId}`}</strong></div><button onClick={() => setIntento(i => i + 1)}>Actualizar verificación</button></div>
    {!resultado ? <p role="status" className="mt-3">Consultando la preparación…</p> : resultado.error ? <p role="alert" className="mt-3 text-red-700">No se pudo consultar la preparación: {resultado.error}</p> : <>
      <p className="mt-2">{nombresEstadoOperacion[t?.estado] || 'Sin preparación'} · Preparó {t?.preparador_nombre || 'sin asignar'} · Revisó {t?.revisor_nombre || 'sin asignar'}</p>
      {d.entregada ? <p className="mt-2">Las cantidades de esta preparación ya figuran despachadas.</p> : verificada ? <p className="mt-2 font-medium">{resumenOperacion(d.lineas).parcial || Number(d.otras_sucursales) > 0 ? 'Esta revisión cubre una entrega parcial.' : 'La preparación está verificada.'} Usa las cantidades de abajo al completar el despacho.</p> : <p role="alert" className="mt-2 font-medium text-amber-800">{d.cambios.length ? 'El pedido cambió. Esta preparación necesita comprobarse nuevamente.' : 'Esta preparación no tiene una revisión vigente para el despacho.'}</p>}
      {lineas.length > 0 && <details className="dispatch-preparation-details"><summary>Ver alistado, faltantes y motivos · {lineas.length} productos</summary><table className="dispatch-preparation-table"><thead><tr><th>Producto</th><th>Alistado en esta entrega</th><th>Queda pendiente</th></tr></thead><tbody>{lineas.map(l => <tr key={l.pedido_linea_id}><td>{l.snapshot.nombre}{l.observacion && <small>{l.observacion}</small>}</td><td>{l.confirmada ? <>{cantidadTexto(l.preparada_base)} {l.snapshot.unidad_base}{Number(l.snapshot.factor) > 1 ? ` · ${cantidadTexto(Number(l.preparada_base) / Number(l.snapshot.factor))} ${l.snapshot.presentacion}` : ''}{Number(l.preparada_base) === 0 && <small>No alistado</small>}</> : 'Sin confirmar'}</td><td>{l.confirmada ? `${cantidadTexto(Math.max(0, Number(l.snapshot.pendiente_base) - Number(l.preparada_base)))} ${l.snapshot.unidad_base}` : 'Sin determinar'}</td></tr>)}</tbody></table></details>}
    </>}
    <Link className="mt-3 inline-block font-medium text-sky-800 underline" to={`/operaciones/pedidos/${pedidoId}?preparacion=${preparacionId}&sucursal=${sucursalId}`}>Abrir checklist y responsables</Link>
  </section>;
}
