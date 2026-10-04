"""Pruebas del pipeline de ML.   python -m unittest discover -s ml/tests"""
from __future__ import annotations

import json
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


class TestCLI(unittest.TestCase):
    def test_demo_sintetico_genera_modelo_y_reporte(self):
        salida = Path(tempfile.mkdtemp()) / "modelo.json"
        self.assertEqual(cli.main(["--demo-sintetico", "--salida", str(salida), "--aumentos", "2", "--capas", "16"]), 0)
        self.assertEqual(json.loads(salida.read_text())["formato"], "signy-clasificador")

    def test_dataset_inexistente_falla_limpio(self):
        self.assertEqual(cli.main(["--dataset", "/no/existe.json"]), 2)


if __name__ == "__main__":
    unittest.main()
