"""Salida de consola (rich) que funciona en cualquier terminal, y un menú reutilizable."""
from __future__ import annotations

import sys
from typing import Callable

from rich.console import Console
from rich.markup import escape
from rich.prompt import Confirm, Prompt

# soft_wrap: no partir los mensajes largos (ni al redirigir la salida a un archivo).
consola = Console(soft_wrap=True, highlight=False)
errores = Console(stderr=True, soft_wrap=True, highlight=False)


class ConfirmarSiNo(Confirm):
    """Pregunta sí/no en español ("s"/"n"): la de rich por defecto es "y"/"n", en inglés."""
    choices = ["s", "n"]
    validate_error_message = "[prompt.invalid]Responde «s» o «n»"


def consola_utf8() -> None:
    """En Windows, Git Bash y la terminal de algunos editores no usan UTF-8, y
    los ✔ / ⚠️ / ✖ de los scripts los hacían caer con UnicodeEncodeError."""
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def ok(texto: str) -> None:
    consola.print(f"[green]✔[/] {escape(texto)}")


def aviso(texto: str) -> None:
    consola.print(f"[yellow]⚠️  {escape(texto)}[/]")


def error(texto: str) -> None:
    errores.print(f"[red]✖ {escape(texto)}[/]")


def menu(titulo: str, opciones: list[tuple[str, Callable[[], object]]]) -> None:
    """Menú numerado que se repite hasta elegir 0. Ctrl+C cancela la acción en curso y vuelve al menú."""
    while True:
        consola.print()
        consola.rule(f"[bold]{escape(titulo)}")
        for i, (texto, _) in enumerate(opciones, 1):
            consola.print(f"  [bold cyan]{i}[/]  {escape(texto)}")
        consola.print("  [bold cyan]0[/]  Salir")
        try:
            eleccion = Prompt.ask("Opción", choices=[str(i) for i in range(len(opciones) + 1)], show_choices=False)
        except (KeyboardInterrupt, EOFError):
            return
        if eleccion == "0":
            return
        try:
            opciones[int(eleccion) - 1][1]()
        except KeyboardInterrupt:
            aviso("Cancelado.")
