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
from signy_ml.dataset import cargar_dataset  # noqa: E402
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
    pedidos: list[str] = []

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
        token = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        if self.headers.get("apikey") != CLAVE or token not in ("tok-admin", "tok-alumno"):
            return self._responder(401, {"message": "JWT inválido"})
        offset, limit = int(q.get("offset", 0)), int(q.get("limit", 1000))
        if u.path == "/rest/v1/muestras_sena":
            if self.sin_tabla:
                return self._responder(404, {"code": "PGRST205", "message": "Could not find the table 'public.muestras_sena' in the schema cache"})
            visibles = self.muestras if token == "tok-admin" else []  # RLS: solo admins
            return self._responder(200, visibles[offset:offset + limit])
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
        FalsoSupabase.pedidos = []

    def test_admin_descarga_todo_paginado_y_anonimizado(self):
        ds = sb.descargar_dataset(self.url, CLAVE, "admin@signy.cl", "clave-admin")
        self.assertEqual(len(ds["muestras"]), 230)
        self.assertEqual(sum("muestras_sena" in p for p in FalsoSupabase.pedidos), 3)  # 100 + 100 + 30
        self.assertEqual({m["participante"] for m in ds["muestras"]}, {"p1", "p2", "p3"})
        self.assertNotIn("uuid-", json.dumps(ds))
        self.assertEqual([s["palabra"] for s in ds["senas"]], ["hola", "si"])  # "chao" no tiene muestras
        ruta = Path(tempfile.mkdtemp()) / "ds.json"
        ruta.write_text(json.dumps(ds))
        self.assertEqual(len(cargar_dataset(ruta).muestras), 230)

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
        salida = Path(tempfile.mkdtemp()) / "modelo.json"
        guardado = salida.parent / "descargado.json"
        try:
            with mock.patch.object(sb, "leer_config_app", return_value=(self.url, CLAVE)), \
                 mock.patch.dict(os.environ, {"SIGNY_PASSWORD": "clave-admin"}), redirect_stdout(StringIO()):
                codigo = cli.main(["--supabase", "--email", "admin@signy.cl", "--salida", str(salida),
                                   "--guardar-dataset", str(guardado), "--aumentos", "1", "--capas", "16"])
        finally:
            FalsoSupabase.muestras = _muestras(230)
        self.assertEqual(codigo, 0)
        modelo = json.loads(salida.read_text())
        self.assertEqual(sorted(c["palabra"] for c in modelo["clases"]), ["hola", "si"])
        self.assertTrue(guardado.exists())

    def test_cli_pide_email(self):
        with redirect_stdout(StringIO()), mock.patch("sys.stderr", new=StringIO()):
            self.assertEqual(cli.main(["--supabase"]), 2)


if __name__ == "__main__":
    unittest.main()
