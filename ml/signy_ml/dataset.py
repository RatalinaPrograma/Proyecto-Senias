"""Validación del dataset descargado de Supabase (`supabase_descarga.descargar_dataset`).

Formato (`signy-dataset`, versión 1):
{
  "formato": "signy-dataset", "version": 1, "exportado": "<fecha ISO>",
  "senas":    [{"id": 12, "palabra": "hola", ...}],
  "muestras": [{"id": 1, "senaId": 12,
                "tipo": "dinamica", "manosRequeridas": 1,
                "captura": {"ancho": 640, "alto": 480,
                            "frames": [{"t": 0, "m": [[x0,y0,z0, ... x20,y20,z20]], "l": ["Right"]}]}}]
}
`m` son las manos del frame en coordenadas normalizadas de imagen (tal
cual las entrega MediaPipe) y `l` su lateralidad (opcional).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np


class DatasetInvalido(ValueError):
    pass


@dataclass
class Muestra:
    id: int
    sena_id: int
    captura: dict  # forma "expandida": manos como np.ndarray (21, 3)


@dataclass
class Dataset:
    senas: dict[int, str]
    muestras: list[Muestra] = field(default_factory=list)

    def conteo_por_sena(self) -> Counter:
        return Counter(m.sena_id for m in self.muestras)

    def palabras_repetidas(self) -> dict[str, list[int]]:
        """Palabras que aparecen en más de una seña con muestras (p. ej. "hola" en dos subniveles)."""
        por_palabra: dict[str, list[int]] = {}
        for sena_id in sorted(self.conteo_por_sena()):
            por_palabra.setdefault(self.senas[sena_id].strip().lower(), []).append(sena_id)
        return {palabra: ids for palabra, ids in por_palabra.items() if len(ids) > 1}

    def nombre(self, sena_id: int) -> str:
        """Nombre para reportes: la palabra, o "palabra (#id)" si otra seña se llama igual."""
        palabra = self.senas[sena_id]
        return f"{palabra} (#{sena_id})" if palabra.strip().lower() in self.palabras_repetidas() else palabra


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


def leer_dataset(datos: dict) -> Dataset:
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
            id=int(m["id"]), sena_id=sena_id, captura=expandir_captura(m["captura"]),
        ))
    if not ds.muestras:
        raise DatasetInvalido("El dataset no tiene muestras.")
    return ds
