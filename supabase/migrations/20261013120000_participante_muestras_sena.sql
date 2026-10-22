-- Persona que hace la seña en cada muestra del dataset.
--
-- Por qué hace falta: hasta ahora la "persona" de una muestra era la
-- cuenta admin que la grabó (`autor_id`). Pero lo normal es que UNA cuenta
-- admin grabe a VARIAS personas (compañeros, profesores, personas sordas
-- que colaboran) con el mismo celular. Así, todas sus muestras contaban
-- como una sola persona y `ml/entrenar.py` no podía medir la precisión con
-- personas que el modelo nunca vio, que es lo que de verdad importa en la app.
--
-- `participante` es un apodo o iniciales que escribe el admin al grabar
-- (ej. "Cata", "BV"). No hace falta el nombre real: al exportar o descargar
-- el dataset se reemplaza por p1, p2, … Si queda vacío (NULL), se usa la
-- cuenta que grabó, como antes.
--
-- Es seguro correr esta migración más de una vez. Requiere haber corrido
-- antes 20261004120000_dataset_muestras_sena.sql.

ALTER TABLE public.muestras_sena
  ADD COLUMN IF NOT EXISTS participante text
  CHECK (participante IS NULL OR char_length(participante) BETWEEN 1 AND 40);

COMMENT ON COLUMN public.muestras_sena.participante IS
  'Apodo o iniciales de quien hace la seña (NULL = la cuenta que grabó). Se anonimiza como p1, p2, … al exportar.';
