-- Logros retroactivos ("backlog" de logros pendientes).
--
-- Por qué hace falta: los logros de racha y lecciones se revisan con un
-- ">=" cada vez que el usuario practica, así que se autocorrigen solos en
-- la siguiente lección. Pero "congelador" y "nivel_completado" solo se
-- revisan en el momento EXACTO en que algo cambia (ganar un congelador
-- nuevo, terminar la última lección de un nivel) -- alguien que ya tenía
-- un congelador guardado, o que ya había completado un nivel entero ANTES
-- de que este sistema existiera, nunca lo iba a recibir con solo seguir
-- usando la app normalmente. Este script mira el estado actual de cada
-- usuario y entrega los logros que ya le corresponden por lo que hizo en
-- el pasado.
--
-- Seguro de correr más de una vez: usa ON CONFLICT DO NOTHING en todos
-- los inserts, apoyado en la primary key compuesta (user_id, logro_id)
-- que ya tiene usuario_logros.

-- Primeros pasos / Explorador / Maestro de manos -- por cantidad de
-- lecciones (subniveles) completadas.
WITH conteo_lecciones AS (
  SELECT user_id, COUNT(*) AS total
  FROM progreso_subnivel_usuario
  WHERE completado = true
  GROUP BY user_id
)
INSERT INTO usuario_logros (user_id, logro_id)
SELECT c.user_id, l.id
FROM conteo_lecciones c
JOIN logros l ON l.codigo = 'primera_leccion'
WHERE c.total >= 1
ON CONFLICT (user_id, logro_id) DO NOTHING;

WITH conteo_lecciones AS (
  SELECT user_id, COUNT(*) AS total
  FROM progreso_subnivel_usuario
  WHERE completado = true
  GROUP BY user_id
)
INSERT INTO usuario_logros (user_id, logro_id)
SELECT c.user_id, l.id
FROM conteo_lecciones c
JOIN logros l ON l.codigo = 'diez_lecciones'
WHERE c.total >= 10
ON CONFLICT (user_id, logro_id) DO NOTHING;

WITH conteo_lecciones AS (
  SELECT user_id, COUNT(*) AS total
  FROM progreso_subnivel_usuario
  WHERE completado = true
  GROUP BY user_id
)
INSERT INTO usuario_logros (user_id, logro_id)
SELECT c.user_id, l.id
FROM conteo_lecciones c
JOIN logros l ON l.codigo = 'cincuenta_lecciones'
WHERE c.total >= 50
ON CONFLICT (user_id, logro_id) DO NOTHING;

-- Una semana firme / Un mes imparable / Leyenda de la racha -- se usa
-- max_racha (la racha más alta que alguna vez tuvo), no racha_actual: la
-- intención del logro es "en algún momento llegaste a...", no "hoy tienes
-- que seguir teniéndola viva".
INSERT INTO usuario_logros (user_id, logro_id)
SELECT us.user_id, l.id
FROM user_stats us
JOIN logros l ON l.codigo = 'racha_7'
WHERE us.max_racha >= 7
ON CONFLICT (user_id, logro_id) DO NOTHING;

INSERT INTO usuario_logros (user_id, logro_id)
SELECT us.user_id, l.id
FROM user_stats us
JOIN logros l ON l.codigo = 'racha_30'
WHERE us.max_racha >= 30
ON CONFLICT (user_id, logro_id) DO NOTHING;

INSERT INTO usuario_logros (user_id, logro_id)
SELECT us.user_id, l.id
FROM user_stats us
JOIN logros l ON l.codigo = 'racha_100'
WHERE us.max_racha >= 100
ON CONFLICT (user_id, logro_id) DO NOTHING;

-- Prevenido -- si hoy tiene 1 o más congeladores guardados, en algún
-- momento ganó al menos uno.
INSERT INTO usuario_logros (user_id, logro_id)
SELECT us.user_id, l.id
FROM user_stats us
JOIN logros l ON l.codigo = 'congelador'
WHERE us.racha_congeladores >= 1
ON CONFLICT (user_id, logro_id) DO NOTHING;

-- Nivel superado -- si ya tiene al menos un nivel marcado como
-- completado.
INSERT INTO usuario_logros (user_id, logro_id)
SELECT DISTINCT pnu.user_id, l.id
FROM progreso_nivel_usuario pnu
JOIN logros l ON l.codigo = 'nivel_completado'
WHERE pnu.completado = true
ON CONFLICT (user_id, logro_id) DO NOTHING;

-- Manos a la obra (práctica con cámara) -- intentos_ejercicio junta
-- filas del quiz Y de la cámara en la misma tabla, sin una columna que
-- diga de cuál vino cada una. La única forma de distinguirlas con los
-- datos que ya existen: la cámara SIEMPRE manda un score_similitud (aunque
-- sea 0), y el quiz nunca manda ninguno (queda NULL). Por eso el filtro
-- de acá abajo -- si algún día se agrega una columna de origen, esto se
-- puede simplificar.
INSERT INTO usuario_logros (user_id, logro_id)
SELECT DISTINCT ie.user_id, l.id
FROM intentos_ejercicio ie
JOIN logros l ON l.codigo = 'practica_camara'
WHERE ie.score_similitud IS NOT NULL
ON CONFLICT (user_id, logro_id) DO NOTHING;

-- Aparte, sin relación con el backfill: "logros" es la única tabla de
-- contenido (junto a niveles/subniveles/senas) que NO tenía una política
-- de escritura para admins -- hoy no rompe nada porque la app nunca
-- escribe logros desde el cliente (la siembra se corrió directo en el SQL
-- Editor, que no pasa por RLS), pero si en algún momento se arma un panel
-- de admin para editar logros desde la app, la va a necesitar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'logros' AND policyname = 'Admins pueden escribir logros'
  ) THEN
    CREATE POLICY "Admins pueden escribir logros"
      ON public.logros
      FOR ALL
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.es_admin = true));
  END IF;
END $$;
