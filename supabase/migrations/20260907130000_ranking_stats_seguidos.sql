-- Necesaria para el ranking entre amigos: hoy `user_stats` solo se puede
-- leer la fila propia (auth.uid() = user_id). Sin esto, cualquier consulta
-- que intente traer la racha/XP de alguien que sigues simplemente vuelve
-- vacía para esas filas (RLS filtra en silencio, no tira error), y el
-- ranking mostraría a todos en 0 salvo a ti mismo.
--
-- Es una política ADICIONAL (no reemplaza la que ya existía para tu
-- propia fila) -- Postgres combina políticas PERMISSIVE del mismo comando
-- con OR, así que esto solo agrega "también puedes ver la fila de alguien
-- si lo sigues", sin tocar nada de lo que ya funcionaba.
--
-- El seguimiento en Signy es asimétrico (como Instagram, no como
-- Facebook): si A sigue a B, A puede ver las stats de B con esto, pero B
-- no puede ver las de A a menos que B también lo siga. Es exactamente lo
-- que hace falta para "mi ranking de a quienes sigo".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_stats' AND policyname = 'usuarios ven stats de a quienes siguen'
  ) THEN
    CREATE POLICY "usuarios ven stats de a quienes siguen"
      ON public.user_stats
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.follows
          WHERE follows.follower_id = auth.uid()
            AND follows.followed_id = user_stats.user_id
        )
      );
  END IF;
END $$;
