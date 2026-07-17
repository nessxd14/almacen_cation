-- Fix: Cristian, Rony y Gabriel perdieron su nombre/rol corregidos porque
-- sus cuentas de Supabase Auth se recrearon en algún momento después de
-- 2026-07-13_perfil_email_y_roles.sql (nuevo id de auth.users -> el
-- trigger handle_new_user() volvió a insertar la fila de perfil con los
-- valores por defecto: nombre = prefijo de email, rol = 'operario').
-- Detectado incidentalmente mientras se investigaba el brief de "marca
-- visible" (ver nota abajo). Cristian estaba sin rol admin en producción.
--
-- YA APLICADA DIRECTAMENTE (no queda como paso manual) — DML simple sobre
-- 3 filas, confirmada con BEGIN...ROLLBACK antes de aplicar para real.
-- Se deja este archivo como registro histórico del cambio.

update perfil set nombre = 'Cristian', rol = 'admin'    where email = 'mamanicristian865@gmail.com';
update perfil set nombre = 'Rony',     rol = 'admin'    where email = 'piterali.argana@gmail.com';
update perfil set nombre = 'Gabriel',  rol = 'operario' where email = 'gabrieloni62@gmail.com';
