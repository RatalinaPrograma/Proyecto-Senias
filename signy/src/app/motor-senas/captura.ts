import { CapturaCruda, FrameCrudo, Lateralidad, Mano, PUNTOS_POR_MANO } from './tipos';

/** Lo mínimo que se usa de un `HandLandmarkerResult` de MediaPipe. */
export interface ResultadoManosMediaPipe {
  landmarks?: { x: number; y: number; z?: number }[][];
  handedness?: { categoryName?: string }[][];
}

/**
 * Decide si hay que procesar el frame actual del video.
 *
 * El bucle de la cámara corre en `requestAnimationFrame`, que va a la tasa
 * de la PANTALLA (60, 90 o 120 Hz), mientras la cámara entrega ~30 fps. Si
 * se llama a `detectForVideo` en cada vuelta, el mismo frame de cámara se
 * procesa 2 a 4 veces: se desperdicia CPU/batería y la secuencia grabada
 * se llena de frames repetidos (una grabación "de 30 frames" duraba medio
 * segundo en un monitor de 60 Hz y un cuarto de segundo en uno de 120 Hz).
 * Solo se procesa cuando el video avanzó (`currentTime` cambió), con una
 * marca de tiempo monótona como pide MediaPipe en modo VIDEO.
 */
export class ControlFramesVideo {
  private ultimoTiempoVideo = -1;
  private ultimaMarca = 0;

  esFrameNuevo(video: { currentTime: number }): boolean {
    if (video.currentTime === this.ultimoTiempoVideo) return false;
    this.ultimoTiempoVideo = video.currentTime;
    return true;
  }

  /** Marca de tiempo en ms estrictamente creciente para `detectForVideo`. */
  marcaDeTiempo(ahora = performance.now()): number {
    this.ultimaMarca = Math.max(ahora, this.ultimaMarca + 1);
    return this.ultimaMarca;
  }

  reiniciar(): void {
    this.ultimoTiempoVideo = -1;
  }
}

export function manosDesdeResultado(resultado: ResultadoManosMediaPipe | null | undefined): {
  manos: Mano[];
  lateralidad: Lateralidad[];
} {
  const manos: Mano[] = [];
  const lateralidad: Lateralidad[] = [];
  (resultado?.landmarks ?? []).forEach((mano, i) => {
    if (!mano || mano.length < PUNTOS_POR_MANO) return;
    manos.push(mano.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })));
    const nombre = resultado?.handedness?.[i]?.[0]?.categoryName;
    lateralidad.push(nombre === 'Left' || nombre === 'Right' ? nombre : null);
  });
  return { manos, lateralidad };
}

/**
 * Acumula los resultados crudos de MediaPipe en una `CapturaCruda`.
 * Con `ventanaMs` funciona como búfer circular (últimos N milisegundos),
 * útil para el reconocimiento continuo en vivo.
 */
export class GrabadorCaptura {
  private frames: FrameCrudo[] = [];
  private inicio: number | null = null;
  private ancho = 0;
  private alto = 0;

  constructor(private readonly ventanaMs: number | null = null) {}

  agregar(resultado: ResultadoManosMediaPipe | null | undefined, marcaMs: number, ancho: number, alto: number): void {
    if (this.inicio === null) this.inicio = marcaMs;
    this.ancho = ancho;
    this.alto = alto;
    const { manos, lateralidad } = manosDesdeResultado(resultado);
    this.frames.push({ t: Math.round((marcaMs - this.inicio) * 10) / 10, manos, lateralidad });
    if (this.ventanaMs !== null) {
      const limite = this.frames[this.frames.length - 1].t - this.ventanaMs;
      while (this.frames.length && this.frames[0].t < limite) this.frames.shift();
    }
  }

  reiniciar(): void {
    this.frames = [];
    this.inicio = null;
  }

  get totalFrames(): number {
    return this.frames.length;
  }

  get duracionMs(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0;
  }

  /** Cantidad de frames con al menos `cantidad` manos. */
  framesConManos(cantidad = 1): number {
    return this.frames.filter((f) => f.manos.length >= cantidad).length;
  }

  /** Copia de la captura (los tiempos parten en 0). */
  captura(): CapturaCruda {
    const t0 = this.frames.length ? this.frames[0].t : 0;
    return {
      ancho: this.ancho,
      alto: this.alto,
      frames: this.frames.map((f) => ({ ...f, t: f.t - t0 })),
    };
  }
}
