import { FrameManos, distancia } from './geometria';
import { MUNECA, Mano } from './tipos';

/**
 * MediaPipe no garantiza el ORDEN de las manos entre un frame y el
 * siguiente: cuando una mano se pierde y se vuelve a detectar, la posición
 * 0 y 1 pueden intercambiarse. Si se usa `landmarks[0]` directamente, una
 * seña de dos manos "salta" de una mano a la otra a mitad de la grabación,
 * y en señas de una mano se puede terminar midiendo la mano que está quieta.
 *
 * Este seguimiento asigna cada detección a una de dos "pistas" según la
 * cercanía de la muñeca con la última posición conocida de cada pista, de
 * modo que cada pista sigue SIEMPRE a la misma mano física.
 */
export type PistasPorFrame = [Mano | null, Mano | null][];

/** Distancia (en alto de imagen) a partir de la cual una detección se considera otra mano. */
const SALTO_MAXIMO = 0.3;

export function seguirManos(frames: FrameManos[]): PistasPorFrame {
  const ultima: (Mano | null)[] = [null, null];
  const salida: PistasPorFrame = [];

  const costo = (mano: Mano, pista: number) => {
    const u = ultima[pista];
    return u ? distancia(mano[MUNECA], u[MUNECA]) : SALTO_MAXIMO;
  };

  for (const frame of frames) {
    const manos = frame.manos.slice(0, 2);
    const asignacion: [Mano | null, Mano | null] = [null, null];

    if (manos.length === 1) {
      const m = manos[0];
      let pista: number;
      if (!ultima[0] && !ultima[1]) {
        pista = 0;
      } else {
        const d0 = ultima[0] ? costo(m, 0) : Infinity;
        const d1 = ultima[1] ? costo(m, 1) : Infinity;
        pista = d0 <= d1 ? 0 : 1;
        // Lejos de la única pista conocida y la otra está libre: es otra mano.
        if (Math.min(d0, d1) > SALTO_MAXIMO && !ultima[1 - pista]) pista = 1 - pista;
      }
      asignacion[pista] = m;
    } else if (manos.length === 2) {
      let [a, b] = manos;
      if (!ultima[0] && !ultima[1]) {
        if (a[MUNECA].x > b[MUNECA].x) [a, b] = [b, a];
      } else if (costo(a, 1) + costo(b, 0) < costo(a, 0) + costo(b, 1)) {
        [a, b] = [b, a];
      }
      asignacion[0] = a;
      asignacion[1] = b;
    }

    if (asignacion[0]) ultima[0] = asignacion[0];
    if (asignacion[1]) ultima[1] = asignacion[1];
    salida.push(asignacion);
  }
  return salida;
}

export interface ResumenPista {
  indice: 0 | 1;
  /** Fracción de los frames (con alguna mano) en que la pista estuvo presente. */
  presencia: number;
  xMedia: number;
  yMedia: number;
}

/** Una pista cuenta como mano "activa" si aparece en al menos este porcentaje de frames. */
export const PRESENCIA_MINIMA = 0.3;

export function resumirPistas(pistas: PistasPorFrame): ResumenPista[] {
  const conAlguna = pistas.filter((p) => p[0] || p[1]).length || 1;
  const resumen: ResumenPista[] = [];
  for (const indice of [0, 1] as const) {
    const presentes = pistas.map((p) => p[indice]).filter((m): m is Mano => !!m);
    if (!presentes.length) continue;
    resumen.push({
      indice,
      presencia: presentes.length / conAlguna,
      xMedia: presentes.reduce((s, m) => s + m[MUNECA].x, 0) / presentes.length,
      yMedia: presentes.reduce((s, m) => s + m[MUNECA].y, 0) / presentes.length,
    });
  }
  return resumen;
}

/**
 * Secuencias candidatas para comparar contra una seña de `manosRequeridas`.
 *  - 2 manos: frames donde están ambas pistas, ordenadas de izquierda a
 *    derecha en la imagen según su posición PROMEDIO (un cruce momentáneo
 *    de manos no las desordena).
 *  - 1 mano: una secuencia por cada pista activa, la más alta primero
 *    (la mano que hace la seña suele estar más arriba que la que descansa).
 */
export function secuenciasCandidatas(frames: FrameManos[], manosRequeridas: 1 | 2): FrameManos[][] {
  const pistas = seguirManos(frames);
  const resumen = resumirPistas(pistas).filter((r) => r.presencia >= PRESENCIA_MINIMA);

  if (manosRequeridas === 2) {
    if (resumen.length < 2) return [];
    const [izq, der] = resumen.slice().sort((a, b) => a.xMedia - b.xMedia);
    const secuencia: FrameManos[] = [];
    pistas.forEach((p, i) => {
      const a = p[izq.indice];
      const b = p[der.indice];
      if (a && b) secuencia.push({ t: frames[i].t, manos: [a, b] });
    });
    return [secuencia];
  }

  return resumen
    .sort((a, b) => a.yMedia - b.yMedia)
    .map((r) => {
      const secuencia: FrameManos[] = [];
      pistas.forEach((p, i) => {
        const m = p[r.indice];
        if (m) secuencia.push({ t: frames[i].t, manos: [m] });
      });
      return secuencia;
    });
}
