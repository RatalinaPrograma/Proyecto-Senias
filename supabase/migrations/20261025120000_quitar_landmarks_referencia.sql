-- Se saca el motor de comparación DTW (referencia grabada por el admin): el
-- clasificador entrenado (ml/entrenar.py) es ahora la única fuente de
-- verdad, y siempre se entrena antes de publicar una seña nueva a alumnos.
alter table senas drop column if exists landmarks_referencia;
