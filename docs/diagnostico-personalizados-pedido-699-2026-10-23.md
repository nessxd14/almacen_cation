# Personalizados y miniapp QR: pedido PED-2026-00699

Revisión de solo lectura de producción realizada el 23/10/2026. No se modificaron pedidos, compras, stock, configuración ni funciones.

**Aclaración posterior del usuario:** el 699 sí fue entregado físicamente. La solicitud es exigir el circuito regular para los personalizados futuros. No se debe reabrir el 699. La corrección y sus pruebas se describen en `pedidos-dos-responsables.md`.

## Identificación y hallazgo

El número comercial **PED-2026-00699** corresponde al `pedido.id=790`. El ID 699 corresponde a otro documento, PED-2026-00614, de catálogo; no confundir ambos al abrir una ruta de QR.

El pedido 790 contiene 20 líneas, IDs 4689–4708, todas personalizadas. Todas están en `COMPRADO_DIRECTO`, con `cantidad_despachada=0`, sin nota de compra directa y sin modificación de usuario/fecha registrada. El pedido está `COMPLETADO`.

No tiene preparación, eventos de preparación, eventos de pedido, eventos de despacho, lotes de evidencia ni retiro de la miniapp. Esto confirma ausencia de trazabilidad en esos registros; no permite determinar si hubo entrega física fuera del sistema.

Sus 20 solicitudes de compra están `RECIBIDA`, con `cantidad_recibida=0` y sin responsable de recepción. Todas tienen `recibido_en=2026-10-22T13:46:39.3429Z`, equivalente al **22/10/2026 a las 09:46:39 de Bolivia**. La sincronización de despacho hacia Hermes también figura creada y sincronizada en ese mismo instante.

## Por qué se ve cerrado y no permite marcar

1. `public.recalcular_estado_pedido` considera terminal el estado `COMPRADO_DIRECTO`. Cuando todas las líneas quedan cerradas, el pedido pasa a `COMPLETADO`.
2. `almacen_operaciones.lineas_actuales` excluye `COMPRADO_DIRECTO`. La consulta real `lineas_actuales(790,1)` devuelve cero filas.
3. La miniapp bloquea la preparación cuando el pedido no está `ABIERTO`; el motor también impide crearla en un pedido completado.
4. El trigger `public._compra_solicitud_sync` cierra solicitudes como `RECIBIDA` cuando una línea pasa a `COMPRADO_DIRECTO`. Esa rama no incrementa `cantidad_recibida` y solo toma el responsable de `NEW.modificado_por`, que aquí es nulo. Por eso una solicitud puede figurar recibida en cero sin demostrar recepción física.

El escaneo refleja un cierre ya persistido. Los datos no sustentan atribuir el cierre al acto de escanear.

## Alcance comprobado

Con el mismo instante exacto de recepción se encontraron **246 líneas personalizadas de 22 pedidos**. Los 22 están completados y ninguno tiene preparación registrada:

382, 606, 617, 672, 684, 685, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 715 y 716 (todos con prefijo PED-2026- y cinco dígitos).

La coincidencia temporal es indicio de una operación conjunta. No se identificó su autor ni instrucción de origen. Las consultas de logs de Postgres alrededor de ese momento no devolvieron registros que permitan atribuirla.

## Casos relacionados y criterio de corrección

- **Personalizado comprado/recibido, aún no retirado:** debe seguir disponible para alistar y verificar. Recibir una compra no debe confirmar por sí solo la salida al cliente.
- **Personalizado entregado directamente:** necesita una confirmación explícita y trazable de entrega, con responsable, fecha y evidencia según el circuito aplicable.
- **Pedido mixto:** los personalizados pendientes deben conservarse en el checklist aunque las líneas de catálogo ya hayan salido.
- **Personalizado sin código:** verificar visualmente la descripción, unidad y cantidad. La miniapp de dos responsables ya admite revisión visual mediante el formulario de cantidades; los botones adicionales de escaneo no son adecuados para una línea sin producto de catálogo.
- **Cantidades parciales:** el plan de salida vigente solo acepta un personalizado completo o sin salida. Si se necesitan entregas parciales, hay que diseñar y probar ese comportamiento expresamente.
- **Históricos cerrados sin trazabilidad:** requieren clasificación operativa antes de recuperar pendientes. No inferir que `cantidad_despachada=0` significa que nunca se entregaron: el motor actual de personalizados cierra cambiando estado y no actualiza esa cantidad.

La protección de despacho de dos responsables solo actúa cuando ya existe una preparación de ese flujo. No constituye una garantía global para pedidos sin preparación, como este.

Antes de recuperar el 699 se debe confirmar qué material sigue físicamente pendiente. Cualquier recuperación debe conservar el historial y revisar la marca de entrega en Hermes para evitar inconsistencias entre sistemas. No basta con cambiar solo el estado de la cabecera o hacer visible el botón en el frontend.

## Referencias de implementación

- `src/OperacionesMovilApp.jsx`: bloqueo de documentos cerrados y acceso a preparación.
- `src/PreparacionChecklist.jsx` y `src/CantidadPedido.jsx`: alistado, cantidades y comprobación visual.
- `supabase/migrations/20261010004229_operaciones_movil_pedidos.sql`: líneas actuales y motor de preparación.
- `supabase/migrations/20261021192845_pedidos_dos_responsables_evidencias.sql`: plan de salida, protección de despacho y retiro de personalizados.
- Definiciones vigentes consultadas directamente: `recalcular_estado_pedido`, `_compra_solicitud_sync`, `recibir_compra`, `comprar_directo` y `entregar_personalizado`.

## Consultas reproducibles de solo lectura

```sql
select id, numero, estado from public.pedido
where id=790 or numero='PED-2026-00699';

select id, descripcion, estado, cantidad_base, cantidad_despachada,
       compra_directa_nota, modificado_en, modificado_por
from public.pedido_linea where pedido_id=790 order by id;

select count(*) from almacen_operaciones.lineas_actuales(790,1);

select c.id, c.estado, c.cantidad_recibida, c.recibido_en, c.recibido_por
from public.compra_solicitud c
join public.pedido_linea l on l.id=c.pedido_linea_id
where l.pedido_id=790 order by c.id;

select p.id, p.numero, p.estado, count(*) as lineas
from public.compra_solicitud c
join public.pedido_linea l on l.id=c.pedido_linea_id
join public.pedido p on p.id=l.pedido_id
where c.recibido_en='2026-10-22T13:46:39.3429Z'
  and l.es_personalizado and l.estado='COMPRADO_DIRECTO'
group by p.id, p.numero, p.estado order by p.id;
```
