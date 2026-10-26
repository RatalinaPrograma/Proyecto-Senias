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

/** Ajusta las dimensiones internas del canvas solo cuando realmente cambian (evita recrear el buffer en cada frame). */
export function sincronizarTamanoCanvas(canvas: HTMLCanvasElement, ancho: number, alto: number): void {
  if (canvas.width !== ancho) canvas.width = ancho;
  if (canvas.height !== alto) canvas.height = alto;
}

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
    // Halo ligero acelerado por GPU en lugar de ctx.shadowBlur (que fuerza Gaussian blur por software en CPU en Android WebView).
    if (estilo.brillo) {
      const radioHalo = (estilo.radioPunta ?? 6) + 4;
      ctx.fillStyle = estilo.brillo;
      ctx.globalAlpha = 0.28;
      for (let i = 0; i < mano.length; i++) {
        if (!PUNTAS.has(i)) continue;
        const p = mano[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, radioHalo, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    mano.forEach((p, i) => {
      const esPunta = PUNTAS.has(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, esPunta ? estilo.radioPunta ?? 6 : estilo.radioNudillo ?? 4, 0, 2 * Math.PI);
      ctx.fillStyle = esPunta ? estilo.punta : estilo.nudillo;
      ctx.fill();
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
