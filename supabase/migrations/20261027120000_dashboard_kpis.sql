-- KPIs del dashboard del panel de admin (signy/src/app/admin-dashboard).
--
-- Por qué una función y no consultas desde la app: las tablas de progreso
-- tienen RLS ("cada usuario ve solo lo suyo"), así que ni siquiera un admin
-- puede contar desde Angular cuántos usuarios terminaron el nivel 1. Esta
-- función corre con permisos del dueño (SECURITY DEFINER), pero:
--   - solo responde si quien la llama es admin (profiles.es_admin = true),
--   - devuelve solo números agregados (más el top 10 de XP con su nombre),
--   - no cambia nada: es solo lectura.
--
-- p_dias: 7, 30, 90… o 0 = desde el inicio. Las métricas del período se
-- comparan con el período anterior del mismo largo. El embudo, los niveles
-- y la retención usan a los usuarios REGISTRADOS en el período.
-- p_excluir_admins: deja fuera las cuentas del equipo (es_admin) para que
-- las pruebas internas no inflen los números.
--
-- "Activo un día" = hizo algún ejercicio (quiz o cámara), completó una
-- lección o tiene ese día marcado como practicado en la racha.
-- Fechas en hora de Chile. Se puede correr más de una vez (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.dia_chile(ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (ts AT TIME ZONE 'America/Santiago')::date $$;

-- Por si alguna columna de fecha es solo día (tipo date): no hay hora que
-- convertir, y sin esto Postgres la tomaría como medianoche UTC y la
-- correría al día anterior.
CREATE OR REPLACE FUNCTION public.dia_chile(d date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$ SELECT d $$;

-- Fecha guardada como texto 'YYYY-MM-DD' (o date): null si viene vacía, en vez de romper la consulta.
CREATE OR REPLACE FUNCTION public.fecha_o_null(v text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN v ~ '^\d{4}-\d{2}-\d{2}' THEN left(v, 10)::date END $$;

CREATE OR REPLACE FUNCTION public.admin_kpis(p_dias int DEFAULT 30, p_excluir_admins boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET client_min_messages = warning
AS $$
DECLARE
  v_hoy date := public.dia_chile(now());
  v_dias int;
  v_desde date;
  v_desde_prev date;
  v_nivel1 bigint;
  v_nivel2 bigint;
  v_total_usuarios int;
  v_resumen jsonb;
  v_serie jsonb;
  v_embudo jsonb;
  v_niveles jsonb;
  v_retencion jsonb;
  v_habitos jsonb;
  v_senas jsonb;
  v_rachas jsonb;
  v_top jsonb;
  v_dataset jsonb;
  v_contenido jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND es_admin = true) THEN
    RAISE EXCEPTION 'Solo los administradores pueden ver el dashboard.' USING ERRCODE = '42501';
  END IF;

  -- ---- Usuarios considerados (con o sin las cuentas del equipo) ----
  DROP TABLE IF EXISTS pg_temp._kpi_usuarios;
  CREATE TEMP TABLE _kpi_usuarios ON COMMIT DROP AS
    SELECT u.id,
           public.dia_chile(u.created_at) AS registro,
           coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.username), ''), 'Sin nombre') AS nombre
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE NOT (p_excluir_admins AND coalesce(p.es_admin, false));

  SELECT count(*) INTO v_total_usuarios FROM pg_temp._kpi_usuarios;

  IF coalesce(p_dias, 30) <= 0 THEN
    v_desde := coalesce((SELECT min(registro) FROM pg_temp._kpi_usuarios), v_hoy);
    v_dias := v_hoy - v_desde + 1;
  ELSE
    v_dias := least(p_dias, 365);
    v_desde := v_hoy - v_dias + 1;
  END IF;
  v_desde_prev := v_desde - v_dias;

  -- ---- Días con actividad por usuario ----
  DROP TABLE IF EXISTS pg_temp._kpi_actividad;
  CREATE TEMP TABLE _kpi_actividad ON COMMIT DROP AS
    SELECT DISTINCT a.user_id, a.dia
    FROM (
      SELECT user_id, public.dia_chile(created_at) AS dia FROM public.intentos_ejercicio WHERE created_at IS NOT NULL
      UNION ALL
      SELECT user_id, public.dia_chile(updated_at) FROM public.progreso_subnivel_usuario WHERE updated_at IS NOT NULL
      UNION ALL
      SELECT user_id, public.fecha_o_null(fecha::text) FROM public.racha_historial
      WHERE estado::text = 'practicado' AND public.fecha_o_null(fecha::text) IS NOT NULL
    ) a
    JOIN pg_temp._kpi_usuarios u ON u.id = a.user_id;

  -- ---- Niveles: subniveles con contenido y quién completó cada nivel ----
  SELECT id INTO v_nivel1 FROM public.niveles ORDER BY numero_nivel, id LIMIT 1;
  SELECT id INTO v_nivel2 FROM public.niveles ORDER BY numero_nivel, id OFFSET 1 LIMIT 1;

  DROP TABLE IF EXISTS pg_temp._kpi_subniveles;
  CREATE TEMP TABLE _kpi_subniveles ON COMMIT DROP AS
    SELECT s.id, s.nivel_id, s.numero_subnivel, s.nombre,
           EXISTS (SELECT 1 FROM public.senas se WHERE se.subnivel_id = s.id AND se.video_url IS NOT NULL) AS con_contenido
    FROM public.subniveles s;

  DROP TABLE IF EXISTS pg_temp._kpi_lecciones;
  CREATE TEMP TABLE _kpi_lecciones ON COMMIT DROP AS
    SELECT p.user_id, p.subnivel_id, s.nivel_id, public.dia_chile(p.fecha_completado) AS dia
    FROM public.progreso_subnivel_usuario p
    JOIN pg_temp._kpi_usuarios u ON u.id = p.user_id
    JOIN pg_temp._kpi_subniveles s ON s.id = p.subnivel_id
    WHERE p.completado = true;

  -- Un nivel cuenta como terminado si así quedó marcado, o si completó todos sus subniveles con contenido.
  DROP TABLE IF EXISTS pg_temp._kpi_niveles_ok;
  CREATE TEMP TABLE _kpi_niveles_ok ON COMMIT DROP AS
    SELECT DISTINCT user_id, nivel_id FROM (
      SELECT pn.user_id, pn.nivel_id
      FROM public.progreso_nivel_usuario pn
      JOIN pg_temp._kpi_usuarios u ON u.id = pn.user_id
      WHERE pn.completado = true
      UNION ALL
      SELECT l.user_id, l.nivel_id
      FROM pg_temp._kpi_lecciones l
      JOIN pg_temp._kpi_subniveles s ON s.id = l.subnivel_id AND s.con_contenido
      GROUP BY l.user_id, l.nivel_id
      HAVING count(DISTINCT l.subnivel_id) = (
        SELECT count(*) FROM pg_temp._kpi_subniveles s2 WHERE s2.nivel_id = l.nivel_id AND s2.con_contenido
      )
    ) x;

  -- ---- Resumen (tarjetas) ----
  SELECT jsonb_build_object(
    'usuarios_total', v_total_usuarios,
    'usuarios_nuevos', (SELECT count(*) FROM pg_temp._kpi_usuarios WHERE registro BETWEEN v_desde AND v_hoy),
    'usuarios_nuevos_prev', (SELECT count(*) FROM pg_temp._kpi_usuarios WHERE registro BETWEEN v_desde_prev AND v_desde - 1),
    'activos_hoy', (SELECT count(DISTINCT user_id) FROM pg_temp._kpi_actividad WHERE dia = v_hoy),
    'activos_7d', (SELECT count(DISTINCT user_id) FROM pg_temp._kpi_actividad WHERE dia > v_hoy - 7),
    'activos_30d', (SELECT count(DISTINCT user_id) FROM pg_temp._kpi_actividad WHERE dia > v_hoy - 30),
    'activos_periodo', (SELECT count(DISTINCT user_id) FROM pg_temp._kpi_actividad WHERE dia BETWEEN v_desde AND v_hoy),
    'activos_periodo_prev', (SELECT count(DISTINCT user_id) FROM pg_temp._kpi_actividad WHERE dia BETWEEN v_desde_prev AND v_desde - 1),
    'lecciones_total', (SELECT count(*) FROM pg_temp._kpi_lecciones),
    'lecciones_periodo', (SELECT count(*) FROM pg_temp._kpi_lecciones WHERE dia BETWEEN v_desde AND v_hoy),
    'lecciones_periodo_prev', (SELECT count(*) FROM pg_temp._kpi_lecciones WHERE dia BETWEEN v_desde_prev AND v_desde - 1),
    'nivel1_completado', (SELECT count(*) FROM pg_temp._kpi_niveles_ok WHERE nivel_id = v_nivel1),
    'xp_total', (SELECT coalesce(sum(st.puntos_experiencia), 0) FROM public.user_stats st JOIN pg_temp._kpi_usuarios u ON u.id = st.user_id),
    'con_racha', (SELECT count(*) FROM public.user_stats st JOIN pg_temp._kpi_usuarios u ON u.id = st.user_id
                  WHERE coalesce(st.racha_actual, 0) > 0 AND public.fecha_o_null(st.ultima_fecha_practica::text) >= v_hoy - 1),
    'racha_promedio', (SELECT round(avg(st.racha_actual)::numeric, 1) FROM public.user_stats st JOIN pg_temp._kpi_usuarios u ON u.id = st.user_id
                       WHERE coalesce(st.racha_actual, 0) > 0 AND public.fecha_o_null(st.ultima_fecha_practica::text) >= v_hoy - 1),
    'racha_maxima', (SELECT coalesce(max(st.max_racha), 0) FROM public.user_stats st JOIN pg_temp._kpi_usuarios u ON u.id = st.user_id),
    'logros_periodo', (SELECT count(*) FROM public.usuario_logros ul JOIN pg_temp._kpi_usuarios u ON u.id = ul.user_id
                       WHERE public.dia_chile(ul.fecha_obtenido) BETWEEN v_desde AND v_hoy),
    'seguimientos', (SELECT count(*) FROM public.follows f JOIN pg_temp._kpi_usuarios u ON u.id = f.follower_id),
    'quiz', (SELECT jsonb_build_object('intentos', count(*), 'correctos', count(*) FILTER (WHERE i.correcto))
             FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
             WHERE i.score_similitud IS NULL AND public.dia_chile(i.created_at) BETWEEN v_desde AND v_hoy),
    'quiz_prev', (SELECT jsonb_build_object('intentos', count(*), 'correctos', count(*) FILTER (WHERE i.correcto))
                  FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
                  WHERE i.score_similitud IS NULL AND public.dia_chile(i.created_at) BETWEEN v_desde_prev AND v_desde - 1),
    'camara', (SELECT jsonb_build_object('intentos', count(*), 'aprobados', count(*) FILTER (WHERE i.correcto),
                                         'personas', count(DISTINCT i.user_id))
               FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
               WHERE i.score_similitud IS NOT NULL AND public.dia_chile(i.created_at) BETWEEN v_desde AND v_hoy),
    'camara_prev', (SELECT jsonb_build_object('intentos', count(*), 'aprobados', count(*) FILTER (WHERE i.correcto))
                    FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
                    WHERE i.score_similitud IS NOT NULL AND public.dia_chile(i.created_at) BETWEEN v_desde_prev AND v_desde - 1)
  ) INTO v_resumen;

  -- ---- Serie diaria del período ----
  WITH dias AS (SELECT generate_series(v_desde, v_hoy, interval '1 day')::date AS dia),
       nuevos AS (SELECT registro AS dia, count(*) AS n FROM pg_temp._kpi_usuarios GROUP BY 1),
       activos AS (SELECT dia, count(DISTINCT user_id) AS n FROM pg_temp._kpi_actividad GROUP BY 1),
       lecciones AS (SELECT dia, count(*) AS n FROM pg_temp._kpi_lecciones GROUP BY 1),
       ejercicios AS (SELECT public.dia_chile(i.created_at) AS dia, count(*) AS n
                      FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
                      WHERE i.created_at >= (v_desde - 1)::timestamptz
                      GROUP BY 1)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'dia', d.dia,
           'nuevos', coalesce(nu.n, 0),
           'activos', coalesce(ac.n, 0),
           'lecciones', coalesce(le.n, 0),
           'ejercicios', coalesce(ej.n, 0)
         ) ORDER BY d.dia), '[]'::jsonb)
  INTO v_serie
  FROM dias d
  LEFT JOIN nuevos nu ON nu.dia = d.dia
  LEFT JOIN activos ac ON ac.dia = d.dia
  LEFT JOIN lecciones le ON le.dia = d.dia
  LEFT JOIN ejercicios ej ON ej.dia = d.dia;

  -- ---- Embudo (usuarios registrados en el período) ----
  WITH cohorte AS (SELECT id FROM pg_temp._kpi_usuarios WHERE registro BETWEEN v_desde AND v_hoy),
       lecciones_por_usuario AS (SELECT user_id, count(*) AS n FROM pg_temp._kpi_lecciones GROUP BY user_id)
  SELECT jsonb_build_array(
    jsonb_build_object('etapa', 'Se registraron', 'usuarios', (SELECT count(*) FROM cohorte)),
    jsonb_build_object('etapa', 'Hicieron su primer ejercicio', 'usuarios',
      (SELECT count(*) FROM cohorte c WHERE EXISTS (SELECT 1 FROM pg_temp._kpi_actividad a WHERE a.user_id = c.id))),
    jsonb_build_object('etapa', 'Completaron 1 lección', 'usuarios',
      (SELECT count(*) FROM cohorte c JOIN lecciones_por_usuario l ON l.user_id = c.id WHERE l.n >= 1)),
    jsonb_build_object('etapa', 'Completaron 3 lecciones', 'usuarios',
      (SELECT count(*) FROM cohorte c JOIN lecciones_por_usuario l ON l.user_id = c.id WHERE l.n >= 3)),
    jsonb_build_object('etapa', 'Terminaron el nivel 1', 'usuarios',
      (SELECT count(*) FROM cohorte c JOIN pg_temp._kpi_niveles_ok n ON n.user_id = c.id AND n.nivel_id = v_nivel1)),
    jsonb_build_object('etapa', 'Terminaron el nivel 2', 'usuarios',
      (SELECT count(*) FROM cohorte c JOIN pg_temp._kpi_niveles_ok n ON n.user_id = c.id AND n.nivel_id = v_nivel2))
  ) INTO v_embudo;

  -- ---- Progreso por nivel y subnivel (usuarios registrados en el período) ----
  WITH cohorte AS (SELECT id FROM pg_temp._kpi_usuarios WHERE registro BETWEEN v_desde AND v_hoy)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'numero', n.numero_nivel, 'nombre', n.nombre, 'color', n.color,
           'completaron', (SELECT count(*) FROM pg_temp._kpi_niveles_ok k JOIN cohorte c ON c.id = k.user_id WHERE k.nivel_id = n.id),
           'subniveles', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                             'id', s.id, 'numero', s.numero_subnivel, 'nombre', s.nombre, 'con_contenido', s.con_contenido,
                             'completaron', (SELECT count(*) FROM pg_temp._kpi_lecciones l JOIN cohorte c ON c.id = l.user_id
                                             WHERE l.subnivel_id = s.id)
                           ) ORDER BY s.numero_subnivel), '[]'::jsonb)
                          FROM pg_temp._kpi_subniveles s WHERE s.nivel_id = n.id)
         ) ORDER BY n.numero_nivel), '[]'::jsonb)
  INTO v_niveles
  FROM public.niveles n;

  -- ---- Retención: cohortes semanales (hasta 8) y D1 / D7 / D30 ----
  WITH semanas AS (
         SELECT date_trunc('week', registro::timestamp)::date AS semana, id
         FROM pg_temp._kpi_usuarios
         WHERE registro BETWEEN greatest(v_desde, date_trunc('week', v_hoy::timestamp)::date - 7 * 7) AND v_hoy
       ),
       cohortes AS (SELECT semana, count(*) AS usuarios FROM semanas GROUP BY semana)
  SELECT jsonb_build_object(
    'cohortes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'semana', c.semana, 'usuarios', c.usuarios,
               'semanas', (SELECT jsonb_agg(
                             CASE WHEN c.semana + 7 * k > v_hoy THEN NULL
                                  ELSE round(100.0 * (SELECT count(DISTINCT s.id) FROM semanas s
                                                      JOIN pg_temp._kpi_actividad a ON a.user_id = s.id
                                                      WHERE s.semana = c.semana
                                                        AND a.dia BETWEEN c.semana + 7 * k AND c.semana + 7 * k + 6) / c.usuarios, 1)
                             END ORDER BY k)
                           FROM generate_series(0, 7) k)
             ) ORDER BY c.semana)
      FROM cohortes c), '[]'::jsonb),
    'd1', (SELECT jsonb_build_object('elegibles', count(*), 'volvieron',
                    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_temp._kpi_actividad a WHERE a.user_id = u.id AND a.dia = u.registro + 1)))
           FROM pg_temp._kpi_usuarios u WHERE u.registro BETWEEN v_desde AND v_hoy - 1),
    'd7', (SELECT jsonb_build_object('elegibles', count(*), 'volvieron',
                    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_temp._kpi_actividad a WHERE a.user_id = u.id
                                                   AND a.dia BETWEEN u.registro + 7 AND u.registro + 13)))
           FROM pg_temp._kpi_usuarios u WHERE u.registro BETWEEN v_desde AND v_hoy - 13),
    'd30', (SELECT jsonb_build_object('elegibles', count(*), 'volvieron',
                     count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_temp._kpi_actividad a WHERE a.user_id = u.id
                                                    AND a.dia BETWEEN u.registro + 28 AND u.registro + 34)))
            FROM pg_temp._kpi_usuarios u WHERE u.registro BETWEEN v_desde AND v_hoy - 34)
  ) INTO v_retencion;

  -- ---- Hábitos: ejercicios por día de la semana (1 = lunes) y hora ----
  SELECT coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'n', n)), '[]'::jsonb)
  INTO v_habitos
  FROM (
    SELECT extract(isodow FROM i.created_at::timestamptz AT TIME ZONE 'America/Santiago')::int AS dow,
           extract(hour FROM i.created_at::timestamptz AT TIME ZONE 'America/Santiago')::int AS hora,
           count(*) AS n
    FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
    WHERE public.dia_chile(i.created_at) BETWEEN v_desde AND v_hoy
    GROUP BY 1, 2
  ) h;

  -- ---- Señas: práctica, aciertos del quiz y aprobación con cámara en el período ----
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', se.id, 'palabra', se.palabra, 'nivel', n.numero_nivel,
           'quiz_intentos', coalesce(x.quiz_intentos, 0), 'quiz_correctos', coalesce(x.quiz_correctos, 0),
           'cam_intentos', coalesce(x.cam_intentos, 0), 'cam_aprobados', coalesce(x.cam_aprobados, 0)
         ) ORDER BY coalesce(x.quiz_intentos, 0) + coalesce(x.cam_intentos, 0) DESC, se.palabra), '[]'::jsonb)
  INTO v_senas
  FROM public.senas se
  LEFT JOIN public.subniveles s ON s.id = se.subnivel_id
  LEFT JOIN public.niveles n ON n.id = s.nivel_id
  LEFT JOIN (
    SELECT i.sena_id,
           count(*) FILTER (WHERE i.score_similitud IS NULL) AS quiz_intentos,
           count(*) FILTER (WHERE i.score_similitud IS NULL AND i.correcto) AS quiz_correctos,
           count(*) FILTER (WHERE i.score_similitud IS NOT NULL) AS cam_intentos,
           count(*) FILTER (WHERE i.score_similitud IS NOT NULL AND i.correcto) AS cam_aprobados
    FROM public.intentos_ejercicio i JOIN pg_temp._kpi_usuarios u ON u.id = i.user_id
    WHERE public.dia_chile(i.created_at) BETWEEN v_desde AND v_hoy
    GROUP BY i.sena_id
  ) x ON x.sena_id = se.id
  WHERE se.video_url IS NOT NULL OR x.sena_id IS NOT NULL;

  -- ---- Rachas actuales (foto de hoy) ----
  WITH r AS (
    SELECT CASE WHEN coalesce(st.racha_actual, 0) > 0 AND public.fecha_o_null(st.ultima_fecha_practica::text) >= v_hoy - 1
                THEN st.racha_actual ELSE 0 END AS racha
    FROM pg_temp._kpi_usuarios u LEFT JOIN public.user_stats st ON st.user_id = u.id
  )
  SELECT jsonb_build_array(
    jsonb_build_object('rango', 'Sin racha', 'usuarios', count(*) FILTER (WHERE racha = 0)),
    jsonb_build_object('rango', '1–2 días', 'usuarios', count(*) FILTER (WHERE racha BETWEEN 1 AND 2)),
    jsonb_build_object('rango', '3–6 días', 'usuarios', count(*) FILTER (WHERE racha BETWEEN 3 AND 6)),
    jsonb_build_object('rango', '7–13 días', 'usuarios', count(*) FILTER (WHERE racha BETWEEN 7 AND 13)),
    jsonb_build_object('rango', '14–29 días', 'usuarios', count(*) FILTER (WHERE racha BETWEEN 14 AND 29)),
    jsonb_build_object('rango', '30+ días', 'usuarios', count(*) FILTER (WHERE racha >= 30))
  ) INTO v_rachas FROM r;

  -- ---- Top 10 por XP ----
  SELECT coalesce(jsonb_agg(t ORDER BY t.xp DESC, t.nombre), '[]'::jsonb) INTO v_top
  FROM (
    SELECT u.nombre,
           coalesce(st.puntos_experiencia, 0) AS xp,
           CASE WHEN coalesce(st.racha_actual, 0) > 0 AND public.fecha_o_null(st.ultima_fecha_practica::text) >= v_hoy - 1 THEN st.racha_actual ELSE 0 END AS racha,
           coalesce(st.max_racha, 0) AS max_racha,
           (SELECT count(*) FROM pg_temp._kpi_lecciones l WHERE l.user_id = u.id) AS lecciones,
           (SELECT max(a.dia) FROM pg_temp._kpi_actividad a WHERE a.user_id = u.id) AS ultima_actividad
    FROM pg_temp._kpi_usuarios u
    LEFT JOIN public.user_stats st ON st.user_id = u.id
    ORDER BY coalesce(st.puntos_experiencia, 0) DESC, u.nombre
    LIMIT 10
  ) t;

  -- ---- Dataset de señas (para el modelo de IA) ----
  SELECT jsonb_build_object(
    'muestras', count(*),
    'muestras_periodo', count(*) FILTER (WHERE public.dia_chile(m.created_at) BETWEEN v_desde AND v_hoy),
    'senas', count(DISTINCT m.sena_id),
    'personas', count(DISTINCT coalesce(lower(nullif(trim(m.participante), '')), m.autor_id::text))
  ) INTO v_dataset
  FROM public.muestras_sena m;

  -- ---- Contenido publicado ----
  SELECT jsonb_build_object(
    'niveles', (SELECT count(*) FROM public.niveles),
    'subniveles', (SELECT count(*) FROM pg_temp._kpi_subniveles),
    'subniveles_con_contenido', (SELECT count(*) FROM pg_temp._kpi_subniveles WHERE con_contenido),
    'senas', (SELECT count(*) FROM public.senas),
    'senas_con_video', (SELECT count(*) FROM public.senas WHERE video_url IS NOT NULL)
  ) INTO v_contenido;

  RETURN jsonb_build_object(
    'generado', now(),
    'hoy', v_hoy,
    'desde', v_desde,
    'dias', v_dias,
    'excluye_admins', p_excluir_admins,
    'resumen', v_resumen,
    'serie', v_serie,
    'embudo', v_embudo,
    'niveles', v_niveles,
    'retencion', v_retencion,
    'habitos', v_habitos,
    'senas', v_senas,
    'rachas', v_rachas,
    'top', v_top,
    'dataset', v_dataset,
    'contenido', v_contenido
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_kpis(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_kpis(int, boolean) TO authenticated;
