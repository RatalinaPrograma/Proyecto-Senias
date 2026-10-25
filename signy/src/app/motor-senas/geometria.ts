import { CapturaCruda, FrameCrudo, MCP_MEDIO, MUNECA, Mano, Punto3D, PUNTOS_POR_MANO } from './tipos';

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

export function mediana(valores: number[]): number {
  if (!valores.length) return 0;
  const v = valores.slice().sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
