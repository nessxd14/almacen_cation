// Sin consumo de actualizaciones ni cambios de webhook: OpenClaw sigue siendo su receptor.
const BUCKET = 'evidencias_vtd';
const respuesta = (datos, status = 200) => Response.json(datos, { status });

async function rpc(admin, accion, datos = {}) {
  const { data, error } = await admin.rpc('worker_evidencia_vtd', { p_accion: accion, p_datos: datos });
  if (error) throw new Error('No se pudo guardar el estado del envío.');
  return data;
}

async function telegram(fetchImpl, token, metodo, body) {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST', body, signal: AbortSignal.timeout(40000),
  });
  const data = await response.json();
  return { status: response.status, data };
}

export async function comprobarBot(fetchImpl, token, config) {
  if (!token) throw new Error('Falta configurar TELEGRAM_BOT_TOKEN.');
  const me = await telegram(fetchImpl, token, 'getMe', new URLSearchParams());
  if (!me.data.ok || me.data.result.username?.toLowerCase() !== 'cation_bbb_bot') throw new Error('El token no corresponde a @cation_bbb_bot.');
  const chat = await telegram(fetchImpl, token, 'getChat', new URLSearchParams({ chat_id: config.chat_id }));
  if (!chat.data.ok || String(chat.data.result.id) !== config.chat_id || !chat.data.result.is_forum) throw new Error('El bot no puede acceder al grupo con temas configurado.');
  const member = await telegram(fetchImpl, token, 'getChatMember', new URLSearchParams({ chat_id: config.chat_id, user_id: String(me.data.result.id) }));
  const m = member.data.result;
  if (!member.data.ok || !['creator', 'administrator', 'member', 'restricted'].includes(m?.status) || (m.status === 'restricted' && (!m.is_member || !m.can_send_photos || !m.can_send_messages)) || (m.status === 'member' && chat.data.result.permissions?.can_send_photos === false)) {
    throw new Error('El bot necesita permiso para publicar fotos en el grupo.');
  }
  return { bot: '@cation_bbb_bot', grupo: config.chat_id, tema: config.tema_id };
}

export async function enviarLote({ admin, fetchImpl, token, config, lote }) {
  const base = { id: lote.id, lease: lote.lease };
  const files = [];
  try {
    for (const ruta of lote.rutas) {
      const { data, error } = await admin.storage.from(BUCKET).download(ruta);
      if (error || !data || !data.size || data.size > 1048576 || data.type !== 'image/jpeg') throw new Error('Foto no disponible.');
      const magic = new Uint8Array(await data.slice(0, 3).arrayBuffer());
      if (magic[0] !== 255 || magic[1] !== 216 || magic[2] !== 255) throw new Error('El archivo no es una foto JPEG.');
      files.push(data);
    }
  } catch { await rpc(admin, 'error', base); return 'error'; }
  const body = new FormData();
  body.set('chat_id', config.chat_id); body.set('message_thread_id', String(config.tema_id));
  const caption = lote.caption.slice(0, 1000);
  const single = files.length === 1;
  if (single) { body.set('photo', files[0], 'evidencia.jpg'); body.set('caption', caption); }
  else {
    body.set('media', JSON.stringify(files.map((_, i) => ({ type: 'photo', media: `attach://foto${i}`, ...(i === 0 ? { caption } : {}) }))));
    files.forEach((file, i) => body.set(`foto${i}`, file, `evidencia-${i + 1}.jpg`));
  }
  let receipts;
  try {
    const { data, status } = await telegram(fetchImpl, token, single ? 'sendPhoto' : 'sendMediaGroup', body);
    if (status >= 500) throw new Error('Resultado desconocido.');
    if (!data.ok) { await rpc(admin, 'error', { ...base, retry_after: Number(data.parameters?.retry_after) || null }); return 'error'; }
    const messages = single ? [data.result] : data.result;
    if (!Array.isArray(messages) || messages.length !== files.length || messages.some(m => !Number.isSafeInteger(m.message_id) || String(m.chat?.id) !== config.chat_id || m.message_thread_id !== Number(config.tema_id) || !m.photo?.length)) throw new Error('Confirmación incompleta.');
    receipts = messages.map(m => ({ message_id: m.message_id, file_id: m.photo.at(-1).file_id, file_unique_id: m.photo.at(-1).file_unique_id }));
  } catch {
    // Telegram no ofrece clave de idempotencia. Ante timeout no se repite a ciegas.
    await rpc(admin, 'incierto', base); return 'incierto';
  }
  // Reintentar sólo el guardado de la confirmación, nunca la publicación en Telegram.
  for (let i = 0; i < 3; i++) {
    try { await rpc(admin, 'confirmar', { ...base, telegram: receipts }); return 'enviado'; }
    catch { if (i === 2) throw new Error('El envío requiere comprobar su confirmación.'); }
  }
}

export async function limpiarFotos(admin) {
  let borrados = 0;
  for (const lote of await rpc(admin, 'limpiar')) {
    const { error } = await admin.storage.from(BUCKET).remove(lote.rutas);
    if (!error) { await rpc(admin, 'borrado', { id: lote.id }); borrados++; }
  }
  return borrados;
}

export async function manejarWorker(req, { admin, token, fetchImpl = fetch }) {
  if (req.method !== 'POST') return respuesta({ error: 'Método no permitido.' }, 405);
  if (Number(req.headers.get('content-length')) > 4096) return respuesta({ error: 'Solicitud inválida.' }, 413);
  let body;
  try { const raw = await req.text(); if (raw.length > 4096) return respuesta({ error: 'Solicitud inválida.' }, 413); body = JSON.parse(raw); }
  catch { return respuesta({ error: 'Solicitud inválida.' }, 400); }
  try {
    if (!(await rpc(admin, 'autorizar', { token: typeof body?.token === 'string' ? body.token : '' }))?.autorizado) return respuesta({ error: 'No autorizado.' }, 401);
    const config = await rpc(admin, 'configuracion');
    if (body.accion === 'diagnostico') return respuesta({ ok: true, ...await comprobarBot(fetchImpl, token, config) });
    const borrados = await limpiarFotos(admin);
    if (!config.activo) return respuesta({ ok: true, activo: false, borrados });
    await comprobarBot(fetchImpl, token, config);
    const resultados = [];
    // Lotes pequeños para respetar la duración de la función y las cuotas del grupo.
    for (let i = 0; i < 2; i++) {
      const lote = await rpc(admin, 'reclamar');
      if (!lote) break;
      resultados.push(await enviarLote({ admin, fetchImpl, token, config, lote }));
    }
    return respuesta({ ok: true, resultados, borrados });
  } catch (e) {
    // Nunca se registra el error original de fetch: podría contener el token en la URL.
    const mensajes = ['Falta configurar TELEGRAM_BOT_TOKEN.', 'El token no corresponde a @cation_bbb_bot.', 'El bot no puede acceder al grupo con temas configurado.', 'El bot necesita permiso para publicar fotos en el grupo.'];
    return respuesta({ error: mensajes.includes(e.message) ? e.message : 'No se pudo completar el proceso. Las fotos pendientes se conservan.' }, 503);
  }
}
