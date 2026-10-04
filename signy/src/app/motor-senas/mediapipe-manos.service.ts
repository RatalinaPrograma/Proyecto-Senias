import { Injectable } from '@angular/core';
import { FilesetResolver, HandLandmarker, HandLandmarkerOptions } from '@mediapipe/tasks-vision';

/**
 * Debe coincidir con la versión de `@mediapipe/tasks-vision` del package.json:
 * el JS del paquete y el WASM que se descarga tienen que ser de la misma
 * versión. Si se actualiza la dependencia, actualizar también esta constante.
 */
export const VERSION_TASKS_VISION = '1.0.1';
export const URL_WASM_MEDIAPIPE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION_TASKS_VISION}/wasm`;
export const URL_MODELO_MANOS =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function opciones(delegate: 'GPU' | 'CPU'): HandLandmarkerOptions {
  return {
    baseOptions: { modelAssetPath: URL_MODELO_MANOS, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
}

/**
 * Un único HandLandmarker para toda la app.
 *
 * Antes cada pantalla (lección, entrenador, laboratorio) creaba y destruía
 * el suyo: en cada lección se volvía a compilar el WASM y a cargar el
 * modelo (varios segundos en un celular). Ahora se carga una vez y se
 * reutiliza. Si el delegado GPU no está disponible (WebView sin WebGL2,
 * algunos Android), se reintenta con CPU en vez de dejar la cámara rota.
 */
@Injectable({ providedIn: 'root' })
export class MediaPipeManosService {
  private promesa: Promise<HandLandmarker> | null = null;

  obtener(): Promise<HandLandmarker> {
    if (!this.promesa) {
      this.promesa = this.crear().catch((e) => {
        this.promesa = null; // permite reintentar (ej. se recuperó la conexión)
        throw e;
      });
    }
    return this.promesa;
  }

  private async crear(): Promise<HandLandmarker> {
    const vision = await FilesetResolver.forVisionTasks(URL_WASM_MEDIAPIPE);
    try {
      return await HandLandmarker.createFromOptions(vision, opciones('GPU'));
    } catch (e) {
      console.warn('MediaPipe: GPU no disponible, se usa CPU.', e);
      return HandLandmarker.createFromOptions(vision, opciones('CPU'));
    }
  }
}
