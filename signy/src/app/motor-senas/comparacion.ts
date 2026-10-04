import { distanciaEntreFrames } from '../utils/gesture-math';
import { FrameManos, aIsotropico, desaplanar, espejarMano, redondear, remuestrear } from './geometria';
import {
  anguloAlineacion,
  canonicalizar,
  formaEstatica,
  formaMedia,
  manosDeSecuencia,
  recortarQuietud,
  referenciaEstatica,
  rotarManos,
  suavizar,
} from './normalizacion';
import { secuenciasCandidatas, seguirManos } from './seguimiento';
import { CapturaCruda, Mano, ModeloReferenciaSena, ResultadoEvaluacion, TipoSena } from './tipos';

export const VERSION_MOTOR = 3;
/** Tasa a la que se remuestrean todas las secuencias antes de compararlas. */
export const FPS_MOTOR = 20;
export const UMBRAL_DINAMICA = 70;
export const UMBRAL_ESTATICA = 75;
/** Frames útiles mínimos (a FPS_MOTOR) para intentar una comparación. */
export const FRAMES_MINIMOS = 5;
/** Ventana (a FPS_MOTOR) en que una pose estática debe sostenerse: 250 ms. */
const VENTANA_ESTATICA = 5;
/** Inclinación de mano tolerada entre personas: ±25°. */
const GIRO_MAXIMO = (25 * Math.PI) / 180;

// Distancias promedio por articulación que equivalen a 0 % de similitud.
// Son las mismas del motor anterior para no mover los umbrales guardados.
const DISTANCIA_MAXIMA_DINAMICA = 0.45;
const DISTANCIA_MAXIMA_ESTATICA = 0.4;

export function similitudDesdeDistancia(distancia: number, tipo: TipoSena): number {
  const max = tipo === 'estatica' ? DISTANCIA_MAXIMA_ESTATICA : DISTANCIA_MAXIMA_DINAMICA;
  return Math.max(0, Math.min(100, Math.round((1 - distancia / max) * 100)));
}

export interface ResultadoDTW {
  /** Costo acumulado / (largo referencia + largo del tramo usado de la prueba). */
  distancia: number;
  inicio: number;
  fin: number;
}

/**
 * Dynamic Time Warping. Con `subsecuencia`, la referencia completa se
 * alinea contra el MEJOR TRAMO de la prueba (inicio y fin libres): la
 * grabación del alumno puede tener tiempo muerto antes y después de la
 * seña y eso no debe bajarle el puntaje.
 */
export function dtw(referencia: number[][], prueba: number[][], subsecuencia = true): ResultadoDTW {
  const N = referencia.length;
  const M = prueba.length;
  if (!N || !M) return { distancia: Infinity, inicio: 0, fin: 0 };

  const costo = new Float64Array(N * M);
  const origen = new Int32Array(N * M);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const k = i * M + j;
      const local = distanciaEntreFrames(referencia[i], prueba[j]);
      if (i === 0) {
        if (j === 0 || subsecuencia) {
          costo[k] = local;
          origen[k] = j;
        } else {
          costo[k] = costo[k - 1] + local;
          origen[k] = 0;
        }
        continue;
      }
      let previo = k - M; // (i-1, j)
      if (j > 0) {
        if (costo[k - M - 1] <= costo[previo]) previo = k - M - 1; // diagonal
        if (costo[k - 1] < costo[previo]) previo = k - 1; // (i, j-1)
      }
      costo[k] = local + costo[previo];
      origen[k] = origen[previo];
    }
  }

  const ultimaFila = (N - 1) * M;
  if (!subsecuencia) {
    return { distancia: costo[ultimaFila + M - 1] / (N + M), inicio: 0, fin: M - 1 };
  }
  let mejor: ResultadoDTW = { distancia: Infinity, inicio: 0, fin: 0 };
  for (let j = 0; j < M; j++) {
    const inicio = origen[ultimaFila + j];
    const d = costo[ultimaFila + j] / (N + j - inicio + 1);
    if (d < mejor.distancia) mejor = { distancia: d, inicio, fin: j };
  }
  return mejor;
}

/**
 * DTW por subsecuencia en dos pasadas. La normalización canónica se calcula
 * sobre TODA la captura, así que si la persona hizo otra cosa antes de la
 * seña (por ejemplo, la mano venía entrando al cuadro) el centro queda
 * corrido. Una vez ubicado el tramo donde está la seña, se vuelve a
 * normalizar solo ese tramo y se compara de nuevo.
 */
function distanciaDinamica(referencia: ReferenciaPreparada, secuencia: Mano[][]): number {
  let tramo = secuencia;
  let mejor = Infinity;
  for (let pasada = 0; pasada < 3; pasada++) {
    const prueba = canonicalizar(tramo);
    const giro = anguloAlineacion(referencia.forma, formaMedia(prueba), GIRO_MAXIMO);
    const r = dtw(referencia.frames, prueba.map((f) => rotarManos(f, giro)), true);
    if (r.distancia >= mejor) break;
    mejor = r.distancia;
    const siguiente = tramo.slice(Math.max(0, r.inicio - 2), Math.min(tramo.length, r.fin + 3));
    if (siguiente.length < FRAMES_MINIMOS || siguiente.length === tramo.length) break;
    tramo = siguiente;
  }
  return mejor;
}

function espejarFrames(frames: FrameManos[]): FrameManos[] {
  return frames.map((f) => ({ t: f.t, manos: f.manos.map(espejarMano) }));
}

/**
 * Referencia lista para comparar. Los modelos v2 (sin corrección de aspecto,
 * anclados al primer frame, manos en el orden crudo de MediaPipe) se pueden
 * seguir usando: se reconstruyen las manos, se reordenan con el seguimiento
 * y se re-normalizan igual que una captura nueva.
 */
interface ReferenciaPreparada {
  frames: number[][];
  /** Forma media de la mano, para estimar el giro de quien hace la seña. */
  forma: number[];
}

function prepararReferencia(modelo: ModeloReferenciaSena): ReferenciaPreparada {
  const manosPorFrame: Mano[][] = modelo.frames.map((f) => desaplanar(f).slice(0, modelo.manosRequeridas));
  if (modelo.tipo === 'estatica') {
    const formas = manosPorFrame.filter((m) => m.length === modelo.manosRequeridas).map(formaEstatica);
    const forma = formas.length ? referenciaEstatica(formas) : [];
    return { frames: forma.length ? [forma] : [], forma };
  }
  let secuencia = manosPorFrame;
  if (modelo.manosRequeridas === 2 && (modelo.version ?? 1) < 3) {
    const frames = manosPorFrame.map((manos, t) => ({ t, manos }));
    secuencia = manosDeSecuencia(secuenciasCandidatas(frames, 2)[0] ?? []);
  }
  const frames = canonicalizar(secuencia.filter((m) => m.length === modelo.manosRequeridas));
  return { frames, forma: formaMedia(frames) };
}

export interface OpcionesEvaluacion {
  /** Aceptar la seña hecha en espejo (personas zurdas). Por defecto true. */
  permitirEspejo?: boolean;
  umbral?: number;
}

/**
 * Compara lo que hizo una persona frente a la cámara contra el modelo de
 * referencia de la seña. Prueba cada mano candidata y, si se permite, la
 * versión espejada (zurdos), y se queda con el mejor resultado.
 */
export function evaluarCaptura(
  modelo: ModeloReferenciaSena | null | undefined,
  captura: CapturaCruda,
  opciones: OpcionesEvaluacion = {}
): ResultadoEvaluacion {
  const umbral = opciones.umbral ?? modelo?.umbralRecomendado ?? (modelo?.tipo === 'estatica' ? UMBRAL_ESTATICA : UMBRAL_DINAMICA);
  const vacio: ResultadoEvaluacion = { similitudPct: 0, esCoincidente: false, umbral, espejo: false, framesUtiles: 0 };
  if (!modelo || !modelo.frames?.length || (modelo.version ?? 1) < 2) return { ...vacio, motivo: 'sin_modelo' };

  const referencia = prepararReferencia(modelo);
  if (!referencia.frames.length || !referencia.frames[0].length) return { ...vacio, motivo: 'sin_modelo' };

  const iso = aIsotropico(captura, (modelo.version ?? 1) >= 3);
  const variantes: { frames: FrameManos[]; espejo: boolean }[] = [{ frames: iso, espejo: false }];
  if (opciones.permitirEspejo !== false) variantes.push({ frames: espejarFrames(iso), espejo: true });

  let mejor: ResultadoEvaluacion = { ...vacio, motivo: 'pocos_frames' };
  for (const variante of variantes) {
    let candidatas = secuenciasCandidatas(variante.frames, modelo.manosRequeridas);
    // En una seña estática de una mano se evalúa solo la mano más alta: la
    // que descansa abajo podría tener por casualidad la forma buscada.
    if (modelo.tipo === 'estatica') candidatas = candidatas.slice(0, 1);

    for (const candidata of candidatas) {
      const secuencia = remuestrear(candidata, FPS_MOTOR);
      if (secuencia.length < FRAMES_MINIMOS) {
        mejor.framesUtiles = Math.max(mejor.framesUtiles, secuencia.length);
        continue;
      }
      let similitud: number;
      if (modelo.tipo === 'estatica') {
        const ref = referencia.frames[0];
        const formas = suavizar(secuencia.map((f) => formaEstatica(f.manos)), VENTANA_ESTATICA);
        similitud = Math.max(
          ...formas.map((forma) => {
            const alineada = rotarManos(forma, anguloAlineacion(ref, forma, GIRO_MAXIMO));
            return similitudDesdeDistancia(distanciaEntreFrames(ref, alineada), 'estatica');
          })
        );
      } else {
        similitud = similitudDesdeDistancia(distanciaDinamica(referencia, manosDeSecuencia(secuencia)), 'dinamica');
      }
      if (similitud > mejor.similitudPct || mejor.motivo) {
        mejor = {
          similitudPct: similitud,
          esCoincidente: similitud >= umbral,
          umbral,
          espejo: variante.espejo,
          framesUtiles: Math.max(mejor.framesUtiles, secuencia.length),
        };
      }
    }
  }
  return mejor;
}

export interface DatosSena {
  palabra: string;
  tipo: TipoSena;
  manosRequeridas: 1 | 2;
}

/**
 * Construye el modelo de referencia (formato v3) a partir de una grabación
 * del entrenador. Devuelve null si la grabación no tiene suficientes frames
 * con las manos requeridas.
 */
export function construirModeloReferencia(captura: CapturaCruda, datos: DatosSena): ModeloReferenciaSena | null {
  const iso = aIsotropico(captura, true);
  const candidata = secuenciasCandidatas(iso, datos.manosRequeridas)[0];
  if (!candidata) return null;
  const secuencia = remuestrear(candidata, FPS_MOTOR);
  if (secuencia.length < FRAMES_MINIMOS) return null;

  let frames: number[][];
  if (datos.tipo === 'estatica') {
    frames = [referenciaEstatica(secuencia.map((f) => formaEstatica(f.manos)))];
  } else {
    const recortada = recortarQuietud(canonicalizar(manosDeSecuencia(secuencia)));
    frames = canonicalizar(recortada.map((f) => desaplanar(f)));
  }

  const conManos = iso.filter((f) => f.manos.length >= datos.manosRequeridas);
  return {
    version: VERSION_MOTOR,
    palabra: datos.palabra,
    tipo: datos.tipo,
    manosRequeridas: datos.manosRequeridas,
    totalFrames: frames.length,
    fpsObjetivo: FPS_MOTOR,
    frames: redondear(frames),
    duracionMs: conManos.length ? Math.round(conManos[conManos.length - 1].t - conManos[0].t) : 0,
    umbralRecomendado: datos.tipo === 'dinamica' ? UMBRAL_DINAMICA : UMBRAL_ESTATICA,
  };
}

/** Cantidad de frames en que se ven las manos requeridas (para la interfaz). */
export function framesConManos(captura: CapturaCruda, manosRequeridas: 1 | 2): number {
  return seguirManos(aIsotropico(captura)).filter((p) => (manosRequeridas === 2 ? p[0] && p[1] : p[0] || p[1])).length;
}
