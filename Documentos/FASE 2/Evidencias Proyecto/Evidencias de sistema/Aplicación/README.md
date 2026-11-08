# Evidencias de sistema – Aplicación Signy

El código fuente de la aplicación está en la carpeta `/signy` de este repositorio (Ionic 8 + Angular 20 + Capacitor 8, Android).
El reconocimiento de señas vive en `/signy/src/app/motor-senas` (MediaPipe Hands + clasificador propio) y el pipeline de aprendizaje automático en `/ml` (TensorFlow/Keras).

## Resultados de pruebas (08/11/2026, rama `main`)

| Suite | Resultado | Detalle |
|---|---|---|
| Aplicación (Jasmine + Karma, Chrome Headless) | 664 aprobadas · 1 omitida · 0 fallidas | La omitida es `PracticaPage`, en cuarentena (no está enrutada en la app) |
| Cobertura de la aplicación | 79,09 % sentencias · 64,12 % ramas · 77,3 % funciones · 80,88 % líneas | `ng test --code-coverage` |
| Pipeline de ML (Python unittest) | 69 aprobadas · 0 fallidas | `python -m unittest discover -s ml/tests` |
| Compilación | Sin errores | `ng build --configuration production` |

Salida resumida de Karma:

```
Executed 664 of 665 (skipped 1) SUCCESS
TOTAL: 664 SUCCESS
Statements   : 79.09% ( 4120/5209 )
Branches     : 64.12% ( 1405/2191 )
Functions    : 77.3% ( 838/1084 )
Lines        : 80.88% ( 3678/4547 )
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

## Capturas (evidencia)

| Archivo | Qué muestra |
|---|---|
| `Capturas/01_pruebas_app_resumen_664.png` | Terminal: 664 pruebas aprobadas y cobertura |
| `Capturas/02_pruebas_app_karma_jasmine.png` | Karma/Jasmine en Chrome: 665 especificaciones, 0 fallas, 1 pendiente |
| `Capturas/03_pruebas_ia_69.png` | Pruebas del pipeline de IA (69) |
| `Capturas app/01_camara_perfecta_100.png` | Práctica con cámara: seña reconocida al 100 % con felicitación |

Las capturas de Supabase están en `../Base de datos/Capturas/`. Todas aparecen en el Anexo de evidencias del informe técnico.

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
