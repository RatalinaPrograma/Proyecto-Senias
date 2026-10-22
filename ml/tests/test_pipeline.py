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

from signy_ml.aumentacion import aumentar, espejar  # noqa: E402
from signy_ml.caracteristicas import ConfigCaracteristicas, caracteristicas, dimension_por_frame, seguir_manos, a_isotropico  # noqa: E402
from signy_ml.dataset import Dataset, DatasetInvalido, Muestra, cargar_dataset, expandir_captura  # noqa: E402
from signy_ml.modelo import OpcionesEntrenamiento, capas_desde_red, entrenar, probabilidades  # noqa: E402
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
        self.assertEqual(aum["frames"][5]["manos"][0].shape, (21, 3))
        self.assertIsNotNone(caracteristicas(aum, CONFIG))
        self.assertFalse(np.allclose(caracteristicas(aum, CONFIG), caracteristicas(cap, CONFIG)))


class TestDataset(unittest.TestCase):
    def _escribir(self, contenido) -> Path:
        ruta = Path(tempfile.mkdtemp()) / "ds.json"
        ruta.write_text(json.dumps(contenido), encoding="utf-8")
        return ruta

    def test_carga_dataset_valido(self):
        ds = cargar_dataset(self._escribir(dataset_sintetico(["HOLA", "SI"], 2, 2)))
        self.assertEqual(len(ds.muestras), 8)
        self.assertEqual(ds.participantes(), {"p1", "p2"})

    def test_rechaza_formato_desconocido(self):
        with self.assertRaises(DatasetInvalido):
            cargar_dataset(self._escribir({"formato": "otro", "version": 1}))

    def test_rechaza_muestra_de_sena_inexistente(self):
        d = dataset_sintetico(["HOLA"], 1, 1)
        d["muestras"][0]["senaId"] = 999
        with self.assertRaises(DatasetInvalido):
            cargar_dataset(self._escribir(d))

    def test_ignora_manos_corruptas(self):
        cap = expandir_captura({"ancho": 1, "alto": 1, "frames": [{"t": 0, "m": [[1, 2, 3], [float("nan")] * 63, [0.5] * 63]}]})
        self.assertEqual(len(cap["frames"][0]["manos"]), 1)


class TestEntrenamiento(unittest.TestCase):
    def test_reconoce_senas_de_personas_no_vistas(self):
        ds = _ds(["HOLA", "SI", "GRACIAS", "LLAMAR", "L", "SEPARAR"], participantes=4, repeticiones=3)
        modelo, metricas = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, aumentos_por_muestra=4))
        self.assertIn("por persona", metricas["particion"])
        self.assertGreaterEqual(metricas["exactitud"], 0.9)
        rng = np.random.default_rng(123)
        ids = {c["palabra"]: c["senaId"] for c in modelo["clases"]}
        for nombre in ["HOLA", "SI", "L", "SEPARAR"]:
            cap = generar_captura(nombre, rng, tamano=0.2, zurda=True, ancho=480, alto=640)
            p = probabilidades(modelo, caracteristicas(cap, CONFIG))
            self.assertEqual(modelo["clases"][int(np.argmax(p))]["senaId"], ids[nombre.lower()], nombre)

    def test_formato_exportado(self):
        modelo, _ = entrenar(_ds(["HOLA", "L"], 2, 3), OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1))
        self.assertEqual(modelo["formato"], "signy-clasificador")
        self.assertEqual(modelo["capas"][0]["entrada"], dimension_por_frame(CONFIG) * CONFIG.frames)
        self.assertEqual(modelo["capas"][-1]["salida"], 2)  # binario → softmax de 2
        self.assertEqual(modelo["capas"][-1]["activacion"], "softmax")
        json.dumps(modelo)  # serializable

    def test_binario_equivale_a_logistica(self):
        from sklearn.neural_network import MLPClassifier

        rng = np.random.default_rng(0)
        X = rng.normal(size=(40, 3))
        y = (X[:, 0] > 0).astype(int)
        red = MLPClassifier(hidden_layer_sizes=(4,), max_iter=500, random_state=0).fit(X, y)
        x = X[:5]
        for W, b, act in capas_desde_red(red):
            z = x @ W + b
            x = np.maximum(z, 0) if act == "relu" else np.exp(z - z.max(axis=1, keepdims=True))
        x = x / x.sum(axis=1, keepdims=True)
        np.testing.assert_allclose(x, red.predict_proba(X[:5]), atol=1e-9)

    def test_rechaza_una_sola_sena(self):
        with self.assertRaises(ValueError):
            entrenar(_ds(["HOLA"], 2, 2))


class TestPocasMuestras(unittest.TestCase):
    """Lo normal al empezar a grabar: muchas señas con pocas muestras y una sola persona."""

    OP = OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1)

    def test_muchas_senas_con_2_muestras_cada_una(self):
        # Antes: "The test_size = 4 should be greater or equal to the number of classes = 8".
        ds = _ds(["HOLA", "SI", "GRACIAS", "LLAMAR", "A", "L", "SEPARAR", "JUNTAR"], participantes=1, repeticiones=2)
        modelo, metricas = entrenar(ds, self.OP)
        self.assertEqual(len(modelo["clases"]), 8)
        self.assertEqual(metricas["muestrasPrueba"], 8)  # una de cada seña
        self.assertIsNotNone(metricas["exactitud"])

    def test_una_muestra_por_sena_entrena_sin_evaluar(self):
        # Antes: "At least one label specified must be in y_true".
        modelo, metricas = entrenar(_ds(["HOLA", "SI"], participantes=1, repeticiones=1), self.OP)
        self.assertEqual(len(modelo["clases"]), 2)
        self.assertIn("sin evaluación", metricas["particion"])
        self.assertIsNone(metricas["exactitud"])

    def test_senas_con_una_sola_muestra_mezcladas(self):
        ds = _ds(["HOLA", "SI", "A"], participantes=1, repeticiones=3)
        quitar = {m.id for m in ds.muestras if m.sena_id == 3}
        quitar.discard(min(quitar))  # la seña "a" queda con 1 sola muestra
        ds.muestras = [m for m in ds.muestras if m.id not in quitar]
        modelo, metricas = entrenar(ds, self.OP)
        self.assertEqual(len(modelo["clases"]), 3)
        self.assertIn("no estratificada", metricas["particion"])

    def test_por_persona_si_una_persona_grabo_senas_que_otras_no(self):
        ds = _ds(["HOLA", "SI", "L"], participantes=3, repeticiones=2)
        ds.muestras = [m for m in ds.muestras if not (m.sena_id == 3 and m.participante != "p1")]
        modelo, metricas = entrenar(ds, self.OP)
        self.assertEqual(len(modelo["clases"]), 3)
        self.assertIsNotNone(metricas["exactitud"])

    def test_reporte_cuenta_personas_por_sena(self):
        ds = _ds(["HOLA", "SI"], participantes=2, repeticiones=2)
        self.assertEqual(ds.personas_por_sena(), {1: 2, 2: 2})
        modelo, metricas = entrenar(ds, self.OP)
        ruta = Path(tempfile.mkdtemp()) / "reporte.md"
        cli.escribir_reporte(ruta, ds, metricas, modelo, Path("modelo.json"), 10)
        texto = ruta.read_text(encoding="utf-8")
        self.assertIn("| Seña | Muestras | Personas |", texto)
        self.assertIn("| hola | 4 ⚠️ pocas | 2 ⚠️ |", texto)


class TestReporte(unittest.TestCase):
    def test_sena_sin_muestras_de_prueba_no_aparece_como_0_por_ciento(self):
        ds = _ds(["HOLA", "SI"], participantes=1, repeticiones=2)
        metricas = {"particion": "por persona", "muestrasPrueba": 2, "personasPrueba": 1, "exactitud": 1.0,
                    "exactitudSobreUmbral": 1.0, "coberturaUmbral": 1.0,
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
        ruta = Path(tempfile.mkdtemp()) / "ds.json"
        ruta.write_text(json.dumps(crudo), encoding="utf-8")
        ds = cargar_dataset(ruta)
        self.assertEqual(ds.palabras_repetidas(), {"hola": [1, 3]})
        self.assertEqual((ds.nombre(1), ds.nombre(3), ds.nombre(2)), ("hola (#1)", "Hola  (#3)", "si"))
        from contextlib import redirect_stdout
        from io import StringIO
        salida = StringIO()
        with redirect_stdout(salida):
            codigo = cli.main(["--dataset", str(ruta), "--salida", str(ruta.parent / "m.json"), "--aumentos", "1", "--capas", "8"])
        self.assertEqual(codigo, 0)
        self.assertIn('La palabra "hola" está en 2 señas distintas (ids 1, 3)', salida.getvalue())


class TestCLI(unittest.TestCase):
    def test_demo_sintetico_genera_modelo_y_reporte(self):
        salida = Path(tempfile.mkdtemp()) / "modelo.json"
        self.assertEqual(cli.main(["--demo-sintetico", "--salida", str(salida), "--aumentos", "2", "--capas", "16"]), 0)
        self.assertEqual(json.loads(salida.read_text())["formato"], "signy-clasificador")

    def test_dataset_inexistente_falla_limpio(self):
        self.assertEqual(cli.main(["--dataset", "/no/existe.json"]), 2)

    def test_terminal_sin_utf8_no_lo_hace_caer(self):
        # Git Bash / terminales de Windows en cp1252: antes UnicodeEncodeError en el primer "⚠️".
        salida = Path(tempfile.mkdtemp()) / "modelo.json"
        r = subprocess.run(
            [sys.executable, str(RAIZ / "entrenar.py"), "--demo-sintetico", "--salida", str(salida), "--aumentos", "1", "--capas", "8"],
            capture_output=True, env={**os.environ, "PYTHONIOENCODING": "cp1252"}, timeout=300,
        )
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertIn("Modelo guardado", r.stdout.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
