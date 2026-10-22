"""Salida de consola que funciona en cualquier terminal."""
from __future__ import annotations

import sys


def consola_utf8() -> None:
    """En Windows, Git Bash y la terminal de algunos editores no usan UTF-8, y
    los ✔ / ⚠️ / ✖ de los scripts los hacían caer con UnicodeEncodeError."""
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
