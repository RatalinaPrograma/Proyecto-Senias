-- Ajuste al XP de `completar_subnivel` (ver `endurecer_completar_leccion.sql`):
-- la primera versión le daba 0 XP a cualquier repetición de un subnivel ya
-- completado -- correcto contra el abuso (spamear la misma lección fácil
-- para XP infinito), pero de más: rehacer una lección ya completada es una
-- función que la app siempre permitió a propósito (`lessonGuard` deja
-- entrar a subniveles con estado 'completado', y Home los muestra con un
-- check pero igual son clickeables) -- pensada para repasar, y repasar
-- debería seguir dando algo, solo que menos que la primera vez.
--
-- Regla nueva:
--   - Primera vez que completas un subnivel: el XP de esta llamada tal
--     cual (con el mismo tope de 200 que ya había).
--   - Si ya lo habías completado antes: se te da un 30% del XP que
--     ganaste en ESTE intento (así que sigue reflejando qué tan bien te
--     fue -- más respuestas correctas, más XP de repaso también), con un
--     tope aparte más bajo (50) para que ni jugando perfecto un repaso
--     rinda como una lección nueva.
--   - Si ya recibiste recompensa de repaso HOY para este mismo subnivel,
--     la siguiente vez que lo repitas el mismo día da 0 -- sin esto,
--     alguien podría repetir la lección más fácil 200 veces seguidas en
--     una tarde y juntar igual una cantidad importante de XP. Al día
--     siguiente vuelve a estar disponible.
--
-- El resto de `completar_subnivel` (validar que el nivel esté desbloqueado,
-- que sea el subnivel "actual" -- esto último solo aplica a la PRIMERA
-- vez, nunca a un repaso) queda exactamente igual.
--
-- OJO: el control de "una recompensa de repaso por día" NO puede apoyarse
-- en `updated_at` -- la primera vez que completas un subnivel, `updated_at`
-- también queda en "hoy", así que un repaso ESE MISMO día se leía como
-- "ya se te dio recompensa hoy" y daba 0 en vez de 30%. Por eso se agrega
-- una columna aparte, dedicada solo a esto.

ALTER TABLE public.progreso_subnivel_usuario
  ADD COLUMN IF NOT EXISTS ultima_recompensa_repaso date;

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
  v_ultima_recompensa date;
  v_hoy date;
  v_subnivel_permitido bigint;
  v_xp_final int;
  v_es_repaso boolean;
  v_nueva_recompensa date;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No autenticado.');
  END IF;

  v_hoy := (now() AT TIME ZONE 'America/Santiago')::date;

  SELECT nivel_id INTO v_nivel_id FROM public.subniveles WHERE id = p_subnivel_id;
  IF v_nivel_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ese subnivel no existe.');
  END IF;

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

  SELECT completado, ultima_recompensa_repaso INTO v_ya_completado, v_ultima_recompensa
  FROM public.progreso_subnivel_usuario
  WHERE user_id = v_user_id AND subnivel_id = p_subnivel_id;
  v_ya_completado := COALESCE(v_ya_completado, false);
  v_es_repaso := v_ya_completado;

  IF NOT v_es_repaso THEN
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

    IF v_subnivel_permitido IS DISTINCT FROM p_subnivel_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Ese subnivel todavía no te toca.');
    END IF;
  END IF;

  IF v_es_repaso THEN
    IF v_ultima_recompensa IS NOT NULL AND v_ultima_recompensa = v_hoy THEN
      v_xp_final := 0;
      v_nueva_recompensa := v_ultima_recompensa;
    ELSE
      -- 30% de lo ganado en ESTE intento (sigue premiando que te haya ido
      -- bien), con su propio tope más bajo que el de primera vez.
      v_xp_final := LEAST(GREATEST(ROUND(COALESCE(p_xp_ganado, 0) * 0.3), 0), 50);
      v_nueva_recompensa := v_hoy;
    END IF;
  ELSE
    v_xp_final := LEAST(GREATEST(COALESCE(p_xp_ganado, 0), 0), 200);
    v_nueva_recompensa := NULL;
  END IF;

  PERFORM set_config('signy.permitir_stats', 'on', true);

  INSERT INTO public.progreso_subnivel_usuario (user_id, subnivel_id, completado, puntaje, fecha_completado, updated_at, ultima_recompensa_repaso)
  VALUES (v_user_id, p_subnivel_id, true, v_xp_final, now(), now(), v_nueva_recompensa)
  ON CONFLICT (user_id, subnivel_id) DO UPDATE
    SET completado = true,
        puntaje = GREATEST(public.progreso_subnivel_usuario.puntaje, excluded.puntaje),
        fecha_completado = COALESCE(public.progreso_subnivel_usuario.fecha_completado, excluded.fecha_completado),
        updated_at = excluded.updated_at,
        ultima_recompensa_repaso = excluded.ultima_recompensa_repaso;

  IF v_xp_final > 0 THEN
    UPDATE public.user_stats
    SET puntos_experiencia = COALESCE(puntos_experiencia, 0) + v_xp_final
    WHERE user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'xp_otorgado', v_xp_final, 'repaso', v_es_repaso);
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_subnivel(bigint, int) TO authenticated;
