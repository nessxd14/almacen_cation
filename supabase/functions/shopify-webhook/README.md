# shopify-webhook

Edge Function que sincroniza el stock del Kardex con Shopify.

| Topic de Shopify   | Acción en el Kardex                          | Clave de idempotencia                    |
|--------------------|----------------------------------------------|------------------------------------------|
| `orders/fulfilled` | `registrar_salida` por línea despachada      | `shopify:fulfill:{order_id}:{line_id}`   |
| `refunds/create`   | `registrar_entrada` por línea con restock    | `shopify:refund:{refund_id}:{rli_id}`    |

## Garantías de diseño

- **Autenticidad:** verifica `X-Shopify-Hmac-Sha256` con HMAC-SHA256 sobre el **body crudo** (comparación constant-time vía `crypto.subtle.verify`). Sin firma válida → `401`, sin procesar nada.
- **Respuesta rápida:** responde `200` de inmediato y procesa el Kardex en segundo plano (`EdgeRuntime.waitUntil`), para no agotar el timeout (~5 s) de Shopify.
- **Idempotencia:** anclada a orden/línea (no al `X-Shopify-Webhook-Id`). La clave va como `p_idempotencia`; el índice único `uq_kardex_idem` deduplica cualquier reintento sin volver a mover stock.
- **Sobregiro:** las salidas usan `p_permitir_sobregiro = true` — una venta ya despachada nunca se bloquea; un eventual negativo queda visible para conciliación.

## Por qué `refunds/create` cubre también las cancelaciones

El descuento ocurre al **despachar**. El reingreso físico real se produce solo cuando hay una devolución/cancelación con restock, y Shopify emite en esos casos un `refunds/create` con `restock_type` ∈ {`return`, `cancel`}. Cablear además `orders/cancelled` provocaría un **doble reingreso**, así que se usa `refunds/create` como única vía de restock.

## Configuración (una vez)

1. **Secrets** (no van al frontend):
   ```bash
   supabase secrets set SHOPIFY_WEBHOOK_SECRET=<secreto-del-webhook>
   supabase secrets set SHOPIFY_UBICACION_ID=<id-de-ubicacion-online>
   ```
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase automáticamente.

2. **Registrar los webhooks en Shopify** apuntando a:
   ```
   https://<PROJECT_REF>.supabase.co/functions/v1/shopify-webhook
   ```
   Topics: `orders/fulfilled` y `refunds/create`. El secreto HMAC debe coincidir con `SHOPIFY_WEBHOOK_SECRET`.

3. **Catálogo:** cada variante vendible en Shopify debe tener su SKU cargado en `identificador.valor` (con `activo = true`) para que `resolver_identificador` lo mapee a una presentación. Líneas con SKU sin mapeo se omiten y se registran en los logs.

## Despliegue

Desplegada con `verify_jwt = false` (Shopify no envía JWT de Supabase; la autenticación es la firma HMAC propia).

```bash
supabase functions deploy shopify-webhook --no-verify-jwt
```

## Prueba

Como las salidas/entradas exigen catálogo y ubicación reales, prueba end-to-end desde Shopify (botón *Send test notification* en la config del webhook) o con un POST firmado, y revisa el resultado en el tab **Historial** y en los logs de la función.
