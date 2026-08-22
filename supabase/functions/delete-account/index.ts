// supabase/functions/delete-account/index.ts
//
// Elimina la cuenta del usuario que hace la petición. Corre en el servidor
// de Supabase (Deno), NUNCA en el navegador, porque necesita la
// SERVICE_ROLE_KEY para poder borrar usuarios — esa clave jamás debe
// viajar al frontend.
//
// Deploy:
//   supabase functions deploy delete-account
//
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están disponibles como
// variables de entorno automáticas dentro de las Edge Functions, no hay
// que configurarlas a mano.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Falta el header Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cliente "de usuario": solo sirve para averiguar quién está pidiendo
    // borrarse a sí mismo, usando su propio token.
    const clienteUsuario = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await clienteUsuario.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido o sesión expirada' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;

    // Cliente "admin": con la service role key, único que puede borrar usuarios.
    const clienteAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error: deleteError } = await clienteAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Nota: las filas en profiles/user_stats/progreso_*/follows quedan
    // borradas solas si sus foreign keys tienen "on delete cascade" hacia
    // auth.users. Si alguna tabla no la tiene, hay que borrarla a mano acá
    // antes de borrar el usuario.

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
