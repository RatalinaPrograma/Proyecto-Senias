"""Aumentación de datos sobre capturas crudas.

Con pocas grabaciones por seña, el modelo memoriza a la persona y la
cámara. Estas transformaciones simulan la variación real entre alumnos:
lateralidad (zurdos), inclinación de la mano, ángulo de la cámara en 3D,
proporciones de la mano, velocidad de ejecución, temblor de los landmarks,
recortes en los bordes y frames en que MediaPipe pierde la mano.
(El tamaño y la posición en la imagen casi no aportan: las características
los normalizan. Se dejan porque, con dos manos, cambian su relación.)
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


# Punto anterior de cada landmark de MediaPipe (0 = muñeca; dedos de 4 puntos: pulgar 1-4 … meñique 17-20).
PADRE = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19]


def _factores_mano(rng: np.random.Generator, variacion: float) -> np.ndarray:
    """Largo relativo de cada hueso: uno para la palma y uno por dedo (la misma persona en toda la captura)."""
    palma, dedos = rng.uniform(1 - variacion, 1 + variacion), rng.uniform(1 - variacion, 1 + variacion, 5)
    return np.array([1.0] + [palma if PADRE[j] == 0 else dedos[(j - 1) // 4] for j in range(1, 21)])


def _proporciones(mano: np.ndarray, factores: np.ndarray) -> np.ndarray:
    nueva = mano.copy()
    for j in range(1, 21):  # el padre siempre tiene índice menor: ya está recalculado
        nueva[j] = nueva[PADRE[j]] + (mano[j] - mano[PADRE[j]]) * factores[j]
    return nueva


def _rotacion_camara(rng: np.random.Generator, giro_max: float) -> np.ndarray:
    """Cámara girada hacia los lados (eje y) e inclinada (eje x), como un celular apoyado chueco."""
    a, b = rng.uniform(-giro_max, giro_max, 2)
    lado = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
    inclinacion = np.array([[1, 0, 0], [0, math.cos(b), -math.sin(b)], [0, math.sin(b), math.cos(b)]])
    return lado @ inclinacion


def _perder_manos(frames: list[dict], rng: np.random.Generator, perdida_max: float) -> list[dict]:
    """MediaPipe no detecta la mano en algunos frames sueltos y, a veces, en varios seguidos."""
    p = rng.uniform(0, perdida_max)
    salida = [{"t": f["t"], "manos": [m for m in f["manos"] if rng.random() >= p]} for f in frames]
    if len(salida) > 6 and rng.random() < 0.3:
        ini = int(rng.integers(len(salida) - 5))
        for f in salida[ini:ini + int(rng.integers(2, 6))]:
            f["manos"] = []
    return salida


def aumentar(captura: dict, rng: np.random.Generator, *, giro_max=0.3, escala=(0.85, 1.15), deformacion_tiempo=(0.75, 1.3),
             ruido=0.02, recorte=0.12, traslacion=0.08, giro_camara_max=0.35, proporcion=0.1, perdida_max=0.15) -> dict:
    k, frames = _a_iso(captura)
    angulo = rng.uniform(-giro_max, giro_max)
    c, s = math.cos(angulo), math.sin(angulo)
    factor = rng.uniform(*escala)
    desplazamiento = np.array([rng.uniform(-traslacion, traslacion), rng.uniform(-traslacion, traslacion), 0.0])
    factores = _factores_mano(rng, proporcion)
    camara = _rotacion_camara(rng, giro_camara_max)
    munecas = [m[MUNECA] for f in frames for m in f["manos"]]
    centro = np.mean(munecas, axis=0) if munecas else np.zeros(3)
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
            m = _proporciones(m, factores)
            muneca = m[MUNECA]
            rel = m - muneca
            rot = rel.copy()
            rot[:, 0] = rel[:, 0] * c - rel[:, 1] * s
            rot[:, 1] = rel[:, 0] * s + rel[:, 1] * c
            nueva = (muneca + rot * factor - centro) @ camara.T + centro
            nueva[:, 2] -= nueva[MUNECA, 2]  # MediaPipe da la profundidad relativa a la muñeca
            nueva = nueva + desplazamiento + rng.normal(0.0, ruido * tam, nueva.shape)
            manos.append(nueva)
        nuevos.append({"t": duracion * (max(f["t"], 0.0) / duracion) ** gamma, "manos": manos})

    n = len(nuevos)
    if n > 10 and recorte > 0:
        ini = int(rng.uniform(0, recorte) * n)
        fin = n - int(rng.uniform(0, recorte) * n)
        nuevos = nuevos[ini:fin]
    return _desde_iso(k, _perder_manos(nuevos, rng, perdida_max), captura)
