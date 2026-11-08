# Evidencias de sistema – Aplicación Signy

El código fuente de la aplicación está en la carpeta `/signy` de este repositorio (Ionic 8 + Angular 20 + Capacitor 8, Android).
El reconocimiento de señas vive en `/signy/src/app/motor-senas` (MediaPipe Hands + clasificador propio) y el pipeline de aprendizaje automático en `/ml` (TensorFlow/Keras).

## Resultados de pruebas (08/11/2026, rama `v1`)

| Suite | Resultado | Detalle |
|---|---|---|
| Aplicación (Jasmine + Karma, Chrome Headless) | 663 aprobadas · 1 omitida · 0 fallidas | La omitida es `PracticaPage`, en cuarentena (no está enrutada en la app) |
| Cobertura de la aplicación | 79,06 % sentencias · 64,15 % ramas · 77,23 % funciones · 80,85 % líneas | `ng test --code-coverage` |
| Pipeline de ML (Python unittest) | 69 aprobadas · 0 fallidas | `python -m unittest discover -s ml/tests` |
| Compilación | Sin errores | `ng build --configuration production` |

Salida resumida de Karma:

```
Executed 663 of 664 (skipped 1) SUCCESS
TOTAL: 663 SUCCESS
Statements   : 79.06% ( 4114/5203 )
Branches     : 64.15% ( 1405/2190 )
Functions    : 77.23% ( 838/1085 )
Lines        : 80.85% ( 3671/4540 )
```

Salida de las pruebas de ML:

```
Ran 69 tests in 412.981s
OK
```

## Clasificador de señas incluido en la app

`signy/src/assets/modelos/clasificador-senas.json` (entrenado el 26/10/2026 con 169 muestras de 12 señas):

| Métrica | Valor |
|---|---|
| Exactitud con el conjunto de prueba (44 muestras) | 70,5 % |
| Exactitud cuando supera el umbral de confianza | 90,3 % |
| Reconoce "ninguna seña" | 72,7 % |
| Exactitud con personas que no participaron en el entrenamiento | 27,8 % (hace falta grabar a más personas) |

En la lección, la app aprueba la seña desde **75 % de seguridad** (`UMBRAL_APROBACION`); al 100 % muestra solo una felicitación.

## Cómo reproducirlas

```bash
cd signy
npm ci
npm test                      # abre Chrome; agregar --watch=false --code-coverage para un solo ciclo
cd ..
pip install -r ml/requirements.txt
python -m unittest discover -s ml/tests
```

Más detalle sobre qué cubre cada suite en `signy/README-PRUEBAS.md` y `ml/README.md`.
