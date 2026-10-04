/**
 * Clasificador de señas entrenado (red neuronal MLP) que corre en el
 * dispositivo, sin dependencias: el modelo es un JSON con los pesos que
 * genera `ml/entrenar.py`.
 *
 * IMPORTANTE: `caracteristicasClasificador` debe producir EXACTAMENTE los
 * mismos números que `ml/signy_ml/caracteristicas.py`. Cualquier cambio se
 * hace en los dos lados y se verifica con la prueba de paridad
 * (`clasificador.spec.ts`, que usa vectores calculados por Python).
 */
import { aIsotropico, tamanoMano } from './geometria';
import { PRESENCIA_MINIMA, resumirPistas, seguirManos } from './seguimiento';
import { CapturaCruda, MUNECA, Mano, PUNTOS_POR_MANO } from './tipos';
import { mediana } from './geometria';

export const FORMATO_CLASIFICADOR = 'signy-clasificador';
export const VERSION_CLASIFICADOR = 1;

export interface ConfigCaracteristicas {
  /** Cantidad de frames a la que se remuestrea cada captura. */
  frames: number;
  usarZ: boolean;
}

export interface CapaDensa {
  entrada: number;
  salida: number;
  activacion: 'relu' | 'softmax';
  /** Matriz entrada×salida (fila mayor), en base64. */
  pesos: string;
  sesgos: string;
}

export interface ModeloClasificadorJson {
  formato: string;
  version: number;
  creado?: string;
  caracteristicas: ConfigCaracteristicas;
  clases: { senaId: number; palabra: string }[];
  normalizacion: { media: string; escala: string };
  /** Tipo de los números en base64 de las capas ('float16' o 'float32'). */
  tipoPesos: 'float16' | 'float32';
  capas: CapaDensa[];
  /** Probabilidad mínima recomendada para aceptar la predicción. */
  umbralSugerido?: number;
  metricas?: Record<string, unknown>;
}

export interface Prediccion {
  senaId: number;
  palabra: string;
  probabilidad: number;
}

// ---------------------------------------------------------------------------
// Características
// ---------------------------------------------------------------------------

interface FrameAB {
  t: number;
  a: Mano;
  b: Mano | null;
}

function mezclar(a: Mano, b: Mano, u: number): Mano {
  return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * u, y: p.y + (b[i].y - p.y) * u, z: p.z + (b[i].z - p.z) * u }));
}

/** Remuestrea a exactamente `n` frames equiespaciados en el tiempo. */
function remuestrearFijo(frames: FrameAB[], n: number): FrameAB[] {
  if (frames.length === 1) return Array.from({ length: n }, () => frames[0]);
  const t0 = frames[0].t;
  const t1 = frames[frames.length - 1].t;
  const out: FrameAB[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? t0 : t0 + ((t1 - t0) * k) / (n - 1);
    while (j < frames.length - 2 && frames[j + 1].t < t) j++;
    const p = frames[j];
    const q = frames[j + 1];
    const u = q.t > p.t ? Math.min(1, Math.max(0, (t - p.t) / (q.t - p.t))) : 0;
    let b: Mano | null = null;
    if (p.b && q.b) b = mezclar(p.b, q.b, u);
    else b = u < 0.5 ? p.b : q.b;
    out.push({ t, a: mezclar(p.a, q.a, u), b });
  }
  return out;
}

/** Valores por frame del vector de características. */
export function dimensionPorFrame(config: ConfigCaracteristicas): number {
  return 2 * PUNTOS_POR_MANO * (config.usarZ ? 3 : 2) + 1;
}

/**
 * Vector de características de una captura (o null si no se ve ninguna mano
 * de forma estable). Mano A = la mano activa más a la izquierda de la
 * imagen (o la única); mano B = la otra, si está activa (ceros si no).
 * Coordenadas isotrópicas, centradas en la muñeca media de A y escaladas
 * por su tamaño mediano; cada frame termina con 1/0 según esté la mano B.
 */
export function caracteristicasClasificador(captura: CapturaCruda, config: ConfigCaracteristicas): number[] | null {
  const iso = aIsotropico(captura, true);
  const pistas = seguirManos(iso);
  const activas = resumirPistas(pistas)
    .filter((r) => r.presencia >= PRESENCIA_MINIMA)
    .sort((x, y) => x.xMedia - y.xMedia);
  if (!activas.length) return null;
  const ia = activas[0].indice;
  const ib = activas.length > 1 ? activas[1].indice : null;

  const frames: FrameAB[] = [];
  pistas.forEach((p, i) => {
    const a = p[ia];
    if (a) frames.push({ t: iso[i].t, a, b: ib === null ? null : p[ib] });
  });
  if (!frames.length) return null;

  const muestras = remuestrearFijo(frames, config.frames);
  const cx = muestras.reduce((s, f) => s + f.a[MUNECA].x, 0) / muestras.length;
  const cy = muestras.reduce((s, f) => s + f.a[MUNECA].y, 0) / muestras.length;
  const cz = muestras.reduce((s, f) => s + f.a[MUNECA].z, 0) / muestras.length;
  const escalaBruta = mediana(muestras.map((f) => tamanoMano(f.a)));
  const escala = escalaBruta > 1e-6 ? escalaBruta : 1;

  const vector: number[] = [];
  const agregarMano = (m: Mano | null) => {
    for (let i = 0; i < PUNTOS_POR_MANO; i++) {
      if (!m) {
        vector.push(0, 0);
        if (config.usarZ) vector.push(0);
        continue;
      }
      vector.push((m[i].x - cx) / escala, (m[i].y - cy) / escala);
      if (config.usarZ) vector.push((m[i].z - cz) / escala);
    }
  };
  for (const f of muestras) {
    agregarMano(f.a);
    agregarMano(f.b);
    vector.push(f.b ? 1 : 0);
  }
  return vector;
}

// ---------------------------------------------------------------------------
// Inferencia
// ---------------------------------------------------------------------------

function decodificarBase64(b64: string): Uint8Array {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function float16AFloat(h: number): number {
  const signo = h & 0x8000 ? -1 : 1;
  const exponente = (h >> 10) & 0x1f;
  const fraccion = h & 0x3ff;
  if (exponente === 0) return signo * 2 ** -14 * (fraccion / 1024);
  if (exponente === 31) return fraccion ? NaN : signo * Infinity;
  return signo * 2 ** (exponente - 15) * (1 + fraccion / 1024);
}

export function decodificarNumeros(b64: string, tipo: 'float16' | 'float32'): Float32Array {
  const bytes = decodificarBase64(b64);
  const vista = new DataView(bytes.buffer);
  if (tipo === 'float32') {
    const out = new Float32Array(bytes.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = vista.getFloat32(i * 4, true);
    return out;
  }
  const out = new Float32Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = float16AFloat(vista.getUint16(i * 2, true));
  return out;
}

interface CapaLista {
  entrada: number;
  salida: number;
  activacion: 'relu' | 'softmax';
  pesos: Float32Array;
  sesgos: Float32Array;
}

export class ClasificadorSenas {
  private readonly capas: CapaLista[];
  private readonly media: Float32Array;
  private readonly escala: Float32Array;
  readonly umbralSugerido: number;

  private constructor(readonly modelo: ModeloClasificadorJson) {
    this.media = decodificarNumeros(modelo.normalizacion.media, 'float32');
    this.escala = decodificarNumeros(modelo.normalizacion.escala, 'float32');
    this.capas = modelo.capas.map((c) => ({
      entrada: c.entrada,
      salida: c.salida,
      activacion: c.activacion,
      pesos: decodificarNumeros(c.pesos, modelo.tipoPesos),
      sesgos: decodificarNumeros(c.sesgos, modelo.tipoPesos),
    }));
    this.umbralSugerido = modelo.umbralSugerido ?? 0.6;
  }

  /** Valida el JSON y construye el clasificador (lanza error si no es válido). */
  static desdeJson(json: unknown): ClasificadorSenas {
    const m = json as ModeloClasificadorJson;
    if (!m || m.formato !== FORMATO_CLASIFICADOR) throw new Error('No es un modelo de clasificador de Signy.');
    if (m.version !== VERSION_CLASIFICADOR) throw new Error(`Versión de clasificador no soportada: ${m.version}.`);
    const dim = dimensionPorFrame(m.caracteristicas) * m.caracteristicas.frames;
    if (!m.capas?.length || m.capas[0].entrada !== dim) throw new Error('Las capas no coinciden con las características.');
    if (m.capas[m.capas.length - 1].salida !== m.clases.length) throw new Error('La capa final no coincide con las clases.');
    const clf = new ClasificadorSenas(m);
    clf.capas.forEach((c, i) => {
      if (c.pesos.length !== c.entrada * c.salida || c.sesgos.length !== c.salida) {
        throw new Error(`Capa ${i} con tamaño inválido.`);
      }
    });
    if (clf.media.length !== dim || clf.escala.length !== dim) throw new Error('Normalización con tamaño inválido.');
    return clf;
  }

  get clases(): { senaId: number; palabra: string }[] {
    return this.modelo.clases;
  }

  conoce(senaId: number): boolean {
    return this.modelo.clases.some((c) => c.senaId === senaId);
  }

  /** Probabilidades por clase a partir de un vector de características. */
  probabilidades(vector: number[]): number[] {
    let x = vector.map((v, i) => (v - this.media[i]) / (this.escala[i] || 1));
    for (const capa of this.capas) {
      const y = new Array<number>(capa.salida);
      for (let j = 0; j < capa.salida; j++) {
        let s = capa.sesgos[j];
        for (let i = 0; i < capa.entrada; i++) s += x[i] * capa.pesos[i * capa.salida + j];
        y[j] = s;
      }
      if (capa.activacion === 'relu') {
        x = y.map((v) => (v > 0 ? v : 0));
      } else {
        const max = Math.max(...y);
        const e = y.map((v) => Math.exp(v - max));
        const suma = e.reduce((a, b) => a + b, 0);
        x = e.map((v) => v / suma);
      }
    }
    return x;
  }

  /** Predicciones ordenadas de mayor a menor probabilidad (vacío si no hay manos). */
  predecir(captura: CapturaCruda): Prediccion[] {
    const vector = caracteristicasClasificador(captura, this.modelo.caracteristicas);
    if (!vector) return [];
    return this.probabilidades(vector)
      .map((p, i) => ({ ...this.modelo.clases[i], probabilidad: p }))
      .sort((a, b) => b.probabilidad - a.probabilidad);
  }
}
