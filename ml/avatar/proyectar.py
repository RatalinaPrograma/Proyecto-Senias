"""Hornea la ilustración oficial (EstasListo.png) en la textura de la cara del zorrito 3D.

Para cada texel de la cabeza (mapa equirectangular: u = 0,5 al frente, v = 1
arriba, costura atrás, igual que la esfera de three.js) se busca su punto 3D,
se proyecta con la cámara calibrada (calibracion.py) y se toma el color del
dibujo. Un z-buffer evita tomar color de lo que en el dibujo está tapado, la
mitad de la cara que mejor se ve se usa para los dos lados (simetría, sin
costuras en los ojos) y donde el dibujo no muestra nada (nuca, coronilla) quedan
los colores del modelo con un sombreado suave horneado.

    python ml/avatar/proyectar.py                  # escribe signy/src/assets/modelos/zorro-cara.webp
    python ml/avatar/proyectar.py --png salida/    # además deja PNG y máscara para revisar
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import cabeza as C
from calibracion import ILUSTRACION, RAIZ, ajustar

TEXTURA = RAIZ / 'signy' / 'src' / 'assets' / 'modelos' / 'zorro-cara.webp'
ANCHO, ALTO = 2048, 1024


def superficie(lam, phi):
    d = np.stack([np.sin(lam) * np.cos(phi), np.sin(phi), np.cos(lam) * np.cos(phi)], -1)
    return d, d * C.radio(d)[..., None]


def rellenar(z, k):
    """Tapa los huecos del z-buffer (el muestreo es discreto) con el vecino más cercano a la cámara."""
    z = np.where(np.isinf(z), 1e9, z).astype(np.float32)
    vecinos = cv2.erode(z, np.ones((k, k), np.uint8))
    return np.where(z > 1e8, vecinos, z)


def mascara_cara(arte):
    """Píxeles del dibujo que son cara del zorrito (no fondo, pañuelo, mochila, oreja ni hombro)."""
    H, W = arte.shape[:2]
    alfa = arte[..., 3]
    hsv = cv2.cvtColor((arte[..., :3] * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    yy, xx = np.mgrid[0:H, 0:W]
    # Pañuelo azul (con brillo mínimo: un negro casi puro también tiene "tono" azul).
    azul = (hsv[..., 0] > 95) & (hsv[..., 0] < 135) & (hsv[..., 1] > 90) & (hsv[..., 2] > 80)
    # Bajo el mentón está la correa café de la mochila; la boca (también oscura) se respeta.
    boca = (xx > 705) & (xx < 860) & (yy > 480) & (yy < 580)
    cafe = (hsv[..., 2] < 140) & (hsv[..., 1] > 60) & (hsv[..., 0] < 30) & (yy > 565) & ~boca
    fuera = cv2.dilate((azul | cafe).astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    valido = (alfa > 0.97) & ~fuera & ((yy < 585) | boca)
    # Oreja cercana del dibujo (tapa el costado del cráneo) y lo que queda bajo la mejilla (hombro).
    oreja = np.zeros((H, W), np.uint8)
    contorno = [(440, 255), (600, 255), (607, 298), (577, 335), (562, 370), (558, 430), (558, 495), (520, 470), (470, 400), (440, 330)]
    cv2.fillPoly(oreja, [np.array(contorno, np.int32)], 1)
    oreja = cv2.dilate(oreja, np.ones((7, 7), np.uint8)).astype(bool)
    bajo_mejilla = (xx < 700) & (yy > 552 + (xx - 520) * 0.4)
    valido &= ~oreja & ~bajo_mejilla
    return cv2.erode(valido.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)


def hornear():
    arte = np.asarray(Image.open(ILUSTRACION).convert('RGBA')).astype(np.float32) / 255
    H, W = arte.shape[:2]
    camara, _ = ajustar(W, H)

    # Un punto y una normal por texel.
    u = (np.arange(ANCHO) + 0.5) / ANCHO
    v = (np.arange(ALTO) + 0.5) / ALTO
    LAM, PHI = np.meshgrid((u - 0.5) * 2 * np.pi, (v - 0.5) * np.pi)
    D, P = superficie(LAM, PHI)
    e = 1e-3
    dl = superficie(LAM + e, PHI)[1] - P
    dp = superficie(LAM, PHI + e)[1] - P
    N = np.cross(dp, dl)
    N /= np.linalg.norm(N, axis=-1, keepdims=True) + 1e-12
    N *= np.sign(np.sum(N * D, -1, keepdims=True))

    # z-buffer de la cabeza y de las orejas (que tapan parte del cráneo).
    def acumular(puntos, buf):
        Pc = camara.a_camara(puntos.reshape(-1, 3))
        px = np.round(camara.a_pixel(Pc)).astype(int)
        ok = (px[:, 0] >= 0) & (px[:, 0] < W) & (px[:, 1] >= 0) & (px[:, 1] < H)
        np.minimum.at(buf, (px[ok, 1], px[ok, 0]), Pc[ok, 2])

    zbuf = np.full((H, W), np.inf)
    zoreja = np.full((H, W), np.inf)
    acumular(P, zbuf)
    for lado in (-1, 1):
        acumular(C.puntos_oreja(lado), zoreja)
    zbuf = rellenar(zbuf, 5)
    zoreja = rellenar(zoreja, 7)
    valido = mascara_cara(arte)

    def muestrear(puntos, normales):
        Pc = camara.a_camara(puntos)
        px = camara.a_pixel(Pc)
        hacia = -Pc / np.linalg.norm(Pc, axis=-1, keepdims=True)
        frente = np.clip(np.sum(camara.normal_a_camara(normales) * hacia, -1), 0, 1)
        xi = np.clip(np.round(px[..., 0]).astype(int), 0, W - 1)
        yi = np.clip(np.round(px[..., 1]).astype(int), 0, H - 1)
        dentro = (px[..., 0] >= 0) & (px[..., 0] < W) & (px[..., 1] >= 0) & (px[..., 1] < H)
        visible = (Pc[..., 2] <= zbuf[yi, xi] + 0.05) & (Pc[..., 2] <= zoreja[yi, xi])
        color = cv2.remap(arte[..., :3], px[..., 0].astype(np.float32), px[..., 1].astype(np.float32), cv2.INTER_CUBIC)
        return color, frente ** 2 * dentro * visible * valido[yi, xi]

    espejo = np.array([-1, 1, 1])
    cP, wP = muestrear(P, N)
    cM, wM = muestrear(P * espejo, N * espejo)
    # La mitad del ojo cercano (x < 0) es la que mejor se ve en el dibujo: se usa para los dos lados.
    # La otra solo rellena donde la principal no ve (detrás de la oreja, etc.).
    lado_bueno = P[..., 0] <= 0
    cPri, wPri = np.where(lado_bueno[..., None], cP, cM), np.where(lado_bueno, wP, wM)
    cSec, wSec = np.where(lado_bueno[..., None], cM, cP), np.where(lado_bueno, wM, wP)
    usar_sec = (wPri < 0.12) & (wSec > wPri)
    color = np.where(usar_sec[..., None], cSec, cPri)
    peso = np.where(usar_sec, wSec, wPri)
    # Al centro (boca, hocico) basta con verse un poco; en los costados se exige verse de frente,
    # si no queda el color del modelo (ahí el dibujo y la forma 3D no calzan tan bien).
    umbral = 0.12 + 0.25 * C.suave(0.35, 0.7, np.abs(D[..., 0]))
    # Mejillas bajas: crema del modelo (el dibujo ahí muestra el costado de la cabeza).
    mejilla_baja = (np.abs(D[..., 0]) > 0.5) & (D[..., 1] < -0.18)
    cubierto = ((peso > umbral) & ~mejilla_baja).astype(np.uint8)

    # Donde el dibujo no da información: colores del modelo, mezclados suavemente con la proyección
    # (antes, el borde de la proyección se extiende un poco para que la mezcla no traiga negro).
    img8 = (np.clip(color, 0, 1) * 255).astype(np.uint8)
    img8[cubierto == 0] = 0
    extendido = cv2.inpaint(img8, (1 - cubierto) * 255, 8, cv2.INPAINT_TELEA).astype(np.float32) / 255
    # Sombreado horneado (en la app la cara se dibuja sin la luz de la escena, como el arte):
    # luz suave desde arriba y adelante, más oscuro hacia los bordes.
    difusa = np.clip(np.sum(N * np.array([0.0, 0.55, 0.83]), -1), 0, 1)
    borde = 1 - np.clip(N[..., 2], 0, 1)
    sombra = (0.8 + 0.25 * difusa - 0.08 * borde ** 2)[..., None]
    base = np.clip(C.color(D) * sombra, 0, 1)
    mezcla = cv2.GaussianBlur(cubierto.astype(np.float32), (0, 0), 14)
    mezcla = np.clip((mezcla - 0.15) / 0.6, 0, 1)[..., None]
    final = base * (1 - mezcla) + extendido * mezcla
    # Fila 0 = arriba de la cabeza (v = 1), como espera three.js (flipY).
    return (np.clip(final, 0, 1)[::-1] * 255).astype(np.uint8), cubierto[::-1]


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--salida', type=Path, default=TEXTURA, help='textura .webp para la app')
    ap.add_argument('--png', type=Path, help='carpeta donde dejar también cabeza.png y cabeza-mascara.png')
    args = ap.parse_args()
    textura, cubierto = hornear()
    args.salida.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(textura).save(args.salida, 'WEBP', quality=90, method=6)
    print(f'{args.salida} ({args.salida.stat().st_size // 1024} KB), cobertura del dibujo: {cubierto.mean():.1%}')
    if args.png:
        args.png.mkdir(parents=True, exist_ok=True)
        Image.fromarray(textura).save(args.png / 'cabeza.png')
        Image.fromarray(cubierto * 255).save(args.png / 'cabeza-mascara.png')
