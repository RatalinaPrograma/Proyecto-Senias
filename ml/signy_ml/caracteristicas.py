"""Características para el clasificador de señas.

ESPEJO EXACTO de `signy/src/app/motor-senas/clasificador.ts`
(`caracteristicasClasificador`) y de las funciones que usa
(`aIsotropico`, `seguirManos`, `resumirPistas`). Si se cambia algo aquí,
hay que cambiarlo allá y regenerar la prueba de paridad
(`python ml/generar_fixture_paridad.py`).

Una captura es un dict con la forma de `CapturaCruda` en TypeScript:
    {"ancho": 640, "alto": 480,
     "frames": [{"t": 0, "manos": [array (21, 3)], ...}, ...]}
donde cada mano es un `np.ndarray` de forma (21, 3) en coordenadas
normalizadas de imagen (lo que entrega MediaPipe).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

PUNTOS_POR_MANO = 21
MUNECA = 0
MCP_MEDIO = 9
SALTO_MAXIMO = 0.3
PRESENCIA_MINIMA = 0.3
# Mano "en reposo" (ver mano_en_reposo): distancias en tamaños de mano.
REPOSO_MOVIMIENTO_MAX = 0.6   # la mano que descansa casi no se mueve
REPOSO_MARGEN = 1.0           # y queda al menos esto por debajo de donde ocurre la seña
REPOSO_CONTACTO = 0.5         # si la otra mano la toca (más cerca que esto)…
REPOSO_FRAMES_CONTACTO = 3    # …en al menos estos frames, es una mano BASE, no en reposo (un roce suelto no cuenta)
REPOSO_CUANTIL_ALTO = 0.1     # "donde ocurre la seña": el 10 % más alto del recorrido de la otra mano


def _cuantil_bajo(valores: list[float], q: float) -> float:
    """Valor en la posición floor(q·(n−1)) de la lista ordenada (sin interpolar: igual que en clasificador.ts)."""
    orden = sorted(valores)
    return orden[int(q * (len(orden) - 1))]


@dataclass(frozen=True)
class ConfigCaracteristicas:
    frames: int = 12
    usar_z: bool = True

    def a_json(self) -> dict:
        return {"frames": self.frames, "usarZ": self.usar_z}

    @staticmethod
    def desde_json(d: dict) -> "ConfigCaracteristicas":
        return ConfigCaracteristicas(frames=int(d["frames"]), usar_z=bool(d["usarZ"]))


def dimension_por_frame(config: ConfigCaracteristicas) -> int:
    return 2 * PUNTOS_POR_MANO * (3 if config.usar_z else 2) + 1


def a_isotropico(captura: dict) -> list[dict]:
    """x y z multiplicados por ancho/alto (ver geometria.ts)."""
    alto = captura["alto"]
    k = captura["ancho"] / alto if alto > 0 else 1.0
    escala = np.array([k, 1.0, k])
    salida = []
    for f in captura["frames"]:
        manos = [np.asarray(m, dtype=np.float64) * escala for m in f.get("manos", []) if m is not None and len(m) >= PUNTOS_POR_MANO]
        salida.append({"t": float(f["t"]), "manos": manos})
    return salida


def _distancia(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.sum((a - b) ** 2)))


def tamano_mano(mano: np.ndarray) -> float:
    return _distancia(mano[MUNECA], mano[MCP_MEDIO])


def seguir_manos(frames: list[dict]) -> list[list[Optional[np.ndarray]]]:
    """Asigna cada detección a una de dos pistas (ver seguimiento.ts)."""
    ultima: list[Optional[np.ndarray]] = [None, None]
    salida = []

    def costo(mano: np.ndarray, pista: int) -> float:
        u = ultima[pista]
        return _distancia(mano[MUNECA], u[MUNECA]) if u is not None else SALTO_MAXIMO

    for frame in frames:
        manos = frame["manos"][:2]
        asignacion: list[Optional[np.ndarray]] = [None, None]
        if len(manos) == 1:
            m = manos[0]
            if ultima[0] is None and ultima[1] is None:
                pista = 0
            else:
                d0 = costo(m, 0) if ultima[0] is not None else float("inf")
                d1 = costo(m, 1) if ultima[1] is not None else float("inf")
                pista = 0 if d0 <= d1 else 1
                if min(d0, d1) > SALTO_MAXIMO and ultima[1 - pista] is None:
                    pista = 1 - pista
            asignacion[pista] = m
        elif len(manos) == 2:
            a, b = manos
            if ultima[0] is None and ultima[1] is None:
                if a[MUNECA, 0] > b[MUNECA, 0]:
                    a, b = b, a
            elif costo(a, 1) + costo(b, 0) < costo(a, 0) + costo(b, 1):
                a, b = b, a
            asignacion = [a, b]
        if asignacion[0] is not None:
            ultima[0] = asignacion[0]
        if asignacion[1] is not None:
            ultima[1] = asignacion[1]
        salida.append(asignacion)
    return salida


def resumir_pistas(pistas: list[list[Optional[np.ndarray]]]) -> list[dict]:
    con_alguna = sum(1 for p in pistas if p[0] is not None or p[1] is not None) or 1
    resumen = []
    for indice in (0, 1):
        presentes = [p[indice] for p in pistas if p[indice] is not None]
        if not presentes:
            continue
        resumen.append({
            "indice": indice,
            "presencia": len(presentes) / con_alguna,
            "x_media": sum(float(m[MUNECA, 0]) for m in presentes) / len(presentes),
            "y_media": sum(float(m[MUNECA, 1]) for m in presentes) / len(presentes),
        })
    return resumen


def mano_en_reposo(pistas: list[list[Optional[np.ndarray]]], activas: list[dict]) -> Optional[int]:
    """Índice de la pista que es la otra mano DESCANSANDO abajo (o None).

    En una toma de la cintura hacia arriba, en las señas de una mano la otra
    queda visible y quieta a la altura de la cadera. Si se la trata como
    "mano B", el vector cambia por completo según si el alumno la muestra o
    no, y según si es zurdo (cambia qué mano queda a la izquierda).

    Se descarta la mano de más abajo si:
      - casi no se mueve,
      - queda claramente por debajo de DONDE OCURRE LA SEÑA (el 10 % más alto
        del recorrido de la otra mano; no de todo el recorrido, porque lo
        normal es partir con las dos manos abajo y subir una), y
      - la otra mano no la toca mientras está arriba: si la toca, es la mano
        BASE de una seña de dos manos y se conserva.
    Igual que manoEnReposo en clasificador.ts.
    """
    if len(activas) != 2:
        return None
    datos = []
    for r in activas:
        manos = [p[r["indice"]] for p in pistas if p[r["indice"]] is not None]
        munecas = np.array([m[MUNECA, :2] for m in manos])
        centro = np.median(munecas, axis=0)
        datos.append({
            "indice": r["indice"],
            "y_media": r["y_media"],
            "y_alto": _cuantil_bajo([float(y) for y in munecas[:, 1]], REPOSO_CUANTIL_ALTO),
            "tam": float(np.median([tamano_mano(m) for m in manos])),
            "mov": float(np.sqrt(((munecas - centro) ** 2).sum(axis=1)).max()),
        })
    baja, alta = (datos[1], datos[0]) if datos[1]["y_media"] > datos[0]["y_media"] else (datos[0], datos[1])
    t = max(baja["tam"], alta["tam"])
    if not (baja["mov"] < REPOSO_MOVIMIENTO_MAX * t and baja["y_media"] > alta["y_alto"] + REPOSO_MARGEN * t):
        return None
    limite = baja["y_media"] - REPOSO_MARGEN * t
    contactos = 0
    for p in pistas:
        mb, ma = p[baja["indice"]], p[alta["indice"]]
        if mb is None or ma is None or ma[MUNECA, 1] >= limite:
            continue  # solo cuenta un contacto cuando la otra mano está arriba (no cuando ambas descansan juntas)
        dif = ma[:, None, :2] - mb[None, :, :2]
        if float(np.sqrt((dif ** 2).sum(axis=2)).min()) < REPOSO_CONTACTO * t:
            contactos += 1
            if contactos >= REPOSO_FRAMES_CONTACTO:
                return None
    return baja["indice"]


def _remuestrear_fijo(frames: list[tuple], n: int) -> list[tuple]:
    """frames: lista de (t, mano_a, mano_b|None). Igual que remuestrearFijo en TS."""
    if len(frames) == 1:
        return [frames[0]] * n
    t0, t1 = frames[0][0], frames[-1][0]
    salida = []
    j = 0
    for k in range(n):
        t = t0 if n == 1 else t0 + ((t1 - t0) * k) / (n - 1)
        while j < len(frames) - 2 and frames[j + 1][0] < t:
            j += 1
        p, q = frames[j], frames[j + 1]
        u = min(1.0, max(0.0, (t - p[0]) / (q[0] - p[0]))) if q[0] > p[0] else 0.0
        a = p[1] + (q[1] - p[1]) * u
        if p[2] is not None and q[2] is not None:
            b = p[2] + (q[2] - p[2]) * u
        else:
            b = p[2] if u < 0.5 else q[2]
        salida.append((t, a, b))
    return salida


def caracteristicas(captura: dict, config: ConfigCaracteristicas) -> Optional[np.ndarray]:
    iso = a_isotropico(captura)
    pistas = seguir_manos(iso)
    activas = sorted(
        (r for r in resumir_pistas(pistas) if r["presencia"] >= PRESENCIA_MINIMA),
        key=lambda r: r["x_media"],
    )
    reposo = mano_en_reposo(pistas, activas)
    if reposo is not None:
        activas = [r for r in activas if r["indice"] != reposo]
    if not activas:
        return None
    ia = activas[0]["indice"]
    ib = activas[1]["indice"] if len(activas) > 1 else None

    frames = [
        (iso[i]["t"], p[ia], None if ib is None else p[ib])
        for i, p in enumerate(pistas)
        if p[ia] is not None
    ]
    if not frames:
        return None

    muestras = _remuestrear_fijo(frames, config.frames)
    munecas = np.array([f[1][MUNECA] for f in muestras])
    centro = munecas.sum(axis=0) / len(muestras)
    escala = float(np.median([tamano_mano(f[1]) for f in muestras]))
    escala = escala if escala > 1e-6 else 1.0
    columnas = 3 if config.usar_z else 2

    filas = []
    for _, a, b in muestras:
        fa = ((a - centro) / escala)[:, :columnas].reshape(-1)
        fb = ((b - centro) / escala)[:, :columnas].reshape(-1) if b is not None else np.zeros(PUNTOS_POR_MANO * columnas)
        filas.append(np.concatenate([fa, fb, [1.0 if b is not None else 0.0]]))
    return np.concatenate(filas)
