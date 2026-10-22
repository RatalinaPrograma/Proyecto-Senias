# Evidencias de sistema – Aplicación Signy

El código fuente de la aplicación está en la carpeta `/signy` de este repositorio (Ionic 8 + Angular 20 + Capacitor 8, Android).
El reconocimiento de señas vive en `/signy/src/app/motor-senas` y el pipeline de aprendizaje automático en `/ml`.

## Resultados de pruebas (08/10/2026, commit 5fdcfe1 de `main`)

| Suite | Resultado | Detalle |
|---|---|---|
| Aplicación (Jasmine + Karma, Chrome Headless) | 607 aprobadas · 1 omitida · 0 fallidas | La omitida es `PracticaPage`, en cuarentena |
| Cobertura de la aplicación | 80,46 % sentencias · 66,02 % ramas · 80,07 % funciones · 81,96 % líneas | `ng test --code-coverage` |
| Pipeline de ML (Python unittest) | 34 aprobadas · 0 fallidas | `python -m unittest discover -s ml/tests` |
| Compilación | Sin errores | `ng build --configuration development` |

Salida resumida de Karma:

```
Executed 607 of 608 (skipped 1) SUCCESS
TOTAL: 607 SUCCESS
Statements   : 80.46% ( 3184/3957 )
Branches     : 66.02% ( 987/1495 )
Functions    : 80.07% ( 623/778 )
Lines        : 81.96% ( 2850/3477 )
```

Salida de las pruebas de ML:

```
Ran 34 tests in 7.423s
OK
```

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
