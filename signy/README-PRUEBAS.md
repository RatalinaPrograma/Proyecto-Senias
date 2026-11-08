# Pruebas unitarias de Signy

La app tiene **663 pruebas unitarias** (Jasmine + Karma, el mismo stack que trae
Angular de fábrica). Última ejecución: 08/11/2026, rama `v1` — 663 aprobadas,
1 omitida (`PracticaPage`, en cuarentena), 0 fallidas.

| Cobertura | Valor |
|---|---|
| Sentencias | 79,06 % (4114/5203) |
| Ramas | 64,15 % (1405/2190) |
| Funciones | 77,23 % (838/1085) |
| Líneas | 80,85 % (3671/4540) |

Las primeras 377 pruebas llegaron en la rama `pruebas-unitarias`; el resto se
agregó junto con cada funcionalidad nueva (reconocimiento de señas, AI Studio,
Dashboard de KPIs, retroalimentación de la cámara, etc.).

## Cómo correrlas

```bash
cd signy
npm install   # si no lo hiciste después de bajar la rama
npm test
```

Se abre una ventana de Chrome real y corre todo. Tarda unos segundos.

## Qué se probó

| Área | Qué cubre |
|---|---|
| `ContenidoService` | Rachas, congeladores, vidas, XP, logros, ranking, avance de nivel — el corazón del negocio |
| `SupabaseService` | Sesión, perfiles, amigos/follows, subida de avatar, cambio de contraseña, borrado seguro de media |
| `NotificationsService` | Config, permisos, y los horarios límite de la alerta de racha en riesgo |
| `TtsService`, `ImageCacheService` | Caché de voz/preferencias, caché de medios en disco |
| Guards (`auth`, `guest`, `admin`, `lesson`) | Quién puede entrar a cada ruta |
| `LoginPage`, `RegisterPage` | Validación de formularios, 2FA |
| `HomePage`, `ProfilePage`, `SettingsPage`, `FriendsPage`, `OnboardingPage` | Carga de datos, tienda de congeladores, 2FA, eliminar cuenta, debounce de búsqueda |
| `LessonPage` | Las 4 fases de una lección completa: flashcards, emparejar, quiz **con repaso**, cámara, celebraciones de racha/nivel |
| `AdminVocabularioPage` | CRUD de niveles/subniveles/señas con sus reglas de duplicados |
| Componentes chicos (`RachaCalendar`, `SenaIcon`, `GifTile`, `CachedSrcDirective`) | Lógica visual pura |
| `motor-senas` | MediaPipe (con respaldo de GPU a CPU), captura y seguimiento de manos, características del clasificador, paridad con Python, retroalimentación al alumno por niveles (aprobación desde 75 %, felicitación al 100 %) y señas equivalentes (Hola y Chao) |
| `AdminAiStudioPage` | Grabación del dataset, participantes y avatar 3D de referencia |
| `AdminDashboardPage`, `kpis.ts` | Cálculo y presentación de los KPIs de uso |

Todo esto prueba la **lógica de cada archivo `.ts`** — no lo que se ve en
pantalla. Ningún test acá abre el HTML y revisa "¿aparece el botón?" — esa
es una capa distinta (tests de renderizado / e2e) que todavía no existe.

## Lo que NO está probado (a propósito, no por descuido)

- **`PracticaPage`**: está en cuarentena (`xdescribe`, no corre). Llama a 6
  métodos que no existen en `SupabaseService` y no está ruteada en la app —
  o sea, ya estaba rota antes de este trabajo. Hay que decidir si se arregla
  o se borra; cuando se decida, se reemplaza el placeholder por una spec de
  verdad.
- **Renderizado de HTML / interacción de UI**: como se dijo arriba, es una
  categoría aparte.

## El único cambio que toca código de la app (no solo tests)

Se agregó `signy/src/app/services/capacitor-plugins.ts`: tres adaptadores
chiquitos (`PreferencesAdapter`, `LocalNotificationsAdapter`,
`TextToSpeechAdapter`) que envuelven los plugins de Capacitor
(`Preferences`, `LocalNotifications`, `TextToSpeech`).

**Por qué hizo falta**: esos plugins son objetos `Proxy` — por diseño de
Capacitor, generan una función nueva cada vez que se accede a un método y
descartan cualquier intento de reemplazarlos. Eso significa que **no se
pueden mockear en un test** de ninguna forma (ni `spyOn`, ni asignación
directa) — no es un bug de Capacitor ni nuestro, es cómo está construida la
librería. Sin este adaptador, era imposible escribir un test real para
`NotificationsService`, `TtsService` o el tutorial de bienvenida.

Los adaptadores no cambian ningún comportamiento: cada método hace
exactamente lo mismo que el plugin real, solo que ahora Angular puede
inyectar una versión falsa en los tests. `notifications.ts`, `tts.ts` y
`onboarding.page.ts` ahora reciben el adaptador por inyección de
dependencias en vez de importar el plugin directo.

## También se corrigió (encontrado haciendo este trabajo, no relacionado a testing en sí)

Antes de este branch, `ng test` no compilaba ni un solo test por dos
motivos independientes, ya arreglados acá:

1. `tsconfig.spec.json` no incluía `polyfills.ts` ni `test.ts` en su
   `include` — hacía fallar la compilación de Karma desde el arranque.
2. `practica.page.ts` llama a métodos que no existen (ver arriba) — bastaba
   que ese archivo no compilara para que NINGÚN test corriera, aunque no
   tuviera nada que ver con lo que se estaba probando.

## Estructura

Los archivos de test viven al lado del archivo que prueban, con el sufijo
`.spec.ts` (es la convención estándar de Angular, ya la venía usando el
proyecto). No hay una carpeta separada de tests.

`signy/src/testing/supabase-mock.ts` es la única utilidad compartida: un
mock chico y reutilizable del cliente de Supabase para no repetir esa
lógica en cada archivo de test.
