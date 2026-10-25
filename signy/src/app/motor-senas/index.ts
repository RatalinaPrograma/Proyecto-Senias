/**
 * Motor de reconocimiento de señas de Signy.
 *
 *   MediaPipe ──► GrabadorCaptura ──► CapturaCruda ──┬─► ClasificadorSenas (modelo de ml/entrenar.py)
 *   (landmarks)   (frames nuevos)     (sin pérdida)   └─► muestras_sena (dataset para entrenar)
 *
 * Flujo de entrenamiento del clasificador: ver ml/README.md.
 */
export * from './tipos';
export * from './captura';
export * from './clasificador';
export * from './dataset';
export * from './dibujo';
export * from './seguimiento';
export { MediaPipeManosService, URL_WASM_MEDIAPIPE, URL_MODELO_MANOS, VERSION_TASKS_VISION } from './mediapipe-manos.service';
export { ReconocedorSenasService, RUTA_MODELO_CLASIFICADOR } from './reconocedor.service';
export type { EvaluacionSena, FuenteEvaluacion } from './reconocedor.service';
