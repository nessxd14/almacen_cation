/**
 * PedidoDetallePage.jsx — Brief S3 parte A: ruta propia /pedidos/:id para
 * el detalle de pedido, fuera del shell de pestañas de App.jsx (que no
 * tiene URL — ver App.jsx). Solo envuelve <DetallePedido/> con el id de la
 * URL y un "volver" que respeta el historial.
 */
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DetallePedido } from "./PedidosApp";
import ResumenPreparacionDespacho from "./ResumenPreparacionDespacho";
import { idOperacion } from "./lib/operacionesMovil";
import { useSucursal } from "./lib/useSucursal";

export default function PedidoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  const preparacionId = idOperacion(params.get('preparacion'));
  const sucursalId = idOperacion(params.get('sucursal')) || sucursalActivaId;

  // Si se llegó navegando desde la lista (historial con entrada previa en
  // esta sesión), "volver" hace history back — así la lista recupera su
  // filtro y scroll tal cual estaban (brief: "respete el filtro y la
  // página desde donde se entró"). Si se entró por URL directa (sin
  // historial propio, ej. un link compartido), no hay a dónde volver:
  // manda a la bandeja de pedidos.
  const handleBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/");
  };

  return <div className="glass-app"><main className="glass-content">{preparacionId && sucursalId && <ResumenPreparacionDespacho pedidoId={id} preparacionId={preparacionId} sucursalId={sucursalId} nombreSucursal={nombreSucursal(Number(sucursalId))} />}<DetallePedido pedidoId={Number(id)} onBack={handleBack} /></main></div>;
}
