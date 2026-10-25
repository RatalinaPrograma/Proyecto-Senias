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

En Supabase → SQL Editor, correr una vez (en este orden):
1. `supabase/migrations/20261004120000_dataset_muestras_sena.sql` (tabla `muestras_sena`).
2. `supabase/migrations/20261013120000_participante_muestras_sena.sql` (columna `participante`).

Las cuentas que graben y entrenen tienen que ser admin (`profiles.es_admin = true`).

---

## 🎥 Grabar muestras

En **AI Studio → Catálogo**, abrir una seña, escribir en **"Persona que hace la seña"** el apodo
o las iniciales de quien está frente a la cámara (ej. `Cata`, `BV`) y:

- **Grabar 5 seguidas al dataset** (modo ráfaga), o
- **Grabar seña** → hacerla → **Al dataset**, de a una. **Deshacer** borra una grabación mala.

Para que el modelo funcione con alumnos reales:

- **10 a 20 muestras por seña** como mínimo; más es mejor.
- **Varias personas** (ojalá 3 o más), cambiando el campo "Persona" cada vez. El reporte mide la
  precisión con personas que el modelo nunca vio. Al descargar, los apodos se anonimizan (`p1`, `p2`, …).
- Variar distancia a la cámara, luz, velocidad, celular vertical y laptop.
- Solo se guardan coordenadas de 21 puntos por mano: no imágenes ni video.

---

## 🏋️‍♂️ Entrenar

```bash
python ml/entrenar.py
```

Abre un menú:

| Opción | Qué hace |
|---|---|
| 1 · Ver muestras de Supabase | Tabla de muestras y personas por seña (en amarillo, las que faltan) |
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
`--aumentos 10`, `--precision 0.95`, `--umbral 0.6`, `--sin-ninguna`, `--salida carpeta/` (no reemplaza el modelo de la app).

**El modelo solo se instala en la app si su exactitud en prueba es de 80 % o más.** Si no llega
(o no hay datos para medirla), se guarda como prueba en `ml/reportes/prueba/` y no toca la app ni
`ml/output/`: un modelo malo en la app aprobaría señas mal hechas. `--forzar` lo instala igual.

En Git Bash, `getpass` no puede pedir la contraseña: definir antes `export SIGNY_PASSWORD='...'`
(en PowerShell: `$env:SIGNY_PASSWORD='...'`).

Con pocas muestras el modelo igual se genera, pero el reporte dice "sin evaluación" hasta que haya
suficientes para separar una parte de prueba. Mientras se junta el dataset, usar la opción 4.

### Cómo se mide

Con 3 o más personas se entrena **una vez por persona**, dejándola fuera, y se prueba con ella: cada
persona se mide como un alumno nuevo. El reporte da la exactitud promedio ± la variación entre personas
y la exactitud de cada una (la peor dice a quién o qué condición falta grabar). Con menos personas se usa
una partición al azar. Estas rondas solo miden: **el modelo que va a la app se entrena con el 100 % de
las muestras y personas**, sin apartar validación.

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
2. `model_weights.json` — pesos para la inferencia en TypeScript de la app (BatchNorm fusionada, float16).
3. `labels.json` — palabra de cada salida del modelo, en orden.

`model_weights.json` se copia a `signy/src/assets/modelos/clasificador-senas.json`, que es lo que carga
la app. Hacer commit del modelo y compilar la app. El reporte (muestras, precisión por seña, exactitud
por persona y confusiones más frecuentes) queda en `ml/reportes/`.

---

## 📱 Cómo lo usa la app

`ReconocedorSenasService` combina dos motores:

| Motor | Necesita | Cuándo decide |
|---|---|---|
| Referencia (DTW) | 1 grabación de la seña ("Usar como referencia") | siempre que exista |
| Clasificador entrenado | el modelo de este pipeline | si el archivo existe y conoce la seña |

La seña se aprueba si **cualquiera** de los dos la reconoce (el clasificador, solo si la seña es su
primera opción y supera el umbral).

---

## ✅ Pruebas

- `python -m unittest discover -s ml/tests`: características, aumentación, validación del dataset,
  partición de prueba por persona, entrenamiento de punta a punta, **paridad `model.tflite` ↔ `model_weights.json`**,
  CLI y descarga desde Supabase (servidor simulado con login y RLS).
- **Paridad Python ↔ app** (`clasificador.spec.ts`): si se cambia `signy_ml/caracteristicas.py` o
  `motor-senas/clasificador.ts`, cambiar ambos y regenerar el fixture: `python ml/generar_fixture_paridad.py`.

## Detalle técnico

- **Características**: coordenadas isotrópicas, seguimiento estable de las dos manos, remuestreo a N
  frames, centrado en la muñeca media y escalado por el tamaño de mano; mano A + mano B (o ceros) + bandera de presencia.
- **Aumentación**: espejo (zurdos), giro de la mano ±17°, ángulo de cámara 3D ±20° (lados e inclinación),
  proporciones de la mano (palma y cada dedo ±10 %), temblor, velocidad dispareja, recorte de bordes y
  frames en que MediaPipe pierde la mano. Cada 10 épocas se generan variantes nuevas, así el modelo
  ve unas 60 versiones distintas de cada muestra en vez de 10 fijas.
- **Exportación**: la BatchNorm se fusiona en la densa siguiente igual que lo hace TFLite; exportar solo
  las densas daría otro modelo. Una prueba verifica que el JSON y el `.tflite` dan las mismas probabilidades.
- **Formato del dataset**: ver el encabezado de `signy_ml/dataset.py`.
