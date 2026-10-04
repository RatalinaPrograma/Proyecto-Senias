"""
Genera el ícono de Android (adaptativo + clásico + redondo), las pantallas de
carga (splash) y el favicon a partir de las dos imágenes fuente de esta carpeta:

  resources/icon-foreground.png  el zorrito-mano con fondo transparente (1024+ px)
  resources/icon.png             el ícono completo con fondo (referencia de color y Play Store)

Uso (desde signy/):  python resources/generar_iconos.py
Requiere: pip install pillow numpy scipy

Reglas del ícono adaptativo de Android (lienzo de 108 dp):
  - solo se ven los 72 dp del centro, recortados con la forma del celular
    (círculo, squircle, gota...), y lo seguro para todas las formas es un
    círculo de 66 dp. El zorrito se escala para caber completo en ese círculo.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import ConvexHull

RAIZ = Path(__file__).resolve().parents[1]
RES = RAIZ / "android/app/src/main/res"
FUENTE_FRENTE = RAIZ / "resources/icon-foreground.png"
FUENTE_ICONO = RAIZ / "resources/icon.png"

DENSIDADES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
DP_LIENZO = 108
DP_VISIBLE = 72
DP_SEGURO = 66          # diámetro del círculo seguro
ESCALA_MAESTRA = 16     # px por dp del dibujo maestro (1728 px), luego se reduce

# Degradado del fondo: medido sobre icon.png (distancia al centro del brillo,
# como fracción del alto del zorro → color). Turquesa detrás de la cara, azul
# marino en los bordes, igual que el ícono original.
PERFIL = [(0.00, (5, 177, 186)), (0.15, (4, 152, 172)), (0.22, (3, 115, 147)),
          (0.30, (3, 92, 130)), (0.37, (3, 68, 109)), (0.44, (4, 48, 89)),
          (0.52, (5, 38, 78)), (0.59, (6, 32, 71)), (0.66, (7, 30, 68))]
NAVY_APP = (0x12, 0x21, 0x3B)  # --signy-ink, fondo de la app


def limpiar_frente(im: Image.Image) -> Image.Image:
    """Quita el halo casi invisible que deja el recorte y vuelve 100 % opaco el cuerpo."""
    a = np.array(im.convert("RGBA")).astype(np.float32)
    alfa = np.clip((a[..., 3] - 40.0) / (235.0 - 40.0), 0, 1)
    a[..., 3] = alfa * 255
    a[alfa == 0, :3] = 0
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def circulo_envolvente(alfa: np.ndarray) -> tuple[float, float, float]:
    """Centro y radio del menor círculo que contiene todo lo visible (búsqueda sobre el casco convexo)."""
    ys, xs = np.where(alfa > 24)
    puntos = np.stack([xs, ys], 1).astype(np.float64)
    casco = puntos[ConvexHull(puntos).vertices]
    cx, cy = casco.mean(0)
    paso = max(alfa.shape) / 8
    radio = np.hypot(casco[:, 0] - cx, casco[:, 1] - cy).max()
    while paso > 0.25:
        mejor = (radio, cx, cy)
        for dx in (-paso, 0, paso):
            for dy in (-paso, 0, paso):
                r = np.hypot(casco[:, 0] - (cx + dx), casco[:, 1] - (cy + dy)).max()
                if r < mejor[0]:
                    mejor = (r, cx + dx, cy + dy)
        if mejor[0] < radio:
            radio, cx, cy = mejor
        else:
            paso /= 2
    return cx, cy, radio


def degradado(ancho: int, alto: int, centro: tuple[float, float], alto_zorro: float,
              borde: tuple[int, int, int] | None = None) -> Image.Image:
    yy, xx = np.mgrid[0:alto, 0:ancho].astype(np.float32)
    t = np.hypot(xx - centro[0], yy - centro[1]) / alto_zorro
    pos = np.array([p for p, _ in PERFIL], np.float32)
    cols = np.array([c for _, c in PERFIL], np.float32)
    if borde is not None:  # termina en el azul de la app en vez del azul del ícono
        cols = cols.copy()
        cols[-3:] = [np.array(cols[-3]) * 0.5 + np.array(borde) * 0.5, borde, borde]
    canal = [np.interp(t, pos, cols[:, k]) for k in range(3)]
    rgb = np.stack(canal, -1)
    return Image.fromarray(np.clip(rgb, 0, 255).round().astype(np.uint8), "RGB")


def mascara_redondeada(lado: int, radio: float) -> Image.Image:
    m = Image.new("L", (lado * 4, lado * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, lado * 4 - 1, lado * 4 - 1], radius=radio * 4, fill=255)
    return m.resize((lado, lado), Image.LANCZOS)


def mascara_circulo(lado: int) -> Image.Image:
    m = Image.new("L", (lado * 4, lado * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, lado * 4 - 1, lado * 4 - 1], fill=255)
    return m.resize((lado, lado), Image.LANCZOS)


def guardar(im: Image.Image, ruta: Path) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    im.save(ruta, optimize=True)


def main() -> None:
    frente = limpiar_frente(Image.open(FUENTE_FRENTE))
    alfa = np.array(frente)[..., 3]
    cx, cy, radio = circulo_envolvente(alfa)
    ys, xs = np.where(alfa > 128)
    alto_zorro_src = ys.max() - ys.min()

    # ---------- dibujo maestro del ícono adaptativo (108 dp a 16 px/dp) ----------
    lado = DP_LIENZO * ESCALA_MAESTRA
    escala = (DP_SEGURO / 2 * ESCALA_MAESTRA) / radio
    zorro = frente.resize((round(frente.width * escala), round(frente.height * escala)), Image.LANCZOS)
    ox, oy = round(lado / 2 - cx * escala), round(lado / 2 - cy * escala)
    capa_frente = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    capa_frente.alpha_composite(zorro, (ox, oy))

    # Brillo turquesa detrás de la cara (centroide de la mitad de arriba del zorro).
    a_f = np.array(capa_frente)[..., 3]
    ys_f, xs_f = np.where(a_f > 128)
    cara = (xs_f.mean(), ys_f.min() + (ys_f.max() - ys_f.min()) * 0.45)
    alto_zorro = alto_zorro_src * escala
    capa_fondo = degradado(lado, lado, cara, alto_zorro)

    for nombre, f in DENSIDADES.items():
        px = round(DP_LIENZO * f)
        guardar(capa_frente.resize((px, px), Image.LANCZOS), RES / f"mipmap-{nombre}/ic_launcher_foreground.png")
        guardar(capa_fondo.resize((px, px), Image.LANCZOS), RES / f"mipmap-{nombre}/ic_launcher_background.png")

    # ---------- íconos clásicos (Android 7 y launchers antiguos) ----------
    compuesto = capa_fondo.convert("RGBA")
    compuesto.alpha_composite(capa_frente)
    m = (DP_LIENZO - DP_VISIBLE) // 2 * ESCALA_MAESTRA
    visible = compuesto.crop((m, m, lado - m, lado - m))  # los 72 dp que se ven
    for nombre, f in DENSIDADES.items():
        px = round(48 * f)
        interior = round(46 * f)  # 1 dp de margen, como los íconos de Material
        cuadrado = visible.resize((interior, interior), Image.LANCZOS)
        cuadrado.putalpha(mascara_redondeada(interior, interior * 0.2))
        lienzo = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        lienzo.alpha_composite(cuadrado, ((px - interior) // 2, (px - interior) // 2))
        guardar(lienzo, RES / f"mipmap-{nombre}/ic_launcher.png")
        redondo = visible.resize((interior, interior), Image.LANCZOS)
        redondo.putalpha(mascara_circulo(interior))
        lienzo = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        lienzo.alpha_composite(redondo, ((px - interior) // 2, (px - interior) // 2))
        guardar(lienzo, RES / f"mipmap-{nombre}/ic_launcher_round.png")

    # ---------- pantallas de carga (splash) ----------
    for ruta in sorted(RES.glob("drawable*/splash.png")):
        ancho, alto = Image.open(ruta).size
        alto_obj = min(ancho, alto) * 0.34
        e = alto_obj / alto_zorro_src
        z = frente.resize((round(frente.width * e), round(frente.height * e)), Image.LANCZOS)
        centro = (ancho / 2, alto / 2)
        x0 = round(centro[0] - cx * e)
        y0 = round(centro[1] - cy * e)
        caja = np.where(np.array(z)[..., 3] > 128)
        cara_s = (x0 + caja[1].mean(), y0 + caja[0].min() + (caja[0].max() - caja[0].min()) * 0.45)
        fondo = degradado(ancho, alto, cara_s, alto_obj, borde=NAVY_APP).convert("RGBA")
        fondo.alpha_composite(z, (x0, y0))
        guardar(fondo.convert("RGB"), ruta)

    # ---------- favicon de la versión web ----------
    fav = visible.resize((64, 64), Image.LANCZOS)
    fav.putalpha(mascara_redondeada(64, 14))
    guardar(fav, RAIZ / "src/assets/icon/favicon.png")

    print(f"Listo: círculo envolvente r={radio:.0f}px, escala {escala:.3f}")


if __name__ == "__main__":
    main()
