-- Endurece la parte del juego que hoy confía ciegamente en el cliente:
-- terminar una lección hace un .update()/.upsert() directo desde Angular
-- mandando el subnivel_id y el XP ganado como datos sueltos. La política
-- RLS típica de "puedes tocar tu propia fila" evita que toques la fila de
-- OTRO usuario, pero no evita que le pongas cualquier valor a la tuya --
-- alguien con su propio token (sacado de las DevTools, por ejemplo) podía
-- pegarle directo a la API REST y marcar como completado un subnivel que
-- nunca desbloqueó, o sumarse el XP que quisiera.
--
-- Esta migración NO toca la racha/congeladores (eso quedó fuera a
-- propósito -- ver LEEME de la entrega, tiene su propia lógica de fechas
-- ya delicada y recién arreglada; re-derivarla en SQL sin poder correr la
-- suite de tests real es más riesgo del que vale la pena en este pase).
-- Se enfoca en las dos cosas más "rompe-juego": completar lecciones fuera
-- de orden, y XP sin límite.

-- 1) Función que decide si un subnivel es de verdad el que le toca
--    completar a un usuario en este momento -- misma regla que
--    `obtenerMapaDeAprendizaje()` en el cliente (Angular), pero corrida
--    en el servidor, donde el cliente no puede mentir sobre el resultado.
--
-- 2) `completar_subnivel(subnivel_id, xp_ganado)`: hace, todo junto y
--    validado, lo que antes hacían por separado `marcarSubnivelCompletado`
--    + la parte de XP de `actualizarStatsTrasLeccion`:
--      - Verifica que el nivel del subnivel esté desbloqueado.
--      - Verifica que el subnivel sea el "actual" (el primero, con
--        contenido, todavía no completado, dentro de ese nivel) -- no
--        deja completar subniveles bloqueados ni "de próximamente".
--      - Si ya estaba completado, no vuelve a sumar XP (evita el abuso de
--        llamar esto en bucle sobre una lección ya hecha).
--      - Limita el XP de esta llamada a un tope generoso (200) en vez de
--        confiar en lo que mande el cliente.
--
-- 3) Un trigger en `user_stats` bloquea que un cliente autenticado normal
--    cambie `puntos_experiencia` con un UPDATE directo (mismo patrón que
--    `proteger_es_admin` en `profiles`) -- de ahora en más, solo puede
--    cambiar a través de esta función (u otras que se agreguen después
--    con el mismo mecanismo).

CREATE OR REPLACE FUNCTION public.completar_subnivel(p_subnivel_id bigint, p_xp_ganado int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_nivel_id bigint;
  v_es_primer_nivel boolean;
  v_nivel_accesible boolean;
  v_ya_completado boolean;
  v_subnivel_permitido bigint;
  v_xp_final int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No autenticado.');
  END IF;

  SELECT nivel_id INTO v_nivel_id FROM public.subniveles WHERE id = p_subnivel_id;
  IF v_nivel_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese subnivel no existe.');
  END IF;

  -- El primer nivel (numero_nivel más bajo) es accesible aunque no haya
  -- fila de progreso todavía -- misma regla que en el cliente.
  SELECT (n.numero_nivel = (SELECT min(numero_nivel) FROM public.niveles))
    INTO v_es_primer_nivel
  FROM public.niveles n WHERE n.id = v_nivel_id;

  SELECT EXISTS(
    SELECT 1 FROM public.progreso_nivel_usuario
    WHERE user_id = v_user_id AND nivel_id = v_nivel_id AND acceso = true
  ) INTO v_nivel_accesible;

  IF NOT (v_nivel_accesible OR v_es_primer_nivel) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese nivel todavía no está desbloqueado.');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.progreso_subnivel_usuario
    WHERE user_id = v_user_id AND subnivel_id = p_subnivel_id AND completado = true
  ) INTO v_ya_completado;

  -- El subnivel "actual" dentro del nivel: el primero (por numero_subnivel)
  -- que tenga al menos una seña con video_url y que todavía no esté
  -- completado. Los subniveles sin contenido se saltan (igual que
  -- 'proximamente' en el cliente).
  SELECT s.id INTO v_subnivel_permitido
  FROM public.subniveles s
  WHERE s.nivel_id = v_nivel_id
    AND EXISTS (SELECT 1 FROM public.senas se WHERE se.subnivel_id = s.id AND se.video_url IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.progreso_subnivel_usuario p
      WHERE p.user_id = v_user_id AND p.subnivel_id = s.id AND p.completado = true
    )
  ORDER BY s.numero_subnivel
  LIMIT 1;

  IF NOT v_ya_completado AND v_subnivel_permitido IS DISTINCT FROM p_subnivel_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese subnivel todavía no te toca.');
  END IF;

  v_xp_final := LEAST(GREATEST(COALESCE(p_xp_ganado, 0), 0), 200);

  -- Levanta la bandera que el trigger de abajo revisa para dejar pasar
  -- este cambio puntual a puntos_experiencia.
  PERFORM set_config('signy.permitir_stats', 'on', true);

  INSERT INTO public.progreso_subnivel_usuario (user_id, subnivel_id, completado, puntaje, fecha_completado, updated_at)
  VALUES (v_user_id, p_subnivel_id, true, v_xp_final, now(), now())
  ON CONFLICT (user_id, subnivel_id) DO UPDATE
    SET completado = true,
        puntaje = GREATEST(public.progreso_subnivel_usuario.puntaje, excluded.puntaje),
        fecha_completado = COALESCE(public.progreso_subnivel_usuario.fecha_completado, excluded.fecha_completado),
        updated_at = excluded.updated_at;

  IF NOT v_ya_completado THEN
    UPDATE public.user_stats
    SET puntos_experiencia = COALESCE(puntos_experiencia, 0) + v_xp_final
    WHERE user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'xp_otorgado', CASE WHEN v_ya_completado THEN 0 ELSE v_xp_final END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_subnivel(bigint, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.proteger_xp_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.puntos_experiencia IS DISTINCT FROM OLD.puntos_experiencia
     AND auth.role() = 'authenticated'
     AND COALESCE(current_setting('signy.permitir_stats', true), '') <> 'on' THEN
    NEW.puntos_experiencia := OLD.puntos_experiencia;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_proteger_xp_usuario ON public.user_stats;

CREATE TRIGGER trigger_proteger_xp_usuario
  BEFORE UPDATE ON public.user_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_xp_usuario();

-- El trigger de arriba bloquearía, sin querer, a las dos funciones que YA
-- gastan puntos_experiencia legítimamente (comprar y regalar congeladores)
-- -- ambas necesitan levantar la misma bandera antes de tocar esa columna.

-- `comprar_congelador`: hoy `comprarCongelador()` en el cliente hace un
-- `.update()` directo con el precio/máximo ya calculados en TypeScript.
-- Se mueve la misma lógica (mismos precio/máximo/mensajes) a una función
-- para que sea la única forma de tocar tu propio XP+congeladores por esta
-- vía, igual que ya pasa con `regalar_congelador`.
CREATE OR REPLACE FUNCTION public.comprar_congelador()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_precio int := 200;
  v_maximo int := 2;
  v_xp_actual int;
  v_congeladores_actuales int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No autenticado.');
  END IF;

  SELECT puntos_experiencia, racha_congeladores INTO v_xp_actual, v_congeladores_actuales
  FROM public.user_stats WHERE user_id = v_user_id FOR UPDATE;

  IF v_congeladores_actuales IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Todavía no tienes datos de racha.');
  END IF;
  IF v_congeladores_actuales >= v_maximo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya tienes el máximo de congeladores.');
  END IF;
  IF v_xp_actual IS NULL OR v_xp_actual < v_precio THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Te faltan %s XP.', v_precio - COALESCE(v_xp_actual, 0)));
  END IF;

  PERFORM set_config('signy.permitir_stats', 'on', true);

  UPDATE public.user_stats
  SET puntos_experiencia = puntos_experiencia - v_precio,
      racha_congeladores = racha_congeladores + 1
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.comprar_congelador() TO authenticated;

-- `regalar_congelador` ya existía (migración `tienda_congeladores.sql`) y
-- ya validaba todo del lado del servidor -- pero tenía un bug real desde
-- el principio: `regalar_congelador.de_user_id` intenta calificar la
-- variable local `de_user_id` con el nombre de la función, pero eso no es
-- válido en PL/pgSQL (Postgres lo lee como si "regalar_congelador" fuera
-- una tabla, que no existe). Esto hacía que la función fallara SIEMPRE en
-- su primer SELECT, esté o no aplicada la migración -- lo probé en un
-- Postgres real antes de escribir esto (ver LEEME). Se re-crea acá con
-- variables locales `v_...` para no chocar con las columnas de
-- `regalos_congelador`, y de paso se le agrega la misma bandera antes de
-- su UPDATE a puntos_experiencia. El resto de la lógica queda igual.
CREATE OR REPLACE FUNCTION public.regalar_congelador(para_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_de_user_id uuid := auth.uid();
  v_para_user_id uuid := para_user_id;
  precio int := 100;
  maximo int := 2;
  dias_enfriamiento int := 7;
  xp_actual int;
  congeladores_amigo int;
  ultimo_regalo timestamptz;
BEGIN
  IF v_de_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No autenticado.');
  END IF;

  IF v_de_user_id = v_para_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No puedes regalarte un congelador a ti mismo.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.follows WHERE follower_id = v_de_user_id AND followed_id = v_para_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo puedes regalarle a alguien que sigues.');
  END IF;

  SELECT rc.created_at INTO ultimo_regalo
  FROM public.regalos_congelador rc
  WHERE rc.de_user_id = v_de_user_id AND rc.para_user_id = v_para_user_id
  ORDER BY rc.created_at DESC
  LIMIT 1;

  IF ultimo_regalo IS NOT NULL AND ultimo_regalo > now() - (dias_enfriamiento || ' days')::interval THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya le regalaste un congelador a esta persona hace poco.');
  END IF;

  SELECT puntos_experiencia INTO xp_actual FROM public.user_stats WHERE user_id = v_de_user_id FOR UPDATE;
  IF xp_actual IS NULL OR xp_actual < precio THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No tienes suficiente XP.');
  END IF;

  SELECT racha_congeladores INTO congeladores_amigo FROM public.user_stats WHERE user_id = v_para_user_id FOR UPDATE;
  IF congeladores_amigo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa persona todavía no tiene datos.');
  END IF;
  IF congeladores_amigo >= maximo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa persona ya tiene el máximo de congeladores.');
  END IF;

  PERFORM set_config('signy.permitir_stats', 'on', true);

  UPDATE public.user_stats SET puntos_experiencia = puntos_experiencia - precio WHERE user_id = v_de_user_id;
  UPDATE public.user_stats SET racha_congeladores = racha_congeladores + 1 WHERE user_id = v_para_user_id;
  INSERT INTO public.regalos_congelador (de_user_id, para_user_id) VALUES (v_de_user_id, v_para_user_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.regalar_congelador(uuid) TO authenticated;
