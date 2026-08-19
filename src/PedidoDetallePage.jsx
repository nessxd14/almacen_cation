/**
 * PedidoDetallePage.jsx — Brief S3 parte A: ruta propia /pedidos/:id para
 * el detalle de pedido, fuera del shell de pestañas de App.jsx (que no
 * tiene URL — ver App.jsx). Solo envuelve <DetallePedido/> con el id de la
 * URL y un "volver" que respeta el historial.
 */
import { useNavigate, useParams } from "react-router-dom";
import { DetallePedido } from "./PedidosApp";

export default function PedidoDetallePage() {
  const { id } = useParams();
  const navigate = useNavigate();

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

  return <DetallePedido pedidoId={Number(id)} onBack={handleBack} />;
}
