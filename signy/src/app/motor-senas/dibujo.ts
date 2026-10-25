import { desaplanar } from './geometria';
import { Mano, ModeloReferenciaSena } from './tipos';

export { desaplanar };

/** Conexiones entre los 21 landmarks de MediaPipe Hands. */
export const CONEXIONES_MANO: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const PUNTAS = new Set([4, 8, 12, 16, 20]);

export interface EstiloEsqueleto {
  linea: string;
  punta: string;
  nudillo: string;
  borde: string;
  radioPunta?: number;
  radioNudillo?: number;
  brillo?: string;
}

export const ESTILO_SIGNY: EstiloEsqueleto = { linea: '#2CA6A4', punta: '#F2701A', nudillo: '#FFFFFF', borde: '#0A1526' };

/** Dibuja manos ya ubicadas en coordenadas de canvas (en píxeles). */
function dibujarEsqueletoPx(ctx: CanvasRenderingContext2D, manos: { x: number; y: number }[][], estilo: EstiloEsqueleto): void {
  for (const mano of manos) {
    ctx.strokeStyle = estilo.linea;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [a, b] of CONEXIONES_MANO) {
      ctx.beginPath();
      ctx.moveTo(mano[a].x, mano[a].y);
      ctx.lineTo(mano[b].x, mano[b].y);
      ctx.stroke();
    }
    mano.forEach((p, i) => {
      const esPunta = PUNTAS.has(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, esPunta ? estilo.radioPunta ?? 6 : estilo.radioNudillo ?? 4, 0, 2 * Math.PI);
      ctx.fillStyle = esPunta ? estilo.punta : estilo.nudillo;
      if (esPunta && estilo.brillo) {
        ctx.shadowColor = estilo.brillo;
        ctx.shadowBlur = 8;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = estilo.borde;
      ctx.stroke();
    });
  }
}

/** Dibuja el esqueleto de las manos detectadas sobre un canvas del tamaño del video
 * (coordenadas normalizadas de imagen [0..1], como las entrega MediaPipe). */
export function dibujarManos(
  ctx: CanvasRenderingContext2D,
  ancho: number,
  alto: number,
  manos: { x: number; y: number }[][],
  estilo: EstiloEsqueleto = ESTILO_SIGNY
): void {
  dibujarEsqueletoPx(ctx, manos.map((mano) => mano.map((p) => ({ x: p.x * ancho, y: p.y * alto }))), estilo);
}

/** Dónde y a qué escala cabe un modelo de referencia (coordenadas canónicas, centro ≈ 0) en un canvas. */
export interface EncuadreModelo {
  centroX: number;
  centroY: number;
  escala: number;
}

export function ajustarEncuadre(modelo: ModeloReferenciaSena, anchoPx: number, altoPx: number, margen = 0.75): EncuadreModelo {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const frame of modelo.frames) {
    for (const mano of desaplanar(frame)) {
      for (const p of mano) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  const anchoModelo = Math.max(maxX - minX, 0.3);
  const altoModelo = Math.max(maxY - minY, 0.3);
  const escala = Math.min(anchoPx / anchoModelo, altoPx / altoModelo) * margen;
  return { centroX: anchoPx / 2 - ((minX + maxX) / 2) * escala, centroY: altoPx / 2 - ((minY + maxY) / 2) * escala, escala };
}

/** Dibuja un frame (ya desaplanado) de un modelo de referencia, encuadrado con {@link ajustarEncuadre}. */
export function dibujarFrameModelo(ctx: CanvasRenderingContext2D, manos: Mano[], encuadre: EncuadreModelo, estilo: EstiloEsqueleto = ESTILO_SIGNY): void {
  dibujarEsqueletoPx(
    ctx,
    manos.map((mano) => mano.map((p) => ({ x: p.x * encuadre.escala + encuadre.centroX, y: p.y * encuadre.escala + encuadre.centroY }))),
    estilo
  );
}
