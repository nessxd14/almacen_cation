# shopify-stock-push

Edge Function que **empuja el stock del almacén hacia Shopify** (sincronización
inversa). Mantiene el `available` de cada variante en Shopify igual al stock
total del producto en el Kardex.

## Cómo funciona

```
Movimiento Kardex → stock_actual cambia
        │ trigger (trg_encolar_sync_shopify)
        ▼
shopify_sync_outbox            (cola de productos "sucios")
        │ pg_cron cada minuto (solo si la cola no está vacía) → pg_net
        ▼
shopify-stock-push (esta función)
        │  total = Σ stock_actual.cantidad_base del producto
        │  Admin GraphQL inventorySetQuantities(available, location)
        ▼
   Shopify storefront refleja el stock real
```

- **Auth:** OAuth **client_credentials** (igual que `bootstrap_catalogo.mjs`). La función obtiene el token `shpat_` por su cuenta con `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`, lo cachea y lo refresca al expirar o ante un 401. No se pega ningún token a mano.
- **Unidad:** el variant de Shopify se asume en la **unidad base** del producto; se publica `floor(total_base)`.
- **Reintentos:** si una publicación falla, `f_sync_outbox_fallo` incrementa `intentos` y guarda `ultimo_error`. Tras 5 intentos se deja de reintentar (la fila queda con el error para diagnóstico).
- **Eficiencia:** el cron solo invoca la función si hay filas pendientes.
- **Seguridad:** la función exige el header `X-Sync-Secret` (compartido con el cron vía Vault). Desplegada con `verify_jwt=false`.

## Configuración (una vez)

1. **Secrets de la función** (`supabase secrets set` o dashboard → Edge Functions → Secrets):
   ```bash
   supabase secrets set SYNC_SECRET=<un-secreto-aleatorio-fuerte>
   supabase secrets set SHOPIFY_CLIENT_ID=<client-id-de-la-app>
   supabase secrets set SHOPIFY_CLIENT_SECRET=<client-secret-de-la-app>
   supabase secrets set SHOPIFY_STORE_DOMAIN=mi-tienda.myshopify.com
   supabase secrets set SHOPIFY_LOCATION_ID=<id-numérico-de-la-location>
   supabase secrets set SHOPIFY_API_VERSION=2026-01   # opcional
   ```
   La custom app debe tener el scope **`write_inventory`**.

2. **Secreto compartido en Vault** (para que el cron se autentique). Usa el MISMO
   valor que `SYNC_SECRET`:
   ```sql
   select vault.create_secret(
     '<mismo-valor-de-SYNC_SECRET>',
     'shopify_sync_secret',
     'Secreto compartido cron -> shopify-stock-push'
   );
   ```

3. **Mapeo de productos:** cada producto sincronizable debe tener
   `producto.shopify_inventory_item_id` (el inventory item id numérico de la
   variante en Shopify). Los que no lo tengan se omiten y quedan con error en la cola.

## Prueba

1. Provoca un movimiento (entrada/salida/ajuste) sobre un producto con
   `shopify_inventory_item_id` cargado → se encola en `shopify_sync_outbox`.
2. En ≤1 min el cron drena la cola; revisa los logs de la función y el inventario
   de la variante en Shopify.
3. Observabilidad: `select * from public.shopify_sync_outbox` muestra lo pendiente
   y el `ultimo_error` de lo que falla.

## Notas

- Si el variant corresponde a una **presentación** (caja de N) en vez de la unidad
  base, hay que dividir por el factor antes de publicar — pendiente para v2.
- El token de Shopify y `SYNC_SECRET` viven solo en el entorno de la función / Vault;
  nunca en el bundle del frontend ni en el repo.
