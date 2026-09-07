-- Evita que un usuario se auto-otorgue (o le quite a otro) el privilegio
-- de administrador mandando un UPDATE directo a la tabla `profiles`.
--
-- Por qué hace falta esto: las políticas RLS de Supabase se evalúan por
-- FILA ("¿puede este usuario tocar esta fila?"), no por columna. Si la
-- política de UPDATE en `profiles` es del estilo "el usuario puede
-- actualizar su propia fila" (lo normal, para que pueda cambiar su nombre
-- o su avatar), esa misma política también permite, sin querer, que
-- mande junto con esos cambios un `es_admin: true` -- la app de Angular
-- nunca construye una llamada así (upsertProfile ni siquiera acepta ese
-- campo en su tipo), pero eso no protege nada si alguien llama a la API
-- REST de Supabase directamente con su propio token, sin pasar por la app.
--
-- Este trigger cierra esa puerta a nivel de base de datos: si el cambio
-- viene de un usuario autenticado normal (auth.role() = 'authenticated' --
-- exactamente el caso de alguien pegándole a la API REST con su propio
-- token), el trigger ignora ese cambio en particular a `es_admin` y deja
-- pasar el resto del UPDATE sin problema (cambiar tu nombre o tu avatar
-- sigue funcionando exactamente igual). Para cualquier otro camino --
-- editar la fila a mano en el Table Editor de Supabase, correr un UPDATE
-- desde el SQL Editor, la service role, una migración -- `auth.role()` no
-- devuelve 'authenticated' (no hay ningún JWT de por medio), así que el
-- trigger no toca nada: la forma en que hoy le das admin a alguien
-- (entrar a la tabla `profiles` y poner `es_admin = true` a mano) sigue
-- funcionando exactamente igual que antes.
--
-- A propósito NO se bloquea "todo lo que no sea service_role" (una
-- condición más amplia hubiera sido más fácil de escribir, pero también
-- más fácil de que bloqueara sin querer algún otro camino administrativo
-- legítimo que no se haya contemplado acá). Se bloquea puntualmente el
-- único caso que en verdad es el problema.
--
-- Es seguro correr esto aunque la política de RLS actual ya sea correcta:
-- en ese caso este trigger no cambia nada, solo agrega una segunda capa
-- de protección. Y es seguro volver a correr esta migración más de una
-- vez (usa CREATE OR REPLACE / DROP...IF EXISTS en todo).

CREATE OR REPLACE FUNCTION public.proteger_es_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.es_admin IS DISTINCT FROM OLD.es_admin AND auth.role() = 'authenticated' THEN
    NEW.es_admin := OLD.es_admin;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_proteger_es_admin ON public.profiles;

CREATE TRIGGER trigger_proteger_es_admin
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_es_admin();
