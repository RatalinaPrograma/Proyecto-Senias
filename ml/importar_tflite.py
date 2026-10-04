#!/usr/bin/env python3
"""Convierte un clasificador MLP entrenado en Keras/TFLite al formato que usa la app.

    python ml/importar_tflite.py --modelo ml/output/model.tflite \\
        --etiquetas ml/output/labels.json --dataset signy-dataset.json

Requisito: el modelo tiene que haberse entrenado con las MISMAS características
que calcula la app (`signy_ml/caracteristicas.py`, idénticas a
`motor-senas/clasificador.ts`). Si no, la app le entregaría otros números y sus
predicciones no tendrían sentido; por eso se valida la dimensión de entrada.

- Lee los pesos desde el .tflite (con la BatchNorm ya fusionada).
- Asocia cada etiqueta (palabra) con su seña del dataset exportado.
- `--normalizacion`: JSON {"media": [...], "escala": [...]} si el modelo se
  entrenó con entradas estandarizadas (StandardScaler o similar).
- Verifica que el modelo convertido da las mismas probabilidades que el original.
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from signy_ml.caracteristicas import ConfigCaracteristicas, dimension_por_frame  # noqa: E402
from signy_ml.modelo import FORMATO, VERSION, _b64, probabilidades  # noqa: E402
from signy_ml.tflite_import import ModeloNoSoportado, inferir, leer_mlp_tflite  # noqa: E402

SALIDA_APP = RAIZ.parent / "signy" / "src" / "assets" / "modelos" / "clasificador-senas.json"


def normalizar_palabra(p: str) -> str:
    sin_tildes = "".join(c for c in unicodedata.normalize("NFD", p.lower()) if unicodedata.category(c) != "Mn")
    return "".join(c for c in sin_tildes if c.isalnum() or c == " ").strip()


def asociar_etiquetas(etiquetas: list[str], senas: list[dict]) -> list[dict]:
    por_palabra = {normalizar_palabra(s["palabra"]): s for s in senas}
    clases, faltan = [], []
    for e in etiquetas:
        s = por_palabra.get(normalizar_palabra(e))
        if s is None:
            faltan.append(e)
        else:
            clases.append({"senaId": int(s["id"]), "palabra": s["palabra"]})
    if faltan:
        raise ValueError(f"Estas etiquetas no coinciden con ninguna seña del dataset: {', '.join(faltan)}")
    return clases


def convertir(capas, clases: list[dict], config: ConfigCaracteristicas, media=None, escala=None, umbral=0.6) -> dict:
    dim = capas[0][0].shape[0]
    esperado = dimension_por_frame(config) * config.frames
    if dim != esperado:
        raise ModeloNoSoportado(
            f"El modelo espera {dim} entradas, pero las características de Signy "
            f"(frames={config.frames}, z={'sí' if config.usar_z else 'no'}) producen {esperado}. "
            "Hay que entrenarlo con signy_ml/caracteristicas.py (o pasar --frames/--sin-z si se usó otra configuración)."
        )
    if capas[-1][0].shape[1] != len(clases):
        raise ModeloNoSoportado(f"El modelo tiene {capas[-1][0].shape[1]} salidas y hay {len(clases)} etiquetas.")
    media = np.zeros(dim) if media is None else np.asarray(media, dtype=np.float64)
    escala = np.ones(dim) if escala is None else np.where(np.asarray(escala, dtype=np.float64) > 0, escala, 1.0)
    return {
        "formato": FORMATO,
        "version": VERSION,
        "creado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "caracteristicas": config.a_json(),
        "clases": clases,
        "normalizacion": {"media": _b64(media, "float32"), "escala": _b64(escala, "float32")},
        "tipoPesos": "float16",
        "capas": [
            {"entrada": int(W.shape[0]), "salida": int(W.shape[1]), "activacion": act, "pesos": _b64(W, "float16"), "sesgos": _b64(b, "float16")}
            for W, b, act in capas
        ],
        "umbralSugerido": umbral,
        "metricas": {"origen": "importado desde TFLite"},
    }


def verificar(modelo: dict, capas, media, escala, n=200, semilla=0) -> float:
    """Máxima diferencia de probabilidad entre el modelo convertido y el original."""
    dim = capas[0][0].shape[0]
    rng = np.random.default_rng(semilla)
    media = np.zeros(dim) if media is None else np.asarray(media)
    escala = np.ones(dim) if escala is None else np.asarray(escala)
    X = rng.normal(size=(n, dim)) * escala + media
    original = inferir(capas, (X - media) / escala)
    convertido = np.array([probabilidades(modelo, x) for x in X])
    return float(np.abs(original - convertido).max())


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--modelo", type=Path, required=True, help="Archivo .tflite")
    p.add_argument("--etiquetas", type=Path, required=True, help="JSON con la lista de palabras, en el orden de las salidas")
    p.add_argument("--dataset", type=Path, required=True, help="Dataset exportado desde AI Studio (para asociar palabras con señas)")
    p.add_argument("--normalizacion", type=Path, help='JSON {"media": [...], "escala": [...]}')
    p.add_argument("--frames", type=int, default=12)
    p.add_argument("--sin-z", action="store_true")
    p.add_argument("--umbral", type=float, default=0.6)
    p.add_argument("--salida", type=Path, default=SALIDA_APP)
    a = p.parse_args(argv)

    try:
        capas = leer_mlp_tflite(a.modelo)
        etiquetas = json.loads(a.etiquetas.read_text(encoding="utf-8"))
        senas = json.loads(a.dataset.read_text(encoding="utf-8")).get("senas", [])
        clases = asociar_etiquetas(etiquetas, senas)
        norm = json.loads(a.normalizacion.read_text(encoding="utf-8")) if a.normalizacion else {}
        media, escala = norm.get("media"), norm.get("escala")
        modelo = convertir(capas, clases, ConfigCaracteristicas(frames=a.frames, usar_z=not a.sin_z), media, escala, a.umbral)
    except (ModeloNoSoportado, ValueError, OSError, json.JSONDecodeError) as e:
        print(f"✖ {e}", file=sys.stderr)
        return 2

    diferencia = verificar(modelo, capas, media, escala)
    if diferencia > 0.02:
        print(f"✖ El modelo convertido no reproduce al original (diferencia {diferencia:.3f}).", file=sys.stderr)
        return 3
    a.salida.parent.mkdir(parents=True, exist_ok=True)
    a.salida.write_text(json.dumps(modelo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"✔ Modelo importado ({len(clases)} señas, diferencia máx. con el original {diferencia:.4f}) → {a.salida}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
