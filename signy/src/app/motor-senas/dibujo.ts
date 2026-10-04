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

/** Dibuja el esqueleto de las manos detectadas sobre un canvas del tamaño del video. */
export function dibujarManos(
  ctx: CanvasRenderingContext2D,
  ancho: number,
  alto: number,
  manos: { x: number; y: number }[][],
  estilo: EstiloEsqueleto = ESTILO_SIGNY
): void {
  for (const mano of manos) {
    ctx.strokeStyle = estilo.linea;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [a, b] of CONEXIONES_MANO) {
      ctx.beginPath();
      ctx.moveTo(mano[a].x * ancho, mano[a].y * alto);
      ctx.lineTo(mano[b].x * ancho, mano[b].y * alto);
      ctx.stroke();
    }
    mano.forEach((p, i) => {
      const esPunta = PUNTAS.has(i);
      ctx.beginPath();
      ctx.arc(p.x * ancho, p.y * alto, esPunta ? estilo.radioPunta ?? 6 : estilo.radioNudillo ?? 4, 0, 2 * Math.PI);
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
