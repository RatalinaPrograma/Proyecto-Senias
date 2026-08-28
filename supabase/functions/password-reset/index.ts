// supabase/functions/password-reset/index.ts
//
// Recuperación de contraseña con código de 6 dígitos enviado por EmailJS
// (en vez del correo por defecto de Supabase). Corre en el servidor porque
// necesita la SERVICE_ROLE_KEY para cambiar la contraseña del usuario y las
// claves privadas de EmailJS — nada de esto debe viajar al navegador.
//
// Deploy:
//   supabase functions deploy password-reset
//
// Secrets necesarios (supabase secrets set ...):
//   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
//
// La plantilla de EmailJS debe tener las variables {{to_email}} y {{code}}.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CODE_TTL_MINUTOS = 15;
const MAX_INTENTOS = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enviarCodigoPorEmailJS(email: string, code: string) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: Deno.env.get('EMAILJS_SERVICE_ID'),
      template_id: Deno.env.get('EMAILJS_TEMPLATE_ID'),
      user_id: Deno.env.get('EMAILJS_PUBLIC_KEY'),
      accessToken: Deno.env.get('EMAILJS_PRIVATE_KEY'),
      template_params: { to_email: email, code },
    }),
  });
  if (!res.ok) {
    throw new Error(`EmailJS respondió ${res.status}: ${await res.text()}`);
  }
}

/** Busca el id del usuario por email recorriendo las páginas de admin.listUsers. */
async function buscarUserIdPorEmail(admin: ReturnType<typeof createClient>, email: string) {
  // ponytail: escaneo por páginas, sin filtro por email en la Admin API.
  // Si la base de usuarios crece mucho, cambiar por una tabla email -> user_id indexada.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const encontrado = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (encontrado) return encontrado.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (body.action === 'request') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email) return json({ error: 'Falta el email' }, 400);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires_at = new Date(Date.now() + CODE_TTL_MINUTOS * 60_000).toISOString();

      const { error: upsertError } = await admin
        .from('password_reset_codes')
        .upsert({ email, code, expires_at, attempts: 0 });
      if (upsertError) return json({ error: upsertError.message }, 500);

      // No revelamos si el email existe o no: se manda el código igual,
      // y si no hay usuario con ese correo, "confirm" fallará más adelante.
      await enviarCodigoPorEmailJS(email, code);
      return json({ success: true });
    }

    if (body.action === 'confirm') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const code = String(body.code ?? '').trim();
      const newPassword = String(body.newPassword ?? '');
      if (!email || !code || !newPassword) return json({ error: 'Faltan datos' }, 400);

      const { data: fila, error: selectError } = await admin
        .from('password_reset_codes')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      if (selectError) return json({ error: selectError.message }, 500);

      const invalido = () => json({ error: 'Código inválido o expirado' }, 400);

      if (!fila || fila.attempts >= MAX_INTENTOS || new Date(fila.expires_at) < new Date()) {
        return invalido();
      }
      if (fila.code !== code) {
        await admin.from('password_reset_codes').update({ attempts: fila.attempts + 1 }).eq('email', email);
        return invalido();
      }

      const userId = await buscarUserIdPorEmail(admin, email);
      if (!userId) return invalido();

      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (updateError) return json({ error: updateError.message }, 500);

      await admin.from('password_reset_codes').delete().eq('email', email);
      return json({ success: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
