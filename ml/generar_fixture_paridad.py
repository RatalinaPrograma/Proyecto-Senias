#!/usr/bin/env python3
"""Genera la prueba de paridad Python ↔ TypeScript del clasificador.

Entrena un modelo pequeño con datos sintéticos y escribe un fixture en
`signy/src/app/motor-senas/testing/fixture-clasificador.ts` con:
  - el modelo exportado (mismo formato que usa la app),
  - algunas capturas crudas,
  - los vectores de características y las probabilidades que calculó Python.
`clasificador.spec.ts` verifica que la app obtiene los mismos números.

Volver a correrlo cada vez que cambie `signy_ml/caracteristicas.py` o el
formato del modelo:   python ml/generar_fixture_paridad.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from signy_ml.caracteristicas import ConfigCaracteristicas, caracteristicas  # noqa: E402
from signy_ml.dataset import expandir_captura  # noqa: E402
from signy_ml.modelo import OpcionesEntrenamiento, entrenar, probabilidades  # noqa: E402
from signy_ml.sintetico import compactar, dataset_sintetico, generar_captura  # noqa: E402
from signy_ml.dataset import Dataset, Muestra  # noqa: E402

DESTINO = RAIZ.parent / "signy" / "src" / "app" / "motor-senas" / "testing" / "fixture-clasificador.ts"


def main() -> None:
    crudo = dataset_sintetico(["HOLA", "SI", "L", "SEPARAR"], participantes=3, repeticiones=3, semilla=7)
    ds = Dataset(senas={int(s["id"]): s["palabra"] for s in crudo["senas"]})
    ds.muestras = [Muestra(m["id"], m["senaId"], m["participante"], expandir_captura(m["captura"])) for m in crudo["muestras"]]
    op = OpcionesEntrenamiento(config=ConfigCaracteristicas(frames=8, usar_z=True), capas_ocultas=(16,), aumentos_por_muestra=2)
    modelo, _ = entrenar(ds, op)

    rng = np.random.default_rng(99)
    casos = []
    corto = dict(duracion_ms=700.0, pausa_antes_ms=100.0, pausa_despues_ms=100.0)
    for nombre, kw in [
        ("HOLA", {}), ("SI", dict(ancho=480, alto=640)), ("L", dict(zurda=True)),
        ("SEPARAR", dict(prob_intercambio=0.3)), ("HOLA", dict(prob_perdida=0.3, fps=15)),
    ]:
        compacta = compactar(generar_captura(nombre, rng, **corto, **kw))
        captura = expandir_captura(compacta)
        vector = caracteristicas(captura, op.config)
        casos.append({
            "nombre": nombre,
            "captura": compacta,
            "vector": [round(float(v), 10) for v in vector],
            "probabilidades": [round(float(p), 12) for p in probabilidades(modelo, vector)],
        })

    contenido = (
        "// ARCHIVO GENERADO por ml/generar_fixture_paridad.py — no editar a mano.\n"
        "// Prueba de paridad: la app debe calcular los mismos números que Python.\n"
        "/* eslint-disable */\n"
        f"export const MODELO_PARIDAD = {json.dumps(modelo, ensure_ascii=False)};\n\n"
        f"export const CASOS_PARIDAD = {json.dumps(casos, ensure_ascii=False)};\n"
    )
    DESTINO.write_text(contenido, encoding="utf-8")
    print(f"✔ Fixture escrito en {DESTINO} ({DESTINO.stat().st_size / 1024:.0f} KB, {len(casos)} casos)")


if __name__ == "__main__":
    main()
