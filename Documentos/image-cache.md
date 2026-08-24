# Caché de imágenes remotas (íconos y gifs de señas)

## 1. Migración de íconos a Supabase Storage
Se reemplazaron las referencias a `assets/img/login.png` y `assets/img/registro.png` por las URLs públicas del bucket `icons` en 6 archivos (13 usos): `login.page.html`, `register.page.html`, `recuperar.page.html` (×3), `home.page.html` (×2), `lesson.page.html` (×2), `onboarding.page.ts` (×4).

Después se borraron los PNG locales de `signy/src/assets/img/` (quedaban copias sin uso en `android/.../assets` y `www/`, que son build output y se regeneran solos).

## 2. Diagnóstico: por qué no cacheaba
Con `curl -I` a la URL del bucket se vio `Cache-Control: no-cache` — el navegador/WebView descargaba la imagen cada vez, sin importar cuánto código se pusiera encima.

Se buscó en todo el repo (`app`, `supabase/functions`, sin carpetas `scripts/`) cualquier `.upload()` al bucket `icons`: no existe. Los dos PNG se subieron manualmente por fuera del repo (Dashboard, consola, o un script suelto no versionado) — el único `.upload()` del código es `signy/src/app/services/supabase.ts:67`, y es para el bucket `avatars`, no `icons`.

## 3. Intento de arreglar el header en origen
Como el Dashboard no deja fijar `cache-control` al subir por UI, se armó un script Node de un solo uso (`reupload-icons.mjs`, ya borrado) que re-subía los PNG con `cacheControl: '31536000'` usando `@supabase/supabase-js` y la **secret key** (formato nuevo `sb_secret_...`, ya que el proyecto usa el sistema de keys nuevo, no el JWT legacy).

- Primer intento falló: `JWS Protected Header is invalid` → la key pegada no tenía el prefijo correcto.
- Corregido, el upload con `upsert: true` "funcionó" (devolvió OK) pero el header seguía en `no-cache`.
- Se probó borrar el objeto y subir limpio (sin upsert) — mismo resultado.
- Se probó con `curl` directo a la REST API de Storage, mandando `Cache-Control` como header HTTP real (no como opción del SDK) — mismo resultado.

**Conclusión:** no es el SDK ni la forma de subir. Supabase Storage fuerza `Cache-Control: no-cache` en todos los planes salvo que el proyecto tenga activado **Smart CDN caching** (addon). Es un límite de la infraestructura, no del código.

## 4. Solución: caché en la app (cliente)
Ya que el servidor no coopera, el caché se movió al WebView, usando la Cache Storage API del navegador (estándar web, sin dependencias nuevas — `@capacitor/filesystem` no estaba instalado y no hacía falta agregarlo).

**Archivos nuevos:**
- `signy/src/app/services/image-cache.ts` — `ImageCacheService.resolve(url)`: abre el cache `signy-images-v1`, si no tiene la URL la descarga (`cache.add`) y siempre devuelve un `blob:` URL local. Si algo falla (CORS, navegador viejo) cae de vuelta a la URL original.
- `signy/src/app/shared/cached-src.directive.ts` — directiva `[appCachedSrc]` para `<img>`: en cada cambio de input, resuelve la URL vía el servicio y la pone en `img.src`.

**Dónde se conectó** (import del directive en el `imports` del componente + cambio de `src`/`[src]` a `[appCachedSrc]` en el template):
- `auth/login`, `auth/register`, `auth/recuperar`, `home`, `onboarding` → las mascotas estáticas (login.png/registro.png).
- `lesson.page.html:56` y `:120` → los gifs reales de cada seña (`video_url` de la tabla `senas`), que es donde de verdad importa el ahorro de red porque se repiten en cada lección.

**Dejado fuera a propósito:** `home.page.html:22` (avatar del usuario) sigue con `[src]` normal — esa URL se sobrescribe cuando el usuario cambia de foto (mismo path, `upsert`), así que cachearla indefinidamente mostraría fotos viejas.

**Ajuste de tipos:** el input de la directiva se tipó `string | null | undefined` porque `video_url` puede ser `null` en la tabla `senas` (el `*ngIf` de al lado ya filtra ese caso en runtime, pero Angular con `strictTemplates` lo exige en el tipo).

## 5. Verificación
- `ng build` (development y production) — compila limpio; el AOT de Angular valida que cada `[appCachedSrc]` esté bien enlazado (si faltara el import en algún componente, el build habría fallado).
- `ng lint` — sin regresiones (la única regla que falla, `prefer-inject`, ya fallaba en casi todo el proyecto antes de este cambio).
- Se levantó el dev server real y se abrió con Chrome headless en `/auth/login`, `/auth/register`, `/auth/recuperar`, `/home`: cero errores de consola, y se confirmó en el DOM renderizado que el `<img>` termina con `src="blob:..."` — prueba de que la directiva sí intercepta la URL y sirve desde el caché.

## Cómo se usa de ahora en adelante
Para cualquier imagen remota estática nueva (otro ícono, un gif de seña agregado a otra pantalla):
```html
<img [appCachedSrc]="urlRemota">
```
en vez de `src="..."` o `[src]="..."`. No usar esto en imágenes cuya URL se reutiliza para contenido que cambia (como el avatar).
