"""Descarga desde Supabase contra un servidor local que imita su API (auth + PostgREST + RLS)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import entrenar as cli  # noqa: E402
from signy_ml import supabase_descarga as sb  # noqa: E402
from signy_ml.dataset import leer_dataset  # noqa: E402
from signy_ml.sintetico import compactar, generar_captura  # noqa: E402

CLAVE = "sb_publishable_prueba"
USUARIOS = {"admin@signy.cl": ("clave-admin", "tok-admin"), "alumno@signy.cl": ("clave-alumno", "tok-alumno")}


def _muestras(n: int) -> list[dict]:
    rng = np.random.default_rng(0)
    nombres = ["HOLA", "SI"]
    filas = []
    for i in range(n):
        nombre = nombres[i % 2]
        filas.append({
            "id": i + 1, "sena_id": 10 + (i % 2), "autor_id": f"uuid-{i % 3}", "tipo": "dinamica", "manos_requeridas": 1,
            "captura": compactar(generar_captura(nombre, rng, duracion_ms=600, pausa_antes_ms=50, pausa_despues_ms=50, fps=15)),
        })
    return filas


class FalsoSupabase(BaseHTTPRequestHandler):
    muestras: list[dict] = []
    sin_tabla = False
    sin_columna_participante = False
    cortar_respuesta = False
    pedidos: list[str] = []
    metodos: list[tuple[str, str]] = []

    def log_message(self, *args):  # silencio
        pass

    def _responder(self, estado: int, cuerpo):
        datos = json.dumps(cuerpo).encode()
        self.send_response(estado)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_POST(self):
        FalsoSupabase.metodos.append(("POST", urlparse(self.path).path))
        if self.headers.get("apikey") != CLAVE:
            return self._responder(401, {"message": "No API key found in request"})
        cuerpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        esperado = USUARIOS.get(cuerpo.get("email"))
        if not esperado or esperado[0] != cuerpo.get("password"):
            return self._responder(400, {"code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"})
        self._responder(200, {"access_token": esperado[1], "token_type": "bearer"})

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        FalsoSupabase.pedidos.append(self.path)
        FalsoSupabase.metodos.append(("GET", u.path))
        token = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        if self.headers.get("apikey") != CLAVE or token not in ("tok-admin", "tok-alumno"):
            return self._responder(401, {"message": "JWT inválido"})
        offset, limit = int(q.get("offset", 0)), int(q.get("limit", 1000))
        if u.path == "/rest/v1/muestras_sena":
            if self.sin_tabla:
                return self._responder(404, {"code": "PGRST205", "message": "Could not find the table 'public.muestras_sena' in the schema cache"})
            columnas = q.get("select", "*").split(",")
            if "participante" in columnas and self.sin_columna_participante:
                return self._responder(400, {"code": "42703", "message": "column muestras_sena.participante does not exist"})
            if self.cortar_respuesta:  # se corta el wifi a mitad de la página
                datos = json.dumps(self.muestras[:50]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(datos)))
                self.end_headers()
                self.wfile.write(datos[: len(datos) // 2])
                self.wfile.flush()
                self.close_connection = True
                return
            visibles = self.muestras if token == "tok-admin" else []  # RLS: solo admins
            filas = [{k: v for k, v in m.items() if columnas == ["*"] or k in columnas} for m in visibles[offset:offset + limit]]
            return self._responder(200, filas)
        if u.path == "/rest/v1/profiles":
            return self._responder(200, [{"id": "uuid-0", "full_name": "Ana Pérez", "username": "ana"}])
        if u.path == "/rest/v1/senas":
            senas = [{"id": 10, "palabra": "hola", "subnivel_id": 1}, {"id": 11, "palabra": "si", "subnivel_id": 1}, {"id": 12, "palabra": "chao", "subnivel_id": 1}]
            return self._responder(200, senas[offset:offset + limit])
        self._responder(404, {"message": "no existe"})


class TestDescargaSupabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        FalsoSupabase.muestras = _muestras(230)
        cls.servidor = ThreadingHTTPServer(("127.0.0.1", 0), FalsoSupabase)
        cls.url = f"http://127.0.0.1:{cls.servidor.server_address[1]}"
        threading.Thread(target=cls.servidor.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.servidor.shutdown()
        cls.servidor.server_close()

    def setUp(self):
        FalsoSupabase.sin_tabla = False
        FalsoSupabase.sin_columna_participante = False
        FalsoSupabase.cortar_respuesta = False
        FalsoSupabase.pedidos = []
        FalsoSupabase.metodos = []

    def test_admin_descarga_todo_paginado_y_anonimizado(self):
        ds = sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "clave-admin")
        self.assertEqual(len(ds["muestras"]), 230)
        self.assertEqual(sum("muestras_sena" in p for p in FalsoSupabase.pedidos), 3)  # 100 + 100 + 30
        self.assertEqual({m["participante"] for m in ds["muestras"]}, {"p1", "p2", "p3"})
        self.assertNotIn("uuid-", json.dumps(ds))
        self.assertEqual([s["palabra"] for s in ds["senas"]], ["hola", "si"])  # "chao" no tiene muestras
        self.assertEqual(len(leer_dataset(ds).muestras), 230)
        self.assertEqual(leer_dataset(ds).participantes(), {"p1", "p2", "p3"})

    def test_cada_persona_cuenta_aunque_las_grabe_la_misma_cuenta(self):
        originales = FalsoSupabase.muestras
        apodos = ["Cata", "Benja", " cata ", "Benjamín", "benjamin", None]
        FalsoSupabase.muestras = [{**m, "autor_id": "uuid-admin", "participante": apodos[i % 6]} for i, m in enumerate(_muestras(12))]
        try:
            ds = sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "clave-admin")
        finally:
            FalsoSupabase.muestras = originales
        self.assertEqual([m["participante"] for m in ds["muestras"][:6]], ["p1", "p2", "p1", "p3", "p3", "p4"])
        self.assertNotRegex(json.dumps(ds), "Cata|Benja|uuid-")

    def test_sin_la_migracion_de_participante_usa_la_cuenta(self):
        FalsoSupabase.sin_columna_participante = True
        ds = sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "clave-admin")
        self.assertEqual(len(ds["muestras"]), 230)
        self.assertEqual({m["participante"] for m in ds["muestras"]}, {"p1", "p2", "p3"})

    def test_misma_regla_de_persona_que_la_app(self):
        # Igual que clavePersona / limpiarParticipante de motor-senas/dataset.ts.
        self.assertEqual(sb.clave_persona({"participante": "  Ñandú   Azul ", "autor_id": "x"}), "persona:nandu azul")
        self.assertEqual(sb.clave_persona({"participante": "   ", "autor_id": "x"}), "cuenta:x")
        self.assertEqual(sb.clave_persona({"autor_id": None}), "cuenta:sin-autor")
        self.assertEqual(len(sb.limpiar_participante("x" * 60)), 40)

    def test_corte_de_red_a_mitad_de_la_descarga_da_un_mensaje_claro(self):
        FalsoSupabase.cortar_respuesta = True
        with self.assertRaisesRegex(sb.ErrorSupabase, "Se cortó la conexión"):
            sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "clave-admin")

    def test_revision_solo_lee_y_genera_la_pagina(self):
        import revisar_dataset
        salida = Path(tempfile.mkdtemp()) / "revision.html"
        with mock.patch.object(sb, "leer_config_app", return_value=(self.url, CLAVE)), \
             mock.patch.dict(os.environ, {"SIGNY_PASSWORD": "clave-admin"}), redirect_stdout(StringIO()):
            codigo = revisar_dataset.main(["--supabase", "--email", "admin@signy.cl", "--salida", str(salida)])
        self.assertEqual(codigo, 0)
        # Lo único que no es lectura es el inicio de sesión: nada se escribe ni se borra.
        self.assertEqual({(m, r) for m, r in FalsoSupabase.metodos if m != "GET"}, {("POST", "/auth/v1/token")})
        texto = salida.read_text(encoding="utf-8")
        self.assertIn("Revisión del dataset", texto)
        self.assertIn("Ana Pérez (cuenta)", texto)
        self.assertIn('"id":230', texto)  # están todas las muestras

    def test_contrasena_incorrecta(self):
        with self.assertRaisesRegex(sb.ErrorSupabase, "incorrectos"):
            sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "otra")

    def test_cuenta_que_no_es_admin_no_ve_muestras(self):
        with self.assertRaisesRegex(sb.ErrorSupabase, "No hay muestras visibles"):
            sb.descargar_dataset(self.url, CLAVE, "alumno@signy.cl", "clave-alumno")

    def test_tabla_inexistente_explica_la_migracion(self):
        FalsoSupabase.sin_tabla = True
        with self.assertRaisesRegex(sb.ErrorSupabase, "20261004120000"):
            sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "clave-admin")

    def test_sin_conexion(self):
        with self.assertRaisesRegex(sb.ErrorSupabase, "No se pudo conectar"):
            sb.descargar_dataset("http://127.0.0.1:9", CLAVE, "admin@signy.cl", "x")

    def test_lee_la_configuracion_de_la_app(self):
        url, clave = sb.leer_config_app(RAIZ.parent)
        self.assertTrue(url.startswith("https://") and "supabase.co" in url)
        self.assertTrue(clave)

    def test_cli_entrena_directo_desde_supabase(self):
        FalsoSupabase.muestras = _muestras(24)
        salida = Path(tempfile.mkdtemp())
        try:
            with mock.patch.object(sb, "leer_config_app", return_value=(self.url, CLAVE)), \
                 mock.patch.dict(os.environ, {"SIGNY_PASSWORD": "clave-admin"}), redirect_stdout(StringIO()):
                codigo = cli.main(["--supabase", "--email", "admin@signy.cl", "--salida", str(salida),
                                   "--aumentos", "1", "--capas", "16"])
        finally:
            FalsoSupabase.muestras = _muestras(230)
        self.assertEqual(codigo, 0)
        modelo = json.loads((salida / "model_weights.json").read_text())
        self.assertEqual(sorted(c["senaId"] for c in modelo["clases"]), [0, 10, 11])  # 0 = "ninguna seña"
        self.assertTrue((salida / "model.tflite").exists())

    def test_cli_pide_email(self):
        with redirect_stdout(StringIO()), mock.patch("sys.stderr", new=StringIO()):
            self.assertEqual(cli.main(["--supabase"]), 2)


if __name__ == "__main__":
    unittest.main()
