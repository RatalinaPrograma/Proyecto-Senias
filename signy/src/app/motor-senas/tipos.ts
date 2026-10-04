/**
 * Tipos del motor de reconocimiento de señas.
 *
 * Hay dos representaciones distintas:
 *  - Captura CRUDA: lo que entrega MediaPipe, tal cual, más el tamaño del
 *    video. No pierde información y es lo que se guarda en el dataset para
 *    entrenar modelos (cualquier normalización futura se puede recalcular).
 *  - Características: vectores normalizados que se comparan (DTW) o que
 *    entran al clasificador. Se derivan siempre de la captura cruda.
 */

export interface Punto3D {
  x: number;
  y: number;
  z: number;
}

/** 21 landmarks de una mano (orden de MediaPipe Hands). */
export type Mano = Punto3D[];

export const PUNTOS_POR_MANO = 21;
export const VALORES_POR_MANO = PUNTOS_POR_MANO * 3;

/** Índices de landmarks usados por el motor. */
export const MUNECA = 0;
export const MCP_MEDIO = 9;

/** Lateralidad que reporta MediaPipe para cada mano (si viene). */
export type Lateralidad = 'Left' | 'Right' | null;

export interface FrameCrudo {
  /** Milisegundos desde el inicio de la captura (monótono creciente). */
  t: number;
  /** Coordenadas normalizadas de imagen [0..1], tal como las entrega MediaPipe. */
  manos: Mano[];
  lateralidad?: Lateralidad[];
}

export interface CapturaCruda {
  /** Tamaño en píxeles del video del que salieron los landmarks. */
  ancho: number;
  alto: number;
  frames: FrameCrudo[];
}

export type TipoSena = 'estatica' | 'dinamica';

/**
 * Modelo de referencia guardado en `senas.landmarks_referencia`.
 *
 * - v1: cada frame autocentrado (sin trayectoria). Ya no se puede comparar.
 * - v2: frames anclados a la muñeca del primer frame. Sin corrección de
 *   relación de aspecto y grabado a la tasa de refresco de la pantalla
 *   (frames repetidos). Se sigue aceptando, pero conviene re-grabar.
 * - v3: coordenadas isotrópicas (corrige la relación de aspecto del video),
 *   manos ordenadas de forma estable, frames remuestreados a `fpsObjetivo`
 *   y normalización canónica (centro = muñeca promedio, escala = tamaño de
 *   mano mediano). Las estáticas guardan un solo frame: el medoide.
 */
export interface ModeloReferenciaSena {
  version: 1 | 2 | 3;
  palabra: string;
  tipo: TipoSena;
  manosRequeridas: 1 | 2;
  totalFrames: number;
  fpsObjetivo: number;
  /** Arrays planos [x0,y0,z0,...]: 63 valores por mano requerida. */
  frames: number[][];
  duracionMs?: number;
  umbralRecomendado?: number;
}

export interface ResultadoEvaluacion {
  similitudPct: number;
  esCoincidente: boolean;
  umbral: number;
  /** true si el mejor resultado vino de la captura espejada (persona zurda). */
  espejo: boolean;
  /** Frames de la captura que tenían las manos necesarias. */
  framesUtiles: number;
  motivo?: 'sin_modelo' | 'pocos_frames';
}
