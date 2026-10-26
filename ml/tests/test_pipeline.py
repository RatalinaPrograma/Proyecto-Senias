"""Pruebas del pipeline de ML.   python -m unittest discover -s ml/tests"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from signy_ml.aumentacion import PADRE, _congelar_frames, _perder_manos, _proporciones, _rotacion_camara, aumentar, espejar  # noqa: E402
from signy_ml.caracteristicas import ConfigCaracteristicas, caracteristicas, dimension_por_frame, seguir_manos, a_isotropico  # noqa: E402
from signy_ml.dataset import Dataset, DatasetInvalido, Muestra, expandir_captura, leer_dataset  # noqa: E402
from signy_ml.modelo import NINGUNA, OpcionesEntrenamiento, calcular_umbral, empalmes, entrenar, probabilidades  # noqa: E402
from signy_ml.sintetico import dataset_sintetico, generar_captura  # noqa: E402
import entrenar as cli  # noqa: E402

CONFIG = ConfigCaracteristicas(frames=10, usar_z=True)


def _ds(nombres, participantes=3, repeticiones=3, semilla=0) -> Dataset:
    crudo = dataset_sintetico(nombres, participantes, repeticiones, semilla)
    ds = Dataset(senas={int(s["id"]): s["palabra"] for s in crudo["senas"]})
    ds.muestras = [Muestra(m["id"], m["senaId"], expandir_captura(m["captura"]), m["participante"]) for m in crudo["muestras"]]
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


class TestManoEnReposo(unittest.TestCase):
    """La otra mano descansando abajo (toma de la cintura hacia arriba) no debe cambiar el vector."""

    def test_mano_de_una_sena_igual_con_o_sin_la_otra_mano_abajo(self):
        for nombre in ["HOLA", "GRACIAS", "L"]:
            sin = caracteristicas(generar_captura(nombre, np.random.default_rng(3), ruido=0), CONFIG)
            con = caracteristicas(generar_captura(nombre, np.random.default_rng(3), ruido=0, mano_reposo=True), CONFIG)
            np.testing.assert_allclose(con, sin, atol=1e-9, err_msg=nombre)

    def test_zurdo_con_la_otra_mano_abajo_igual_que_zurdo_sin_ella(self):
        sin = caracteristicas(generar_captura("HOLA", np.random.default_rng(3), ruido=0, zurda=True), CONFIG)
        con = caracteristicas(generar_captura("HOLA", np.random.default_rng(3), ruido=0, zurda=True, mano_reposo=True), CONFIG)
        np.testing.assert_allclose(con, sin, atol=1e-9)

    def test_como_se_graba_de_verdad_parte_abajo_sube_y_vuelve(self):
        # Las dos manos parten abajo; una sube a hacer la seña y vuelve: la que se queda abajo no cuenta.
        for nombre in ["HOLA", "GRACIAS", "L"]:
            kw = dict(ruido=0, pausa_antes_ms=400.0, pausa_despues_ms=400.0, inicio_abajo=True)
            sin = caracteristicas(generar_captura(nombre, np.random.default_rng(4), **kw), CONFIG)
            con = caracteristicas(generar_captura(nombre, np.random.default_rng(4), mano_reposo=True, **kw), CONFIG)
            np.testing.assert_allclose(con, sin, atol=1e-9, err_msg=nombre)

    def test_mano_base_tocada_varias_veces_se_conserva(self):
        # El índice baja a tocar la palma de la otra mano (quieta): es una seña de dos manos.
        from signy_ml.sintetico import POSES, mano_local
        rng = np.random.default_rng(2)
        indice, palma = mano_local(POSES["indice"]), mano_local(POSES["palma"])
        indice[:, 1] = -indice[:, 1]  # dedo apuntando hacia abajo
        frames = []
        for i in range(60):
            y = 0.30 + 0.17 * abs(math.sin(i / 59 * math.pi * 2))
            frames.append({"t": i * 33.0, "manos": [indice * 0.15 + np.array([0.50, y, 0.0]),
                                                     palma * 0.15 + np.array([0.50, 0.62, 0.0]) + rng.normal(0, 0.002, (21, 3))]})
        vec = caracteristicas({"ancho": 1, "alto": 1, "frames": frames}, CONFIG)
        d = dimension_por_frame(CONFIG)
        self.assertTrue(np.all(vec[d - 1::d] == 1))

    def test_mano_base_quieta_de_una_sena_de_dos_manos_no_se_descarta(self):
        # Una mano quieta (base) y la otra baja a tocarla: la base está cerca, no "lejos abajo".
        from signy_ml.sintetico import POSES, mano_local
        rng = np.random.default_rng(1)
        base, activa = mano_local(POSES["palma"]), mano_local(POSES["indice"])
        frames = []
        for i in range(40):
            y = 0.40 + 0.16 * math.sin(i / 39 * math.pi)
            m1 = activa * 0.18 + np.array([0.52, y, 0.0])
            m2 = base * 0.18 + np.array([0.53, 0.62, 0.0]) + rng.normal(0, 0.001, (21, 3))
            frames.append({"t": i * 33.0, "manos": [m1, m2]})
        vec = caracteristicas({"ancho": 1, "alto": 1, "frames": frames}, CONFIG)
        d = dimension_por_frame(CONFIG)
        self.assertTrue(np.all(vec[d - 1::d] == 1))

    def test_sena_de_dos_manos_que_se_mueven_no_cambia(self):
        d = dimension_por_frame(CONFIG)
        vec = caracteristicas(generar_captura("SEPARAR", np.random.default_rng(2)), CONFIG)
        self.assertTrue(np.all(vec[d - 1::d] == 1))


class TestCalidad(unittest.TestCase):
    """Revisión de cada grabación (ml/revisar_dataset.py)."""

    def _avisos(self, r):
        return " ".join(t for nivel, t in r["avisos"] if nivel != "info")

    def test_grabacion_buena_sale_verde_e_informa_la_mano_de_abajo(self):
        from signy_ml.calidad import evaluar_muestra
        r = evaluar_muestra(generar_captura("GRACIAS", np.random.default_rng(1), pausa_despues_ms=600, mano_reposo=True), "dinamica", 1)
        self.assertEqual(r["nivel"], "verde", r["avisos"])
        self.assertTrue(r["otraManoAbajo"])

    def test_detecta_sena_cortada_al_final(self):
        from signy_ml.calidad import evaluar_muestra
        cap = generar_captura("GRACIAS", np.random.default_rng(2), duracion_ms=1500, pausa_antes_ms=100, pausa_despues_ms=0)
        cap["frames"] = [f for f in cap["frames"] if f["t"] <= 900]
        self.assertIn("cortada", self._avisos(evaluar_muestra(cap, "dinamica", 1)))

    def test_detecta_mano_perdida_por_movimiento_rapido(self):
        from signy_ml.calidad import evaluar_muestra
        cap = generar_captura("GRACIAS", np.random.default_rng(3), pausa_despues_ms=600)
        for f in cap["frames"]:
            if 400 <= f["t"] <= 1200:
                f["manos"] = []
        r = evaluar_muestra(cap, "dinamica", 1)
        self.assertEqual(r["nivel"], "rojo")
        self.assertIn("Se perdió la mano", self._avisos(r))

    def test_subir_y_bajar_desde_la_cintura_no_es_un_problema(self):
        # Como en las grabaciones reales: la mano parte en la cintura, sube, hace la seña y vuelve a bajar.
        from signy_ml.calidad import evaluar_muestra
        cap = generar_captura("HOLA", np.random.default_rng(7), pausa_antes_ms=500, pausa_despues_ms=600,
                              inicio_abajo=True, mano_reposo=True)
        self.assertEqual(evaluar_muestra(cap, "dinamica", 1)["nivel"], "verde")
        # Perderla un momento mientras sube (borrosa) solo se informa.
        for f in cap["frames"]:
            if 100 <= f["t"] <= 500 and f["manos"]:
                f["manos"] = f["manos"][1:]
        r = evaluar_muestra(cap, "dinamica", 1)
        self.assertEqual(r["nivel"], "verde", r["avisos"])
        self.assertIn("al subirla o bajarla", " ".join(t for _, t in r["avisos"]))

    def test_saltos_solo_entre_frames_seguidos(self):
        # Reaparecer en otro lugar después de perderse no es un "salto brusco".
        from signy_ml.calidad import evaluar_muestra
        cap = generar_captura("HOLA", np.random.default_rng(8), pausa_antes_ms=500, pausa_despues_ms=600, inicio_abajo=True)
        for f in cap["frames"]:
            if 150 <= f["t"] <= 400:  # se pierde mientras sube: reaparece bastante más arriba
                f["manos"] = []
        self.assertEqual(evaluar_muestra(cap, "dinamica", 1)["saltos"], 0)

    def test_sena_de_dos_manos_con_una_sola_visible(self):
        from signy_ml.calidad import evaluar_muestra
        r = evaluar_muestra(generar_captura("HOLA", np.random.default_rng(4)), "dinamica", 2)
        self.assertEqual(r["nivel"], "rojo")

    def test_poco_movimiento_en_sena_dinamica(self):
        from signy_ml.calidad import evaluar_muestra
        self.assertIn("Casi no hay movimiento", self._avisos(evaluar_muestra(generar_captura("L", np.random.default_rng(5)), "dinamica", 1)))

    def test_separar_rojas_deja_fuera_solo_las_que_hay_que_volver_a_grabar(self):
        from signy_ml.calidad import separar_rojas
        buena = generar_captura("GRACIAS", np.random.default_rng(1), pausa_despues_ms=600)
        perdida = generar_captura("GRACIAS", np.random.default_rng(3), pausa_despues_ms=600)
        for f in perdida["frames"]:
            if 400 <= f["t"] <= 1200:
                f["manos"] = []
        ds = Dataset(senas={1: "gracias"}, muestras=[Muestra(1, 1, buena), Muestra(2, 1, perdida),
                                                    Muestra(3, 1, buena, manos_requeridas=2)])
        limpio, rojas = separar_rojas(ds)
        self.assertEqual([m.id for m in limpio.muestras], [1])
        self.assertEqual(sorted(m.id for m, _ in rojas), [2, 3])

    def test_cambio_de_forma_de_la_mano_cuenta_como_movimiento(self):
        from signy_ml.calidad import evaluar_muestra
        r = evaluar_muestra(generar_captura("LLAMAR", np.random.default_rng(6), pausa_despues_ms=600), "dinamica", 1)
        self.assertEqual(r["nivel"], "verde", r["avisos"])


class TestPerfil(unittest.TestCase):
    """Medidas para la retroalimentación al alumno (espejo de motor-senas/retroalimentacion.ts)."""

    def test_mas_rapido_dura_menos_con_el_mismo_recorrido(self):
        from signy_ml.perfil import medir
        rapida = medir(generar_captura("HOLA", np.random.default_rng(1), duracion_ms=500, pausa_antes_ms=300, pausa_despues_ms=500))
        lenta = medir(generar_captura("HOLA", np.random.default_rng(1), duracion_ms=1600, pausa_antes_ms=300, pausa_despues_ms=500))
        self.assertLess(rapida["duracionMs"], 0.5 * lenta["duracionMs"])
        self.assertGreater(rapida["recorrido"], 0.6 * lenta["recorrido"])  # el suavizado achata un poco lo rápido, no tanto

    def test_sena_quieta_y_sena_de_dos_manos(self):
        from signy_ml.perfil import medir
        quieta = medir(generar_captura("L", np.random.default_rng(2), pausa_antes_ms=300, pausa_despues_ms=300, ruido=0.01))
        self.assertLess(quieta["recorrido"], 0.3)
        self.assertIsNone(quieta["duracionMs"])
        dos = medir(generar_captura("SEPARAR", np.random.default_rng(3)))
        self.assertGreater(dos["dosManos"], 0.9)
        self.assertGreater(dos["distanciaManos"], 1)
        self.assertIsNone(medir({"ancho": 640, "alto": 480, "frames": [{"t": 0, "manos": []}]}))

    def test_forma_de_la_mano_distingue_palma_de_puno(self):
        from signy_ml.perfil import medir
        palma = medir(generar_captura("HOLA", np.random.default_rng(4)))["extension"]
        puno = medir(generar_captura("SI", np.random.default_rng(4)))["extension"]
        self.assertTrue(all(a > b + 0.5 for a, b in zip(palma[1:], puno[1:])))

    def test_el_modelo_exportado_trae_el_perfil_de_cada_sena(self):
        ds = _ds(["HOLA", "SEPARAR"], participantes=1, repeticiones=3)
        modelo = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(8,), aumentos_por_muestra=1, epocas=2)).modelo
        perfiles = modelo["perfiles"]
        self.assertEqual(set(perfiles), {"1", "2"})  # sin la clase "ninguna seña"
        self.assertEqual(perfiles["1"]["n"], 3)
        self.assertEqual(perfiles["2"]["dosManos"][0], 1.0)
        self.assertEqual(len(perfiles["1"]["extension"]), 5)


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

    def test_congela_frames_repite_el_cuadro_anterior(self):
        frames = generar_captura("HOLA", np.random.default_rng(1))["frames"]
        congelados = _congelar_frames(frames, np.random.default_rng(7), probabilidad=1.0)
        self.assertEqual(len(congelados), len(frames))
        cambiados = [i for i in range(1, len(congelados)) if congelados[i]["manos"] is not frames[i]["manos"]]
        self.assertTrue(cambiados)
        for i in cambiados:
            np.testing.assert_allclose(congelados[i]["manos"][0], congelados[i - 1]["manos"][0])


class TestDataset(unittest.TestCase):
    def test_lee_persona_tipo_y_manos(self):
        ds = leer_dataset(dataset_sintetico(["HOLA", "SEPARAR"], 2, 1))
        self.assertEqual(ds.participantes(), {"p1", "p2"})
        self.assertEqual({(ds.senas[m.sena_id], m.manos_requeridas) for m in ds.muestras}, {("hola", 1), ("separar", 2)})
        self.assertEqual(ds.personas_por_sena(), {1: 2, 2: 2})

    def test_carga_dataset_valido(self):
        ds = leer_dataset(dataset_sintetico(["HOLA", "SI"], 2, 2))
        self.assertEqual(len(ds.muestras), 8)

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
    def test_reconoce_senas_con_variacion_nueva(self):
        ds = _ds(["HOLA", "SI", "GRACIAS", "LLAMAR", "L", "SEPARAR"], participantes=4, repeticiones=3)
        r = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, aumentos_por_muestra=4))
        modelo, metricas = r.modelo, r.metricas
        self.assertGreaterEqual(metricas["exactitud"], 0.9)
        self.assertGreaterEqual(metricas["rechazoNinguna"], 0.5)
        rng = np.random.default_rng(123)
        ids = {c["palabra"]: c["senaId"] for c in modelo["clases"]}
        for nombre in ["HOLA", "SI", "L", "SEPARAR"]:
            cap = generar_captura(nombre, rng, tamano=0.2, zurda=True, ancho=480, alto=640)
            p = probabilidades(modelo, caracteristicas(cap, CONFIG))
            self.assertEqual(modelo["clases"][int(np.argmax(p))]["senaId"], ids[nombre.lower()], nombre)

    def test_mide_con_cada_persona_como_alumno_nuevo(self):
        from signy_ml.modelo import evaluar_por_persona
        ds = _ds(["HOLA", "SI", "L"], participantes=3, repeticiones=2)
        # Una seña que grabó solo p3: con p3 fuera no hay de quién aprenderla, así que no se mide.
        ds.senas[9] = "solo-p3"
        ds.muestras.append(Muestra(999, 9, generar_captura("GRACIAS", np.random.default_rng(9)), "p3"))
        op = OpcionesEntrenamiento(config=CONFIG, capas_ocultas=(16,), aumentos_por_muestra=2, epocas=20)
        pn = evaluar_por_persona(ds, op, umbral=0.6)
        self.assertEqual(set(pn["personas"]), {"p1", "p2", "p3"})
        self.assertEqual(pn["sinMedir"], 1)
        self.assertEqual(pn["muestras"], 3 * 3 * 2)
        self.assertGreaterEqual(pn["exactitud"], 0.8)
        self.assertLessEqual(pn["aprobadas"], pn["exactitud"])
        aprobadas = [f["aprobadas"] for f in pn["porUmbral"]]
        self.assertEqual(aprobadas, sorted(aprobadas, reverse=True))  # umbral más alto, menos aprobadas
        self.assertIsNone(evaluar_por_persona(_ds(["HOLA", "SI"], participantes=2, repeticiones=2), op, 0.6))

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
    manos a mitad de camino (ver `cambioDeManos` en motor-senas/seguimiento.ts). El clasificador
    debería reconocerla bien, porque calcula sus características cuadro a cuadro."""
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
            quien = f"p{p + 1}"
            ds.muestras.append(Muestra(len(ds.muestras) + 1, 1, _captura_compuesta(rng, **persona), quien))
            ds.muestras.append(Muestra(len(ds.muestras) + 1, 2,
                                       generar_captura("HOLA", rng, duracion_ms=1200, pausa_antes_ms=200, pausa_despues_ms=200, **persona), quien))
            ds.muestras.append(Muestra(len(ds.muestras) + 1, 3,
                                       generar_captura("SEPARAR", rng, duracion_ms=1200, pausa_antes_ms=200, pausa_despues_ms=200, **persona), quien))
    return ds


class TestSenaCompuesta(unittest.TestCase):
    """Una seña que cambia de cantidad de manos (p. ej. 1 mano y después 2). Prueba que el
    clasificador la distingue de sus dos mitades por separado."""

    def test_distingue_la_compuesta_de_sus_dos_mitades(self):
        ds = _ds_compuesta()
        r = entrenar(ds, OpcionesEntrenamiento(config=CONFIG, aumentos_por_muestra=4))
        self.assertGreaterEqual(r.metricas["exactitud"], 0.9)

        ids = {c["palabra"]: c["senaId"] for c in r.modelo["clases"]}
        vector = caracteristicas(_captura_compuesta(np.random.default_rng(999)), CONFIG)
        p = probabilidades(r.modelo, vector)
        self.assertEqual(r.modelo["clases"][int(np.argmax(p))]["senaId"], ids["compuesta"])


class TestPocasMuestras(unittest.TestCase):
    """Lo normal al empezar a grabar: muchas señas con pocas muestras."""

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



class TestReporte(unittest.TestCase):
    def test_sena_sin_muestras_de_prueba_no_aparece_como_0_por_ciento(self):
        ds = _ds(["HOLA", "SI"], participantes=1, repeticiones=2)
        metricas = {"particion": "aleatoria", "muestrasPrueba": 2, "exactitud": 1.0,
                    "exactitudSobreUmbral": 1.0, "coberturaUmbral": 1.0,
                    "rechazoNinguna": None, "umbralCalculado": False,
                    "reporte": {"hola": {"precision": 1.0, "recall": 1.0, "support": 2}}, "confusion": [], "clasesConfusion": []}
        ruta = Path(tempfile.mkdtemp()) / "reporte.md"
        cli.escribir_reporte(ruta, ds, metricas, {"umbralSugerido": 0.6}, Path("m.json"), 1)
        texto = ruta.read_text(encoding="utf-8")
        self.assertIn("Muestras de prueba: 2 de 4", texto)
        self.assertIn("| si | 2 ⚠️ pocas | 1 ⚠️ | — (sin prueba) | — (sin prueba) |", texto)
        self.assertIn("| hola | 2 ⚠️ pocas | 1 ⚠️ | 100.0 % | 100.0 % |", texto)
        self.assertIn("Con personas nuevas: — (no se midió", texto)

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
