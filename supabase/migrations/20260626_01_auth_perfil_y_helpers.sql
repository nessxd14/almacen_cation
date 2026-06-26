-- ─────────────────────────────────────────────────────────────────────────
-- Autenticación: tabla de perfiles + helpers de identidad/rol
-- Fase Auth (#2). Aplicado en Supabase Cloud el 2026-06-26.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.perfil (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'operario' check (rol in ('operario','admin')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

comment on table public.perfil is
  'Perfil de aplicación enlazado 1:1 a auth.users. Provee nombre legible y rol.';

-- Alta automática de perfil cuando se crea un usuario en auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfil (id, nombre, rol)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'nombre', ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(nullif(new.raw_user_meta_data->>'rol',''), 'operario')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- handle_new_user es solo un trigger; no debe exponerse como endpoint RPC.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- ── Helpers de identidad ───────────────────────────────────────────────────
-- Actor a registrar en el Kardex:
--   • Usuario autenticado -> su nombre de perfil (no se puede falsificar).
--   • Sin sesión (service-role / Edge Function) -> el fallback de confianza
--     (p.ej. 'shopify'), o 'sistema'.
create or replace function public.app_usuario(p_fallback text default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nombre from public.perfil where id = auth.uid()),
    p_fallback,
    'sistema'
  );
$$;

create or replace function public.app_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfil
    where id = auth.uid() and rol = 'admin' and activo
  );
$$;

revoke execute on function public.app_usuario(text) from anon;
revoke execute on function public.app_es_admin() from anon;

-- ── RLS de perfil ──────────────────────────────────────────────────────────
alter table public.perfil enable row level security;

drop policy if exists perfil_select on public.perfil;
create policy perfil_select on public.perfil
  for select to authenticated
  using (id = auth.uid() or public.app_es_admin());

drop policy if exists perfil_admin_write on public.perfil;
create policy perfil_admin_write on public.perfil
  for all to authenticated
  using (public.app_es_admin())
  with check (public.app_es_admin());
