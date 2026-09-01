-- supabase/migrations/20260831184000_storage_auto_pack_trigger.sql
--
-- Trigger automático para Supabase Storage:
-- Cada vez que se inserta o actualiza una seña (.webp, .gif, .mp4) en el bucket 'senas-media' o 'senas',
-- se dispara asíncronamente la Edge Function 'generate-master-pack' a través de la extensión pg_net.
-- Así, cualquier seña subida desde el Dashboard de Supabase se empaqueta sola en 'signy_master_v1.zip'.

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_generate_master_pack()
returns trigger
language plpgsql
security definer
as $$
declare
  project_url text := 'https://bjxcdhtigbsbibcltnup.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; -- Reemplazado automáticamente en Supabase
begin
  -- Solo reaccionar a archivos de señas (ignorar el propio signy_master_v1.zip para evitar bucles infinitos)
  if (NEW.bucket_id in ('senas', 'senas-media') and NEW.name not like '%.zip') then
    perform net.http_post(
      url := project_url || '/functions/v1/generate-master-pack',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object(
        'event', TG_OP,
        'bucket_id', NEW.bucket_id,
        'file_name', NEW.name
      )
    );
  end if;
  return NEW;
end;
$$;

-- Crear el trigger en la tabla de objetos de Supabase Storage
drop trigger if exists on_sena_uploaded_generate_pack on storage.objects;

create trigger on_sena_uploaded_generate_pack
after insert or update on storage.objects
for each row
execute function public.trigger_generate_master_pack();

