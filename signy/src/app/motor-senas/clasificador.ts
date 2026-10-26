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
import { PRESENCIA_MINIMA, PistasPorFrame, ResumenPista, resumirPistas, seguirManos } from './seguimiento';
import { CapturaCruda, MUNECA, Mano, PUNTOS_POR_MANO } from './tipos';
import { mediana } from './geometria';
import type { PerfilSena } from './retroalimentacion';

export const FORMATO_CLASIFICADOR = 'signy-clasificador';
/** 2: las características ignoran la mano que descansa abajo (manoEnReposo). */
export const VERSION_CLASIFICADOR = 2;

/** Mano "en reposo" (ver manoEnReposo): distancias en tamaños de mano. */
const REPOSO_MOVIMIENTO_MAX = 0.6; // la mano que descansa casi no se mueve
const REPOSO_MARGEN = 1.0; // y queda al menos esto por debajo de donde ocurre la seña
const REPOSO_CONTACTO = 0.5; // si la otra mano la toca (más cerca que esto)…
const REPOSO_FRAMES_CONTACTO = 3; // …en al menos estos frames, es una mano BASE, no en reposo (un roce suelto no cuenta)
const REPOSO_CUANTIL_ALTO = 0.1; // "donde ocurre la seña": el 10 % más alto del recorrido de la otra mano

/** Valor en la posición floor(q·(n−1)) de la lista ordenada (sin interpolar: igual que en Python). */
function cuantilBajo(valores: number[], q: number): number {
  const orden = valores.slice().sort((a, b) => a - b);
  return orden[Math.floor(q * (orden.length - 1))];
}

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
  /** Cómo se hace cada seña según el dataset (clave: senaId), para la retroalimentación al alumno. */
  perfiles?: Record<string, PerfilSena>;
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

/**
 * Índice de la pista que es la otra mano DESCANSANDO abajo (o null).
 *
 * En una toma de la cintura hacia arriba, en las señas de una mano la otra
 * queda visible y quieta a la altura de la cadera. Si se la trata como
 * "mano B", el vector cambia por completo según si el alumno la muestra o
 * no, y según si es zurdo (cambia qué mano queda a la izquierda).
 *
 * Se descarta la mano de más abajo si:
 *  - casi no se mueve,
 *  - queda claramente por debajo de DONDE OCURRE LA SEÑA (el 10 % más alto
 *    del recorrido de la otra mano; no de todo el recorrido, porque lo
 *    normal es partir con las dos manos abajo y subir una), y
 *  - la otra mano no la toca mientras está arriba: si la toca, es la mano
 *    BASE de una seña de dos manos y se conserva.
 * Igual que mano_en_reposo en ml/signy_ml/caracteristicas.py.
 */
export function manoEnReposo(pistas: PistasPorFrame, activas: ResumenPista[]): number | null {
  if (activas.length !== 2) return null;
  const datos = activas.map((r) => {
    const manos = pistas.map((p) => p[r.indice]).filter((m): m is Mano => !!m);
    const xs = manos.map((m) => m[MUNECA].x);
    const ys = manos.map((m) => m[MUNECA].y);
    const cx = mediana(xs);
    const cy = mediana(ys);
    return {
      indice: r.indice,
      yMedia: r.yMedia,
      yAlto: cuantilBajo(ys, REPOSO_CUANTIL_ALTO),
      tam: mediana(manos.map((m) => tamanoMano(m))),
      mov: Math.max(...xs.map((x, i) => Math.sqrt((x - cx) ** 2 + (ys[i] - cy) ** 2))),
    };
  });
  const [baja, alta] = datos[1].yMedia > datos[0].yMedia ? [datos[1], datos[0]] : [datos[0], datos[1]];
  const t = Math.max(baja.tam, alta.tam);
  if (!(baja.mov < REPOSO_MOVIMIENTO_MAX * t && baja.yMedia > alta.yAlto + REPOSO_MARGEN * t)) return null;
  const limite = baja.yMedia - REPOSO_MARGEN * t;
  let contactos = 0;
  for (const p of pistas) {
    const mb = p[baja.indice];
    const ma = p[alta.indice];
    // Solo cuenta un contacto cuando la otra mano está arriba (no cuando ambas descansan juntas).
    if (!mb || !ma || ma[MUNECA].y >= limite) continue;
    let minimo = Infinity;
    for (const a of ma) for (const b of mb) minimo = Math.min(minimo, Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2));
    if (minimo < REPOSO_CONTACTO * t && ++contactos >= REPOSO_FRAMES_CONTACTO) return null;
  }
  return baja.indice;
}

/** Valores por frame del vector de características. */
export function dimensionPorFrame(config: ConfigCaracteristicas): number {
  return 2 * PUNTOS_POR_MANO * (config.usarZ ? 3 : 2) + 1;
}

/**
 * Vector de características de una captura (o null si no se ve ninguna mano
 * de forma estable). Mano A = la mano activa más a la izquierda de la
 * imagen (o la única); mano B = la otra, si está activa (ceros si no). La
 * otra mano descansando abajo no cuenta (ver manoEnReposo).
 * Coordenadas isotrópicas, centradas en la muñeca media de A y escaladas
 * por su tamaño mediano; cada frame termina con 1/0 según esté la mano B.
 */
export function caracteristicasClasificador(captura: CapturaCruda, config: ConfigCaracteristicas): number[] | null {
  const iso = aIsotropico(captura, true);
  const pistas = seguirManos(iso);
  let activas = resumirPistas(pistas)
    .filter((r) => r.presencia >= PRESENCIA_MINIMA)
    .sort((x, y) => x.xMedia - y.xMedia);
  const reposo = manoEnReposo(pistas, activas);
  if (reposo !== null) activas = activas.filter((r) => r.indice !== reposo);
  if (!activas.length) return null;
  const ia = activas[0].indice;
  const ib = activas.length > 1 ? activas[1].indice : null;

  // Un cuadro se guarda si se ve CUALQUIERA de las dos manos, no solo "ia": si la seña
  // cambia de cantidad de manos a mitad de camino (p. ej. 1 mano y después 2), "ia" puede
  // ser la pista que aparece más tarde, y antes eso descartaba enteros los cuadros del
  // tramo inicial (ver seguimiento.ts `cambioDeManos`, que avisa de este caso en la app).
  const frames: FrameAB[] = [];
  pistas.forEach((p, i) => {
    let a = p[ia];
    let b = ib === null ? null : p[ib];
    if (!a && b) [a, b] = [b, null]; // la única mano del cuadro siempre va en la posición A
    if (a) frames.push({ t: iso[i].t, a, b });
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
  private readonly idsConocidos: Set<number>;
  readonly umbralSugerido: number;

  private constructor(readonly modelo: ModeloClasificadorJson) {
    this.media = decodificarNumeros(modelo.normalizacion.media, 'float32');
    this.escala = decodificarNumeros(modelo.normalizacion.escala, 'float32');
    this.idsConocidos = new Set(modelo.clases.map((c) => c.senaId));
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

  /** Perfil de la seña (velocidad, amplitud, manos, forma), si el modelo lo trae. */
  perfil(senaId: number): PerfilSena | null {
    return this.modelo.perfiles?.[String(senaId)] ?? null;
  }

  conoce(senaId: number): boolean {
    return this.idsConocidos.has(senaId);
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
