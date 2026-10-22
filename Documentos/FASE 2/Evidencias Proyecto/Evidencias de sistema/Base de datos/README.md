# Evidencias de sistema – Base de datos Signy

La base de datos es PostgreSQL gestionado por Supabase. El esquema evoluciona mediante migraciones versionadas en `/supabase/migrations`, y la lógica que no debe ejecutarse en el cliente está en `/supabase/functions` (Edge Functions `password-reset` y `delete-account`).

`Modelo de datos SIGNY.jpg` muestra las entidades principales: `profiles`, `user_stats`, `niveles`, `subniveles`, `senas`, `progreso_nivel_usuario`, `progreso_subnivel_usuario`, `intentos_ejercicio`, `practica_fallos`, `logros`, `usuario_logros` y `muestras_sena`.

## Migraciones versionadas (9)

| Migración | Propósito |
|---|---|
| `20260823225728_password_reset_codes.sql` | Códigos temporales para recuperar la contraseña (solo accesibles desde la Edge Function) |
| `20260907070000_proteger_es_admin.sql` | Impide que un usuario se otorgue privilegios de administrador con un UPDATE directo |
| `20260907090000_fix_racha_historial_unique.sql` | Restricción única para que el historial de racha se guarde correctamente |
| `20260907110000_backfill_logros.sql` | Otorga logros retroactivos a usuarios que ya cumplían las condiciones |
| `20260907130000_ranking_stats_seguidos.sql` | Política RLS adicional para el ranking entre amigos |
| `20260908040000_tienda_congeladores.sql` | Compra y regalo de congeladores de racha con XP |
| `20260919000000_endurecer_completar_leccion.sql` | Valida en el servidor la finalización de lecciones y el XP ganado |
| `20260919010000_xp_repaso.sql` | XP reducido al repetir una lección ya completada |
| `20261004120000_dataset_muestras_sena.sql` | Tabla `muestras_sena` (solo coordenadas de las manos, RLS solo para administradores) |
