-- ─────────────────────────────────────────────────────────────────────────
-- Sincronización inversa Shopify (almacén → Shopify): cola de productos "sucios"
-- Aplicado en Supabase Cloud el 2026-06-26.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.shopify_sync_outbox (
  producto_id   bigint primary key references public.producto(id) on delete cascade,
  encolado_en   timestamptz not null default now(),
  intentos      int         not null default 0,
  ultimo_error  text
);

comment on table public.shopify_sync_outbox is
  'Cola de productos cuyo stock cambió y debe re-publicarse en Shopify.';

create or replace function public.trg_encolar_sync_shopify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_pid bigint;
begin
  v_pid := coalesce(new.producto_id, old.producto_id);
  if v_pid is not null then
    insert into public.shopify_sync_outbox (producto_id, encolado_en, intentos, ultimo_error)
    values (v_pid, now(), 0, null)
    on conflict (producto_id) do update
      set encolado_en = now(), intentos = 0, ultimo_error = null;
  end if;
  return null;
end;
$$;

drop trigger if exists stock_actual_sync_shopify on public.stock_actual;
create trigger stock_actual_sync_shopify
  after insert or update or delete on public.stock_actual
  for each row execute function public.trg_encolar_sync_shopify();

create or replace function public.f_sync_outbox_fallo(p_producto_id bigint, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shopify_sync_outbox
     set intentos = intentos + 1, ultimo_error = p_error, encolado_en = now()
   where producto_id = p_producto_id;
$$;

revoke execute on function public.f_sync_outbox_fallo(bigint, text) from anon, public;

alter table public.shopify_sync_outbox enable row level security;
drop policy if exists outbox_select on public.shopify_sync_outbox;
create policy outbox_select on public.shopify_sync_outbox
  for select to authenticated using (true);
