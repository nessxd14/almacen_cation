import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { manejarPedidosWorker } from './worker-pedidos.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(req => manejarPedidosWorker(req, {
  admin, token: Deno.env.get('TELEGRAM_BOT_TOKEN'),
}));
