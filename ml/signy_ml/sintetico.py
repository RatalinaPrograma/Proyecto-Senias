"""Generador de capturas sintéticas (puerto de `motor-senas/testing/manos-sinteticas.ts`).

Sirve para probar el pipeline de punta a punta sin datos reales: produce
capturas con el mismo formato que exporta la app, variando persona,
cámara, velocidad, ruido y lateralidad. NO sirve para entrenar el modelo
que va a producción: para eso hacen falta grabaciones reales de LSCh.
"""
from __future__ import annotations

import math

import numpy as np

POSES = {
    "puno": dict(pulgar=0.7, indice=1, medio=1, anular=1, menique=1, apertura=0.08),
    "palma": dict(pulgar=0.05, indice=0, medio=0, anular=0, menique=0, apertura=0.05),
    "indice": dict(pulgar=0.8, indice=0, medio=1, anular=1, menique=1, apertura=0.08),
    "ele": dict(pulgar=0, indice=0, medio=1, anular=1, menique=1, apertura=0.1),
    "ve": dict(pulgar=0.8, indice=0, medio=0, anular=1, menique=1, apertura=0.25),
    "garra": dict(pulgar=0.4, indice=0.55, medio=0.55, anular=0.55, menique=0.55, apertura=0.15),
}

_NUDILLOS = {"indice": (0.3, -0.95), "medio": (0.0, -1.0), "anular": (-0.25, -0.92), "menique": (-0.48, -0.8)}
_FALANGES = {
    "pulgar": (0.4, 0.32, 0.27), "indice": (0.45, 0.27, 0.22), "medio": (0.5, 0.3, 0.24),
    "anular": (0.46, 0.28, 0.22), "menique": (0.36, 0.22, 0.19),
}
_DESVIO = {"indice": 1, "medio": 0, "anular": -1, "menique": -2}
_CURVA_MAX = (1.4, 1.75, 1.2)


def mano_local(pose: dict, proporcion: float = 1.0) -> np.ndarray:
    """21 landmarks de una mano derecha, palma a la cámara, muñeca en el origen, tamaño 1."""
    puntos = [(0.0, 0.0, 0.0)]
    abierto, cerrado = np.array([0.62, -0.72, -0.12]), np.array([-0.62, -0.35, -0.7])
    p = np.array([0.22, -0.18, -0.03])
    puntos.append(tuple(p))
    for i in range(3):
        f = min(1.0, pose["pulgar"] * (0.6 + 0.4 * i))
        d = abierto + (cerrado - abierto) * f
        p = p + d / np.linalg.norm(d) * _FALANGES["pulgar"][i] * proporcion
        puntos.append(tuple(p))
    for nombre in ("indice", "medio", "anular", "menique"):
        bx, by = _NUDILLOS[nombre]
        p = np.array([bx, by, 0.0])
        puntos.append(tuple(p))
        desvio = _DESVIO[nombre] * pose.get("apertura", 0.08)
        curva = 0.0
        for i in range(3):
            curva += pose[nombre] * _CURVA_MAX[i]
            l = _FALANGES[nombre][i] * proporcion
            p = p + np.array([math.sin(desvio) * math.cos(curva), -math.cos(desvio) * math.cos(curva), -math.sin(curva)]) * l
            puntos.append(tuple(p))
    return np.array(puntos)


def _mezclar_pose(a: dict, b: dict, u: float) -> dict:
    return {k: a[k] + (b[k] - a[k]) * u for k in a}


_CX, _CY = 0.5, 0.55
SENAS = {
    "A": ("estatica", lambda u: [(POSES["puno"], _CX + 0.01 * math.sin(u * 6), _CY, 0.0)]),
    "B": ("estatica", lambda u: [(POSES["palma"], _CX, _CY + 0.01 * math.sin(u * 5), 0.0)]),
    "L": ("estatica", lambda u: [(POSES["ele"], _CX, _CY, 0.0)]),
    "V": ("estatica", lambda u: [(POSES["ve"], _CX, _CY, 0.0)]),
    "HOLA": ("dinamica", lambda u: [(POSES["palma"], _CX + 0.13 * math.sin(u * math.pi * 3), _CY - 0.05, 0.25 * math.sin(u * math.pi * 3))]),
    "SI": ("dinamica", lambda u: [(POSES["puno"], _CX, _CY + 0.09 * math.sin(u * math.pi * 4), 0.0)]),
    "GRACIAS": ("dinamica", lambda u: [(POSES["palma"], _CX + 0.05 * u, _CY - 0.18 + 0.3 * u, -0.5 * u)]),
    "LLAMAR": ("dinamica", lambda u: [(_mezclar_pose(POSES["palma"], POSES["garra"], 0.5 - 0.5 * math.cos(u * math.pi * 4)), _CX, _CY, 0.0)]),
    "SEPARAR": ("dinamica", lambda u: [
        (POSES["palma"], _CX + 0.06 + 0.22 * u, _CY, 0.3),
        (POSES["palma"], _CX - 0.06 - 0.22 * u, _CY, -0.3),
    ]),
    "JUNTAR": ("dinamica", lambda u: [
        (POSES["puno"], _CX + 0.28 - 0.2 * u, _CY - 0.1 * u, 0.0),
        (POSES["puno"], _CX - 0.28 + 0.2 * u, _CY - 0.1 * u, 0.0),
    ]),
}


def generar_captura(nombre: str, rng: np.random.Generator, *, ancho=640, alto=480, fps=30.0,
                    duracion_ms=1200.0, pausa_antes_ms=300.0, pausa_despues_ms=300.0,
                    tamano=0.18, proporcion=1.0, zurda=False, dx=0.0, dy=0.0, giro=0.0,
                    ruido=0.03, prob_perdida=0.0, prob_intercambio=0.0) -> dict:
    _, definicion = SENAS[nombre]
    aspecto = ancho / alto
    total = pausa_antes_ms + duracion_ms + pausa_despues_ms
    frames = []
    t = 0.0
    while t <= total:
        u = min(1.0, max(0.0, (t - pausa_antes_ms) / duracion_ms))
        manos = []
        for pose, x, y, g in definicion(u):
            local = mano_local(pose, proporcion)
            ang = g + giro
            c, s = math.cos(ang), math.sin(ang)
            iso = np.empty_like(local)
            iso[:, 0] = x + aspecto / 2 - 0.5 + dx + (local[:, 0] * c - local[:, 1] * s) * tamano
            iso[:, 1] = y + dy + (local[:, 0] * s + local[:, 1] * c) * tamano
            iso[:, 2] = local[:, 2] * tamano
            iso += rng.normal(0.0, ruido * tamano, iso.shape) * np.array([1, 1, 2])
            if zurda:
                iso[:, 0] = aspecto - iso[:, 0]
            iso[:, 2] -= iso[0, 2]
            manos.append(iso / np.array([aspecto, 1.0, aspecto]))
        if len(manos) == 2 and prob_intercambio and rng.random() < prob_intercambio:
            manos.reverse()
        if prob_perdida and rng.random() < prob_perdida:
            manos = []
        frames.append({"t": round(t), "manos": manos})
        t += 1000.0 / fps
    return {"ancho": ancho, "alto": alto, "frames": frames}


def dataset_sintetico(senas: list[str], participantes: int, repeticiones: int, semilla: int = 0) -> dict:
    """Dataset con el formato de exportación de la app (ver dataset.py)."""
    rng = np.random.default_rng(semilla)
    muestras = []
    ids = {nombre: i + 1 for i, nombre in enumerate(senas)}
    for p in range(participantes):
        persona = dict(
            tamano=float(rng.uniform(0.13, 0.25)), proporcion=float(rng.uniform(0.92, 1.08)),
            zurda=bool(rng.random() < 0.2), dx=float(rng.uniform(-0.12, 0.12)), dy=float(rng.uniform(-0.06, 0.06)),
            giro=float(rng.uniform(-0.25, 0.25)),
        )
        camara = [(640, 480), (480, 640), (1280, 720)][p % 3]
        for nombre in senas:
            for _ in range(repeticiones):
                captura = generar_captura(
                    nombre, rng, ancho=camara[0], alto=camara[1], fps=float(rng.choice([24, 30])),
                    duracion_ms=float(rng.uniform(800, 1700)), pausa_antes_ms=float(rng.uniform(100, 500)),
                    pausa_despues_ms=float(rng.uniform(100, 500)), ruido=float(rng.uniform(0.02, 0.04)),
                    prob_perdida=0.05, prob_intercambio=0.1, **persona,
                )
                muestras.append({
                    "id": len(muestras) + 1, "senaId": ids[nombre], "participante": f"p{p + 1}",
                    "tipo": SENAS[nombre][0], "manosRequeridas": 2 if nombre in ("SEPARAR", "JUNTAR") else 1,
                    "captura": compactar(captura),
                })
    return {
        "formato": "signy-dataset", "version": 1, "exportado": "sintetico",
        "senas": [{"id": ids[n], "palabra": n.lower()} for n in senas],
        "muestras": muestras,
    }


def compactar(captura: dict) -> dict:
    """Formato compacto de la app: cada mano como lista plana de 63 números."""
    return {
        "ancho": captura["ancho"], "alto": captura["alto"],
        "frames": [{"t": f["t"], "m": [np.round(m, 5).reshape(-1).tolist() for m in f["manos"]]} for f in captura["frames"]],
    }
