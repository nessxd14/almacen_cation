-- Migración: completar la tabla `perfil` ya existente (email + nombres/roles
-- reales) y dejar `handle_new_user()` poblando email hacia adelante.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase, validando primero en BEGIN … ROLLBACK.
--
-- ============================================================================
-- PASO 0 — Evidencia recogida contra la base viva (2026-07-13)
-- ============================================================================
--
-- El brief (BRIEF_fase1_auth_real_v1.md) asumía "no existe tabla perfil
-- todavía" y traía un CREATE TABLE completo (enum rol_usuario, columna
-- email, RLS select-all para cualquier autenticado). Contra la base viva
-- eso es incorrecto: `perfil` YA EXISTE, con infraestructura funcional
-- construida en otra sesión/tarea, no versionada en este repo:
--
--   - Columnas actuales: id (PK, FK a auth.users), nombre (text), rol
--     (text, CHECK IN ('operario','admin') — cumple el mismo propósito
--     que el enum del brief, no se reemplaza), activo (bool), creado_en.
--     Falta: email.
--   - Trigger `on_auth_user_created` (AFTER INSERT ON auth.users) ya
--     llama a una función `handle_new_user()` que autopobla perfil
--     (nombre desde raw_user_meta_data->>'nombre' o prefijo de email;
--     rol desde raw_user_meta_data->>'rol' o 'operario' por defecto) —
--     mismo propósito que crear_perfil_automatico() del brief, ya
--     resuelto, no se recrea.
--   - RLS ya habilitado con `perfil_select` (cada usuario lee su propia
--     fila, o cualquier admin lee todas vía app_es_admin()) y
--     `perfil_admin_write` (solo admin escribe). Es MÁS restrictivo que
--     el "select-all para cualquier autenticado" que pedía el brief —
--     y alcanza para lo que necesita el frontend (useUsuarioActual() solo
--     lee su propia fila; Historial/Pedidos no leen perfil en absoluto,
--     creado_por ya es texto plano). No se toca el RLS.
--   - Las 5 filas de perfil ya estaban pobladas (mismo id que auth.users),
--     pero con `nombre` = prefijo de email ("nessxd14", "piterali.argana",
--     "mamanicristian865", "gabrieloni62") en vez de nombre real, y
--     mamanicristian865@gmail.com (Cristian) en rol='operario' — la
--     tabla de roles confirmada por Ness en el brief dice 'admin'. Los
--     otros 4 ya coincidían con lo confirmado.
--
-- Decisión (confirmada con Ness): ADAPTAR lo existente, no recrear. Este
-- archivo solo agrega `email`, corrige los 5 nombres/roles al valor
-- exacto que Ness confirmó, y actualiza handle_new_user() para que
-- también guarde el email de acá en adelante. No se toca el enum (sigue
-- sin existir, el CHECK ya cumple la misma función), no se toca RLS.
--
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PASO 1 — Columna email (nullable primero para poder backfillear).
-- ----------------------------------------------------------------------------
alter table perfil add column if not exists email text;

update perfil p set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- ----------------------------------------------------------------------------
-- PASO 2 — Nombres y roles reales, tabla confirmada por Ness (brief, no
-- volver a preguntar). Único cambio de rol real: Cristian pasa de
-- 'operario' (dato viejo/adivinado) a 'admin' (confirmado).
-- ----------------------------------------------------------------------------
update perfil set nombre = 'Administrador', rol = 'admin'    where id = '33d29ce8-a4fe-4776-bf34-16b09b6a81b4'; -- admin@cation.app
update perfil set nombre = 'Ness',          rol = 'admin'    where id = '06d97fe8-b246-4c82-99d5-f5e612b4bb60'; -- nessxd14@gmail.com
update perfil set nombre = 'Rony',          rol = 'admin'    where id = '9aae1800-3f99-4c3a-9b25-97c5aec8c91f'; -- piterali.argana@gmail.com
update perfil set nombre = 'Cristian',      rol = 'admin'    where id = '16a91138-d410-4dd7-b14a-a09b3047743e'; -- mamanicristian865@gmail.com
update perfil set nombre = 'Gabriel',       rol = 'operario' where id = '53f4a8cc-2a0f-478c-83d2-c372e9030da4'; -- gabrieloni62@gmail.com

-- ----------------------------------------------------------------------------
-- PASO 3 — email obligatorio de acá en adelante (ya sin NULLs tras el backfill).
-- ----------------------------------------------------------------------------
alter table perfil alter column email set not null;

-- ----------------------------------------------------------------------------
-- PASO 4 — handle_new_user() pasa a guardar también el email (mismo
-- criterio de nombre/rol que ya tenía, solo se agrega el campo nuevo).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.perfil (id, nombre, email, rol)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'rol', ''), 'operario')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 5 — Verificación (debe mostrar los 5 usuarios con email poblado y
-- el nombre/rol de la tabla confirmada).
-- ----------------------------------------------------------------------------
select id, nombre, email, rol, activo from perfil order by creado_en;

-- Revisar el resultado de arriba, y si está todo bien:
--   COMMIT;
-- si algo no cuadra:
--   ROLLBACK;
commit;
