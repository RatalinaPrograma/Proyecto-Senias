-- El código guarda en racha_historial con:
--   .upsert({ user_id, fecha, estado }, { onConflict: 'user_id,fecha' })
-- pero la tabla nunca tuvo una restricción única sobre (user_id, fecha) --
-- solo su PRIMARY KEY (id). Sin esa restricción, Postgres no tiene cómo
-- resolver el "ON CONFLICT" y el upsert falla en cada llamada. El error
-- se atrapa y solo se registra en consola (nunca rompe el guardado de la
-- racha en sí, que vive aparte en user_stats), así que probablemente
-- nunca se haya guardado una fila con éxito en esta tabla.
--
-- Esto explica por qué el calendario de racha en Perfil y la tira semanal
-- de la pantalla de racha activada pueden haberse visto vacíos o
-- incompletos: no es un bug de la UI, es que no había filas que leer.

-- 1) Por si acaso ya hay duplicados (mismo user_id + fecha) de algún otro
--    intento de escritura anterior, nos quedamos con la fila más reciente
--    de cada grupo y borramos el resto -- si no hay duplicados, esto no
--    borra nada.
DELETE FROM public.racha_historial a
USING public.racha_historial b
WHERE a.user_id = b.user_id
  AND a.fecha = b.fecha
  AND a.id < b.id;

-- 2) La restricción que el código siempre asumió que existía.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'racha_historial_user_fecha_key'
  ) THEN
    ALTER TABLE public.racha_historial
      ADD CONSTRAINT racha_historial_user_fecha_key UNIQUE (user_id, fecha);
  END IF;
END $$;
