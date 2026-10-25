"""Pruebas del pipeline de ML.   python -m unittest discover -s ml/tests"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from signy_ml.aumentacion import PADRE, _perder_manos, _proporciones, _rotacion_camara, aumentar, espejar  # noqa: E402
from signy_ml.caracteristicas import ConfigCaracteristicas, caracteristicas, dimension_por_frame, seguir_manos, a_isotropico  # noqa: E402
from signy_ml.dataset import Dataset, DatasetInvalido, Muestra, expandir_captura, leer_dataset  # noqa: E402
from signy_ml.modelo import NINGUNA, OpcionesEntrenamiento, calcular_umbral, empalmes, entrenar, probabilidades  # noqa: E402
from signy_ml.sintetico import dataset_sintetico, generar_captura  # noqa: E402
import entrenar as cli  # noqa: E402

CONFIG = ConfigCaracteristicas(frames=10, usar_z=True)


def _ds(nombres, participantes=3, repeticiones=3, semilla=0) -> Dataset:
    crudo = dataset_sintetico(nombres, participantes, repeticiones, semilla)
    ds = Dataset(senas={int(s["id"]): s["palabra"] for s in crudo["senas"]})
    ds.muestras = [Muestra(m["id"], m["senaId"], m["participante"], expandir_captura(m["captura"])) for m in crudo["muestras"]]
    return ds


class TestCaracteristicas(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(1)

    def test_dimension(self):
        vec = caracteristicas(generar_captura("HOLA", self.rng), CONFIG)
        self.assertEqual(vec.shape, (dimension_por_frame(CONFIG) * CONFIG.frames,))
        self.assertEqual(dimension_por_frame(ConfigCaracteristicas(frames=1, usar_z=False)), 85)

    def test_sin_manos_devuelve_none(self):
        self.assertIsNone(caracteristicas({"ancho": 640, "alto": 480, "frames": [{"t": 0, "manos": []}]}, CONFIG))

    def test_invariante_a_posicion(self):
        a = caracteristicas(generar_captura("HOLA", np.random.default_rng(5), ruido=0), CONFIG)
        b = caracteristicas(generar_captura("HOLA", np.random.default_rng(5), ruido=0, dx=0.1, dy=-0.05), CONFIG)
        np.testing.assert_allclose(a, b, atol=1e-9)

    def test_invariante_a_distancia_de_la_camara(self):
        # En una seña sin desplazamiento, acercarse a la cámara solo agranda la mano.
        a = caracteristicas(generar_captura("L", np.random.default_rng(5), ruido=0, tamano=0.15), CONFIG)
        b = caracteristicas(generar_captura("L", np.random.default_rng(5), ruido=0, tamano=0.25), CONFIG)
        np.testing.assert_allclose(a, b, atol=1e-9)

    def test_invariante_a_relacion_de_aspecto(self):
        a = caracteristicas(generar_captura("L", np.random.default_rng(5), ruido=0, ancho=640, alto=480), CONFIG)
        b = caracteristicas(generar_captura("L", np.random.default_rng(5), ruido=0, ancho=480, alto=640), CONFIG)
        np.testing.assert_allclose(a, b, atol=1e-9)

    def test_seguimiento_corrige_intercambio_de_manos(self):
        cap = generar_captura("SEPARAR", np.random.default_rng(2), prob_intercambio=0.5, ruido=0)
        pistas = seguir_manos(a_isotropico(cap))
        xs0 = [p[0][0, 0] for p in pistas if p[0] is not None]
        xs1 = [p[1][0, 0] for p in pistas if p[1] is not None]
        self.assertTrue(all(x > 0.5 * 640 / 480 for x in xs0) or all(x < 0.5 * 640 / 480 for x in xs0))
        self.assertTrue(np.mean(xs0) != np.mean(xs1))

    def test_bandera_de_segunda_mano(self):
        d = dimension_por_frame(CONFIG)
        una = caracteristicas(generar_captura("HOLA", self.rng), CONFIG)
        dos = caracteristicas(generar_captura("SEPARAR", self.rng), CONFIG)
        self.assertTrue(np.all(una[d - 1::d] == 0))
        self.assertTrue(np.all(dos[d - 1::d] == 1))


class TestAumentacion(unittest.TestCase):
    def test_espejar_es_involutivo(self):
        cap = generar_captura("L", np.random.default_rng(1))
        doble = espejar(espejar(cap))
        np.testing.assert_allclose(doble["frames"][3]["manos"][0], cap["frames"][3]["manos"][0], atol=1e-12)

    def test_aumentar_conserva_formato_y_cambia_datos(self):
        cap = generar_captura("HOLA", np.random.default_rng(1))
        aum = aumentar(cap, np.random.default_rng(2))
        self.assertEqual((aum["ancho"], aum["alto"]), (cap["ancho"], cap["alto"]))
        self.assertLessEqual(len(aum["frames"]), len(cap["frames"]))
        self.assertEqual(next(f for f in aum["frames"] if f["manos"])["manos"][0].shape, (21, 3))
        self.assertIsNotNone(caracteristicas(aum, CONFIG))
        self.assertFalse(np.allclose(caracteristicas(aum, CONFIG), caracteristicas(cap, CONFIG)))

    def test_proporciones_cambian_largos_y_conservan_la_muneca(self):
        mano = generar_captura("L", np.random.default_rng(1))["frames"][10]["manos"][0]
        factores = np.ones(21)
        factores[6:9] = 1.2  # solo los huesos del índice (sin el de la palma)
        nueva = _proporciones(mano, factores)
        np.testing.assert_allclose(nueva[:6], mano[:6])
        np.testing.assert_allclose(np.linalg.norm(nueva[8] - nueva[7]), 1.2 * np.linalg.norm(mano[8] - mano[7]))
        self.assertEqual(len(PADRE), 21)

    def test_camara_3d_es_una_rotacion(self):
        R = _rotacion_camara(np.random.default_rng(3), 0.35)
        np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-12)
        self.assertFalse(np.allclose(R, np.eye(3)))

    def test_aumentar_deja_la_profundidad_relativa_a_la_muneca(self):
        aum = aumentar(generar_captura("HOLA", np.random.default_rng(1)), np.random.default_rng(4), ruido=0.0)
        for f in aum["frames"]:
            for m in f["manos"]:
                self.assertAlmostEqual(m[0, 2], 0.0, places=9)

    def test_mediapipe_pierde_manos(self):
        frames = generar_captura("HOLA", np.random.default_rng(1))["frames"]
        perdidos = _perder_manos(frames, np.random.default_rng(0), perdida_max=0.5)
        self.assertEqual(len(perdidos), len(frames))
        self.assertLess(sum(len(f["manos"]) for f in perdidos), sum(len(f["manos"]) for f in frames))


class TestDataset(unittest.TestCase):
    def test_carga_dataset_valido(self):
        ds = leer_dataset(dataset_sintetico(["HOLA", "SI"], 2, 2))
        self.assertEqual(len(ds.muestras), 8)
        self.assertEqual(ds.participantes(), {"p1", "p2"})

    def test_rechaza_formato_desconocido(self):
        with self.assertRaises(DatasetInvalido):
            leer_dataset({"formato": "otro", "version": 1})

    def test_rechaza_muestra_de_sena_inexistente(self):
        d = dataset_sintetico(["HOLA"], 1, 1)
        d["muestras"][0]["senaId"] = 999
        with self.assertRaises(DatasetInvalido):
            leer_dataset(d)

    def test_ignora_manos_corruptas(self):
        cap = expandir_captura({"ancho": 1, "alto": 1, "frames": [{"t": 0, "m": [[1, 2, 3], [float("nan")] * 63, [0.5] * 63]}]})
        self.assertEqual(len(cap["frames"][0]["manos"]), 1)


class TestEntrenamiento(unittest.TestCase):
    def test_reconoce_senas_de_personas_no_vistas(self):
        ds = _ds(["HOLA", "SI", "GRACIAS", "LLAMAR", "L", "SEPARAR"], participantes=4, repeticiones=3)
        r = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, aumentos_por_muestra=4))
        modelo, metricas = r.modelo, r.metricas
        self.assertIn("por persona", metricas["particion"])
        self.assertGreaterEqual(metricas["exactitud"], 0.9)
        # Una ronda por persona: las 4 se prueban y el modelo final las usa a todas.
        self.assertEqual((metricas["rondas"], metricas["personasPrueba"]), (4, 4))
        self.assertEqual(set(metricas["exactitudPorPersona"]), {"p1", "p2", "p3", "p4"})
        self.assertEqual(metricas["muestrasPrueba"], len(ds.muestras))
        self.assertIsNotNone(metricas["desviacionPersonas"])
        self.assertGreaterEqual(metricas["rechazoNinguna"], 0.5)
        rng = np.random.default_rng(123)
        ids = {c["palabra"]: c["senaId"] for c in modelo["clases"]}
        for nombre in ["HOLA", "SI", "L", "SEPARAR"]:
            cap = generar_captura(nombre, rng, tamano=0.2, zurda=True, ancho=480, alto=640)
            p = probabilidades(modelo, caracteristicas(cap, CONFIG))
            self.assertEqual(modelo["clases"][int(np.argmax(p))]["senaId"], ids[nombre.lower()], nombre)

    def test_formato_exportado(self):
        modelo = entrenar(_ds(["HOLA", "L"], 2, 3), OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1)).modelo
        self.assertEqual(modelo["formato"], "signy-clasificador")
        self.assertEqual(modelo["capas"][0]["entrada"], dimension_por_frame(CONFIG) * CONFIG.frames)
        self.assertEqual(modelo["capas"][-1]["salida"], 3)  # hola, l y "ninguna seña"
        self.assertIn(NINGUNA, [c["senaId"] for c in modelo["clases"]])
        self.assertEqual(modelo["capas"][-1]["activacion"], "softmax")
        json.dumps(modelo)  # serializable

    def test_json_de_la_app_reproduce_al_tflite(self):
        """BatchNorm fusionada + pesos float16 (app) ≈ el .tflite que exporta TensorFlow."""
        import tensorflow as tf

        ds = _ds(["HOLA", "SI", "L"], 2, 2)
        r = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(16, 8), aumentos_por_muestra=2, epocas=20))
        interprete = tf.lite.Interpreter(model_content=r.tflite)
        interprete.allocate_tensors()
        entrada, salida = interprete.get_input_details()[0], interprete.get_output_details()[0]
        self.assertEqual(r.etiquetas, [c["palabra"] for c in r.modelo["clases"]])
        for m in ds.muestras[:6]:
            x = caracteristicas(m.captura, CONFIG)
            interprete.set_tensor(entrada["index"], x[None].astype(np.float32))
            interprete.invoke()
            np.testing.assert_allclose(probabilidades(r.modelo, x), interprete.get_tensor(salida["index"])[0], atol=0.02)

    def test_umbral_calculado_es_el_menor_que_logra_la_precision(self):
        real = np.array([1, 1, 2, 2, NINGUNA])
        pred = np.array([1, 2, 2, 1, 1])
        conf = np.array([0.9, 0.55, 0.8, 0.6, 0.7])
        # Con 0.75 solo quedan aceptadas las dos correctas (0.9 y 0.8).
        self.assertEqual(calcular_umbral(real, pred, conf, 0.95), 0.75)
        self.assertIsNone(calcular_umbral(real, pred, conf * 0.1, 0.95))  # nada supera 0.5

    def test_empalmes_mezclan_senas_distintas(self):
        ds = _ds(["HOLA", "SI"], 1, 2)
        negativos = empalmes([m.captura for m in ds.muestras], [m.sena_id for m in ds.muestras], 5, np.random.default_rng(0))
        self.assertEqual(len(negativos), 5)
        self.assertTrue(all(caracteristicas(n, CONFIG) is not None for n in negativos))
        self.assertEqual(empalmes([ds.muestras[0].captura], [1], 3, np.random.default_rng(0)), [])

    def test_rechaza_una_sola_sena(self):
        with self.assertRaises(ValueError):
            entrenar(_ds(["HOLA"], 2, 2))


def _captura_compuesta(rng, **kw) -> dict:
    """HOLA (1 mano) seguida de SEPARAR (2 manos): como una seña que cambia de cantidad de
    manos a mitad de camino. La referencia DTW de la app no reconoce bien este cambio (ver
    `cambioDeManos` en motor-senas/seguimiento.ts), pero el clasificador sí debería, porque
    calcula sus características cuadro a cuadro."""
    a = generar_captura("HOLA", rng, duracion_ms=700, pausa_antes_ms=100, pausa_despues_ms=0, **kw)
    b = generar_captura("SEPARAR", rng, duracion_ms=700, pausa_antes_ms=0, pausa_despues_ms=100, **kw)
    fin = a["frames"][-1]["t"]
    return {"ancho": a["ancho"], "alto": a["alto"], "frames": a["frames"] + [{"t": f["t"] + fin, "manos": f["manos"]} for f in b["frames"]]}


def _ds_compuesta(participantes=4, repeticiones=3, semilla=0) -> Dataset:
    """Dataset con una seña COMPUESTA y sus dos mitades por separado (HOLA, SEPARAR) como
    distractoras: si el clasificador solo aprendiera "alguna mano se mueve", confundiría la
    compuesta con una de sus mitades."""
    rng = np.random.default_rng(semilla)
    ds = Dataset(senas={1: "compuesta", 2: "hola", 3: "separar"})
    for p in range(participantes):
        persona = dict(tamano=float(rng.uniform(0.15, 0.22)), proporcion=float(rng.uniform(0.95, 1.05)))
        for _ in range(repeticiones):
            ds.muestras.append(Muestra(len(ds.muestras) + 1, 1, f"p{p + 1}", _captura_compuesta(rng, **persona)))
            ds.muestras.append(Muestra(len(ds.muestras) + 1, 2, f"p{p + 1}",
                                       generar_captura("HOLA", rng, duracion_ms=1200, pausa_antes_ms=200, pausa_despues_ms=200, **persona)))
            ds.muestras.append(Muestra(len(ds.muestras) + 1, 3, f"p{p + 1}",
                                       generar_captura("SEPARAR", rng, duracion_ms=1200, pausa_antes_ms=200, pausa_despues_ms=200, **persona)))
    return ds


class TestSenaCompuesta(unittest.TestCase):
    """Una seña que cambia de cantidad de manos (p. ej. 1 mano y después 2): fase 3 del plan
    de señas compuestas. Prueba que el clasificador SÍ la distingue, a diferencia de la
    referencia DTW de la app (que no puede representar el cambio: ver sena-trainer-modal)."""

    def test_distingue_la_compuesta_de_sus_dos_mitades(self):
        ds = _ds_compuesta()
        r = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, aumentos_por_muestra=4))
        self.assertGreaterEqual(r.metricas["exactitud"], 0.9)

        ids = {c["palabra"]: c["senaId"] for c in r.modelo["clases"]}
        vector = caracteristicas(_captura_compuesta(np.random.default_rng(999)), CONFIG)
        p = probabilidades(r.modelo, vector)
        self.assertEqual(r.modelo["clases"][int(np.argmax(p))]["senaId"], ids["compuesta"])


class TestPocasMuestras(unittest.TestCase):
    """Lo normal al empezar a grabar: muchas señas con pocas muestras y una sola persona."""

    OP = OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1)

    def test_muchas_senas_con_2_muestras_cada_una(self):
        # Antes: "The test_size = 4 should be greater or equal to the number of classes = 8".
        ds = _ds(["HOLA", "SI", "GRACIAS", "LLAMAR", "A", "L", "SEPARAR", "JUNTAR"], participantes=1, repeticiones=2)
        r = entrenar(ds, self.OP)
        modelo, metricas = r.modelo, r.metricas
        self.assertEqual(len(modelo["clases"]), 8 + 1)
        self.assertEqual(metricas["muestrasPrueba"], 8)  # una de cada seña
        self.assertIsNotNone(metricas["exactitud"])

    def test_una_muestra_por_sena_entrena_sin_evaluar(self):
        # Antes: "At least one label specified must be in y_true".
        r = entrenar(_ds(["HOLA", "SI"], participantes=1, repeticiones=1), self.OP)
        modelo, metricas = r.modelo, r.metricas
        self.assertEqual(len(modelo["clases"]), 2 + 1)
        self.assertIn("sin evaluación", metricas["particion"])
        self.assertIsNone(metricas["exactitud"])

    def test_senas_con_una_sola_muestra_mezcladas(self):
        ds = _ds(["HOLA", "SI", "A"], participantes=1, repeticiones=3)
        quitar = {m.id for m in ds.muestras if m.sena_id == 3}
        quitar.discard(min(quitar))  # la seña "a" queda con 1 sola muestra
        ds.muestras = [m for m in ds.muestras if m.id not in quitar]
        r = entrenar(ds, self.OP)
        modelo, metricas = r.modelo, r.metricas
        self.assertEqual(len(modelo["clases"]), 3 + 1)
        self.assertIn("no estratificada", metricas["particion"])

    def test_por_persona_si_una_persona_grabo_senas_que_otras_no(self):
        ds = _ds(["HOLA", "SI", "L"], participantes=3, repeticiones=2)
        ds.muestras = [m for m in ds.muestras if not (m.sena_id == 3 and m.participante != "p1")]
        r = entrenar(ds, self.OP)
        modelo, metricas = r.modelo, r.metricas
        self.assertEqual(len(modelo["clases"]), 3 + 1)
        self.assertIsNotNone(metricas["exactitud"])

    def test_reporte_cuenta_personas_por_sena(self):
        ds = _ds(["HOLA", "SI"], participantes=2, repeticiones=2)
        self.assertEqual(ds.personas_por_sena(), {1: 2, 2: 2})
        r = entrenar(ds, self.OP)
        ruta = Path(tempfile.mkdtemp()) / "reporte.md"
        cli.escribir_reporte(ruta, ds, r.metricas, r.modelo, Path("modelo.json"), 10)
        texto = ruta.read_text(encoding="utf-8")
        self.assertIn("| Seña | Muestras | Personas |", texto)
        self.assertIn("| hola | 4 ⚠️ pocas | 2 ⚠️ |", texto)


class TestReporte(unittest.TestCase):
    def test_sena_sin_muestras_de_prueba_no_aparece_como_0_por_ciento(self):
        ds = _ds(["HOLA", "SI"], participantes=1, repeticiones=2)
        metricas = {"particion": "por persona", "muestrasPrueba": 2, "personasPrueba": 1, "exactitud": 1.0,
                    "exactitudSobreUmbral": 1.0, "coberturaUmbral": 1.0, "exactitudPorPersona": {}, "desviacionPersonas": None,
                    "rechazoNinguna": None, "umbralCalculado": False,
                    "reporte": {"hola": {"precision": 1.0, "recall": 1.0, "support": 2}}, "confusion": [], "clasesConfusion": []}
        ruta = Path(tempfile.mkdtemp()) / "reporte.md"
        cli.escribir_reporte(ruta, ds, metricas, {"umbralSugerido": 0.6}, Path("m.json"), 1)
        texto = ruta.read_text(encoding="utf-8")
        self.assertIn("Muestras de prueba: 2 de 4 (1 persona(s))", texto)
        self.assertIn("| si | 2 ⚠️ pocas | 1 ⚠️ | — (sin prueba) | — (sin prueba) |", texto)
        self.assertIn("| hola | 2 ⚠️ pocas | 1 ⚠️ | 100.0 % | 100.0 % |", texto)

    def test_palabra_repetida_en_dos_senas_avisa_y_se_distingue_en_el_reporte(self):
        crudo = dataset_sintetico(["HOLA", "SI", "L"], 2, 2)
        for sena in crudo["senas"]:
            if sena["palabra"] == "l":
                sena["palabra"] = "Hola "  # misma palabra que la seña 1, en otro subnivel
        ds = leer_dataset(crudo)
        self.assertEqual(ds.palabras_repetidas(), {"hola": [1, 3]})
        self.assertEqual((ds.nombre(1), ds.nombre(3), ds.nombre(2)), ("hola (#1)", "Hola  (#3)", "si"))
        from contextlib import redirect_stdout
        from io import StringIO
        salida = StringIO()
        with redirect_stdout(salida):
            codigo = cli.entrenar_y_guardar(ds, OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1),
                                            Path(tempfile.mkdtemp()), False)
        self.assertEqual(codigo, 0)
        self.assertIn('La palabra "hola" está en 2 señas distintas (ids 1, 3)', salida.getvalue())


class TestCLI(unittest.TestCase):
    def test_demo_sintetico_genera_modelo_y_reporte(self):
        salida = Path(tempfile.mkdtemp())
        self.assertEqual(cli.main(["--demo-sintetico", "--salida", str(salida), "--aumentos", "2", "--capas", "16"]), 0)
        self.assertEqual(json.loads((salida / "model_weights.json").read_text())["formato"], "signy-clasificador")
        self.assertEqual(len(json.loads((salida / "labels.json").read_text(encoding="utf-8"))), 7 + 1)
        self.assertGreater((salida / "model.tflite").stat().st_size, 0)

    def test_modelo_sin_evaluar_no_se_instala_en_la_app(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest import mock

        app = Path(tempfile.mkdtemp()) / "clasificador-senas.json"
        op = OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1, epocas=2)
        with mock.patch.object(cli, "SALIDA_APP", app), redirect_stdout(StringIO()) as salida:
            self.assertEqual(cli.entrenar_y_guardar(_ds(["HOLA", "SI"], 1, 1), op, Path(tempfile.mkdtemp()), True), 0)
        self.assertFalse(app.exists())
        self.assertIn("No se instala en la app", salida.getvalue())

    def test_bajo_el_minimo_con_preguntar_instala_si_el_usuario_dice_que_si(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest import mock

        app = Path(tempfile.mkdtemp()) / "clasificador-senas.json"
        op = OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1, epocas=2)
        with mock.patch.object(cli, "SALIDA_APP", app), mock.patch.object(cli, "ConfirmarSiNo") as confirm, redirect_stdout(StringIO()):
            confirm.ask.return_value = True
            codigo = cli.entrenar_y_guardar(_ds(["HOLA", "SI"], 1, 1), op, Path(tempfile.mkdtemp()), True, preguntar=True)
        self.assertEqual(codigo, 0)
        self.assertTrue(app.exists())
        confirm.ask.assert_called_once()

    def test_bajo_el_minimo_con_preguntar_no_instala_si_el_usuario_dice_que_no(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from unittest import mock

        app = Path(tempfile.mkdtemp()) / "clasificador-senas.json"
        op = OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1, epocas=2)
        with mock.patch.object(cli, "SALIDA_APP", app), mock.patch.object(cli, "ConfirmarSiNo") as confirm, redirect_stdout(StringIO()):
            confirm.ask.return_value = False
            codigo = cli.entrenar_y_guardar(_ds(["HOLA", "SI"], 1, 1), op, Path(tempfile.mkdtemp()), True, preguntar=True)
        self.assertEqual(codigo, 0)
        self.assertFalse(app.exists())

    def test_terminal_sin_utf8_no_lo_hace_caer(self):
        # Git Bash / terminales de Windows en cp1252: antes UnicodeEncodeError en el primer "⚠️".
        salida = Path(tempfile.mkdtemp())
        r = subprocess.run(
            [sys.executable, str(RAIZ / "entrenar.py"), "--demo-sintetico", "--salida", str(salida), "--aumentos", "1", "--capas", "8"],
            capture_output=True, env={**os.environ, "PYTHONIOENCODING": "cp1252"}, timeout=300,
        )
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertIn("Modelo guardado", r.stdout.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
