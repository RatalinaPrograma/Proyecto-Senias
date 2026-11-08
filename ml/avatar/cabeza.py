"""Forma de la cabeza del zorrito, igual que `radioCabezaZorro` en
signy/src/app/motor-senas/avatar/personajes.ts.

La cabeza es una superficie "radial": para cada dirección `d` desde su centro,
`radio(d)` dice a qué distancia está la superficie. La textura de la cara se
hornea sobre esta misma forma, así que SI SE CAMBIA AQUÍ HAY QUE CAMBIARLA
ALLÁ (y volver a correr proyectar.py).
"""
import numpy as np

# Proporciones calibradas con la ilustración (ver calibracion.py): cráneo alto y rasgos juntos.
ALTO_CRANEO = 0.9
OJO = (0.39, -0.03, 0.92)
BOCA_Y = -0.4


def suave(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def radio(d):
    """`d`: direcciones unitarias (..., 3). Devuelve el radio (...)."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    r = 1 / np.sqrt((x / 0.98) ** 2 + (y / ALTO_CRANEO) ** 2 + (z / 0.84) ** 2)
    # Mitad de abajo más ancha: carita de peluche.
    r = r * (1 + 0.03 * suave(0.1, -0.5, y) * (1 - np.abs(z) * 0.5))
    # Mechones de los mofletes.
    lateral = suave(0.58, 0.9, np.abs(x)) * (1 - suave(0.35, 0.78, np.abs(z)))
    ang = np.arctan2(y, np.abs(x))
    pico = lambda c, w: np.maximum(0, 1 - np.abs(ang - c) / w) ** 2
    r = r + lateral * (0.1 * pico(-0.18, 0.17) + 0.15 * pico(-0.45, 0.17) + 0.07 * pico(-0.72, 0.15))
    # Hocico y barbilla.
    r = r + 0.36 * np.exp(-((x / 0.27) ** 2) - ((y + 0.3) / 0.2) ** 2) * suave(0.55, 0.95, z)
    r = r + 0.06 * np.exp(-((x / 0.25) ** 2) - ((y + 0.62) / 0.12) ** 2) * suave(0.4, 0.8, z)
    # Mechón en la frente.
    arriba = suave(0.78, 0.97, y) * suave(-0.15, 0.35, z)
    pico2 = lambda c, w: np.maximum(0, 1 - np.abs(x - c) / w) ** 2
    r = r + arriba * (0.05 * pico2(-0.2, 0.1) + 0.09 * pico2(-0.06, 0.11) + 0.11 * pico2(0.08, 0.11) + 0.05 * pico2(0.22, 0.09))
    return r


def normalizar(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def punto(d):
    d = normalizar(d)
    return d * radio(d)[..., None]


def rotacion_yxz(rx, ry, rz):
    """Rotación con el orden 'YXZ' de three.js."""
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Ry @ Rx @ Rz


# Orejas (como construirOrejas en personajes.ts).
PERFIL_OREJA = np.array([[0.37, -0.12], [0.38, 0.12], [0.34, 0.38], [0.25, 0.62], [0.13, 0.8], [0.03, 0.9], [0.001, 0.91]])


def pivote_oreja(lado):
    return np.array([lado * 0.5, 0.46, -0.12]), rotacion_yxz(-0.1, lado * 0.12, lado * -0.44)


def puntos_oreja(lado, n=60):
    """Muestras de la superficie de una oreja (para saber qué parte del cráneo tapa)."""
    ys = np.linspace(PERFIL_OREJA[0, 1], PERFIL_OREJA[-1, 1], n)
    ang = np.linspace(0, 2 * np.pi, n)
    A, Y = np.meshgrid(ang, ys)
    R = np.interp(Y, PERFIL_OREJA[:, 1], PERFIL_OREJA[:, 0])
    local = np.stack([np.sin(A) * R, Y, np.cos(A) * R * 0.42], -1).reshape(-1, 3)
    pivote, rot = pivote_oreja(lado)
    return local @ rot.T + pivote


def nariz():
    """Centro visible de la nariz (en la punta del hocico)."""
    mejor, mejor_z = None, -1e9
    for dy in np.arange(-0.5, 0.001, 0.02):
        p = punto([0, dy, 1])
        if p[2] > mejor_z:
            mejor_z, mejor = p[2], p
    return mejor + np.array([0, 0.05, 0.08])


def puntos_clave():
    """Rasgos del modelo que se pueden ubicar en la ilustración (para calibrar la cámara)."""
    ojo = normalizar(OJO)
    cerca = ojo * [-1, 1, 1]
    pivote, rot = pivote_oreja(-1)
    pivote2, rot2 = pivote_oreja(1)
    return {
        'ojo_cerca': punto(cerca) + cerca * 0.03,
        'ojo_lejos': punto(ojo) + ojo * 0.03,
        'nariz': nariz(),
        'boca': punto([0, BOCA_Y, 0.88]),
        'oreja_cerca': pivote + rot @ np.array([0, 0.91, 0]),
        'oreja_lejos': pivote2 + rot2 @ np.array([0, 0.91, 0]),
        'mechon': punto([0.03, 0.97, 0.22]),
    }


def _hex(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


NARANJA, NARANJA_OSCURO, CREMA = _hex('F57205'), _hex('B94A04'), _hex('F8DCB4')


def color(d):
    """Colores del modelo (sRGB 0..1) para las zonas que la ilustración no muestra (nuca, costados)."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    t = (suave(0.4, 1, y) * 0.2 + suave(0, -0.9, z) * 0.2)[..., None]
    out = NARANJA * (1 - t) + NARANJA_OSCURO * t
    ax = np.abs(x)
    borde = -0.2 - 0.12 * np.sin(np.minimum(1, ax / 0.75) * np.pi) + 0.15 * suave(0.55, 0.9, ax)
    crema = (suave(borde + 0.04, borde - 0.04, y) * suave(-0.15, 0.3, z))[..., None]
    out = out * (1 - crema) + CREMA * crema
    return out * (1 - 0.15 * suave(-0.6, -0.95, y))[..., None]
