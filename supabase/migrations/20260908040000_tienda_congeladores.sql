-- Tienda de congeladores: comprar con XP + regalar a amigos.
--
-- "Comprar para uno mismo" solo toca tu propia fila de user_stats, así que
-- no necesita nada nuevo: la política RLS que ya existe
-- ("usuarios actualizan sus propias stats") alcanza perfecto.
--
-- "Regalar a un amigo" es distinto: implica que TU cambio (gastar XP)
-- también le entregue algo a la fila de OTRA persona (sumarle un
-- congelador). Eso no se puede resolver con una política RLS normal sin
-- abrir una puerta peligrosa -- si le diéramos a cualquier seguidor
-- permiso de UPDATE sobre la fila de user_stats de a quien sigue, esa
-- misma puerta serviría para que alguien le cambie la racha, el XP o las
-- vidas a un amigo sin que este se entere, no solo el congelador. Por eso
-- esto se resuelve con una función de Postgres (RPC) que corre con
-- permisos elevados PERO solo hace exactamente esta operación puntual,
-- validando todo adentro: que de verdad lo sigas, que tengas el XP,
-- que tu amigo no esté ya en el máximo, y que no le hayas regalado a esa
-- misma persona hace menos de una semana.

CREATE TABLE IF NOT EXISTS public.regalos_congelador (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  de_user_id uuid NOT NULL REFERENCES auth.users(id),
  para_user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.regalos_congelador ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'regalos_congelador' AND policyname = 'usuarios ven sus propios regalos') THEN
    CREATE POLICY "usuarios ven sus propios regalos"
      ON public.regalos_congelador FOR SELECT
      USING (auth.uid() = de_user_id OR auth.uid() = para_user_id);
  END IF;
END $$;

-- No hace falta una política de INSERT para regalos_congelador: la única
-- forma de insertar una fila es a través de la función de abajo (que
-- corre con permisos elevados y ya valida todo por su cuenta), no
-- directo desde el cliente.

CREATE OR REPLACE FUNCTION public.regalar_congelador(para_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  de_user_id uuid := auth.uid();
  precio int := 100;
  maximo int := 2;
  dias_enfriamiento int := 7;
  xp_actual int;
  congeladores_amigo int;
  ultimo_regalo timestamptz;
BEGIN
  IF de_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No autenticado.');
  END IF;

  IF de_user_id = para_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No puedes regalarte un congelador a ti mismo.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.follows WHERE follower_id = de_user_id AND followed_id = para_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo puedes regalarle a alguien que sigues.');
  END IF;

  SELECT rc.created_at INTO ultimo_regalo
  FROM public.regalos_congelador rc
  WHERE rc.de_user_id = regalar_congelador.de_user_id AND rc.para_user_id = regalar_congelador.para_user_id
  ORDER BY rc.created_at DESC
  LIMIT 1;

  IF ultimo_regalo IS NOT NULL AND ultimo_regalo > now() - (dias_enfriamiento || ' days')::interval THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya le regalaste un congelador a esta persona hace poco.');
  END IF;

  -- FOR UPDATE bloquea las filas mientras dura la transacción, para que
  -- dos regalos casi simultáneos (doble clic, dos pestañas) no alcancen a
  -- leer el mismo XP/congeladores "viejo" y pisarse uno al otro.
  SELECT puntos_experiencia INTO xp_actual FROM public.user_stats WHERE user_id = de_user_id FOR UPDATE;
  IF xp_actual IS NULL OR xp_actual < precio THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No tienes suficiente XP.');
  END IF;

  SELECT racha_congeladores INTO congeladores_amigo FROM public.user_stats WHERE user_id = para_user_id FOR UPDATE;
  IF congeladores_amigo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa persona todavía no tiene datos.');
  END IF;
  IF congeladores_amigo >= maximo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa persona ya tiene el máximo de congeladores.');
  END IF;

  UPDATE public.user_stats SET puntos_experiencia = puntos_experiencia - precio WHERE user_id = de_user_id;
  UPDATE public.user_stats SET racha_congeladores = racha_congeladores + 1 WHERE user_id = para_user_id;
  INSERT INTO public.regalos_congelador (de_user_id, para_user_id) VALUES (de_user_id, para_user_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.regalar_congelador(uuid) TO authenticated;
