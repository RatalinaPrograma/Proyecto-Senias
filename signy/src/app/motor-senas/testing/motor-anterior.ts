/**
 * Emulación fiel del motor anterior (gesture-math v2 tal como lo usaban el
 * entrenador del admin y la lección), para medir en pruebas cuánto mejora el
 * motor nuevo en cada escenario. No se usa en la app.
 */
import {
  AnclaSesion,
  ModeloReferenciaSena as ModeloV2,
  compararFrameEstatico,
  compararSecuenciasDTW,
} from '../../utils/gesture-math';
import { CapturaCruda } from '../tipos';
import { duplicarComoRequestAnimationFrame } from './manos-sinteticas';

/** Grabación del entrenador anterior: 30 ticks de requestAnimationFrame con manos. */
export function grabarReferenciaAnterior(
  captura: CapturaCruda,
  tipo: 'estatica' | 'dinamica',
  manos: 1 | 2,
  hzPantalla = 60
): ModeloV2 {
  const ancla = new AnclaSesion();
  const frames: number[][] = [];
  for (const f of duplicarComoRequestAnimationFrame(captura, hzPantalla).frames) {
    const n = ancla.normalizar(f.manos, manos);
    if (n) frames.push(n);
    if (frames.length >= 30) break;
  }
  return {
    version: 2,
    palabra: '',
    tipo,
    manosRequeridas: manos,
    totalFrames: frames.length,
    fpsObjetivo: 30,
    frames,
    umbralRecomendado: tipo === 'dinamica' ? 70 : 75,
  };
}

/** Evaluación de la lección anterior: 2,8 s a la tasa de la pantalla. */
export function evaluarAnterior(modelo: ModeloV2, captura: CapturaCruda, hzPantalla = 120): number {
  const ancla = new AnclaSesion();
  const alumno: number[][] = [];
  for (const f of duplicarComoRequestAnimationFrame(captura, hzPantalla).frames) {
    const n = ancla.normalizar(f.manos, modelo.manosRequeridas);
    if (n) alumno.push(n);
  }
  if (alumno.length < 5) return 0;
  if (modelo.tipo === 'estatica') {
    return Math.max(...alumno.map((f) => compararFrameEstatico(modelo.frames[0], f).similitudPct));
  }
  return compararSecuenciasDTW(modelo.frames, alumno).similitudPct;
}
