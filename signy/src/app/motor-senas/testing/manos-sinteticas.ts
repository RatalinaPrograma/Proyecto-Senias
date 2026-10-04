/**
 * Generador de manos sintéticas para pruebas del motor de señas.
 *
 * Produce los mismos 21 landmarks que MediaPipe Hands (coordenadas
 * normalizadas de imagen, z relativa a la muñeca) a partir de un modelo
 * cinemático simple de mano: posición de nudillos fija, falanges que se
 * curvan según la "flexión" de cada dedo. No pretende ser realista al
 * milímetro: sirve para reproducir, de forma controlada y repetible, las
 * condiciones que rompen el reconocimiento (relación de aspecto, orden de
 * manos, zurdos, frames repetidos, pausas antes/después de la seña).
 *
 * Unidades internas: "isotrópicas" (1 = alto de la imagen en x, y y z).
 */
import { CapturaCruda, FrameCrudo, Mano, Punto3D } from '../tipos';

/** Flexión por dedo: 0 = estirado, 1 = cerrado. */
export interface Pose {
  pulgar: number;
  indice: number;
  medio: number;
  anular: number;
  menique: number;
  /** Separación lateral de los dedos (radianes). */
  apertura?: number;
}

export const POSES = {
  puno: { pulgar: 0.7, indice: 1, medio: 1, anular: 1, menique: 1 } as Pose,
  palma: { pulgar: 0.05, indice: 0, medio: 0, anular: 0, menique: 0, apertura: 0.05 } as Pose,
  indice: { pulgar: 0.8, indice: 0, medio: 1, anular: 1, menique: 1 } as Pose,
  ele: { pulgar: 0, indice: 0, medio: 1, anular: 1, menique: 1, apertura: 0.1 } as Pose,
  ve: { pulgar: 0.8, indice: 0, medio: 0, anular: 1, menique: 1, apertura: 0.25 } as Pose,
  garra: { pulgar: 0.4, indice: 0.55, medio: 0.55, anular: 0.55, menique: 0.55, apertura: 0.15 } as Pose,
};

/** Estado de UNA mano en un instante. */
export interface EstadoMano {
  pose: Pose;
  /** Posición de la muñeca en unidades isotrópicas (x ∈ [0, aspecto], y ∈ [0, 1]). */
  x: number;
  y: number;
  /** Tamaño de la mano: distancia muñeca–nudillo medio. */
  tamano: number;
  /** Giro en el plano de la imagen (radianes). */
  giro?: number;
}

/** Una seña = función del tiempo normalizado (0..1) a las manos visibles. */
export type DefinicionSena = (u: number) => EstadoMano[];

export interface Persona {
  /** Factor de largo de dedos (variación anatómica). */
  proporcion: number;
  tamano: number;
  zurda: boolean;
  /** Desfase de posición respecto del centro de la imagen. */
  dx: number;
  dy: number;
  giro: number;
}

export const PERSONA_BASE: Persona = { proporcion: 1, tamano: 0.18, zurda: false, dx: 0, dy: 0, giro: 0 };

// ---------------------------------------------------------------------------
// Cinemática
// ---------------------------------------------------------------------------

const NUDILLOS: Record<'indice' | 'medio' | 'anular' | 'menique', [number, number]> = {
  indice: [0.3, -0.95],
  medio: [0, -1],
  anular: [-0.25, -0.92],
  menique: [-0.48, -0.8],
};
const FALANGES: Record<'pulgar' | 'indice' | 'medio' | 'anular' | 'menique', number[]> = {
  pulgar: [0.4, 0.32, 0.27],
  indice: [0.45, 0.27, 0.22],
  medio: [0.5, 0.3, 0.24],
  anular: [0.46, 0.28, 0.22],
  menique: [0.36, 0.22, 0.19],
};
const DESVIO_DEDO: Record<'indice' | 'medio' | 'anular' | 'menique', number> = {
  indice: 1,
  medio: 0,
  anular: -1,
  menique: -2,
};
// Ángulo máximo de cada articulación (MCP, PIP, DIP) al cerrar el dedo.
const CURVA_MAX = [1.4, 1.75, 1.2];

function dedo(base: Punto3D, largo: number[], flexion: number, desvio: number, proporcion: number): Punto3D[] {
  const puntos: Punto3D[] = [];
  let p = base;
  let curva = 0;
  for (let i = 0; i < 3; i++) {
    curva += flexion * CURVA_MAX[i];
    const l = largo[i] * proporcion;
    p = {
      x: p.x + Math.sin(desvio) * Math.cos(curva) * l,
      y: p.y - Math.cos(desvio) * Math.cos(curva) * l,
      z: p.z - Math.sin(curva) * l,
    };
    puntos.push(p);
  }
  return puntos;
}

function pulgar(flexion: number, proporcion: number): Punto3D[] {
  // Estirado apunta hacia afuera y arriba; cerrado cruza la palma.
  const abierto = { x: 0.62, y: -0.72, z: -0.12 };
  const cerrado = { x: -0.62, y: -0.35, z: -0.7 };
  const puntos: Punto3D[] = [{ x: 0.22, y: -0.18, z: -0.03 }];
  let p = puntos[0];
  for (let i = 0; i < 3; i++) {
    const f = Math.min(1, flexion * (0.6 + 0.4 * i));
    const d = {
      x: abierto.x + (cerrado.x - abierto.x) * f,
      y: abierto.y + (cerrado.y - abierto.y) * f,
      z: abierto.z + (cerrado.z - abierto.z) * f,
    };
    const n = Math.hypot(d.x, d.y, d.z);
    const l = FALANGES.pulgar[i] * proporcion;
    p = { x: p.x + (d.x / n) * l, y: p.y + (d.y / n) * l, z: p.z + (d.z / n) * l };
    puntos.push(p);
  }
  return puntos;
}

/** Landmarks de una mano DERECHA con la palma hacia la cámara, muñeca en el origen, tamaño 1. */
export function manoLocal(pose: Pose, proporcion = 1): Punto3D[] {
  const apertura = pose.apertura ?? 0.08;
  const puntos: Punto3D[] = [{ x: 0, y: 0, z: 0 }, ...pulgar(pose.pulgar, proporcion)];
  for (const nombre of ['indice', 'medio', 'anular', 'menique'] as const) {
    const [bx, by] = NUDILLOS[nombre];
    const base = { x: bx, y: by, z: 0 };
    puntos.push(base, ...dedo(base, FALANGES[nombre], pose[nombre], DESVIO_DEDO[nombre] * apertura, proporcion));
  }
  return puntos;
}

/** Ubica una mano local en la imagen: giro, escala, traslación (unidades isotrópicas). */
export function ubicarMano(local: Punto3D[], estado: EstadoMano): Punto3D[] {
  const giro = estado.giro ?? 0;
  const c = Math.cos(giro);
  const s = Math.sin(giro);
  return local.map((p) => ({
    x: estado.x + (p.x * c - p.y * s) * estado.tamano,
    y: estado.y + (p.x * s + p.y * c) * estado.tamano,
    z: p.z * estado.tamano,
  }));
}

// ---------------------------------------------------------------------------
// Señas de ejemplo
// ---------------------------------------------------------------------------

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function mezclarPose(a: Pose, b: Pose, u: number): Pose {
  return {
    pulgar: lerp(a.pulgar, b.pulgar, u),
    indice: lerp(a.indice, b.indice, u),
    medio: lerp(a.medio, b.medio, u),
    anular: lerp(a.anular, b.anular, u),
    menique: lerp(a.menique, b.menique, u),
    apertura: lerp(a.apertura ?? 0.08, b.apertura ?? 0.08, u),
  };
}

const CX = 0.5; // centro relativo; se suma a la mitad del ancho de imagen
const CY = 0.55;

export const SENAS: Record<string, { tipo: 'estatica' | 'dinamica'; manos: 1 | 2; def: DefinicionSena }> = {
  // Estáticas: pose fija, con un leve balanceo natural.
  A: { tipo: 'estatica', manos: 1, def: (u) => [{ pose: POSES.puno, x: CX + 0.01 * Math.sin(u * 6), y: CY, tamano: 1 }] },
  B: { tipo: 'estatica', manos: 1, def: (u) => [{ pose: POSES.palma, x: CX, y: CY + 0.01 * Math.sin(u * 5), tamano: 1 }] },
  L: { tipo: 'estatica', manos: 1, def: () => [{ pose: POSES.ele, x: CX, y: CY, tamano: 1 }] },
  V: { tipo: 'estatica', manos: 1, def: () => [{ pose: POSES.ve, x: CX, y: CY, tamano: 1 }] },
  INDICE: { tipo: 'estatica', manos: 1, def: () => [{ pose: POSES.indice, x: CX, y: CY, tamano: 1 }] },
  C: { tipo: 'estatica', manos: 1, def: () => [{ pose: POSES.garra, x: CX, y: CY, tamano: 1 }] },
  // Dinámicas.
  HOLA: {
    tipo: 'dinamica',
    manos: 1,
    def: (u) => [{ pose: POSES.palma, x: CX + 0.13 * Math.sin(u * Math.PI * 3), y: CY - 0.05, tamano: 1, giro: 0.25 * Math.sin(u * Math.PI * 3) }],
  },
  SI: {
    tipo: 'dinamica',
    manos: 1,
    def: (u) => [{ pose: POSES.puno, x: CX, y: CY + 0.09 * Math.sin(u * Math.PI * 4), tamano: 1 }],
  },
  GRACIAS: {
    tipo: 'dinamica',
    manos: 1,
    def: (u) => [{ pose: POSES.palma, x: CX + 0.05 * u, y: CY - 0.18 + 0.3 * u, tamano: 1, giro: -0.5 * u }],
  },
  LLAMAR: {
    tipo: 'dinamica',
    manos: 1,
    def: (u) => [{ pose: mezclarPose(POSES.palma, POSES.garra, 0.5 - 0.5 * Math.cos(u * Math.PI * 4)), x: CX, y: CY, tamano: 1 }],
  },
  SEPARAR: {
    tipo: 'dinamica',
    manos: 2,
    def: (u) => [
      { pose: POSES.palma, x: CX + 0.06 + 0.22 * u, y: CY, tamano: 1, giro: 0.3 },
      { pose: POSES.palma, x: CX - 0.06 - 0.22 * u, y: CY, tamano: 1, giro: -0.3 },
    ],
  },
  JUNTAR: {
    tipo: 'dinamica',
    manos: 2,
    def: (u) => [
      { pose: POSES.puno, x: CX + 0.28 - 0.2 * u, y: CY - 0.1 * u, tamano: 1 },
      { pose: POSES.puno, x: CX - 0.28 + 0.2 * u, y: CY - 0.1 * u, tamano: 1 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Generación de capturas
// ---------------------------------------------------------------------------

/** PRNG determinista (mulberry32) para que las pruebas sean repetibles. */
export function rng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export interface OpcionesCaptura {
  ancho?: number;
  alto?: number;
  fps?: number;
  /** Duración de la seña en sí. */
  duracionMs?: number;
  /** Tiempo con la mano quieta/entrando antes y después de la seña. */
  pausaAntesMs?: number;
  pausaDespuesMs?: number;
  /** La mano entra desde abajo del cuadro durante la pausa inicial. */
  entraDesdeAbajo?: boolean;
  persona?: Partial<Persona>;
  /** Ruido gaussiano por landmark, en fracción del tamaño de la mano. */
  ruido?: number;
  /** Probabilidad por frame de que MediaPipe devuelva las 2 manos en orden invertido. */
  probIntercambio?: number;
  /** Agrega una segunda mano quieta (apoyada) en señas de una mano. */
  manoPasiva?: boolean;
  /** Probabilidad por frame de que MediaPipe no detecte ninguna mano. */
  probPerdida?: number;
  semilla?: number;
}

/** Simula lo que entrega MediaPipe para una persona haciendo la seña. */
export function generarCaptura(nombre: keyof typeof SENAS | string, o: OpcionesCaptura = {}): CapturaCruda {
  const sena = SENAS[nombre];
  const ancho = o.ancho ?? 640;
  const alto = o.alto ?? 480;
  const aspecto = ancho / alto;
  const fps = o.fps ?? 30;
  const dur = o.duracionMs ?? 1200;
  const antes = o.pausaAntesMs ?? 0;
  const despues = o.pausaDespuesMs ?? 0;
  const persona: Persona = { ...PERSONA_BASE, ...o.persona };
  const r = rng(o.semilla ?? 1);
  const ruido = o.ruido ?? 0.01;

  const total = antes + dur + despues;
  const frames: FrameCrudo[] = [];
  for (let t = 0; t <= total; t += 1000 / fps) {
    const u = Math.min(1, Math.max(0, (t - antes) / dur));
    let estados = sena.def(u).map((e) => ({ ...e }));

    if (o.entraDesdeAbajo && t < antes) {
      const entrada = 1 - t / antes; // 1 al inicio, 0 al empezar la seña
      estados = estados.map((e) => ({ ...e, y: e.y + 0.35 * entrada }));
    }
    if (o.manoPasiva && sena.manos === 1) {
      estados.push({ pose: POSES.palma, x: CX - 0.32, y: 0.9, tamano: 1, giro: 0.6 });
    }

    const manos: Mano[] = estados.map((e) => {
      const local = manoLocal(e.pose, persona.proporcion);
      const iso = ubicarMano(local, {
        ...e,
        x: e.x + aspecto / 2 - 0.5 + persona.dx,
        y: e.y + persona.dy,
        tamano: e.tamano * persona.tamano,
        giro: (e.giro ?? 0) + persona.giro,
      });
      const conRuido = iso.map((p) => ({
        x: p.x + gauss(r) * ruido * persona.tamano,
        y: p.y + gauss(r) * ruido * persona.tamano,
        z: p.z + gauss(r) * ruido * persona.tamano * 2,
      }));
      const espejada = persona.zurda ? conRuido.map((p) => ({ ...p, x: aspecto - p.x })) : conRuido;
      const zMuneca = espejada[0].z;
      return espejada.map((p) => ({ x: p.x / aspecto, y: p.y, z: (p.z - zMuneca) / aspecto }));
    });

    if (manos.length === 2 && o.probIntercambio && r() < o.probIntercambio) {
      manos.reverse();
    }
    const perdido = !!o.probPerdida && r() < o.probPerdida;
    frames.push({ t: Math.round(t), manos: perdido ? [] : manos });
  }
  return { ancho, alto, frames };
}

/**
 * Reproduce el bug de la app anterior: el bucle llamaba a detectForVideo en
 * cada requestAnimationFrame (60–120 Hz) aunque la cámara entrega 30 fps,
 * así que cada frame de cámara se procesaba varias veces.
 */
export function duplicarComoRequestAnimationFrame(captura: CapturaCruda, hzPantalla: number): CapturaCruda {
  const frames: FrameCrudo[] = [];
  if (!captura.frames.length) return captura;
  const fin = captura.frames[captura.frames.length - 1].t;
  let i = 0;
  for (let t = 0; t <= fin; t += 1000 / hzPantalla) {
    while (i + 1 < captura.frames.length && captura.frames[i + 1].t <= t) i++;
    frames.push({ ...captura.frames[i], t: Math.round(t) });
  }
  return { ...captura, frames };
}
