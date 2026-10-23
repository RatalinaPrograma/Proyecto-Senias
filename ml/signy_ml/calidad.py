"""Revisión de calidad de cada grabación del dataset (solo lectura).

Mide, a partir de la captura cruda, lo que no se puede ver en el momento de
grabar: cuánto se vio la mano que hace la seña, si se perdió por un rato
(movimiento muy rápido o borroso), si la seña parece cortada al final, si la
otra mano quedaba descansando abajo, etc. No cambia nada: solo informa.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from .caracteristicas import (
    MUNECA,
    PRESENCIA_MINIMA,
    ConfigCaracteristicas,
    a_isotropico,
    caracteristicas,
    mano_en_reposo,
    resumir_pistas,
    seguir_manos,
    tamano_mano,
)

# Umbrales (los de "rojo" marcan una muestra que conviene volver a grabar).
COBERTURA_AMARILLO = 0.7
COBERTURA_ROJO = 0.4
HUECO_AMARILLO_MS = 300
HUECO_ROJO_MS = 700
SALTO_TAMANOS = 1.2          # la muñeca "salta" más que esto (en tamaños de mano) entre dos frames seguidos
SALTO_MAX_DT_MS = 70         # solo cuenta como salto entre frames CONSECUTIVOS (no al reaparecer tras perderse)
HUECO_TRANSICION_AMARILLO_MS = 1000  # perderla al subir/bajar la mano (no durante la seña) importa menos
ZONA_BAJA_TAMANOS = 1.8      # más de esto (en tamaños de mano) por debajo de donde ocurre la seña = subiendo desde la cadera o bajando al reposo
SALTOS_AMARILLO = 2
FINAL_MS = 200               # último tramo de la grabación que se mira para "cortada"
FINAL_VELOCIDAD_RELATIVA = 0.5  # respecto de la velocidad típica (mediana) de la mano mientras está arriba
FINAL_VELOCIDAD_MINIMA = 0.8  # tamaños de mano por segundo: más lento que esto es la mano quieta (temblor)
MOVIMIENTO_MINIMO = 0.35     # en una seña dinámica algún punto de la mano debería moverse al menos esto (tamaños de mano)
VENTANA_SUAVIZADO = 5        # frames: quita el temblor normal de los puntos antes de medir velocidades


def _suavizar(x: np.ndarray, ventana: int = VENTANA_SUAVIZADO) -> np.ndarray:
    """Promedio móvil centrado a lo largo del eje 0 (con los bordes recortados a lo disponible)."""
    if len(x) < 3:
        return x
    medio = ventana // 2
    return np.array([x[max(0, i - medio): i + medio + 1].mean(axis=0) for i in range(len(x))])


def _pistas_de_la_sena(pistas, manos_requeridas: int):
    """Índices de las pistas que hacen la seña (sin la mano que descansa abajo), y si había una en reposo."""
    activas = [r for r in resumir_pistas(pistas) if r["presencia"] >= PRESENCIA_MINIMA]
    reposo = mano_en_reposo(pistas, sorted(activas, key=lambda r: r["x_media"]))
    utiles = [r for r in activas if r["indice"] != reposo]
    if manos_requeridas == 1:
        # La mano que hace la seña suele estar más arriba que la otra (igual que la comparación de la app).
        utiles = sorted(utiles, key=lambda r: r["y_media"])[:1]
    return [r["indice"] for r in utiles], reposo is not None, len(activas)


def evaluar_muestra(captura: dict, tipo: str, manos_requeridas: int) -> dict:
    """Métricas y avisos de una muestra (captura expandida, como la deja dataset.expandir_captura)."""
    frames = captura["frames"]
    avisos: list[tuple[str, str]] = []  # (nivel 'rojo'|'amarillo'|'info', texto)
    res: dict = {"frames": len(frames), "duracionMs": 0, "fps": 0.0, "cobertura": 0.0, "huecoMaxMs": 0,
                 "saltos": 0, "movimiento": 0.0, "otraManoAbajo": False, "avisos": avisos, "nivel": "verde"}
    if len(frames) < 2:
        avisos.append(("rojo", "La grabación casi no tiene frames."))
        res["nivel"] = "rojo"
        return res

    t = np.array([f["t"] for f in frames], dtype=float)
    res["duracionMs"] = int(round(t[-1] - t[0]))
    res["fps"] = round((len(frames) - 1) / max((t[-1] - t[0]) / 1000.0, 1e-6), 1)

    iso = a_isotropico(captura)
    pistas = seguir_manos(iso)
    indices, reposo, n_activas = _pistas_de_la_sena(pistas, manos_requeridas)
    res["otraManoAbajo"] = reposo
    if reposo:
        avisos.append(("info", "Se ve la otra mano descansando abajo: el modelo la ignora."))

    if not indices:
        avisos.append(("rojo", "No se ve ninguna mano de forma estable: no sirve para entrenar."))
        res["nivel"] = "rojo"
        return res
    if manos_requeridas == 2 and len(indices) < 2:
        avisos.append(("rojo", "Es una seña de 2 manos, pero casi todo el tiempo se vio solo 1."))

    presente = np.array([all(p[i] is not None for i in indices) for p in pistas])
    res["cobertura"] = round(float(presente.mean()), 3)

    # Hueco más largo sin la(s) mano(s) que hacen la seña, entre su primera y última aparición.
    vistos = np.flatnonzero(presente)
    # "Zona baja" de la mano principal: donde está mientras sube desde la cadera o baja al reposo (no la seña).
    # Se mide en tamaños de mano por debajo de donde ocurre la seña (el 10 % más alto de su recorrido), así una
    # seña que baja por sí misma (de la barbilla al pecho) no se confunde con volver al reposo.
    manos_principal = [p[indices[0]] for p in pistas if p[indices[0]] is not None]
    tam_principal = float(np.median([tamano_mano(m) for m in manos_principal]))
    y_alto = float(np.quantile([float(m[MUNECA, 1]) for m in manos_principal], 0.1))
    limite_bajo = y_alto + ZONA_BAJA_TAMANOS * tam_principal
    hueco_en_transicion = False
    if len(vistos) >= 2:
        difs = np.diff(t[vistos])
        k = int(np.argmax(difs))
        res["huecoMaxMs"] = int(round(float(difs[k])))
        # ¿Se perdió mientras la mano subía desde la cadera o bajaba al reposo, o en plena seña?
        antes, despues = pistas[vistos[k]][indices[0]], pistas[vistos[k + 1]][indices[0]]
        hueco_en_transicion = antes[MUNECA, 1] > limite_bajo or despues[MUNECA, 1] > limite_bajo

    # Mano principal en tamaños de mano (suavizada para no confundir temblor con movimiento).
    principal = indices[0]
    pos = [(t[k], p[principal]) for k, p in enumerate(pistas) if p[principal] is not None]
    tam = float(np.median([tamano_mano(m) for _, m in pos])) or 1.0
    tiempos = np.array([tt for tt, _ in pos])
    puntos = np.array([m[:, :2] for _, m in pos]) / tam  # (frames, 21, 2)
    if len(puntos) >= 2:
        saltos = np.linalg.norm(np.diff(puntos[:, MUNECA], axis=0), axis=1)
        consecutivos = np.diff(tiempos) <= SALTO_MAX_DT_MS
        res["saltos"] = int(((saltos > SALTO_TAMANOS) & consecutivos).sum())
        suave = _suavizar(puntos)
        # Cuánto se mueve el punto de la mano que más se mueve (muñeca o dedos).
        res["movimiento"] = round(float(np.max(np.linalg.norm(suave - np.median(suave, axis=0), axis=2))), 2)
        if tipo == "dinamica" and len(suave) >= 8:
            dt = np.maximum(np.diff(tiempos) / 1000.0, 1e-3)
            centro = suave.mean(axis=1)  # el centro de la mano tiembla mucho menos que las puntas de los dedos
            velocidad = np.linalg.norm(np.diff(centro, axis=0), axis=1) / dt
            # Velocidad típica de la mano mientras está arriba (la mediana no se deja arrastrar por la subida rápida).
            arriba = np.array([float(m[MUNECA, 1]) <= y_alto + 1.0 * tam_principal for _, m in pos[1:]])
            tipica = float(np.median(velocidad[arriba] if arriba.sum() >= 3 else velocidad))
            final = velocidad[tiempos[1:] >= tiempos[-1] - FINAL_MS]
            # Máximo, no promedio: si se cortó justo cuando la mano cambiaba de dirección, el promedio sale bajo.
            vf = float(np.max(final)) if len(final) else 0.0
            if vf > FINAL_VELOCIDAD_RELATIVA * tipica and vf > FINAL_VELOCIDAD_MINIMA:
                if float(pos[-1][1][MUNECA, 1]) > limite_bajo:
                    avisos.append(("info", "Termina mientras la mano baja al reposo: normal."))
                else:
                    avisos.append(("amarillo", "Puede estar cortada al final: la mano seguía moviéndose arriba cuando terminó la "
                                               "grabación (si la seña es larga, usa 4 s)."))

    if res["cobertura"] < COBERTURA_ROJO:
        avisos.append(("rojo", f"La mano que hace la seña se vio solo en el {res['cobertura'] * 100:.0f} % de la grabación."))
    elif res["cobertura"] < COBERTURA_AMARILLO:
        avisos.append(("amarillo", f"La mano que hace la seña se vio en el {res['cobertura'] * 100:.0f} % de la grabación."))
    if hueco_en_transicion:
        if res["huecoMaxMs"] >= HUECO_TRANSICION_AMARILLO_MS:
            avisos.append(("amarillo", f"Se perdió la mano durante {res['huecoMaxMs']} ms al subirla o bajarla (movimiento rápido o borroso)."))
        elif res["huecoMaxMs"] >= HUECO_AMARILLO_MS:
            avisos.append(("info", f"Se perdió la mano {res['huecoMaxMs']} ms al subirla o bajarla, no durante la seña: no afecta."))
    elif res["huecoMaxMs"] >= HUECO_ROJO_MS:
        avisos.append(("rojo", f"Se perdió la mano durante {res['huecoMaxMs']} ms seguidos en plena seña (movimiento muy rápido, borroso o fuera de cuadro)."))
    elif res["huecoMaxMs"] >= HUECO_AMARILLO_MS:
        avisos.append(("amarillo", f"Se perdió la mano durante {res['huecoMaxMs']} ms seguidos en plena seña."))
    if res["saltos"] >= SALTOS_AMARILLO:
        avisos.append(("amarillo", f"{res['saltos']} saltos bruscos de la mano entre un frame y otro (movimiento muy rápido o borroso)."))
    if tipo == "dinamica" and res["movimiento"] < MOVIMIENTO_MINIMO:
        avisos.append(("amarillo", "Casi no hay movimiento para ser una seña dinámica (¿se hizo después de que terminó la grabación?)."))

    if caracteristicas(captura, ConfigCaracteristicas()) is None:
        avisos.append(("rojo", "El modelo no puede usar esta muestra (no hay una mano estable)."))

    niveles = {nivel for nivel, _ in avisos}
    res["nivel"] = "rojo" if "rojo" in niveles else "amarillo" if "amarillo" in niveles else "verde"
    return res


def evaluar_referencia(referencia: Optional[dict]) -> dict:
    """Revisión del modelo de referencia de una seña (senas.landmarks_referencia)."""
    if not referencia:
        return {"nivel": "gris", "avisos": [("info", "Sin referencia guardada.")]}
    avisos: list[tuple[str, str]] = []
    version = referencia.get("version", 1)
    frames = referencia.get("frames") or []
    if version < 3:
        avisos.append(("amarillo", f"Referencia en formato antiguo (v{version}): conviene volver a grabarla."))
    if referencia.get("tipo") == "dinamica" and len(frames) < 8:
        avisos.append(("amarillo", f"Referencia muy corta ({len(frames)} frames): puede estar incompleta."))
    if not frames:
        avisos.append(("rojo", "La referencia no tiene frames."))
    niveles = {nivel for nivel, _ in avisos}
    nivel = "rojo" if "rojo" in niveles else "amarillo" if "amarillo" in niveles else "verde"
    return {"nivel": nivel, "avisos": avisos, "frames": len(frames), "version": version}
