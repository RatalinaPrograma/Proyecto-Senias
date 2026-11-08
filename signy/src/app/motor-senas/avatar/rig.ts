/**
 * Proporciones (rig) de cada personaje del avatar 3D, en unidades del avatar.
 *
 * Ejes: X hacia la derecha de quien mira, Y hacia arriba, Z hacia quien mira.
 * El personaje mira de frente (+Z). La cintura está en y = 0.
 *
 * Estos números son la "calibración" del personaje: dónde están los hombros,
 * cuánto miden brazo y antebrazo, el tamaño de la mano y la posición de la
 * cara, el mentón y el pecho. La cinemática los usa para llevar la seña de la
 * persona (medida en "tamaños de palma") al cuerpo del personaje, y el
 * modelo 3D se construye con los mismos valores para que todo calce.
 */
import { TemaAvatar } from './config';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Elipsoide (para que las manos no atraviesen la cabeza ni el cuerpo). */
export interface Elipsoide {
  centro: V3;
  radios: V3;
}

/**
 * Esqueleto canónico de la mano DERECHA, en unidades de palma (1 = muñeca → nudillo del dedo medio).
 * Ejes locales: x hacia el lado del índice, y de la muñeca hacia los nudillos, z hacia la palma.
 */
export interface EsqueletoMano {
  /** Posición local de los puntos que no cuelgan de otra falange: 1 (base del pulgar), 5, 9, 13 y 17 (nudillos). */
  base: Record<1 | 5 | 9 | 13 | 17, V3>;
  /** Largo del hueso que llega a cada landmark (índice 0..20; 0 y las bases no se usan). */
  falanges: number[];
  /** Radio de cada dedo (pulgar, índice, medio, anular, meñique), en unidades de palma. */
  radioDedos: [number, number, number, number, number];
}

export interface RigAvatar {
  /** Hombro de la izquierda de la pantalla (lado -1) y de la derecha (lado +1). */
  hombroIzq: V3;
  hombroDer: V3;
  largoBrazo: number;
  largoAntebrazo: number;
  /** Largo de la palma (muñeca → nudillo medio) con tamaño de manos = 1. */
  largoPalma: number;
  mano: EsqueletoMano;
  /** Puntos de referencia del cuerpo (y) para llevar la seña a las mismas zonas: cara, mentón, hombros, pecho, cintura. */
  yCoronilla: number;
  yOjos: number;
  yMenton: number;
  yHombros: number;
  yPecho: number;
  yCintura: number;
  /** Frente del pecho (z): las manos quedan delante de este plano. */
  zFrentePecho: number;
  /** Volúmenes que las manos no pueden atravesar (cabeza, hocico, torso). */
  colisiones: Elipsoide[];
  /** Zona visible para las manos (para que nunca salgan del cuadro). */
  limites: { xMax: number; yMin: number; yMax: number };
  /** Dónde descansan las muñecas cuando no se ve una mano (lado +1; el -1 es simétrico). */
  munecaReposo: V3;
}

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });

/** Falanges: [_, pulgar 1..4, índice 5..8, medio 9..12, anular 13..16, meñique 17..20]. */
function falanges(pulgar: number[], indice: number[], medio: number[], anular: number[], menique: number[]): number[] {
  return [0, 0, ...pulgar, 0, ...indice, 0, ...medio, 0, ...anular, 0, ...menique];
}

/** Patita de peluche: dedos cortos y gorditos. */
const MANO_PATITA: EsqueletoMano = {
  base: {
    1: v(0.24, 0.2, 0.12),
    5: v(0.34, 0.93, 0),
    9: v(0.03, 1, 0),
    13: v(-0.27, 0.93, 0),
    17: v(-0.5, 0.78, 0),
  },
  falanges: falanges([0.38, 0.3, 0.25], [0.36, 0.23, 0.19], [0.4, 0.25, 0.2], [0.37, 0.23, 0.19], [0.3, 0.19, 0.17]),
  radioDedos: [0.15, 0.135, 0.14, 0.135, 0.125],
};

/** Mano humana estilizada: un poco más larga y fina. */
const MANO_HUMANA: EsqueletoMano = {
  base: {
    1: v(0.22, 0.2, 0.1),
    5: v(0.33, 0.94, 0),
    9: v(0.03, 1, 0),
    13: v(-0.26, 0.94, 0),
    17: v(-0.5, 0.8, 0),
  },
  falanges: falanges([0.42, 0.33, 0.27], [0.43, 0.26, 0.21], [0.48, 0.29, 0.23], [0.44, 0.27, 0.21], [0.35, 0.21, 0.19]),
  radioDedos: [0.135, 0.12, 0.122, 0.116, 0.105],
};

export const RIG_ZORRO: RigAvatar = {
  hombroIzq: v(-0.53, 1.32, 0),
  hombroDer: v(0.53, 1.32, 0),
  largoBrazo: 0.7,
  largoAntebrazo: 0.66,
  largoPalma: 0.4,
  mano: MANO_PATITA,
  yCoronilla: 3.12,
  yOjos: 2.32,
  yMenton: 1.66,
  yHombros: 1.34,
  yPecho: 0.92,
  yCintura: 0,
  zFrentePecho: 0.6,
  colisiones: [
    { centro: v(0, 2.3, 0.02), radios: v(0.96, 0.82, 0.84) },
    { centro: v(0, 2.02, 0.62), radios: v(0.38, 0.26, 0.36) },
    { centro: v(0, 0.7, 0), radios: v(0.78, 1.0, 0.62) },
  ],
  limites: { xMax: 1.7, yMin: 0.34, yMax: 3.25 },
  munecaReposo: v(0.6, 0.66, 0.74),
};

export const RIG_PERSONA: RigAvatar = {
  hombroIzq: v(-0.55, 1.28, 0),
  hombroDer: v(0.55, 1.28, 0),
  largoBrazo: 0.7,
  largoAntebrazo: 0.66,
  largoPalma: 0.37,
  mano: MANO_HUMANA,
  yCoronilla: 3.14,
  yOjos: 2.26,
  yMenton: 1.56,
  yHombros: 1.3,
  yPecho: 0.9,
  yCintura: 0,
  zFrentePecho: 0.46,
  colisiones: [
    { centro: v(0, 2.28, 0), radios: v(0.78, 0.86, 0.78) },
    { centro: v(0, 0.72, 0), radios: v(0.6, 0.98, 0.48) },
  ],
  limites: { xMax: 1.7, yMin: 0.34, yMax: 3.25 },
  munecaReposo: v(0.52, 0.62, 0.62),
};

export function rigDeTema(tema: TemaAvatar): RigAvatar {
  return tema === 'zorro' ? RIG_ZORRO : RIG_PERSONA;
}
