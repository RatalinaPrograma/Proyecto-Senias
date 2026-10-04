# Signy · Machine learning de señas

Entrena un clasificador de señas de LSCh a partir de grabaciones hechas con la
propia app y lo deja dentro de la app, liviano y funcionando sin internet.

```
 Entrenador del admin ──► tabla muestras_sena ──► python ml/entrenar.py --supabase ──► assets/modelos/clasificador-senas.json
 (graba con la cámara)    (captura cruda)          (descarga, entrena y evalúa)          (la app lo carga sola)
```

## 1. Preparar (una vez)

1. En Supabase → SQL Editor, correr `supabase/migrations/20261004120000_dataset_muestras_sena.sql`.
2. En el computador: `pip install -r ml/requirements.txt` (solo numpy y scikit-learn).

## 2. Grabar muestras

En **AI Studio → Catálogo**, abrir una seña y:

- **Grabar 5 seguidas al dataset** (modo ráfaga): graba 5 muestras una tras otra, con
  una cuenta atrás entre cada una, y las guarda solas. Es la forma rápida.
- O bien **Grabar seña** → hacerla → **Al dataset**, de a una.

La lista del catálogo muestra cuántas muestras tiene cada seña (en naranjo si son menos de 10).

Para que el modelo funcione con alumnos reales:

- **10 a 20 muestras por seña** como mínimo; más es mejor.
- **Varias personas** (ojalá 3 o más): el modelo aprende la seña, no a la persona.
  El reporte mide la precisión con personas que el modelo nunca vio.
- Variar un poco: distancia a la cámara, luz, velocidad, celular vertical y laptop.
- Si una grabación salió mal, **Deshacer** la borra.
- Las muestras son solo coordenadas de 21 puntos por mano: no se guardan imágenes ni video.

## 3. Entrenar

Un solo comando, con una cuenta **admin** de la app (pide la contraseña; también se
puede pasar en la variable `SIGNY_PASSWORD`):

```bash
python ml/entrenar.py --supabase --email admin@correo.cl
```

Descarga todas las muestras (las personas quedan anonimizadas como `p1`, `p2`, …),
entrena, mide la precisión y deja el modelo en
`signy/src/assets/modelos/clasificador-senas.json` y el reporte en `ml/reportes/`.
Hacer commit del modelo y compilar la app.

Alternativa sin conexión desde Python: AI Studio en el navegador del computador →
botón **Dataset (N)** → `python ml/entrenar.py --dataset signy-dataset-AAAAMMDD.json`.
(En la app del celular ese botón no descarga archivos: usar `--supabase`.)

Opciones útiles: `--frames 12` (resolución temporal), `--sin-z` (ignora la
profundidad), `--capas 64,32` (tamaño de la red), `--aumentos 10`, `--umbral 0.6`.

Para probar el pipeline sin datos reales: `python ml/entrenar.py --demo-sintetico`
(escribe en `ml/reportes/`, **no** en la app).

## 4. Cómo lo usa la app

`ReconocedorSenasService` combina dos motores:

| Motor | Necesita | Cuándo decide |
|---|---|---|
| Referencia (DTW) | 1 grabación de la seña ("Usar como referencia") | siempre que exista |
| Clasificador entrenado | el modelo de este pipeline | si el archivo existe y conoce la seña |

La seña se aprueba si **cualquiera** de los dos la reconoce (el clasificador, solo si
la seña es su primera opción y supera el umbral). Sin modelo ni referencia, la
práctica solo verifica que se vieron las manos (como antes).

## 5. Modelos entrenados en Keras/TFLite

Si se entrena con otro framework (por ejemplo, el MLP de Keras en `ml/output/`), se
puede llevar a la app siempre que use **las mismas características** que
`signy_ml/caracteristicas.py`. El importador lee el `.tflite`, asocia cada etiqueta
con su seña y verifica que el resultado reproduce al original:

```bash
python ml/importar_tflite.py --modelo modelo.tflite --etiquetas labels.json --dataset signy-dataset.json
```

Se lee el `.tflite` y no un JSON de pesos exportado a mano porque, al convertir a
TFLite, las capas **BatchNormalization** quedan fusionadas en la capa densa
siguiente; un JSON con solo las capas densas es otro modelo.

Estado del modelo en `ml/output/` (subido a `dev` el 04-10-2026):
- Espera **64 entradas** por predicción, cuyo cálculo no está en el repo (falta el
  script de entrenamiento), así que la app no le puede entregar datos correctos todavía.
- `model_weights.json` no incluye la BatchNorm: no coincide con `model.tflite`.
- No trae métricas. Casi todos los pesos de la primera capa siguen cerca de su valor
  inicial, lo que sugiere muy pocos datos o épocas de entrenamiento.

## 6. Garantías (pruebas)

- `python -m unittest discover -s ml/tests`: características, aumentación,
  validación del dataset, entrenamiento de punta a punta, CLI, descarga desde
  Supabase (contra un servidor simulado con login y RLS) e importador TFLite.
- **Paridad Python ↔ app** (`clasificador.spec.ts`): la app calcula las mismas
  características y probabilidades que Python (diferencia < 1e-6). Si se cambia
  `signy_ml/caracteristicas.py` o `motor-senas/clasificador.ts`, hay que cambiar
  ambos y regenerar el fixture: `python ml/generar_fixture_paridad.py`.

## Detalle técnico

- **Características** (`caracteristicas.py` = `clasificador.ts`): coordenadas
  isotrópicas (corrige la relación de aspecto de la cámara), seguimiento estable
  de las dos manos, remuestreo a N frames, centrado en la muñeca media y escalado
  por el tamaño de mano mediano; mano A + mano B (o ceros) + bandera de presencia.
- **Aumentación**: espejo (zurdos), giro de la mano ±17°, escala, temblor,
  deformación no lineal del tiempo y recorte de bordes.
- **Modelo**: red neuronal MLP (scikit-learn) con ReLU y softmax; pesos en float16
  (~300 KB). La inferencia en la app es TypeScript puro, sin dependencias.
- **Formato del dataset**: ver el encabezado de `signy_ml/dataset.py`.
