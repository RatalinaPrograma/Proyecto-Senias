"""Cámara de la ilustración oficial: dónde estaba "la cámara" que dibujó al zorrito.

Se marcaron a mano (en píxeles de signy/src/assets/img/EstasListo.png) los
mismos rasgos que da `cabeza.puntos_clave()`, y con solvePnP de OpenCV se
obtiene la pose de la cabeza en el dibujo. Con eso se puede proyectar cada
punto de la cabeza 3D sobre la ilustración y tomar su color.

    python ml/avatar/calibracion.py     # muestra el error por rasgo
"""
from pathlib import Path

import cv2
import numpy as np

import cabeza

RAIZ = Path(__file__).resolve().parents[2]
ILUSTRACION = RAIZ / 'signy' / 'src' / 'assets' / 'img' / 'EstasListo.png'

# Rasgos en la ilustración (x, y en píxeles; la imagen mide 1536 × 1024).
RASGOS_DIBUJO = {
    'ojo_cerca': (674, 468),    # centro del ojo izquierdo de la imagen (el que se ve de frente)
    'ojo_lejos': (849, 423),
    'nariz': (779, 484),
    'boca': (780, 535),         # centro de la boca abierta
    'oreja_cerca': (463, 273),  # puntas de las orejas
    'oreja_lejos': (867, 150),
    'mechon': (707, 247),       # mechón de la frente
}

# Lente larga (casi sin perspectiva, como un dibujo); el centro óptico es el centro de la imagen.
FOCAL = 4000.0


class Camara:
    def __init__(self, K, R, t):
        self.K, self.R, self.t = K, R, t

    def a_camara(self, P):
        """Puntos del modelo (y arriba, z hacia el espectador) → coordenadas de cámara de OpenCV."""
        return (P * [1, -1, -1]) @ self.R.T + self.t

    def normal_a_camara(self, N):
        return (N * [1, -1, -1]) @ self.R.T

    def a_pixel(self, Pc):
        f, cx, cy = self.K[0, 0], self.K[0, 2], self.K[1, 2]
        return np.stack([f * Pc[..., 0] / Pc[..., 2] + cx, f * Pc[..., 1] / Pc[..., 2] + cy], -1)


def ajustar(ancho=1536, alto=1024):
    nombres = list(RASGOS_DIBUJO)
    modelo = cabeza.puntos_clave()
    P3 = np.array([modelo[n] for n in nombres]) * [1, -1, -1]
    P2 = np.array([RASGOS_DIBUJO[n] for n in nombres], float)
    K = np.array([[FOCAL, 0, ancho / 2], [0, FOCAL, alto / 2], [0, 0, 1]])
    _, rvec, tvec = cv2.solvePnP(P3, P2, K, None)
    R, _ = cv2.Rodrigues(rvec)
    camara = Camara(K, R, tvec.ravel())
    proyectados = camara.a_pixel(camara.a_camara(np.array([modelo[n] for n in nombres])))
    errores = dict(zip(nombres, np.linalg.norm(proyectados - P2, axis=1)))
    return camara, errores


if __name__ == '__main__':
    _, errores = ajustar()
    for nombre, e in errores.items():
        print(f'{nombre:12s} {e:5.1f} px')
    print(f'error medio: {np.mean(list(errores.values())):.1f} px (la cabeza mide ~450 px en el dibujo)')
