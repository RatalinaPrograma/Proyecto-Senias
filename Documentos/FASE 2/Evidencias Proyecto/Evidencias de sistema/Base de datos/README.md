# Evidencias de sistema – Base de datos Signy

La base de datos es PostgreSQL gestionado por Supabase. Los scripts SQL que crean las funciones, los triggers y las políticas RLS están en `/supabase/migrations`, y la lógica que no debe ejecutarse en el cliente está en `/supabase/functions` (Edge Functions `password-reset` y `delete-account`).

La base tiene **16 tablas propias + `auth.users`**, todas con RLS. `Modelo de datos SIGNY.jpg` muestra las tablas con las que trabaja la app (todas menos `password_reset_codes`, que solo usa la Edge Function de recuperación de contraseña).

| Grupo | Tablas |
|---|---|
| Contenido | `niveles`, `subniveles`, `senas`, `logros` |
| Usuarios y comunidad | `profiles`, `follows`, `regalos_congelador`, `password_reset_codes` |
| Progreso y gamificación | `user_stats`, `racha_historial`, `progreso_nivel_usuario`, `progreso_subnivel_usuario`, `usuario_logros` |
| Práctica e IA | `intentos_ejercicio`, `practica_fallos`, `muestras_sena` (dataset: solo puntos de las manos, sin video) |

## Capturas (evidencia)

| Archivo | Qué muestra |
|---|---|
| `Capturas/01_supabase_tablas.png` | Las 16 tablas del esquema `public` en el Table Editor |
| `Capturas/02_supabase_edge_functions.png` | Edge Functions desplegadas: `delete-account` y `password-reset` (las usa la app) y `generate-master-pack` (prueba de la rama `dev`, la versión final no la usa) |
| `Capturas/03_supabase_storage.png` | Buckets de Storage: `icons`, `avatars` y `senas-media`, con sus políticas |

## Scripts SQL (12)

| Archivo | Propósito |
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
| `20261013120000_participante_muestras_sena.sql` | Guarda qué persona hizo la seña en cada muestra del dataset |
| `20261025120000_quitar_landmarks_referencia.sql` | Quita la referencia grabada de cada seña: el motor DTW se reemplazó por el clasificador entrenado |
| `20261027120000_dashboard_kpis.sql` | Función `admin_kpis` con los indicadores del Dashboard (solo para administradores) |
