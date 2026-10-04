"""Aumentación de datos sobre capturas crudas.

Con pocas grabaciones por seña, el modelo memoriza a la persona y la
cámara. Estas transformaciones simulan la variación real entre alumnos:
lateralidad (zurdos), inclinación de la mano, distancia a la cámara,
velocidad de ejecución, temblor de los landmarks y recortes en los bordes.
Se aplican sobre coordenadas isotrópicas y se vuelven a dejar en
coordenadas de imagen, para pasar por la MISMA función de características
que usa la app.
"""
from __future__ import annotations

import math

import numpy as np

from .caracteristicas import MUNECA, tamano_mano


def _a_iso(captura: dict) -> tuple[float, list[dict]]:
    k = captura["ancho"] / captura["alto"]
    escala = np.array([k, 1.0, k])
    return k, [{"t": f["t"], "manos": [m * escala for m in f["manos"]]} for f in captura["frames"]]


def _desde_iso(k: float, frames: list[dict], base: dict) -> dict:
    escala = np.array([k, 1.0, k])
    return {"ancho": base["ancho"], "alto": base["alto"], "frames": [{"t": f["t"], "manos": [m / escala for m in f["manos"]]} for f in frames]}


def espejar(captura: dict) -> dict:
    """Misma seña hecha por una persona zurda."""
    return {**captura, "frames": [{"t": f["t"], "manos": [m * np.array([-1.0, 1.0, 1.0]) + np.array([1.0, 0.0, 0.0]) for m in f["manos"]]} for f in captura["frames"]]}


def aumentar(captura: dict, rng: np.random.Generator, *, giro_max=0.3, escala=(0.85, 1.15), deformacion_tiempo=(0.75, 1.3),
             ruido=0.02, recorte=0.12, traslacion=0.08) -> dict:
    k, frames = _a_iso(captura)
    angulo = rng.uniform(-giro_max, giro_max)
    c, s = math.cos(angulo), math.sin(angulo)
    factor = rng.uniform(*escala)
    desplazamiento = np.array([rng.uniform(-traslacion, traslacion), rng.uniform(-traslacion, traslacion), 0.0])
    # Deformación no lineal del tiempo: una parte de la seña más rápida que
    # otra (un cambio de velocidad uniforme no cambia nada, porque las
    # características se remuestrean a una cantidad fija de frames).
    gamma = rng.uniform(*deformacion_tiempo)
    duracion = max(frames[-1]["t"], 1.0) if frames else 1.0

    con_manos = [f for f in frames if f["manos"]]
    tam = np.median([tamano_mano(m) for f in con_manos for m in f["manos"]]) if con_manos else 0.1
    nuevos = []
    for f in frames:
        manos = []
        for m in f["manos"]:
            muneca = m[MUNECA]
            rel = m - muneca
            rot = rel.copy()
            rot[:, 0] = rel[:, 0] * c - rel[:, 1] * s
            rot[:, 1] = rel[:, 0] * s + rel[:, 1] * c
            nueva = muneca + rot * factor + desplazamiento
            nueva = nueva + rng.normal(0.0, ruido * tam, nueva.shape)
            manos.append(nueva)
        nuevos.append({"t": duracion * (max(f["t"], 0.0) / duracion) ** gamma, "manos": manos})

    n = len(nuevos)
    if n > 10 and recorte > 0:
        ini = int(rng.uniform(0, recorte) * n)
        fin = n - int(rng.uniform(0, recorte) * n)
        nuevos = nuevos[ini:fin]
    return _desde_iso(k, nuevos, captura)
