"""Pruebas del importador de modelos TFLite.   python -m unittest discover -s ml/tests"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import importar_tflite as cli  # noqa: E402
from signy_ml.caracteristicas import ConfigCaracteristicas, dimension_por_frame  # noqa: E402
from signy_ml.modelo import probabilidades  # noqa: E402
from signy_ml.tflite_import import inferir, leer_mlp_tflite  # noqa: E402

SALIDA_NACHO = RAIZ / "output"
HAY_MODELO_NACHO = (SALIDA_NACHO / "model.tflite").exists()


@unittest.skipUnless(HAY_MODELO_NACHO, "no está ml/output/model.tflite")
class TestModeloDeNacho(unittest.TestCase):
    """Usa el modelo real que subió Nacho a dev (ml/output)."""

    def setUp(self):
        self.capas = leer_mlp_tflite(SALIDA_NACHO / "model.tflite")
        self.json = json.loads((SALIDA_NACHO / "model_weights.json").read_text(encoding="utf-8"))

    def test_lee_la_arquitectura(self):
        self.assertEqual([W.shape for W, _, _ in self.capas], [(64, 64), (64, 32), (32, 4)])
        self.assertEqual([a for _, _, a in self.capas], ["relu", "relu", "softmax"])

    def test_primera_capa_coincide_con_los_pesos_de_keras(self):
        # Comparación contra un artefacto independiente (el JSON exportado desde Keras).
        W = np.array(self.json["capas"]["densa1"]["pesos"])
        self.assertLess(np.abs(self.capas[0][0] - W).max(), 0.01)

    def test_el_json_no_incluye_la_batchnorm(self):
        # Por esto se lee el .tflite: la 2.ª capa del JSON no tiene la BatchNorm
        # fusionada y por lo tanto no es el modelo que se entrenó.
        W2 = np.array(self.json["capas"]["densa2"]["pesos"])
        self.assertGreater(np.abs(self.capas[1][0] - W2).max(), 1.0)

    def test_probabilidades_validas(self):
        p = inferir(self.capas, np.random.default_rng(0).normal(size=(10, 64)))
        np.testing.assert_allclose(p.sum(axis=1), 1.0, atol=1e-9)

    def test_rechaza_importarlo_si_no_usa_las_caracteristicas_de_signy(self):
        ds = Path(tempfile.mkdtemp()) / "ds.json"
        ds.write_text(json.dumps({"senas": [
            {"id": 1, "palabra": "¿Cómo estás?"}, {"id": 2, "palabra": "chao"}, {"id": 3, "palabra": "Gracias"}, {"id": 4, "palabra": "hola"},
        ]}), encoding="utf-8")
        err = io.StringIO()
        with redirect_stderr(err):
            codigo = cli.main(["--modelo", str(SALIDA_NACHO / "model.tflite"), "--etiquetas", str(SALIDA_NACHO / "labels.json"),
                               "--dataset", str(ds), "--salida", str(ds.parent / "m.json")])
        self.assertEqual(codigo, 2)
        self.assertIn("espera 64 entradas", err.getvalue())
        self.assertFalse((ds.parent / "m.json").exists())


class TestConversion(unittest.TestCase):
    def test_asocia_etiquetas_sin_importar_tildes_ni_signos(self):
        clases = cli.asociar_etiquetas(["¿Cómo estás?", "HOLA"], [{"id": 7, "palabra": "como estas"}, {"id": 8, "palabra": "Hola"}])
        self.assertEqual([c["senaId"] for c in clases], [7, 8])
        with self.assertRaises(ValueError):
            cli.asociar_etiquetas(["gato"], [{"id": 1, "palabra": "perro"}])

    def test_convertido_reproduce_al_original(self):
        config = ConfigCaracteristicas(frames=4, usar_z=False)
        dim = dimension_por_frame(config) * config.frames
        rng = np.random.default_rng(1)
        capas = [(rng.normal(size=(dim, 16)) * 0.1, rng.normal(size=16) * 0.1, "relu"),
                 (rng.normal(size=(16, 3)) * 0.3, rng.normal(size=3) * 0.1, "softmax")]
        clases = [{"senaId": i, "palabra": f"s{i}"} for i in range(3)]
        media, escala = rng.normal(size=dim), rng.uniform(0.5, 2, size=dim)
        modelo = cli.convertir(capas, clases, config, media, escala)
        self.assertLess(cli.verificar(modelo, capas, media, escala), 0.02)
        x = rng.normal(size=dim)
        np.testing.assert_allclose(probabilidades(modelo, x), inferir(capas, (x - media) / escala), atol=0.02)
        self.assertEqual(modelo["formato"], "signy-clasificador")


if __name__ == "__main__":
    unittest.main()
