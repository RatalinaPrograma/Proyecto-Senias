/**
 * gesture-math.ts
 * Motor matemático de normalización y Dynamic Time Warping (DTW)
 * para comparación geométrica de landmarks de MediaPipe en Signy Edge AI.
 */

export interface Punto3D {
  x: number;
  y: number;
  z: number;
}

export interface ModeloReferenciaSena {
  version: 1;
  palabra: string;
  tipo: 'estatica' | 'dinamica';
  manosRequeridas: 1 | 2;
  totalFrames: number;
  fpsObjetivo: number;
  // Cada elemento es un array plano de coordenadas [x0, y0, z0, ..., xN, yN, zN]
  // 63 números para 1 mano (21 puntos * 3), 126 para 2 manos
  frames: number[][];
  duracionMs?: number;
  umbralRecomendado?: number; // Por defecto 70-75%
}

export interface ResultadoComparacion {
  distanciaDTW: number;
  similitudPct: number;
  esCoincidente: boolean;
  detalles: {
    framesReferencia: number;
    framesPrueba: number;
  };
}

/**
 * Normaliza los 21 landmarks de una mano para lograr:
 * 1. Invarianza a la posición: La muñeca (punto 0) se traslada al origen (0, 0, 0).
 * 2. Invarianza a la distancia/escala: Todos los puntos se dividen por la distancia
 *    entre la muñeca (0) y el nudillo medio MCP (9), de modo que la mano mida exactamente 1.0.
 *
 * Retorna un array plano de 63 números: [x0, y0, z0, x1, y1, z1, ..., x20, y20, z20].
 */
export function normalizarMano(landmarks: Punto3D[]): number[] {
  if (!landmarks || landmarks.length < 21) {
    return new Array(63).fill(0);
  }

  const muneca = landmarks[0];
  const mcpMedio = landmarks[9];

  // Distancia euclidiana entre muñeca y nudillo del medio (escala)
  const dx = mcpMedio.x - muneca.x;
  const dy = mcpMedio.y - muneca.y;
  const dz = (mcpMedio.z || 0) - (muneca.z || 0);
  const escala = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Evitar división por cero si la mano colapsa
  const factorEscala = escala > 0.0001 ? escala : 1.0;

  const resultado: number[] = new Array(63);

  for (let i = 0; i < 21; i++) {
    const p = landmarks[i];
    const idx = i * 3;
    // Traslación + Escalado
    resultado[idx] = (p.x - muneca.x) / factorEscala;
    resultado[idx + 1] = (p.y - muneca.y) / factorEscala;
    resultado[idx + 2] = ((p.z || 0) - (muneca.z || 0)) / factorEscala;
  }

  return resultado;
}

/**
 * Normaliza un frame que puede contener 1 o 2 manos.
 * Si manosRequeridas === 2 y ambas están presentes, concatena las dos manos (126 floats).
 * Si manosRequeridas === 1, procesa únicamente la primera mano (63 floats).
 */
export function normalizarFrame(
  manosDetectadas: Punto3D[][],
  manosRequeridas: 1 | 2 = 1
): number[] | null {
  if (!manosDetectadas || manosDetectadas.length === 0) return null;

  if (manosRequeridas === 1) {
    return normalizarMano(manosDetectadas[0]);
  }

  // 2 Manos requeridas
  if (manosDetectadas.length < 2) {
    // Falta una mano
    return null;
  }

  const mano1 = normalizarMano(manosDetectadas[0]);
  const mano2 = normalizarMano(manosDetectadas[1]);

  // Posición relativa entre las dos muñecas para preservar la relación espacial entre ambas manos
  const m1 = manosDetectadas[0][0];
  const m2 = manosDetectadas[1][0];
  const distRelativaX = m2.x - m1.x;
  const distRelativaY = m2.y - m1.y;
  const distRelativaZ = (m2.z || 0) - (m1.z || 0);

  // En la mano 2, sumamos el offset relativo para que DTW sepa si las manos están juntas o separadas
  for (let i = 0; i < 21; i++) {
    mano2[i * 3] += distRelativaX;
    mano2[i * 3 + 1] += distRelativaY;
    mano2[i * 3 + 2] += distRelativaZ;
  }

  return [...mano1, ...mano2];
}

/**
 * Calcula la distancia promedio por articulación entre dos frames normalizados.
 * Devuelve un valor cercano a 0 (idénticos) hasta >0.6 (muy diferentes).
 */
export function distanciaEntreFrames(frameA: number[], frameB: number[]): number {
  if (frameA.length !== frameB.length || frameA.length === 0) return 999;

  const totalPuntos = frameA.length / 3;
  let sumaDistancias = 0;

  for (let i = 0; i < totalPuntos; i++) {
    const idx = i * 3;
    const dx = frameA[idx] - frameB[idx];
    const dy = frameA[idx + 1] - frameB[idx + 1];
    const dz = frameA[idx + 2] - frameB[idx + 2];
    sumaDistancias += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  return sumaDistancias / totalPuntos;
}

/**
 * Algoritmo DTW (Dynamic Time Warping) para comparar dos secuencias temporales de frames.
 * Permite comparar señas ejecutadas a diferentes ritmos o velocidades.
 *
 * @param referencia Secuencia de frames grabada en el modelo de referencia
 * @param prueba Secuencia de frames ejecutada por el usuario
 * @param umbralAceptacion Porcentaje mínimo (ej. 70%) para dar la seña como válida
 */
export function compararSecuenciasDTW(
  referencia: number[][],
  prueba: number[][],
  umbralAceptacion = 70
): ResultadoComparacion {
  const N = referencia.length;
  const M = prueba.length;

  if (N === 0 || M === 0) {
    return {
      distanciaDTW: 999,
      similitudPct: 0,
      esCoincidente: false,
      detalles: { framesReferencia: N, framesPrueba: M }
    };
  }

  // Matriz de costos acumulados (N x M)
  const dtw: number[][] = Array.from({ length: N }, () => new Array(M).fill(Infinity));

  // Inicializar origen
  dtw[0][0] = distanciaEntreFrames(referencia[0], prueba[0]);

  // Primera columna
  for (let i = 1; i < N; i++) {
    dtw[i][0] = dtw[i - 1][0] + distanciaEntreFrames(referencia[i], prueba[0]);
  }

  // Primera fila
  for (let j = 1; j < M; j++) {
    dtw[0][j] = dtw[0][j - 1] + distanciaEntreFrames(referencia[0], prueba[j]);
  }

  // Llenar el resto de la matriz con programación dinámica
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < M; j++) {
      const costoLocal = distanciaEntreFrames(referencia[i], prueba[j]);
      const minAnterior = Math.min(
        dtw[i - 1][j],     // inserción
        dtw[i][j - 1],     // eliminación
        dtw[i - 1][j - 1]  // coincidencia / avance diagonal
      );
      dtw[i][j] = costoLocal + minAnterior;
    }
  }

  // Distancia normalizada por la longitud del camino de deformación
  const distanciaFinal = dtw[N - 1][M - 1] / (N + M);

  // Mapeo a porcentaje de similitud:
  // Distancia 0.00 -> 100%
  // Distancia 0.15 -> ~80%
  // Distancia 0.25 -> ~67%
  // Distancia >= 0.50 -> 0%
  const MAX_DISTANCIA_TOLERABLE = 0.45;
  const similitudRaw = (1 - (distanciaFinal / MAX_DISTANCIA_TOLERABLE)) * 100;
  const similitudPct = Math.max(0, Math.min(100, Math.round(similitudRaw)));

  return {
    distanciaDTW: Number(distanciaFinal.toFixed(4)),
    similitudPct,
    esCoincidente: similitudPct >= umbralAceptacion,
    detalles: {
      framesReferencia: N,
      framesPrueba: M
    }
  };
}

/**
 * Compara un frame estático contra otro frame estático de referencia.
 * Útil para señas que no tienen trayectoria de movimiento (ej. vocales A, E, I, O, U).
 */
export function compararFrameEstatico(
  frameRef: number[],
  frameUsuario: number[],
  umbralAceptacion = 75
): ResultadoComparacion {
  const dist = distanciaEntreFrames(frameRef, frameUsuario);
  const MAX_DIST = 0.40;
  const similitudRaw = (1 - (dist / MAX_DIST)) * 100;
  const similitudPct = Math.max(0, Math.min(100, Math.round(similitudRaw)));

  return {
    distanciaDTW: Number(dist.toFixed(4)),
    similitudPct,
    esCoincidente: similitudPct >= umbralAceptacion,
    detalles: { framesReferencia: 1, framesPrueba: 1 }
  };
}
