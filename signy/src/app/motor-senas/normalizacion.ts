import { FrameManos, aplanar, mediana, tamanoMano } from './geometria';
import { distanciaEntreFrames } from '../utils/gesture-math';
import { MUNECA, Mano, Punto3D, VALORES_POR_MANO } from './tipos';

function centroDeFrame(manos: Mano[]): Punto3D {
  if (manos.length === 1) return manos[0][MUNECA];
  const a = manos[0][MUNECA];
  const b = manos[1][MUNECA];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function trasladarEscalar(manos: Mano[], centro: Punto3D, escala: number): number[] {
  const s = escala > 1e-6 ? escala : 1;
  return aplanar(
    manos.map((m) => m.map((p) => ({ x: (p.x - centro.x) / s, y: (p.y - centro.y) / s, z: (p.z - centro.z) / s })))
  );
}

/**
 * Normalización canónica de una secuencia (señas dinámicas):
 *  - centro = posición PROMEDIO de la muñeca (o del punto medio entre las
 *    dos muñecas) durante toda la secuencia;
 *  - escala = tamaño de mano MEDIANO de la secuencia.
 *
 * Conserva la trayectoria (cuánto y hacia dónde se mueve la mano) igual que
 * el anclaje al primer frame del motor anterior, pero sin depender de dónde
 * estaba la mano justo cuando la cámara la detectó por primera vez (si la
 * mano venía entrando al cuadro, toda la seña quedaba desplazada).
 */
export function canonicalizar(secuencia: Mano[][]): number[][] {
  if (!secuencia.length) return [];
  const centros = secuencia.map(centroDeFrame);
  const centro = {
    x: centros.reduce((s, c) => s + c.x, 0) / centros.length,
    y: centros.reduce((s, c) => s + c.y, 0) / centros.length,
    z: centros.reduce((s, c) => s + c.z, 0) / centros.length,
  };
  const escala = mediana(secuencia.map((manos) => manos.reduce((s, m) => s + tamanoMano(m), 0) / manos.length));
  return secuencia.map((manos) => trasladarEscalar(manos, centro, escala));
}

/**
 * Forma de la mano en UN instante (señas estáticas): centrada en la muñeca
 * de la primera mano y escalada por su tamaño. No incluye dónde está la
 * mano en la imagen, solo su forma (y, con 2 manos, la posición relativa
 * de la segunda respecto de la primera).
 */
export function formaEstatica(manos: Mano[]): number[] {
  return trasladarEscalar(manos, manos[0][MUNECA], tamanoMano(manos[0]));
}

export function promedioFrames(frames: number[][]): number[] {
  if (!frames.length) return [];
  const out = new Array(frames[0].length).fill(0);
  for (const f of frames) for (let i = 0; i < out.length; i++) out[i] += f[i];
  return out.map((v) => v / frames.length);
}

/** Promedio móvil de `ventana` frames (reduce el temblor de los landmarks). */
export function suavizar(frames: number[][], ventana: number): number[][] {
  if (frames.length <= ventana) return frames.length ? [promedioFrames(frames)] : [];
  const out: number[][] = [];
  for (let i = ventana - 1; i < frames.length; i++) out.push(promedioFrames(frames.slice(i - ventana + 1, i + 1)));
  return out;
}

/** Cada mano del frame trasladada para que su propia muñeca quede en el origen. */
function centrarCadaMano(frame: number[]): number[] {
  const out = frame.slice();
  for (let base = 0; base + VALORES_POR_MANO <= out.length; base += VALORES_POR_MANO) {
    const [mx, my, mz] = [frame[base], frame[base + 1], frame[base + 2]];
    for (let i = base; i < base + VALORES_POR_MANO; i += 3) {
      out[i] -= mx;
      out[i + 1] -= my;
      out[i + 2] -= mz;
    }
  }
  return out;
}

/**
 * Giro (en el plano de la imagen) que mejor alinea la forma de `prueba` con
 * la de `referencia` (Procrustes 2D), limitado a ±`maximo` radianes. Cada
 * persona inclina la mano un poco distinto; sin esta tolerancia, una mano
 * girada 10–15° ya bajaba una seña estática correcta del umbral. El límite
 * evita que un giro grande convierta una forma de mano en otra.
 */
export function anguloAlineacion(referencia: number[], prueba: number[], maximo: number): number {
  const r = centrarCadaMano(referencia);
  const p = centrarCadaMano(prueba);
  let num = 0;
  let den = 0;
  for (let i = 0; i + 2 < Math.min(r.length, p.length); i += 3) {
    num += p[i] * r[i + 1] - p[i + 1] * r[i];
    den += p[i] * r[i] + p[i + 1] * r[i + 1];
  }
  const angulo = Math.atan2(num, den);
  return Math.max(-maximo, Math.min(maximo, angulo));
}

/** Gira cada mano alrededor de su propia muñeca (no mueve la trayectoria). */
export function rotarManos(frame: number[], angulo: number): number[] {
  if (!angulo) return frame;
  const c = Math.cos(angulo);
  const s = Math.sin(angulo);
  const out = frame.slice();
  for (let base = 0; base + VALORES_POR_MANO <= out.length; base += VALORES_POR_MANO) {
    const [mx, my] = [frame[base], frame[base + 1]];
    for (let i = base; i < base + VALORES_POR_MANO; i += 3) {
      const x = frame[i] - mx;
      const y = frame[i + 1] - my;
      out[i] = mx + x * c - y * s;
      out[i + 1] = my + x * s + y * c;
    }
  }
  return out;
}

/** Forma promedio (muñecas en el origen) de una secuencia, para estimar el giro. */
export function formaMedia(frames: number[][]): number[] {
  return promedioFrames(frames.map(centrarCadaMano));
}

/**
 * Referencia de una seña estática: el medoide de la grabación y, para
 * reducir el temblor, el promedio de la mitad de los frames más parecidos a él.
 */
export function referenciaEstatica(formas: number[][]): number[] {
  const centro = medoide(formas);
  if (formas.length < 4) return centro;
  const cercanas = formas
    .map((f) => ({ f, d: distanciaEntreFrames(f, centro) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.ceil(formas.length / 2))
    .map((x) => x.f);
  return promedioFrames(cercanas);
}

/** Frame más "central" de un conjunto: el que minimiza la distancia total al resto. */
export function medoide(frames: number[][]): number[] {
  if (frames.length <= 2) return frames[0] ?? [];
  let mejor = 0;
  let mejorCosto = Infinity;
  for (let i = 0; i < frames.length; i++) {
    let costo = 0;
    for (let j = 0; j < frames.length && costo < mejorCosto; j++) {
      if (i !== j) costo += distanciaEntreFrames(frames[i], frames[j]);
    }
    if (costo < mejorCosto) {
      mejorCosto = costo;
      mejor = i;
    }
  }
  return frames[mejor];
}

/**
 * Quita la quietud del principio y del final de una grabación de referencia
 * (el admin acomodándose antes de empezar o esperando a que termine). Se
 * mantiene un pequeño margen para no cortar el arranque del movimiento.
 */
export function recortarQuietud(frames: number[][], margen = 2, fraccion = 0.2): number[][] {
  if (frames.length < 6) return frames;
  const movimiento = frames.map((f, i) => (i === 0 ? 0 : distanciaEntreFrames(f, frames[i - 1])));
  const suavizado = movimiento.map((_, i) => {
    const ventana = movimiento.slice(Math.max(1, i - 1), Math.min(movimiento.length, i + 2));
    return ventana.reduce((s, v) => s + v, 0) / (ventana.length || 1);
  });
  const maximo = Math.max(...suavizado);
  // Aun con la mano quieta, los landmarks tiemblan: el "piso" de movimiento
  // se estima con el percentil 10 y el umbral se mide desde ahí.
  const piso = suavizado.slice(1).sort((a, b) => a - b)[Math.floor((suavizado.length - 1) * 0.1)] ?? 0;
  if (maximo - piso <= 1e-6) return frames;
  const umbral = piso + (maximo - piso) * fraccion;
  let inicio = suavizado.findIndex((v) => v >= umbral);
  let fin = suavizado.length - 1;
  while (fin > inicio && suavizado[fin] < umbral) fin--;
  inicio = Math.max(0, inicio - 1 - margen);
  fin = Math.min(frames.length - 1, fin + margen);
  const recortado = frames.slice(inicio, fin + 1);
  return recortado.length >= 5 ? recortado : frames;
}

export function manosDeSecuencia(secuencia: FrameManos[]): Mano[][] {
  return secuencia.map((f) => f.manos);
}
