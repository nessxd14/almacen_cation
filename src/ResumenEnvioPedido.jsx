import {CheckCircle2, Clock3, Package, Info, ChevronRight} from 'lucide-react';
import ImagenProducto from './ImagenProducto';
import {OrigenesMaterial} from './AbastecimientoLinea';
import {filasEnvio, textoCantidadEnvio} from './lib/envioPedido';

export default function ResumenEnvioPedido({lineas, revision = false, cerrado = false, numero = 1, onEditar, ocupado = false, sinCabecera = false, traslado = false}) {
  const filas = filasEnvio(lineas, revision || cerrado);
  const salen = filas.filter(f => f.cantidad > 0 && f.preparada);
  const pendientes = filas.filter(f => f.pendiente > 0);
  const comprobadas = salen.filter(f => f.revisada).length;
  return <section className="pt-envio" aria-label={cerrado ? 'Resumen del envío cerrado' : 'Resumen de este envío'}>
    {!sinCabecera&&<header className="pt-envio-cabecera"><small>ENVÍO {numero}</small><h2>{cerrado ? 'Salida verificada y registrada' : revision ? 'Verificar lo que sale' : 'Resumen del alistado'}</h2>
      <p>{cerrado ? 'Este envío conserva sus productos y cantidades.' : 'Comprueba los productos y las cantidades de este envío.'}</p></header>}
    <section className="pt-envio-grupo pt-envio-sale"><header><h3>{traslado&&revision?'Se recibe en este traslado':cerrado ? 'Salió en este envío' : 'Sale en este envío'}</h3><span>{cerrado ? <><CheckCircle2 size={15}/> Registrado</> : revision ? `${comprobadas}/${salen.length} verificados` : `${salen.length} ${salen.length===1?'producto':'productos'}`}</span></header>
      {salen.length ? salen.map(f => <Fila key={f.linea.pedido_linea_id} fila={f} traslado={traslado} cerrado={cerrado} revision={revision} onEditar={onEditar} ocupado={ocupado}/>) : <p className="pt-envio-vacio">Todavía no hay productos alistados para salir.</p>}
    </section>
    {pendientes.length > 0 && <section className="pt-envio-grupo pt-envio-pendiente"><header><h3>{cerrado ? 'Pendiente al cerrar este envío' : 'Queda pendiente de despacho'}</h3><span><Clock3 size={15}/> {pendientes.length} {pendientes.length===1?'producto':'productos'}</span></header>
      {pendientes.map(f => <Fila key={f.linea.pedido_linea_id} fila={f} traslado={traslado} pendiente onEditar={onEditar} ocupado={ocupado}/>)}
    </section>}
    <p className="pt-envio-aclaracion"><Info size={17}/>{traslado?'El material no entregado no se cuenta como recibido.':cerrado ? 'Verificación de salida; la recepción del cliente se registra por separado.' : 'Lo que no sale conserva su cantidad pendiente en el mismo pedido.'}</p>
  </section>;
}

function Fila({fila, pendiente = false, cerrado, revision, onEditar, ocupado, traslado}) {
  const {linea, cantidad, origenCompleto, revisada, preparada} = fila;
  const nombre = linea.reemplazo?.nombre || linea.snapshot.nombre;
  const compra=linea.compra_existente?.find(c=>['SOLICITADA','COMPRADA'].includes(c.estado));
  const contenido = <><div className="pt-envio-foto"><ImagenProducto url={linea.reemplazo?.imagen_url || linea.snapshot.imagen_url} nombre={nombre}/></div><div className="pt-envio-producto"><strong>{pendiente ? linea.snapshot.nombre : nombre}</strong>
    <span>{pendiente ? 'Pendiente: ' : cerrado ? 'Despachado: ' : traslado&&revision?'Recibido: ':'Alistado: '}{textoCantidadEnvio(pendiente ? fila.pendiente : cantidad, linea.snapshot)}</span>
    {pendiente ? <><small>{!preparada ? 'Falta resolver el alistado' : cantidad === 0 ? 'No sale en este envío' : 'La cantidad restante sigue pendiente'}</small>{compra&&<small>{compra.estado==='COMPRADA'?'Compra en gestión':'Compra solicitada'} · {textoCantidadEnvio(fila.pendiente,linea.snapshot)} pendientes</small>}</> : <>
      {linea.reemplazo && <small>Reemplaza a {linea.snapshot.nombre}</small>}
      {traslado?<small>Origen del traslado registrado</small>:origenCompleto ? <OrigenesMaterial origenes={linea.origenes_declarados} snapshot={{...linea.snapshot,...(linea.reemplazo ? {factor: 1, presentacion: linea.reemplazo.unidad_base, unidad_base: linea.reemplazo.unidad_base} : {})}}/> : <small>Origen pendiente de completar</small>}
      {!cerrado && revision && <small>{revisada ? 'Cantidad verificada' : 'Falta verificar físicamente'}</small>}
    </>}
  </div>{!pendiente && cerrado ? <CheckCircle2 className="pt-envio-estado" size={20}/> : pendiente ? <Clock3 className="pt-envio-estado" size={20}/> : <Package className="pt-envio-estado" size={20}/>}</>;
  return onEditar ? <button className="pt-envio-fila" type="button" disabled={ocupado} onClick={() => onEditar(linea.pedido_linea_id)} aria-label={`Revisar ${nombre}${pendiente ? ', cantidad pendiente' : ''}`}>{contenido}<ChevronRight size={16} className="pt-envio-editar" aria-hidden="true"/></button> : <article className="pt-envio-fila">{contenido}</article>;
}
