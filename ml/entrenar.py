#!/usr/bin/env python3
"""Entrena el clasificador de señas de Signy con un solo comando.

    python ml/entrenar.py --supabase --email admin@correo.cl
    python ml/entrenar.py --dataset ruta/signy-dataset.json

1. Descarga las muestras directo de Supabase (cuenta admin) o lee el archivo
   exportado desde Signy AI Studio (botón "Dataset").
2. Calcula las características (idénticas a las de la app) y aumenta los datos.
3. Mide la precisión con datos separados (con personas no vistas, si hay 3+).
4. Entrena el modelo final con todo y lo deja, liviano (pesos en float16),
   en signy/src/assets/modelos/clasificador-senas.json, donde la app lo carga.
5. Escribe un reporte en ml/reportes/.

Para probar el pipeline sin datos reales: --demo-sintetico
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from signy_ml.caracteristicas import ConfigCaracteristicas  # noqa: E402
from signy_ml.dataset import DatasetInvalido, cargar_dataset  # noqa: E402
from signy_ml.modelo import OpcionesEntrenamiento, entrenar  # noqa: E402

SALIDA_APP = RAIZ.parent / "signy" / "src" / "assets" / "modelos" / "clasificador-senas.json"
MINIMO_RECOMENDADO = 10


def _pct(v) -> str:
    return "—" if v is None else f"{v * 100:.1f} %"


def escribir_reporte(ruta: Path, ds, metricas: dict, modelo: dict, destino: Path, kb: float) -> None:
    conteo = ds.conteo_por_sena()
    lineas = [
        f"# Reporte de entrenamiento — {datetime.now():%Y-%m-%d %H:%M}",
        "",
        f"- Señas: **{len(conteo)}** · muestras: **{len(ds.muestras)}** · personas: **{len(ds.participantes())}**",
        f"- Partición de prueba: {metricas['particion']}",
        f"- Exactitud en prueba: **{_pct(metricas['exactitud'])}**",
        f"- Con umbral de confianza {modelo['umbralSugerido']}: exactitud {_pct(metricas['exactitudSobreUmbral'])}, "
        f"responde en el {_pct(metricas['coberturaUmbral'])} de los casos",
        f"- Modelo: `{destino}` ({kb:.0f} KB)",
        "",
        "## Muestras por seña",
        "",
        "| Seña | Muestras | Precisión | Sensibilidad |",
        "|---|---|---|---|",
    ]
    reporte = metricas.get("reporte", {})
    for sena_id, n in sorted(conteo.items(), key=lambda x: ds.senas[x[0]]):
        nombre = ds.senas[sena_id]
        r = reporte.get(nombre, {})
        aviso = " ⚠️ pocas" if n < MINIMO_RECOMENDADO else ""
        lineas.append(f"| {nombre} | {n}{aviso} | {_pct(r.get('precision'))} | {_pct(r.get('recall'))} |")

    confusiones = []
    nombres, matriz = metricas.get("clasesConfusion", []), metricas.get("confusion", [])
    for i, fila in enumerate(matriz):
        for j, v in enumerate(fila):
            if i != j and v:
                confusiones.append((v, nombres[i], nombres[j]))
    if confusiones:
        lineas += ["", "## Confusiones más frecuentes", ""]
        lineas += [f"- **{a}** se confundió con **{b}** ({v} veces)" for v, a, b in sorted(confusiones, reverse=True)[:10]]
    ruta.write_text("\n".join(lineas) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    origen = p.add_mutually_exclusive_group(required=True)
    origen.add_argument("--dataset", type=Path, help="JSON exportado desde Signy AI Studio")
    origen.add_argument("--supabase", action="store_true", help="Descargar las muestras directo de Supabase (pide --email)")
    origen.add_argument("--demo-sintetico", action="store_true", help="Entrena con datos sintéticos (solo para probar el pipeline)")
    p.add_argument("--salida", type=Path, default=None, help=f"Ruta del modelo (por defecto {SALIDA_APP.relative_to(RAIZ.parent)})")
    p.add_argument("--frames", type=int, default=12, help="Frames a los que se remuestrea cada seña (12)")
    p.add_argument("--sin-z", action="store_true", help="Ignorar la profundidad z (más liviano, a veces más robusto)")
    p.add_argument("--capas", default="64,32", help="Neuronas por capa oculta, separadas por coma (64,32)")
    p.add_argument("--aumentos", type=int, default=10, help="Variaciones aumentadas por muestra (10)")
    p.add_argument("--umbral", type=float, default=0.6, help="Confianza mínima sugerida para aceptar una predicción (0.6)")
    p.add_argument("--semilla", type=int, default=42)
    p.add_argument("--email", help="Cuenta admin de la app (con --supabase). La contraseña se pide o se lee de SIGNY_PASSWORD")
    p.add_argument("--guardar-dataset", type=Path, help="Con --supabase: guarda también el dataset descargado en este archivo")
    a = p.parse_args(argv)

    if a.demo_sintetico:
        from signy_ml.sintetico import dataset_sintetico
        import tempfile

        tmp = Path(tempfile.mkdtemp()) / "dataset-sintetico.json"
        tmp.write_text(json.dumps(dataset_sintetico(["HOLA", "SI", "GRACIAS", "LLAMAR", "A", "L", "SEPARAR"], 6, 4)), encoding="utf-8")
        ruta_dataset = tmp
        destino = a.salida or (RAIZ / "reportes" / "modelo-demo-sintetico.json")
        print("⚠️  Modo demo: datos SINTÉTICOS. El modelo resultante NO sirve para la app.")
    elif a.supabase:
        from signy_ml.supabase_descarga import ErrorSupabase, descargar_dataset, leer_config_app
        import tempfile

        if not a.email:
            print("✖ Con --supabase hay que indicar --email (una cuenta admin de la app).", file=sys.stderr)
            return 2
        password = os.environ.get("SIGNY_PASSWORD") or getpass.getpass(f"Contraseña de {a.email}: ")
        try:
            url, clave = leer_config_app(RAIZ.parent)
            print("Descargando muestras de Supabase…")
            datos = descargar_dataset(url, clave, a.email, password, lambda n: print(f"  {n} muestras", end="\r"))
        except (ErrorSupabase, OSError) as e:
            print(f"✖ {e}", file=sys.stderr)
            return 2
        ruta_dataset = a.guardar_dataset or (Path(tempfile.mkdtemp()) / "signy-dataset.json")
        ruta_dataset.parent.mkdir(parents=True, exist_ok=True)
        ruta_dataset.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
        destino = a.salida or SALIDA_APP
    else:
        ruta_dataset = a.dataset
        destino = a.salida or SALIDA_APP

    try:
        ds = cargar_dataset(ruta_dataset)
    except (DatasetInvalido, OSError, json.JSONDecodeError) as e:
        print(f"✖ No se pudo leer el dataset: {e}", file=sys.stderr)
        return 2

    conteo = ds.conteo_por_sena()
    print(f"Dataset: {len(conteo)} señas, {len(ds.muestras)} muestras, {len(ds.participantes())} personas.")
    pocas = [ds.senas[s] for s, n in conteo.items() if n < MINIMO_RECOMENDADO]
    if pocas:
        print(f"⚠️  Menos de {MINIMO_RECOMENDADO} muestras en: {', '.join(sorted(pocas))}. Graba más para mejorar la precisión.")

    op = OpcionesEntrenamiento(
        config=ConfigCaracteristicas(frames=a.frames, usar_z=not a.sin_z),
        capas_ocultas=tuple(int(x) for x in a.capas.split(",") if x.strip()),
        aumentos_por_muestra=a.aumentos, umbral_sugerido=a.umbral, semilla=a.semilla,
    )
    try:
        modelo, metricas = entrenar(ds, op)
    except ValueError as e:
        print(f"✖ {e}", file=sys.stderr)
        return 2

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(modelo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = destino.stat().st_size / 1024
    reportes = RAIZ / "reportes"
    reportes.mkdir(exist_ok=True)
    ruta_reporte = reportes / f"reporte-{datetime.now():%Y%m%d-%H%M%S}.md"
    escribir_reporte(ruta_reporte, ds, metricas, modelo, destino, kb)

    print(f"Partición de prueba: {metricas['particion']}")
    print(f"Exactitud en prueba: {_pct(metricas['exactitud'])}")
    print(f"✔ Modelo guardado en {destino} ({kb:.0f} KB)")
    print(f"✔ Reporte en {ruta_reporte}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
