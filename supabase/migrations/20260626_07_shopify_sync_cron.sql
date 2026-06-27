-- ─────────────────────────────────────────────────────────────────────────
-- Drenado programado de la cola de sync inverso: cada minuto, si hay pendientes,
-- invoca la Edge Function shopify-stock-push. El secreto compartido se lee de
-- Vault (nombre 'shopify_sync_secret'). Aplicado en Supabase Cloud el 2026-06-26.
-- ─────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job where jobname = 'shopify-stock-push-drain';

select cron.schedule(
  'shopify-stock-push-drain',
  '* * * * *',
  $cmd$
  select net.http_post(
    url     := 'https://zxoxougwgstrarwymlvd.supabase.co/functions/v1/shopify-stock-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Sync-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'shopify_sync_secret'),
        ''
      )
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.shopify_sync_outbox where intentos < 5);
  $cmd$
);
