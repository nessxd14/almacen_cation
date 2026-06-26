# Roadmap — Almacén Catión (WMS)

Estado al 2026-06-26. Marca el avance por fases y deja documentado el panorama
acordado para el resto del desarrollo.

## Estado actual

- **Fases 1–4** (catálogo, inventario, conteo/conciliación, operaciones diarias): operativas y cableadas a Supabase Cloud.
- **Kardex** append-only con `stock_actual` derivado por trigger; idempotencia vía índice único `uq_kardex_idem` sobre `kardex_transacciones.idempotencia_clave`.
- **RPCs desplegados**: `registrar_entrada/salida/ajuste/traslado`, `inyectar_inventario_inicial`, `conciliar_sesion`, `promover_huerfano`, `descartar_huerfano`, `resolver_identificador`, `recalcular_stock_actual`.

## #2 — Autenticación (EN CURSO)

Decisiones tomadas: **signup cerrado** (admin crea usuarios) + **atribución server-side desde el JWT** (anti-spoofing).

Hecho:
- Tabla `perfil` (1:1 con `auth.users`, `nombre` + `rol` ∈ {operario, admin}) con trigger de alta automática.
- Helpers `app_usuario(fallback)` y `app_es_admin()`.
- Los 5 RPCs ahora escriben `creado_por = app_usuario(p_usuario)`: para usuarios autenticados usan su perfil (no falsificable); para service-role (Shopify) usan la etiqueta de sistema.
- RLS de `perfil` (cada quien ve el suyo; admin ve/gestiona todos).
- Políticas `authenticated` (`auth_all`) en las 14 tablas, **aditivas** sobre `dev_anon_all`.
- Frontend: `AuthProvider` + `Login`, gate de sesión en `App.jsx`, header con usuario/logout, tab **Admin** gateado por rol. Quitados los `"operario"` hardcoded.
- Migraciones versionadas en `supabase/migrations/`.

**Checklist de GO-LIVE** (cuando el login esté desplegado y probado en prod):
1. Aplicar `supabase/migrations/20260626_04_rls_cerrar_anon.sql` para retirar `dev_anon_all`.
2. Crear los usuarios reales (Marcos, Lucía…) — por ahora desde el panel de Supabase (Authentication → Add user) o seed SQL; más adelante, pantalla Admin.
3. Activar **Leaked Password Protection** en Auth.
4. Cambiar la contraseña del admin semilla (`admin@cation.app`).

Pendiente de refinamiento (no bloqueante):
- Restringir escrituras de catálogo/ubicaciones a rol admin (hoy `auth_all` es permisivo por paridad con el comportamiento previo).
- Pantalla Admin para crear/desactivar usuarios y cambiar roles (requiere Edge Function con service-role).

## #4 — Webhook de Shopify (HECHO — pendiente config + prueba en prod)

Edge Function `shopify-webhook` desplegada (ACTIVE, `verify_jwt=false`). Ver
`supabase/functions/shopify-webhook/README.md`.

Hecho:
- HMAC-SHA256 sobre el body crudo (constant-time); 200 rápido + proceso en
  segundo plano (`EdgeRuntime.waitUntil`).
- `orders/fulfilled` → `registrar_salida` (idempotencia `shopify:fulfill:{order}:{line}`, sobregiro permitido).
- `refunds/create` → `registrar_entrada` para líneas con restock (`shopify:refund:{refund}:{line}`).
  Cubre también cancelaciones de pedidos despachados (Shopify emite refund con restock);
  no se cablea `orders/cancelled` para evitar doble reingreso.
- Mapeo SKU → presentación vía `resolver_identificador`. `service_role_key` server-side.

**Checklist de GO-LIVE de Shopify:**
1. `supabase secrets set SHOPIFY_WEBHOOK_SECRET=… SHOPIFY_UBICACION_ID=…`
2. Registrar webhooks `orders/fulfilled` y `refunds/create` → `…/functions/v1/shopify-webhook`.
3. Cargar los SKU de las variantes en `identificador` (`activo=true`).
4. Prueba end-to-end desde Shopify y verificar en el tab Historial.

Nota: el smoke test HTTP desde el entorno de desarrollo está bloqueado por la
política de egress (403 en CONNECT a supabase.co); probar desde Shopify o un POST firmado.

### #4b — Sincronización inversa (almacén → Shopify) (HECHO — pendiente config)

Edge Function `shopify-stock-push` desplegada (ACTIVE, `verify_jwt=false`). Ver
`supabase/functions/shopify-stock-push/README.md`. Migraciones `…_06` y `…_07`.

Arquitectura outbox + cron (verificada):
- Tabla `shopify_sync_outbox` + trigger sobre `stock_actual` que encola el producto
  en cada cambio de stock (probado: insertar stock encola; dedup por PK).
- `pg_cron` cada minuto invoca la función vía `pg_net` **solo si hay pendientes**;
  el secreto compartido se lee de Vault (`shopify_sync_secret`).
- La función publica `floor(stock_base_total)` en Shopify (Admin GraphQL
  `inventorySetQuantities`), borra la fila al éxito, e incrementa `intentos`/guarda
  `ultimo_error` al fallar (corte a 5 intentos).
- Variant = unidad base (v2: dividir por factor si el variant es una presentación).

**Checklist de GO-LIVE (sync inverso):**
1. `supabase secrets set SYNC_SECRET=… SHOPIFY_ADMIN_TOKEN=… SHOPIFY_STORE=… SHOPIFY_LOCATION_ID=…`
2. `select vault.create_secret('<mismo SYNC_SECRET>', 'shopify_sync_secret', '…');`
3. Cargar `producto.shopify_inventory_item_id` en los productos sincronizables.
4. Provocar un movimiento y verificar el inventario de la variante en Shopify.

Todo queda **inerte** hasta el paso 1–2: sin secret la función responde 401 y no
publica nada.

Auth alineada al modelo real: la función obtiene el token vía **OAuth
client_credentials** (`SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`/`SHOPIFY_STORE_DOMAIN`)
y lo cachea/refresca, en vez de un `shpat_` estático que expira (igual que `bootstrap_catalogo.mjs`).

**Alineaciones Shopify pendientes (anotadas, no aplicadas aún):**
- **Reverse sync → API 2026-04 + clave de idempotencia** en `inventorySetQuantities`
  (la versión 2026-04 la exige en el write). Hoy usa 2026-01 sin idempotencyKey.
- **Webhook por `variant_id`**: resolver `shopify_variant_id → presentación base`
  como vía principal (maneja variantes sin SKU), con SKU vía `identificador` de
  respaldo. Hoy resuelve solo por SKU (funciona porque el bootstrap siembra todo
  SKU en `identificador`, pero falla en variantes sin código).

Prerrequisito si se siembra el catálogo en la nube: la migración de índices únicos
de mapeo (`migracion_indices_shopify.sql`, usada por el `ON CONFLICT` del bootstrap)
debe existir en la nube antes de correr `bootstrap_catalogo.mjs` contra ella.

## Fase 5 — Costos y analítica (HECHO)

Backend desplegado (`supabase/migrations/20260626_05_fase5_costos_reorden.sql`):
- `f_valuacion_inventario()`: **promedio ponderado móvil** por producto recorriendo
  el Kardex en orden. El promedio solo cambia en entradas; las salidas reducen
  cantidad sin alterar el costo. Verificado: +10@5, +10@7, −5, +5@9 → 20 u, costo 6.75, valor 135.
- Vista `v_valuacion_inventario` (cantidad, costo promedio, valor, margen vs precio_base).
- Columnas `stock_min` / `punto_reorden` en `producto`.
- Vista `v_analitica_reorden`: stock, ventas 30/90 d, velocidad diaria, días de
  cobertura y flag `necesita_reorden`.

Frontend: tab **Analítica** (`AnaliticaApp.jsx`) con KPIs (valor a costo, unidades,
productos a reordenar) y dos vistas (Valuación / Reorden). Los puntos de reorden
se editan inline (solo admin).

Nota: valuación por producto (location-agnostic), estándar para costo. FIFO sigue
descartado salvo que se agregue tracking de lotes.

## Fase 6 — Administración avanzada / multi-tenant SaaS

- `tenant_id` en todas las tablas + RLS por claim de tenant en el JWT (migración grande).
- Tiers de precio por PyME + billing (Stripe). Depende de que #2 esté maduro.

## Deuda técnica

- ~~`Scanner` duplicado en ConteoApp~~ → resuelto (usa `EscanerCodigo`).
- `sync_imagenes.mjs` corriendo incremental — diferido, no urgente.
- Vistas `v_*` son SECURITY DEFINER (advisor); revisar al cerrar RLS.
