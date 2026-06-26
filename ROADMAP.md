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

## #4 — Webhook de Shopify (SIGUIENTE)

- **Supabase Edge Function** (Deno), no servicio Node aparte.
- Verificación **HMAC sobre el body crudo** con `SHOPIFY_WEBHOOK_SECRET`; responder **200 rápido** y luego procesar.
- Idempotencia anclada a orden/línea: clave `shopify:{order_id}:{line_id}` pasada como `p_idempotencia` a `registrar_salida` → el índice único deduplica reintentos. **No requiere tablas nuevas.**
- Mapeo SKU/variant Shopify → `presentacion_id` vía `resolver_identificador`; definir ubicación default para ventas online.
- `service_role_key` vive dentro de la función (server-side).

## Fase 5 — Costos y analítica

- Valuación por **promedio ponderado móvil** desde el Kardex (vista derivada); FIFO queda descartado salvo que se agregue tracking de lotes.
- `stock_min` / `punto_reorden` en `producto` + vista "necesita reposición" y velocidad de rotación desde las salidas.

## Fase 6 — Administración avanzada / multi-tenant SaaS

- `tenant_id` en todas las tablas + RLS por claim de tenant en el JWT (migración grande).
- Tiers de precio por PyME + billing (Stripe). Depende de que #2 esté maduro.

## Deuda técnica

- ~~`Scanner` duplicado en ConteoApp~~ → resuelto (usa `EscanerCodigo`).
- `sync_imagenes.mjs` corriendo incremental — diferido, no urgente.
- Vistas `v_*` son SECURITY DEFINER (advisor); revisar al cerrar RLS.
