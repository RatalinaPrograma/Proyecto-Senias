-- Códigos temporales de recuperación de contraseña (flujo EmailJS).
-- Sin políticas RLS a propósito: solo la service role key (usada por la
-- Edge Function password-reset) puede leer/escribir esta tabla.
create table if not exists public.password_reset_codes (
  email text primary key,
  code text not null,
  expires_at timestamptz not null,
  attempts int not null default 0
);

alter table public.password_reset_codes enable row level security;
