import { CapturaCruda, FrameCrudo, MCP_MEDIO, MUNECA, Mano, Punto3D, PUNTOS_POR_MANO, VALORES_POR_MANO } from './tipos';

/** Frame con manos ya en coordenadas isotrópicas y el instante en que se tomó. */
export interface FrameManos {
  t: number;
  manos: Mano[];
}

/**
 * MediaPipe entrega x dividido por el ANCHO de la imagen e y dividido por el
 * ALTO. Comparar esas coordenadas directamente deforma la mano cuando las
 * cámaras tienen distinta relación de aspecto (laptop 4:3 horizontal vs.
 * celular 3:4 vertical): el mismo dedo "mide" distinto según el eje.
 * Multiplicando x (y z, que MediaPipe expresa en la escala de x) por
 * ancho/alto, todo queda en unidades de "alto de imagen" en los tres ejes.
 */
export function aIsotropico(captura: CapturaCruda, corregirAspecto = true): FrameManos[] {
  const k = corregirAspecto && captura.alto > 0 ? captura.ancho / captura.alto : 1;
  return captura.frames.map((f: FrameCrudo) => ({
    t: f.t,
    manos: (f.manos || [])
      .filter((m) => m && m.length >= PUNTOS_POR_MANO)
      .map((m) => m.map((p) => ({ x: p.x * k, y: p.y, z: (p.z || 0) * k }))),
  }));
}

export function distancia(a: Punto3D, b: Punto3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Tamaño de la mano: distancia muñeca → nudillo del dedo medio. */
export function tamanoMano(mano: Mano): number {
  return distancia(mano[MUNECA], mano[MCP_MEDIO]);
}

export function aplanar(manos: Mano[]): number[] {
  const out: number[] = [];
  for (const m of manos) {
    for (let i = 0; i < PUNTOS_POR_MANO; i++) out.push(m[i].x, m[i].y, m[i].z);
  }
  return out;
}

export function desaplanar(frame: number[]): Mano[] {
  const manos: Mano[] = [];
  for (let base = 0; base + VALORES_POR_MANO <= frame.length; base += VALORES_POR_MANO) {
    const m: Mano = [];
    for (let i = 0; i < PUNTOS_POR_MANO; i++) {
      m.push({ x: frame[base + i * 3], y: frame[base + i * 3 + 1], z: frame[base + i * 3 + 2] });
    }
    manos.push(m);
  }
  return manos;
}

/** Espejo horizontal: convierte la ejecución de una persona zurda en la de una diestra. */
export function espejarMano(mano: Mano): Mano {
  return mano.map((p) => ({ x: -p.x, y: p.y, z: p.z }));
}

function mezclarMano(a: Mano, b: Mano, u: number): Mano {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * u,
    y: p.y + (b[i].y - p.y) * u,
    z: p.z + (b[i].z - p.z) * u,
  }));
}

/**
 * Remuestrea una secuencia de frames (todas con la misma cantidad de manos)
 * a una tasa fija, interpolando linealmente. Así una cámara de 15 fps y una
 * de 60 fps producen secuencias comparables, y los frames repetidos o
 * perdidos dejan de influir. No inventa frames dentro de huecos largos (la
 * mano salió de cuadro).
 */
export function remuestrear(frames: FrameManos[], fps: number, huecoMaxMs = 400): FrameManos[] {
  if (frames.length < 2 || fps <= 0) return frames.slice();
  const paso = 1000 / fps;
  const out: FrameManos[] = [];
  const inicio = frames[0].t;
  const fin = frames[frames.length - 1].t;
  let j = 0;
  for (let t = inicio; t <= fin + 1e-6; t += paso) {
    while (j + 1 < frames.length - 1 && frames[j + 1].t < t) j++;
    const a = frames[j];
    const b = frames[Math.min(j + 1, frames.length - 1)];
    if (b.t - a.t > huecoMaxMs) continue;
    const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    out.push({ t, manos: a.manos.map((m, i) => mezclarMano(m, b.manos[i], u)) });
  }
  return out;
}

export function mediana(valores: number[]): number {
  if (!valores.length) return 0;
  const v = valores.slice().sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function redondear(frames: number[][], decimales = 4): number[][] {
  const f = 10 ** decimales;
  return frames.map((fr) => fr.map((v) => Math.round(v * f) / f));
}
