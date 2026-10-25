#!/usr/bin/env python3
"""Entrena el clasificador de señas de Signy con las muestras de Supabase (tabla muestras_sena).

    python ml/entrenar.py                                     # menú interactivo
    python ml/entrenar.py --supabase --email admin@correo.cl  # entrena directo, sin menú

1. Descarga las muestras directo de Supabase con una cuenta admin (no se leen archivos locales).
2. Calcula las características (idénticas a las de la app) y aumenta los datos.
3. Mide la precisión con datos separados (con personas no vistas, si hay 3+).
4. Entrena el modelo final (Keras) con todo y lo exporta a ml/output/:
   model.tflite, labels.json y model_weights.json (BatchNorm fusionada, pesos float16).
   model_weights.json se copia a signy/src/assets/modelos/clasificador-senas.json, donde la app lo carga
   (solo si la exactitud en prueba llega al mínimo: ver EXACTITUD_MINIMA_APP).
5. Escribe un reporte en ml/reportes/.

Para probar el pipeline sin datos reales: --demo-sintetico
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import sys
import time
from dataclasses import replace
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from rich.prompt import Prompt  # noqa: E402
from rich.table import Table  # noqa: E402

from signy_ml.caracteristicas import ConfigCaracteristicas  # noqa: E402
from signy_ml.consola import aviso, consola, consola_utf8, error, menu, ok  # noqa: E402
from signy_ml.dataset import Dataset, DatasetInvalido, leer_dataset  # noqa: E402
from signy_ml.modelo import OpcionesEntrenamiento, entrenar  # noqa: E402

SALIDA_ML = RAIZ / "output"
SALIDA_APP = RAIZ.parent / "signy" / "src" / "assets" / "modelos" / "clasificador-senas.json"
MINIMO_RECOMENDADO = 10
PERSONAS_RECOMENDADAS = 3
EXACTITUD_MINIMA_APP = 0.8  # por debajo, el modelo no se copia a la app (salvo --forzar)


def _pct(v) -> str:
    return "—" if v is None else f"{v * 100:.1f} %"


def _exactitud(m: dict) -> str:
    """"77.5 % ± 11.0" cuando se probó persona por persona."""
    return _pct(m["exactitud"]) + ("" if m.get("desviacionPersonas") is None else f" ± {m['desviacionPersonas'] * 100:.1f}")


def escribir_reporte(ruta: Path, ds, metricas: dict, modelo: dict, destino: Path, kb: float) -> None:
    conteo = ds.conteo_por_sena()
    personas = ds.personas_por_sena()
    lineas = [
        f"# Reporte de entrenamiento — {datetime.now():%Y-%m-%d %H:%M}",
        "",
        f"- Señas: **{len(conteo)}** · muestras: **{len(ds.muestras)}** · personas: **{len(ds.participantes())}**",
        f"- Partición de prueba: {metricas['particion']}",
        f"- Muestras de prueba: {metricas['muestrasPrueba']} de {len(ds.muestras)}"
        f" ({metricas.get('personasPrueba', 0)} persona(s))",
        f"- Exactitud en prueba: **{_exactitud(metricas)}**",
        f"- Con umbral de confianza {modelo['umbralSugerido']}"
        f"{' (calculado)' if metricas.get('umbralCalculado') else ''}: exactitud {_pct(metricas['exactitudSobreUmbral'])}, "
        f"responde en el {_pct(metricas['coberturaUmbral'])} de los casos",
        f"- Movimientos que no son seña rechazados: {_pct(metricas.get('rechazoNinguna'))}",
        f"- Modelo: `{destino}` ({kb:.0f} KB)",
        "",
        "## Muestras por seña",
        "",
        "| Seña | Muestras | Personas | Precisión | Sensibilidad |",
        "|---|---|---|---|---|",
    ]
    reporte = metricas.get("reporte", {})
    for sena_id, n in sorted(conteo.items(), key=lambda x: ds.nombre(x[0])):
        nombre = ds.nombre(sena_id)
        r = reporte.get(nombre, {})
        aviso_n = " ⚠️ pocas" if n < MINIMO_RECOMENDADO else ""
        aviso_personas = " ⚠️" if personas.get(sena_id, 0) < PERSONAS_RECOMENDADAS else ""
        # Sin muestras de esta seña en la prueba no hay nada que medir: "0.0 %" haría creer que falla.
        if r.get("support", 0) > 0:
            precision, sensibilidad = _pct(r.get("precision")), _pct(r.get("recall"))
        else:
            precision = sensibilidad = "— (sin prueba)"
        lineas.append(f"| {nombre} | {n}{aviso_n} | {personas.get(sena_id, 0)}{aviso_personas} "
                      f"| {precision} | {sensibilidad} |")

    if metricas.get("exactitudPorPersona"):
        lineas += ["", "## Exactitud por persona", "", "| Persona | Exactitud |", "|---|---|"]
        lineas += [f"| {p} | {_pct(v)} |" for p, v in sorted(metricas["exactitudPorPersona"].items(), key=lambda x: x[1])]

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


def descargar(email: str, password: str) -> Dataset:
    """Dataset de la tabla muestras_sena (lanza ErrorSupabase o DatasetInvalido)."""
    from signy_ml.supabase_descarga import descargar_dataset, leer_config_app

    url, clave = leer_config_app(RAIZ.parent)
    with consola.status("Descargando muestras de Supabase…") as estado:
        datos = descargar_dataset(url, clave, email, password, lambda n: estado.update(f"Descargando muestras de Supabase… {n}"))
    return leer_dataset(datos)


def mostrar_dataset(ds: Dataset) -> None:
    personas = ds.personas_por_sena()
    tabla = Table(title=f"{len(ds.conteo_por_sena())} señas · {len(ds.muestras)} muestras · {len(ds.participantes())} personas")
    tabla.add_column("Seña")
    tabla.add_column("Muestras", justify="right")
    tabla.add_column("Personas", justify="right")
    for sena_id, n in sorted(ds.conteo_por_sena().items(), key=lambda x: ds.nombre(x[0])):
        p = personas.get(sena_id, 0)
        tabla.add_row(ds.nombre(sena_id), f"[yellow]{n}[/]" if n < MINIMO_RECOMENDADO else str(n),
                      f"[yellow]{p}[/]" if p < PERSONAS_RECOMENDADAS else str(p))
    consola.print(tabla)


def avisar_dataset(ds: Dataset) -> None:
    conteo = ds.conteo_por_sena()
    consola.print(f"Dataset: {len(conteo)} señas, {len(ds.muestras)} muestras, {len(ds.participantes())} personas.")
    pocas = [ds.senas[s] for s, n in conteo.items() if n < MINIMO_RECOMENDADO]
    if pocas:
        aviso(f"Menos de {MINIMO_RECOMENDADO} muestras en: {', '.join(sorted(pocas))}. Graba más para mejorar la precisión.")
    for palabra, ids in ds.palabras_repetidas().items():
        aviso(f"La palabra \"{palabra}\" está en {len(ids)} señas distintas (ids {', '.join(map(str, ids))}). "
              "El modelo las trata como señas diferentes y no las va a distinguir: graba esa palabra en una sola.")
    if len(ds.participantes()) < PERSONAS_RECOMENDADAS:
        aviso(f"Solo {len(ds.participantes())} persona(s) en el dataset: graba a {PERSONAS_RECOMENDADAS} o más "
              "(campo \"Persona\" del entrenador) para que el modelo funcione con alumnos nuevos.")


def opciones(a: argparse.Namespace) -> OpcionesEntrenamiento:
    return OpcionesEntrenamiento(
        config=ConfigCaracteristicas(frames=a.frames, usar_z=not a.sin_z),
        capas_ocultas=tuple(int(x) for x in a.capas.split(",") if x.strip()),
        aumentos_por_muestra=a.aumentos, epocas=a.epocas, umbral_sugerido=a.umbral, semilla=a.semilla,
        clase_ninguna=not a.sin_ninguna, precision_objetivo=a.precision,
    )


def entrenar_y_guardar(ds: Dataset, op: OpcionesEntrenamiento, salida: Path, instalar_en_app: bool, forzar: bool = False) -> int:
    """Entrena y escribe model.tflite, labels.json y model_weights.json en `salida` (y en la app si se pide
    y el modelo aprobó la prueba: un modelo malo en la app aprobaría señas mal hechas)."""
    avisar_dataset(ds)
    try:
        with consola.status("Entrenando (TensorFlow)…"):
            r = entrenar(ds, op)
    except ValueError as e:
        error(str(e))
        return 2

    exactitud = r.metricas["exactitud"]
    if instalar_en_app and not forzar and (exactitud is None or exactitud < EXACTITUD_MINIMA_APP):
        salida, instalar_en_app = RAIZ / "reportes" / "prueba", False
        aviso(f"No se instala en la app: la exactitud en prueba es {_pct(exactitud)} y se necesita al menos "
              f"{_pct(EXACTITUD_MINIMA_APP)}. Graba más muestras y personas. Se guardó como prueba en {salida}.")

    salida.mkdir(parents=True, exist_ok=True)
    pesos = salida / "model_weights.json"
    pesos.write_text(json.dumps(r.modelo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (salida / "model.tflite").write_bytes(r.tflite)
    (salida / "labels.json").write_text(json.dumps(r.etiquetas, ensure_ascii=False, indent=2), encoding="utf-8")
    destino = pesos
    if instalar_en_app:
        SALIDA_APP.parent.mkdir(parents=True, exist_ok=True)
        destino = Path(shutil.copyfile(pesos, SALIDA_APP))
    kb = destino.stat().st_size / 1024
    reportes = RAIZ / "reportes"
    reportes.mkdir(exist_ok=True)
    ruta_reporte = reportes / f"reporte-{datetime.now():%Y%m%d-%H%M%S}.md"
    escribir_reporte(ruta_reporte, ds, r.metricas, r.modelo, destino, kb)

    m = r.metricas
    consola.print(f"Partición de prueba: {m['particion']}")
    consola.print(f"Muestras de prueba: {m['muestrasPrueba']} de {len(ds.muestras)} ({m.get('personasPrueba', 0)} persona(s))")
    consola.print(f"Exactitud en prueba: [bold]{_exactitud(m)}[/]")
    if m["exactitudPorPersona"]:
        consola.print("Por persona: " + ", ".join(f"{p} {_pct(v)}" for p, v in sorted(m["exactitudPorPersona"].items())))
    consola.print(f"Umbral: {r.modelo['umbralSugerido']}{' (calculado)' if m['umbralCalculado'] else ' (por defecto: faltan datos de prueba)'}"
                  f" · rechaza el {_pct(m['rechazoNinguna'])} de los movimientos que no son seña")
    ok(f"Modelo guardado en {destino} ({kb:.0f} KB)")
    ok(f"TFLite y etiquetas en {salida}")
    ok(f"Reporte en {ruta_reporte}")
    return 0


def comparar(ds: Dataset, a: argparse.Namespace) -> None:
    """Mide varias configuraciones con las mismas rondas y semilla, para elegir con números."""
    base = opciones(a)
    variantes = [
        ("actual", base),
        ("8 frames", replace(base, config=ConfigCaracteristicas(frames=8, usar_z=base.config.usar_z))),
        ("sin z", replace(base, config=ConfigCaracteristicas(frames=base.config.frames, usar_z=False))),
        ("red chica (32,16)", replace(base, capas_ocultas=(32, 16))),
        ("sin aumentación", replace(base, aumentos_por_muestra=0, incluir_espejo=False)),
        ("sin clase ninguna", replace(base, clase_ninguna=False)),
    ]
    aviso(f"Se entrena {len(variantes)} veces por cada ronda de prueba: puede tardar varios minutos.")
    tabla = Table(title="Comparación (mismas rondas de prueba)")
    for col in ("Configuración", "Exactitud", "Peor persona", "Rechazo", "Umbral", "Tiempo"):
        tabla.add_column(col, justify="left" if col == "Configuración" else "right")
    for nombre, op in variantes:
        inicio = time.perf_counter()
        with consola.status(f"Evaluando «{nombre}»…"):
            m = entrenar(ds, op, solo_evaluar=True).metricas
        peor = min(m["exactitudPorPersona"].items(), key=lambda x: x[1], default=None)
        tabla.add_row(nombre, _exactitud(m), f"{_pct(peor[1])} ({peor[0]})" if peor else "—", _pct(m["rechazoNinguna"]),
                      str(m["umbral"]), f"{time.perf_counter() - inicio:.0f} s")
    consola.print(tabla)


def demo(a: argparse.Namespace) -> int:
    from signy_ml.sintetico import dataset_sintetico

    aviso("Modo demo: datos SINTÉTICOS. El modelo resultante NO sirve para la app.")
    ds = leer_dataset(dataset_sintetico(["HOLA", "SI", "GRACIAS", "LLAMAR", "A", "L", "SEPARAR"], 6, 4))
    return entrenar_y_guardar(ds, opciones(a), a.salida or RAIZ / "reportes" / "demo-sintetico", False)


def menu_interactivo(a: argparse.Namespace) -> int:
    from signy_ml.supabase_descarga import ErrorSupabase

    sesion: dict = {"email": a.email}

    def dataset(recargar: bool = False):
        """Descarga una vez por sesión; las credenciales se piden una sola vez y no se guardan en disco."""
        if recargar or "ds" not in sesion:
            sesion["email"] = sesion["email"] or Prompt.ask("Correo de la cuenta admin")
            password = sesion.get("password") or os.environ.get("SIGNY_PASSWORD") or Prompt.ask("Contraseña", password=True)
            try:
                sesion["ds"] = descargar(sesion["email"], password)
                sesion["password"] = password
            except (ErrorSupabase, DatasetInvalido, OSError) as e:
                sesion.pop("password", None)
                error(str(e))
                return None
        return sesion["ds"]

    def ver(recargar: bool):
        if ds := dataset(recargar):
            mostrar_dataset(ds)

    def comparar_configuraciones():
        if ds := dataset():
            try:
                comparar(ds, a)
            except ValueError as e:
                error(str(e))

    def entrenar_con(salida: Path, instalar: bool):
        if ds := dataset():
            entrenar_y_guardar(ds, opciones(a), salida, instalar)

    menu("Signy · entrenamiento del clasificador de señas", [
        ("Ver muestras de Supabase (por seña y persona)", lambda: ver(False)),
        ("Volver a descargar las muestras", lambda: ver(True)),
        ("Entrenar y actualizar el modelo de la app", lambda: entrenar_con(a.salida or SALIDA_ML, a.salida is None)),
        ("Entrenar de prueba (no toca la app → ml/reportes/prueba/)", lambda: entrenar_con(RAIZ / "reportes" / "prueba", False)),
        ("Comparar configuraciones (solo mide, no guarda modelo)", comparar_configuraciones),
        ("Demo con datos sintéticos", lambda: demo(a)),
    ])
    return 0


def main(argv=None) -> int:
    consola_utf8()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    accion = p.add_mutually_exclusive_group()
    accion.add_argument("--supabase", action="store_true", help="Entrena directo, sin menú (pide --email)")
    accion.add_argument("--demo-sintetico", action="store_true", help="Entrena con datos sintéticos (solo para probar el pipeline)")
    p.add_argument("--email", help="Cuenta admin de la app. La contraseña se pide o se lee de SIGNY_PASSWORD")
    p.add_argument("--salida", type=Path, default=None,
                   help=f"Carpeta de salida (por defecto {SALIDA_ML.relative_to(RAIZ.parent)}). Si se indica, no reemplaza el modelo de la app")
    p.add_argument("--frames", type=int, default=12, help="Frames a los que se remuestrea cada seña (12)")
    p.add_argument("--sin-z", action="store_true", help="Ignorar la profundidad z (más liviano, a veces más robusto)")
    p.add_argument("--capas", default="64,32", help="Neuronas por capa oculta, separadas por coma (64,32)")
    p.add_argument("--aumentos", type=int, default=10, help="Variaciones aumentadas por muestra (10)")
    p.add_argument("--epocas", type=int, default=60, help="Épocas de entrenamiento (60; variantes aumentadas nuevas cada 10)")
    p.add_argument("--precision", type=float, default=0.95,
                   help="Precisión buscada al calcular el umbral de confianza (0.95)")
    p.add_argument("--umbral", type=float, default=0.6, help="Umbral de confianza si no hay datos de prueba para calcularlo (0.6)")
    p.add_argument("--sin-ninguna", action="store_true", help="No agregar la clase \"ninguna seña\"")
    p.add_argument("--semilla", type=int, default=42)
    p.add_argument("--forzar", action="store_true",
                   help=f"Con --supabase: instalar en la app aunque la exactitud sea menor a {EXACTITUD_MINIMA_APP * 100:.0f} %%")
    a = p.parse_args(argv)

    if a.demo_sintetico:
        return demo(a)
    if not a.supabase:
        return menu_interactivo(a)

    from signy_ml.supabase_descarga import ErrorSupabase

    if not a.email:
        error("Con --supabase hay que indicar --email (una cuenta admin de la app).")
        return 2
    password = os.environ.get("SIGNY_PASSWORD") or getpass.getpass(f"Contraseña de {a.email}: ")
    try:
        ds = descargar(a.email, password)
    except (ErrorSupabase, DatasetInvalido, OSError) as e:
        error(str(e))
        return 2
    return entrenar_y_guardar(ds, opciones(a), a.salida or SALIDA_ML, a.salida is None, a.forzar)


if __name__ == "__main__":
    sys.exit(main())
