"""Descarga el dataset directo desde Supabase (sin exportarlo a mano desde AI Studio).

Inicia sesión con una cuenta de administrador (la misma de la app) y lee la
tabla `muestras_sena` respetando el RLS: una cuenta que no es admin no ve
ninguna muestra. Usa solo la biblioteca estándar de Python.

La URL y la clave pública se leen de `signy/src/environments/environment.ts`,
así que no hay que configurar nada aparte. La contraseña nunca se guarda.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

PAGINA = 100  # cada muestra pesa decenas de KB


class ErrorSupabase(RuntimeError):
    pass


def leer_config_app(raiz_repo: Path) -> tuple[str, str]:
    """(url, clave pública) desde environment.ts de la app."""
    ruta = raiz_repo / "signy" / "src" / "environments" / "environment.ts"
    texto = ruta.read_text(encoding="utf-8")
    url = re.search(r"url:\s*['\"]([^'\"]+)['\"]", texto)
    clave = re.search(r"key:\s*['\"]([^'\"]+)['\"]", texto)
    if not url or not clave:
        raise ErrorSupabase(f"No se encontraron url/key de Supabase en {ruta}.")
    return url.group(1).rstrip("/"), clave.group(1)


def _pedir(metodo: str, url: str, cabeceras: dict, cuerpo: Optional[dict] = None, timeout: float = 60):
    datos = json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo, headers={**cabeceras, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        try:
            detalle = json.loads(e.read().decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            detalle = {}
        raise ErrorSupabase(_mensaje_error(e.code, detalle)) from None
    except urllib.error.URLError as e:
        raise ErrorSupabase(f"No se pudo conectar con Supabase: {e.reason}") from None


def _mensaje_error(estado: int, detalle: dict) -> str:
    codigo = str(detalle.get("code") or detalle.get("error_code") or detalle.get("error") or "")
    texto = detalle.get("msg") or detalle.get("message") or detalle.get("error_description") or ""
    if codigo in ("invalid_credentials", "invalid_grant") or "Invalid login" in texto:
        return "Correo o contraseña incorrectos."
    if codigo in ("42P01", "PGRST205") or "muestras_sena" in texto:
        return "La tabla muestras_sena no existe: falta aplicar la migración 20261004120000_dataset_muestras_sena.sql."
    return f"Supabase respondió {estado}: {texto or codigo or 'error desconocido'}"


def iniciar_sesion(url: str, clave: str, email: str, password: str) -> str:
    r = _pedir("POST", f"{url}/auth/v1/token?grant_type=password", {"apikey": clave}, {"email": email, "password": password})
    token = (r or {}).get("access_token")
    if not token:
        raise ErrorSupabase("Supabase no devolvió una sesión.")
    return token


def _leer_todo(url: str, clave: str, token: str, tabla: str, columnas: str, al_avanzar=None) -> list[dict]:
    filas: list[dict] = []
    while True:
        query = urllib.parse.urlencode({"select": columnas, "order": "id", "offset": len(filas), "limit": PAGINA})
        pagina = _pedir("GET", f"{url}/rest/v1/{tabla}?{query}", {"apikey": clave, "Authorization": f"Bearer {token}"})
        filas.extend(pagina or [])
        if al_avanzar:
            al_avanzar(len(filas))
        if not pagina or len(pagina) < PAGINA:
            return filas


def descargar_dataset(url: str, clave: str, email: str, password: str,
                      al_avanzar: Optional[Callable[[int], None]] = None) -> dict:
    """Dataset en el mismo formato que exporta AI Studio (personas anonimizadas p1, p2, …)."""
    token = iniciar_sesion(url, clave, email, password)
    muestras = _leer_todo(url, clave, token, "muestras_sena",
                          "id,sena_id,autor_id,tipo,manos_requeridas,captura", al_avanzar)
    if not muestras:
        raise ErrorSupabase("No hay muestras visibles: graba algunas con \"Al dataset\" o revisa que la cuenta sea admin.")
    senas = _leer_todo(url, clave, token, "senas", "id,palabra,subnivel_id")

    participantes: dict[str, str] = {}
    def anonimo(autor) -> str:
        clave_autor = autor or "sin-autor"
        participantes.setdefault(clave_autor, f"p{len(participantes) + 1}")
        return participantes[clave_autor]

    con_muestras = {m["sena_id"] for m in muestras}
    return {
        "formato": "signy-dataset",
        "version": 1,
        "exportado": "supabase",
        "senas": [{"id": s["id"], "palabra": s["palabra"], "subnivelId": s.get("subnivel_id")} for s in senas if s["id"] in con_muestras],
        "muestras": [{
            "id": m["id"], "senaId": m["sena_id"], "participante": anonimo(m.get("autor_id")),
            "tipo": m["tipo"], "manosRequeridas": m["manos_requeridas"], "captura": m["captura"],
        } for m in muestras],
    }
