"""Perfil de cómo se hace cada seña (velocidad, amplitud, manos, forma de la mano), para que la app
le dé al alumno una retroalimentación concreta ("fue muy rápido", "junta tus manos", "estira el índice").

`medir()` es ESPEJO de `medirIntento` en `signy/src/app/motor-senas/retroalimentacion.ts`: mismas
fórmulas, verificadas por la prueba de paridad (`generar_fixture_paridad.py` guarda las medidas de
Python y `retroalimentacion.spec.ts` las compara). Si se cambia algo aquí, cambiarlo allá también.

`perfiles()` resume las medidas de todas las muestras de cada seña (mediana y dispersión robusta) y
va dentro del modelo que carga la app (`clasificador-senas.json`, campo `perfiles`).
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from .caracteristicas import (
    MUNECA,
    PRESENCIA_MINIMA,
    a_isotropico,
    mano_en_reposo,
    resumir_pistas,
    seguir_manos,
    tamano_mano,
)
from .dataset import Dataset

VENTANA_SUAVIZADO = 3      # frames: quita el temblor de MediaPipe sin achatar los movimientos rápidos
HUECO_MAX_MS = 300         # más que esto sin ver la mano: al reaparecer no se cuenta como movimiento
VELOCIDAD_MINIMA = 0.8     # tamaños de mano por segundo: más lento que esto es temblor, no movimiento (como calidad.py)
QUIETA = 0.3               # recorrido (en tamaños de mano) por debajo del cual la seña se considera quieta
MIN_FRAMES = 3
PUNTAS = (8, 12, 16, 20)   # índice, medio, anular, meñique
PULGAR, MCP_INDICE = 4, 5


def _suavizar(x: np.ndarray) -> np.ndarray:
    """Promedio móvil centrado (los bordes usan lo disponible). Igual que `suavizar` en TS."""
    medio = VENTANA_SUAVIZADO // 2
    return np.array([x[max(0, i - medio): i + medio + 1].mean(axis=0) for i in range(len(x))])


def _mediana(valores) -> float:
    return float(np.median(np.asarray(valores, dtype=np.float64)))


def _extension(mano: np.ndarray) -> list[float]:
    """[pulgar, índice, medio, anular, meñique]: qué tan estirado está cada dedo, en tamaños de mano.
    Dedos: distancia punta → muñeca. Pulgar: distancia punta → nudillo del índice (separación)."""
    t = tamano_mano(mano) or 1.0
    pulgar = float(np.linalg.norm(mano[PULGAR] - mano[MCP_INDICE])) / t
    return [pulgar] + [float(np.linalg.norm(mano[p] - mano[MUNECA])) / t for p in PUNTAS]


def medir(captura: dict) -> Optional[dict]:
    """Medidas del intento, o None si no se vio ninguna mano de forma estable.

    - recorrido: cuánto se movieron las manos (centroide, suavizado), en tamaños de mano.
    - duracionMs: lo que tardó el movimiento (del 10 % al 90 % del recorrido); None si la seña es quieta.
    - dosManos: fracción de los frames con manos en que se vieron las dos (sin contar la que descansa abajo).
    - distanciaManos: distancia típica entre las dos manos (en tamaños de mano); None con una mano.
    - extension: forma de la mano principal (la que más se mueve) durante el movimiento; ver _extension.
    """
    iso = a_isotropico(captura)
    pistas = seguir_manos(iso)
    activas = sorted((r for r in resumir_pistas(pistas) if r["presencia"] >= PRESENCIA_MINIMA), key=lambda r: r["x_media"])
    reposo = mano_en_reposo(pistas, activas)
    activas = [r for r in activas if r["indice"] != reposo]
    if not activas:
        return None
    indices = [r["indice"] for r in activas]
    tiempos = [f["t"] for f in iso]
    tamano = _mediana([tamano_mano(p[i]) for p in pistas for i in indices if p[i] is not None]) or 1.0

    eventos: list[tuple[float, float]] = []  # (t, avance) de todas las manos
    camino = {}
    centroides = {}
    for i in indices:
        presentes = [k for k, p in enumerate(pistas) if p[i] is not None]
        c = _suavizar(np.array([pistas[k][i].mean(axis=0) for k in presentes]))
        centroides[i] = dict(zip(presentes, c))
        camino[i] = 0.0
        for a, b, ca, cb in zip(presentes, presentes[1:], c, c[1:]):
            dt = tiempos[b] - tiempos[a]
            if dt > HUECO_MAX_MS:
                continue
            d = float(np.linalg.norm(cb - ca))
            if d / tamano / max(dt, 1.0) * 1000 < VELOCIDAD_MINIMA:
                continue
            eventos.append((tiempos[b], d))
            camino[i] += d
    eventos.sort(key=lambda e: e[0])
    total = sum(d for _, d in eventos)
    recorrido = total / tamano

    duracion, desde, hasta = None, -np.inf, np.inf
    if recorrido >= QUIETA:
        acumulado, t10, t90 = 0.0, None, None
        for t, d in eventos:
            acumulado += d
            if t10 is None and acumulado >= 0.1 * total:
                t10 = t
            if t90 is None and acumulado >= 0.9 * total:
                t90 = t
        duracion, desde, hasta = t90 - t10, t10, t90

    con_alguna = sum(1 for p in pistas if any(p[i] is not None for i in indices))
    ambas = [k for k, p in enumerate(pistas) if len(indices) == 2 and all(p[i] is not None for i in indices)]
    distancia = None
    if len(ambas) >= MIN_FRAMES:
        distancia = _mediana([np.linalg.norm(centroides[indices[0]][k] - centroides[indices[1]][k]) for k in ambas]) / tamano

    # Mano principal: la que más se movió (si empatan, la primera de izquierda a derecha).
    principal = max(indices, key=lambda i: (camino[i], -indices.index(i)))
    formas = [_extension(p[principal]) for k, p in enumerate(pistas)
              if p[principal] is not None and desde <= tiempos[k] <= hasta]
    extension = [_mediana([f[d] for f in formas]) for d in range(5)] if len(formas) >= MIN_FRAMES else None

    return {
        "recorrido": recorrido,
        "duracionMs": duracion,
        "dosManos": len(ambas) / con_alguna if con_alguna else 0.0,
        "distanciaManos": distancia,
        "extension": extension,
    }


def _rango(valores: list[float]) -> Optional[list[float]]:
    """[mediana, dispersión robusta (1.4826 · desviación absoluta mediana)], o None sin valores."""
    if not valores:
        return None
    v = np.asarray(valores, dtype=np.float64)
    med = float(np.median(v))
    return [round(med, 4), round(float(1.4826 * np.median(np.abs(v - med))), 4)]


def perfiles(ds: Dataset) -> dict[str, dict]:
    """Perfil típico de cada seña (clave: senaId como texto), a partir de todas sus muestras."""
    por_sena: dict[int, list[dict]] = {}
    for m in ds.muestras:
        medidas = medir(m.captura)
        if medidas is not None:
            por_sena.setdefault(m.sena_id, []).append(medidas)
    salida = {}
    for sena_id, lista in sorted(por_sena.items()):
        ext = [x["extension"] for x in lista if x["extension"] is not None]
        salida[str(sena_id)] = {
            "n": len(lista),
            "recorrido": _rango([x["recorrido"] for x in lista]),
            "duracionMs": _rango([x["duracionMs"] for x in lista if x["duracionMs"] is not None]),
            "dosManos": _rango([x["dosManos"] for x in lista]),
            "distanciaManos": _rango([x["distanciaManos"] for x in lista if x["distanciaManos"] is not None]),
            "extension": [_rango([e[d] for e in ext]) for d in range(5)] if ext else None,
        }
    return salida
