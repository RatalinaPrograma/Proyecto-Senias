"""Carga y validación del dataset que exporta Signy AI Studio.

Formato (`signy-dataset`, versión 1):
{
  "formato": "signy-dataset", "version": 1, "exportado": "<fecha ISO>",
  "senas":    [{"id": 12, "palabra": "hola", ...}],
  "muestras": [{"id": 1, "senaId": 12, "participante": "p1",
                "tipo": "dinamica", "manosRequeridas": 1,
                "captura": {"ancho": 640, "alto": 480,
                            "frames": [{"t": 0, "m": [[x0,y0,z0, ... x20,y20,z20]], "l": ["Right"]}]}}]
}
`m` son las manos del frame en coordenadas normalizadas de imagen (tal
cual las entrega MediaPipe) y `l` su lateralidad (opcional).
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


class DatasetInvalido(ValueError):
    pass


@dataclass
class Muestra:
    id: int
    sena_id: int
    participante: str
    captura: dict  # forma "expandida": manos como np.ndarray (21, 3)


@dataclass
class Dataset:
    senas: dict[int, str]
    muestras: list[Muestra] = field(default_factory=list)

    def conteo_por_sena(self) -> Counter:
        return Counter(m.sena_id for m in self.muestras)

    def participantes(self) -> set[str]:
        return {m.participante for m in self.muestras}


def expandir_captura(compacta: dict) -> dict:
    if "ancho" not in compacta or "alto" not in compacta or "frames" not in compacta:
        raise DatasetInvalido("captura sin ancho/alto/frames")
    frames = []
    for f in compacta["frames"]:
        manos = []
        for plana in f.get("m", []):
            arr = np.asarray(plana, dtype=np.float64)
            if arr.size != 63 or not np.all(np.isfinite(arr)):
                continue  # mano incompleta o corrupta: se ignora, igual que en la app
            manos.append(arr.reshape(21, 3))
        frames.append({"t": float(f["t"]), "manos": manos})
    return {"ancho": int(compacta["ancho"]), "alto": int(compacta["alto"]), "frames": frames}


def cargar_dataset(ruta: str | Path) -> Dataset:
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    if datos.get("formato") != "signy-dataset":
        raise DatasetInvalido("El archivo no es un dataset de Signy (falta formato='signy-dataset').")
    if datos.get("version") != 1:
        raise DatasetInvalido(f"Versión de dataset no soportada: {datos.get('version')}")
    senas = {int(s["id"]): str(s["palabra"]) for s in datos.get("senas", [])}
    ds = Dataset(senas=senas)
    for m in datos.get("muestras", []):
        sena_id = int(m["senaId"])
        if sena_id not in senas:
            raise DatasetInvalido(f"La muestra {m.get('id')} apunta a la seña {sena_id}, que no está en 'senas'.")
        ds.muestras.append(Muestra(
            id=int(m["id"]), sena_id=sena_id, participante=str(m.get("participante") or "desconocido"),
            captura=expandir_captura(m["captura"]),
        ))
    if not ds.muestras:
        raise DatasetInvalido("El dataset no tiene muestras.")
    return ds
