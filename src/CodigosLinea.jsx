/**
 * CodigosLinea — línea secundaria en gris (11px) bajo el nombre de producto,
 * con "código de barras · código de fábrica · marca". Compartido entre
 * PedidosApp y TrasladosApp. Lo que no existe simplemente no ocupa lugar.
 */
export default function CodigosLinea({ codigos, marca, esPersonalizado }) {
  if (esPersonalizado) {
    return <p className="text-[11px] text-slate-400">Ítem a pedido · sin código</p>;
  }

  const items = [];
  if (codigos?.barra) items.push({ text: codigos.barra, mono: true });
  if (codigos?.fabrica) items.push({ text: codigos.fabrica, mono: true });
  if (marca) items.push({ text: marca, mono: false });
  if (items.length === 0) return null;

  return (
    <p className="text-[11px] text-slate-400">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && " · "}
          <span className={it.mono ? "font-mono" : ""}>{it.text}</span>
        </span>
      ))}
    </p>
  );
}
