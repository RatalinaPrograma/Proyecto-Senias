# 🧠 Signy · Machine learning de señas (TensorFlow / TFLite)

Entrena un clasificador de señas de LSCh con las grabaciones hechas en la propia app
(tabla `muestras_sena` de Supabase) y lo deja dentro de la app, liviano y funcionando sin internet.

```
 Entrenador del admin ──► tabla muestras_sena ──► python ml/entrenar.py ──► ml/output/ + assets/modelos/clasificador-senas.json
 (graba con la cámara)    (captura cruda)          (descarga, entrena, evalúa)
```

Las muestras se leen **siempre directo de Supabase**: no hay que exportar ni guardar archivos locales.

---

## 📐 Arquitectura del modelo

Red MLP de Keras:

* **Entrada:** características de la seña (las mismas que calcula la app: `signy_ml/caracteristicas.py` = `motor-senas/clasificador.ts`).
  Con la configuración por defecto (12 frames, con z) son 12 × 127 = 1524 valores, normalizados dentro del modelo.
* **Capa oculta 1:** 64 neuronas `ReLU` + Batch Normalization + Dropout (0.2).
* **Capa oculta 2:** 32 neuronas `ReLU`.
* **Salida:** N + 1 neuronas `Softmax`: una por seña con muestras y una para **"ninguna seña"** (`senaId` 0).

> El modelo de 64 entradas de `dev` (un solo frame) no servía en la app, que no calcula ese vector.
> Este pipeline usa las características que la app sí calcula (prueba de paridad incluida).

---

## 🚀 Requisitos e instalación

Python **3.10 a 3.13** (TensorFlow todavía no publica una versión estable para 3.14).
Desde la carpeta raíz del repo (`Proyecto-Senias`):

```bash
python -m pip install -r ml/requirements.txt
```

En Windows, si `python` no se reconoce, usar `py -3.12 -m pip install -r ml\requirements.txt`.

En Supabase → SQL Editor, correr una vez (en este orden; se pueden correr más de una vez sin problema):
1. `supabase/migrations/20261004120000_dataset_muestras_sena.sql` (tabla `muestras_sena`).
2. `supabase/migrations/20261013120000_participante_muestras_sena.sql` (columna `participante`).

Las cuentas que graben y entrenen tienen que ser admin (`profiles.es_admin = true`).

---

## 🎥 Grabar muestras

En **AI Studio → Catálogo**, abrir una seña y:

- **Grabar 5 seguidas al dataset** (modo ráfaga), o
- **Grabar seña** → hacerla → **Al dataset**, de a una. **Deshacer** borra una grabación mala.

Para que el modelo funcione con alumnos reales:

- **10 a 20 muestras por seña** como mínimo; más es mejor.
- **Varias personas** (ojalá 3 o más por seña), con una cantidad parecida de muestras cada una: el
  modelo aprende la seña, no a la persona. El modelo final se entrena con todas las muestras de
  todas las personas; además, el reporte mide aparte la precisión con personas que el modelo no vio.
- **Cambiar el campo "Persona" cada vez que se graba a alguien distinto.** Se recuerda entre
  señas (en ese dispositivo), y la cuenta atrás muestra a quién se está grabando. Si se deja
  vacío, la persona es la cuenta con que se entró: sirve si cada uno graba con su propia
  cuenta, pero si una cuenta graba a varias personas sin escribir el apodo, se cuentan como
  una sola y la medición con personas nuevas sale engañosa.
  No hace falta el nombre real: al descargar el dataset los apodos se reemplazan por `p1`, `p2`, …
  ("Cata" y "cata" son la misma persona).
- Variar un poco: distancia a la cámara, luz, velocidad, celular vertical y laptop.
- Si una grabación salió mal, **Deshacer** la borra.
- Las muestras son solo coordenadas de 21 puntos por mano: no se guardan imágenes ni video.
- **Toma de la cintura hacia arriba**: está bien. En las señas de una mano, la otra puede
  quedar visible descansando abajo; el modelo la ignora (si está quieta y bastante más abajo
  que la mano que hace la seña). Partir con las dos manos abajo y subir una está bien.
- **Velocidad natural, no brusca**: si la mano se mueve muy rápido la imagen sale borrosa
  y MediaPipe la pierde por un momento. Con buena luz de frente se pierde menos.
- **Duración**: la grabación dura 2, 3 o 4 s desde que se ven las manos. Para señas largas
  (por ejemplo de la cadera a la cabeza) usar **4 s**, así no se corta al final.

## 🔍 Revisar las grabaciones (solo lectura)

Al grabar no se puede ver cómo quedó cada muestra. Para eso:

```bash
python ml/revisar_dataset.py --supabase --email admin@correo.cl
```

Genera `ml/reportes/revision-<fecha>.html`. Ábrela con doble clic: cada muestra aparece
animada como esqueleto de las manos, con quién la grabó, cuándo, y avisos automáticos:

- 🟢 bien · 🟡 revisar la animación (puede servir) · 🔴 conviene volver a grabarla.
- Mano perdida por un rato (movimiento muy rápido o borroso), seña posiblemente cortada
  al final, poco movimiento en una seña dinámica, seña de 2 manos donde se vio 1.
- Perder la mano un momento **mientras sube desde la cintura o baja al reposo** es normal:
  sale solo como información, no en amarillo. Lo que importa es lo que pasa durante la seña.

El script **no cambia nada** en Supabase: solo lee. Si una muestra está mal, se puede borrar
en Supabase → SQL Editor con `delete from muestras_sena where id in (…);` usando los `#` de
la página (lo borrado no se recupera). Con `--guardar-datos archivo.json` se guarda lo
descargado y después se puede revisar sin conexión con `--datos archivo.json`.

Al entrenar, las muestras 🔴 se dejan fuera solas (con el mismo criterio de esta página) y se
avisa cuántas fueron; con `--incluir-rojas` se usan igual. Tampoco se borra nada en Supabase.

**Señas compuestas** (que cambian de cantidad de manos a mitad de camino, p. ej. empiezan con 1 y
pasan a 2): en el selector "Manos" del entrenador, elegir siempre la cantidad del **inicio** de la
seña, nunca la mayor — la grabación no empieza hasta detectar esa cantidad, así que con "2 manos"
se pierde el tramo inicial de 1 mano. El entrenador avisa si detecta esto (en vivo, mientras espera
para grabar, y después de grabar si la toma cambió de cantidad de manos). El clasificador de este
pipeline reconoce bien este tipo de señas porque calcula sus características cuadro a cuadro (cada
cuadro lleva su propia mano B o ceros, con una bandera de presencia) — conviene juntar varias
muestras "Al dataset" de este tipo de señas y entrenar.

---

## 🏋️‍♂️ Entrenar

```bash
python ml/entrenar.py
```

Abre un menú:

| Opción | Qué hace |
|---|---|
| 1 · Ver muestras de Supabase | Tabla de muestras y personas por seña, sin las 🔴 (en amarillo, las que faltan) |
| 2 · Volver a descargar | Refresca las muestras (se descargan una vez por sesión) |
| 3 · Entrenar y actualizar el modelo de la app | Entrena, escribe `ml/output/` y actualiza la app (solo si la exactitud alcanza el mínimo: ver abajo) |
| 4 · Entrenar de prueba | Igual, pero en `ml/reportes/prueba/` sin tocar la app |
| 5 · Comparar configuraciones | Mide la configuración actual contra 8 frames, sin z, red chica, sin aumentación y sin clase "ninguna"; no guarda modelo |
| 6 · Demo con datos sintéticos | Prueba el pipeline sin datos reales (no sirve para la app) |

Correo y contraseña de admin se piden una sola vez por sesión y no se guardan
(la contraseña también se puede pasar en `SIGNY_PASSWORD`).

Sin menú (automatizable):

```bash
python ml/entrenar.py --supabase --email admin@correo.cl
```

Opciones (también aplican al menú): `--epocas 60`, `--frames 12`, `--sin-z`, `--capas 64,32`,
`--aumentos 10`, `--precision 0.95`, `--umbral 0.6`, `--sin-ninguna`, `--incluir-rojas`, `--sin-personas`,
`--salida carpeta/` (no reemplaza el modelo de la app).

**El modelo solo se instala en la app si su exactitud en prueba es de 70 % o más**, porque uno
peor aprobaría señas mal hechas (o rechazaría señas bien hechas). Si no llega:
- **En el menú**, muestra los números (exactitud, confusiones) y pregunta si instalarlo
  igual — la decisión queda en quien entrena, viendo el reporte completo.
- **Con `--supabase`** (sin menú), no se instala salvo que se pase `--forzar`; sin eso, se guarda
  como prueba en `ml/reportes/prueba/` y no toca la app ni `ml/output/`.

En Git Bash, `getpass` no puede pedir la contraseña: definir antes `export SIGNY_PASSWORD='...'`
(en PowerShell: `$env:SIGNY_PASSWORD='...'`).

Con pocas muestras el modelo igual se genera, pero el reporte dice "sin evaluación" hasta que haya
suficientes para separar una parte de prueba. Mientras se junta el dataset, usar la opción 4.

### Cómo se mide

Se aparta una partición de prueba al azar (estratificada por seña, cuando hay muestras suficientes).
Con esa exactitud se decide si el modelo se instala en la app. Ojo: la misma persona puede quedar en
entrenamiento y en prueba, y las grabaciones en ráfaga de una persona se parecen mucho entre sí, así
que este número suele salir más alto que con un alumno nuevo.

Por eso, con 3 o más personas, el reporte también mide **con personas nuevas**: cada persona se prueba
con un modelo entrenado sin ella, como si fuera un alumno que nunca grabó. Es el número que más se
parece a lo que pasa en la app. Una seña que grabó solo esa persona no se puede medir así (el modelo no
tiene de quién aprenderla): se cuenta aparte como "sin medir", porque es falta de grabaciones y no un
error del modelo. Esta medición **solo informa**: no cambia el modelo, el umbral ni el mínimo para
instalar. Agrega un entrenamiento por persona; para saltarla, `--sin-personas`.

El reporte trae además una tabla de umbrales con personas nuevas: cuántas señas bien hechas se
aprobarían con cada umbral y cuántas veces el modelo dijo otra seña con esa seguridad. Sirve para
elegir `--precision`/`--umbral` con datos y no a ojo.

Ninguna de estas rondas cambia lo que va a la app: **el modelo que va a la app se entrena con el
100 % de las muestras y personas**, sin apartar validación.

### Umbral y "ninguna seña"

Además de las señas, el modelo aprende la clase "ninguna seña" con movimientos armados empalmando el
comienzo de una seña con el final de otra (lo que pasa entre señas o cuando el alumno hace otra cosa).
El umbral de confianza ya no es fijo: se elige el más bajo (0.50 a 0.95) con el que, de lo que el modelo
acepta, acierta al menos `--precision` (95 %), contando como error aceptar un movimiento que no es seña.
Un umbral más alto rechaza más intentos dudosos; bajar `--precision` lo hace más permisivo.
La app no necesita cambios: el id 0 nunca coincide con la seña pedida.

---

## 📦 Salidas

En `ml/output/`:
1. `model.tflite` — modelo TensorFlow Lite para Android/iOS (incluye la normalización de la entrada).
2. `model_weights.json` — pesos para la inferencia en TypeScript de la app (BatchNorm fusionada, float16),
   más el **perfil de cada seña** (ver abajo).
3. `labels.json` — palabra de cada salida del modelo, en orden.

`model_weights.json` se copia a `signy/src/assets/modelos/clasificador-senas.json`, que es lo que carga
la app. Hacer commit del modelo y compilar la app. El reporte (muestras y personas por seña, precisión
por seña, medición con personas nuevas y confusiones más frecuentes) queda en `ml/reportes/`.

---

## 📱 Cómo lo usa la app

`ReconocedorSenasService` usa el clasificador entrenado (el modelo de este pipeline) si el archivo
existe y conoce la seña: la aprueba solo si la seña es su primera opción y supera el umbral. Si
todavía no la conoce (sin entrenar o sin suficientes muestras), cae a solo verificar que se vieron
las manos, sin evaluar si la seña está bien hecha — por eso conviene entrenar antes de publicar una
seña nueva a los alumnos.

Cuando la seña no se aprueba, la lección da una pista concreta para el siguiente intento (no se vio
la mano, fue muy rápido, faltó la segunda mano, se pareció más a otra seña…): ver
`motor-senas/retroalimentacion.ts`.

---

## ✅ Pruebas

- `python -m unittest discover -s ml/tests`: características (mano en reposo y señas compuestas),
  calidad de las grabaciones, perfil de cada seña, aumentación, validación del dataset, medición por persona, entrenamiento
  de punta a punta, **paridad `model.tflite` ↔ `model_weights.json`**, CLI y descarga desde Supabase
  (servidor simulado con login, RLS y personas anonimizadas).
- **Paridad Python ↔ app** (`clasificador.spec.ts`): si se cambia `signy_ml/caracteristicas.py` o
  `motor-senas/clasificador.ts`, cambiar ambos y regenerar el fixture: `python ml/generar_fixture_paridad.py`.

## Detalle técnico

- **Características** (`caracteristicas.py` = `clasificador.ts`): coordenadas isotrópicas (corrige la
  relación de aspecto de la cámara), seguimiento estable de las dos manos, remuestreo a N frames,
  centrado en la muñeca media y escalado por el tamaño de mano mediano; mano A + mano B (o ceros) +
  bandera de presencia. Un cuadro cuenta si se ve cualquiera de las dos manos (señas compuestas).
  La otra mano descansando abajo no cuenta como mano B (`mano_en_reposo` = `manoEnReposo`):
  se descarta si está quieta, queda al menos 1 tamaño de mano por debajo de donde ocurre la
  seña (el 10 % más alto del recorrido de la otra mano, porque lo normal es partir con las dos
  manos abajo) y la otra mano no la toca (si la toca en 3 frames o más, es la mano base de una
  seña de dos manos). Sin esto, el mismo gesto daba vectores distintos según si el alumno la
  mostraba o no, o si era zurdo.
  Desde este cambio el formato del modelo es la versión 2 (la app rechaza modelos v1).
- **Aumentación**: espejo (zurdos), giro de la mano ±23°, ángulo de cámara 3D ±29° (lados e inclinación),
  escalado ±35-40 %, traslación, proporciones de la mano (palma y cada dedo ±10 %), deformación temporal
  no lineal (seña más rápida o lenta en una parte que en otra), temblor, recorte de bordes, frames
  congelados (2-3 cuadros repetidos, simulando un frame dropeado) y frames en que MediaPipe pierde la
  mano. Cada 10 épocas se generan variantes nuevas, así el modelo ve unas 60 versiones distintas de
  cada muestra en vez de 10 fijas.
- **Exportación**: la BatchNorm se fusiona en la densa siguiente igual que lo hace TFLite; exportar solo
  las densas daría otro modelo. Una prueba verifica que el JSON y el `.tflite` dan las mismas probabilidades.
- **Perfil de cada seña** (`signy_ml/perfil.py` = `motor-senas/retroalimentacion.ts`): con las muestras de
  cada seña se calcula cómo se hace normalmente (mediana y dispersión): cuánto dura el movimiento, qué tan
  amplio es, si va con una o dos manos, qué tan juntas van y qué tan estirado va cada dedo. La app compara
  el intento del alumno con eso para decirle qué cambiar ("fue muy rápido", "junta un poco tus manos",
  "estira el índice"). Las mismas fórmulas en Python y en la app, verificadas por la prueba de paridad.
- **Formato del dataset**: ver el encabezado de `signy_ml/dataset.py`.
