/**
 * Cinemática del avatar de señas: de los 21 landmarks de MediaPipe de cada
 * mano a una pose del personaje (hombro, codo, muñeca y 21 articulaciones),
 * siempre con las proporciones del personaje. No depende de three.js.
 *
 * Qué la hace "calibrada":
 *  - Retargeting: de la mano medida se toman solo la orientación de la palma
 *    y la DIRECCIÓN de cada falange; los largos son los del personaje. La mano
 *    no se estira ni se encoge por ruido o por perspectiva, y los dedos no se
 *    doblan hacia el dorso más de lo que puede una mano real.
 *  - Espacio de señas: la posición se mide en "tamaños de palma" desde donde
 *    está la cara en una toma de cintura hacia arriba (como piden las
 *    lecciones) y se lleva a la misma zona del personaje: una seña en el
 *    mentón queda en su mentón, una en el pecho, en su pecho.
 *  - Brazo con IK de dos huesos de largo fijo; el codo se dobla hacia abajo y
 *    afuera, guiado por la orientación de la mano, y se suaviza para que
 *    nunca salte de un lado al otro.
 *  - Las manos no atraviesan la cabeza ni el cuerpo: si caen dentro, se
 *    adelantan hasta quedar justo delante.
 *  - Filtro One Euro: quita el temblor de MediaPipe sin agregar retraso a
 *    los movimientos rápidos (a diferencia de un promedio simple).
 */
import { Lateralidad } from '../tipos';
import { Elipsoide, EsqueletoMano, RigAvatar, V3 } from './rig';

export type { V3 } from './rig';
export type Lado = -1 | 1;

// ---------------------------------------------------------------------------
// Vectores
// ---------------------------------------------------------------------------

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const sumar = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const restar = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const escalar = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const punto = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cruz = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const largo = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const distancia = (a: V3, b: V3): number => largo(restar(a, b));
export const mezclar = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export function normalizar(a: V3, respaldo: V3 = v3(0, 1, 0)): V3 {
  const l = largo(a);
  return l > 1e-9 ? escalar(a, 1 / l) : { ...respaldo };
}

/** Un vector unitario perpendicular a `a`. */
function perpendicular(a: V3): V3 {
  return Math.abs(a.x) < 0.9 ? normalizar(cruz(a, v3(1, 0, 0))) : normalizar(cruz(a, v3(0, 1, 0)));
}

function promedio(puntos: V3[]): V3 {
  let s = v3();
  for (const p of puntos) s = sumar(s, p);
  return escalar(s, 1 / Math.max(1, puntos.length));
}

const limitar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const suave = (a: number, b: number, x: number) => {
  const t = limitar((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Filtro One Euro (Casiez et al., 2012)
// ---------------------------------------------------------------------------

function alfa(corteHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * corteHz);
  return 1 / (1 + tau / dt);
}

/**
 * Filtro paso bajo adaptativo: con la mano quieta corta fuerte (sin temblor) y
 * con la mano rápida casi no filtra (sin retraso). Todos los valores
 * comparten el mismo corte (calculado con la rapidez media de los puntos)
 * para que la mano se mueva como un bloque y no se deforme.
 */
export class FiltroUnEuro {
  private valor: number[] | null = null;
  private derivada: number[] = [];
  private tAnterior = 0;

  constructor(public minCorte = 3, public beta = 3, public corteDerivada = 1.2) {}

  filtrar(entrada: number[], tMs: number): number[] {
    const dt = (tMs - this.tAnterior) / 1000;
    if (!this.valor || this.valor.length !== entrada.length || !(dt > 0) || dt > 0.5) {
      this.valor = [...entrada];
      this.derivada = entrada.map(() => 0);
      this.tAnterior = tMs;
      return [...entrada];
    }
    this.tAnterior = tMs;
    const aD = alfa(this.corteDerivada, dt);
    let rapidez2 = 0;
    for (let i = 0; i < entrada.length; i++) {
      const crudo = (entrada[i] - this.valor[i]) / dt;
      this.derivada[i] += aD * (crudo - this.derivada[i]);
      rapidez2 += this.derivada[i] * this.derivada[i];
    }
    const rapidez = Math.sqrt(rapidez2 / Math.max(1, entrada.length / 3));
    const a = alfa(this.minCorte + this.beta * rapidez, dt);
    for (let i = 0; i < entrada.length; i++) this.valor[i] += a * (entrada[i] - this.valor[i]);
    return [...this.valor];
  }

  reiniciar(): void {
    this.valor = null;
  }
}

/** Frecuencia de corte mínima (Hz) para un nivel de suavizado de 0 a 0.85. */
export function corteDeSuavizado(suavizado: number): number {
  const s = limitar(suavizado, 0, 0.85);
  return 0.6 + 14 * Math.pow(1 - s, 3);
}

// ---------------------------------------------------------------------------
// Asignación de manos a brazos
// ---------------------------------------------------------------------------

/** Lado de la pantalla (-1 izquierda, +1 derecha) al que corresponde una etiqueta de MediaPipe. */
export function ladoDeEtiqueta(etiqueta: Lateralidad | undefined, espejado: boolean): Lado | null {
  // En el video sin espejo, la HandLandmarker de tasks-vision etiqueta la mano real de la persona
  // (verificado con las fotos de prueba de MediaPipe: right_hands.jpg → 'Right'). La mano derecha de
  // alguien que mira a la cámara aparece a la izquierda de la imagen, igual que la del personaje.
  if (etiqueta === 'Right') return espejado ? 1 : -1;
  if (etiqueta === 'Left') return espejado ? -1 : 1;
  return null;
}

export interface ManosPorLado {
  izq: V3[] | null;
  der: V3[] | null;
  /** Etiqueta de MediaPipe de la mano asignada a cada lado (si venía). */
  etiquetaIzq?: Lateralidad;
  etiquetaDer?: Lateralidad;
}

/**
 * Decide qué brazo del personaje sigue a cada mano detectada.
 * Con dos manos: por etiqueta de MediaPipe si son distintas, si no por posición.
 * Con una mano: primero continuidad (si está donde estaba hace un momento la
 * mano de un brazo, es la misma mano física, aunque cruce la línea media o la
 * etiqueta parpadee); si no, la etiqueta; y sin etiqueta, el lado de la imagen
 * con histéresis en el centro.
 */
export class AsignadorManos {
  private ladoUnica: Lado | null = null;
  private ultima: Record<'-1' | '1', { pos: V3; t: number } | null> = { '-1': null, '1': null };

  reiniciar(): void {
    this.ladoUnica = null;
    this.ultima = { '-1': null, '1': null };
  }

  /** `manos` en coordenadas isotrópicas de imagen (x en [0, aspecto], y en [0, 1]). */
  asignar(manos: V3[][], etiquetas: (Lateralidad | undefined)[], espejado: boolean, aspecto: number, tMs: number): ManosPorLado {
    const centros = manos.map(centroPalma);
    const res: ManosPorLado = { izq: null, der: null };

    if (manos.length >= 2) {
      const la = ladoDeEtiqueta(etiquetas[0], espejado);
      const lb = ladoDeEtiqueta(etiquetas[1], espejado);
      const primeraIzq = la !== null && lb !== null && la !== lb ? la === -1 : centros[0].x <= centros[1].x;
      res.izq = primeraIzq ? manos[0] : manos[1];
      res.der = primeraIzq ? manos[1] : manos[0];
      res.etiquetaIzq = (primeraIzq ? etiquetas[0] : etiquetas[1]) ?? undefined;
      res.etiquetaDer = (primeraIzq ? etiquetas[1] : etiquetas[0]) ?? undefined;
      this.recordar(-1, primeraIzq ? centros[0] : centros[1], tMs);
      this.recordar(1, primeraIzq ? centros[1] : centros[0], tMs);
      return res;
    }

    if (manos.length === 1) {
      const c = centros[0];
      const lado = this.ladoCercano(c, tMs) ?? ladoDeEtiqueta(etiquetas[0], espejado) ?? this.ladoPorPosicion(c, aspecto, espejado);
      this.ladoUnica = lado;
      if (lado === -1) {
        res.izq = manos[0];
        res.etiquetaIzq = etiquetas[0] ?? undefined;
      } else {
        res.der = manos[0];
        res.etiquetaDer = etiquetas[0] ?? undefined;
      }
      this.recordar(lado, c, tMs);
    }
    return res;
  }

  /** Lado cuyo brazo vio una mano hace menos de 0,6 s cerca de `c` (o null). */
  private ladoCercano(c: V3, tMs: number): Lado | null {
    let mejor: Lado | null = null;
    let mejorD = 0.25;
    for (const l of [-1, 1] as Lado[]) {
      const u = this.ultima[String(l) as '-1' | '1'];
      if (!u || tMs - u.t > 600) continue;
      const d = distancia(c, u.pos);
      if (d < mejorD) {
        mejorD = d;
        mejor = l;
      }
    }
    return mejor;
  }

  /**
   * Sin otra pista: el lado de la imagen, con una franja central en la que se
   * mantiene el lado anterior. Si es la primera vez y la mano está al centro,
   * se supone la mano derecha (la mayoría de las personas seña con ella), que
   * sin espejo queda a la izquierda de la pantalla.
   */
  private ladoPorPosicion(c: V3, aspecto: number, espejado: boolean): Lado {
    if (c.x < aspecto * 0.45) return -1;
    if (c.x > aspecto * 0.55) return 1;
    return this.ladoUnica ?? (espejado ? 1 : -1);
  }

  private recordar(lado: Lado, pos: V3, tMs: number): void {
    this.ultima[String(lado) as '-1' | '1'] = { pos, t: tMs };
  }
}

// ---------------------------------------------------------------------------
// Retargeting de la mano
// ---------------------------------------------------------------------------

/** Padre de cada landmark en la cadena de la mano (0 = muñeca). */
export const PADRE_LANDMARK = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
const BASES_MANO = [1, 5, 9, 13, 17] as const;
const ES_BASE = new Set<number>(BASES_MANO);

/** Ejes de la mano: hacia el índice, hacia los nudillos y hacia donde mira la palma. */
export interface BaseMano {
  x: V3;
  y: V3;
  palma: V3;
}

/**
 * Quiralidad de la mano que lleva el brazo de cada lado: el personaje mira de
 * frente, así que su mano derecha queda a la izquierda de la pantalla.
 */
export const quiralidadDeLado = (lado: Lado): Lado => (lado === -1 ? 1 : -1);

/** Ejes de la palma a partir de muñeca (0), nudillos del índice (5), medio (9) y meñique (17). */
export function baseDeMano(lm: V3[], quiralidad: Lado): BaseMano {
  const y = normalizar(restar(lm[9], lm[0]));
  const ancho = restar(lm[5], lm[17]);
  const x = normalizar(restar(ancho, escalar(y, punto(ancho, y))), perpendicular(y));
  return { x, y, palma: escalar(cruz(x, y), quiralidad) };
}

export function centroPalma(lm: V3[]): V3 {
  return promedio([lm[0], lm[5], lm[9], lm[13], lm[17]]);
}

/**
 * Mano del personaje (relativa a su muñeca) con la orientación y la forma de
 * `lm` (ejes del avatar, cualquier escala) pero con los largos de `esqueleto`.
 */
export function retargetMano(lm: V3[], esqueleto: EsqueletoMano, largoPalma: number, quiralidad: Lado): { puntos: V3[]; base: BaseMano } {
  const base = baseDeMano(lm, quiralidad);
  const local = (p: V3) => escalar(sumar(sumar(escalar(base.x, p.x), escalar(base.y, p.y)), escalar(base.palma, p.z)), largoPalma);
  const puntos: V3[] = new Array(21);
  puntos[0] = v3();
  for (const i of BASES_MANO) puntos[i] = local(esqueleto.base[i]);
  for (let j = 1; j < 21; j++) {
    if (ES_BASE.has(j)) continue;
    const p = PADRE_LANDMARK[j];
    let d = normalizar(restar(lm[j], lm[p]), base.y);
    // Límite anatómico: un dedo no se dobla hacia el dorso más de ~20° (el pulgar, ~30°).
    const maxDorso = j <= 4 ? 0.5 : 0.34;
    const haciaDorso = -punto(d, base.palma);
    if (haciaDorso > maxDorso) {
      // Se conserva la dirección a lo largo de la palma y se deja el componente hacia el dorso justo en el límite.
      const tangente = normalizar(sumar(d, escalar(base.palma, haciaDorso)), base.y);
      d = sumar(escalar(tangente, Math.sqrt(1 - maxDorso * maxDorso)), escalar(base.palma, -maxDorso));
    }
    puntos[j] = sumar(puntos[p], escalar(d, esqueleto.falanges[j] * largoPalma));
  }
  return { puntos, base };
}

/** Mano relajada (dedos un poco curvados), en ejes locales de la mano derecha y unidades de palma. */
function manoRelajadaLocal(esqueleto: EsqueletoMano): V3[] {
  const puntos: V3[] = new Array(21);
  puntos[0] = v3();
  const curvas = [0.25, 0.35, 0.4, 0.45, 0.5];
  const abanico = [0, 0.1, 0, -0.08, -0.16];
  for (let dedo = 0; dedo < 5; dedo++) {
    const b = BASES_MANO[dedo];
    puntos[b] = { ...esqueleto.base[b] };
    let curva = dedo === 0 ? 0.2 : 0.15;
    for (let k = 1; k <= 3; k++) {
      const j = b + k;
      curva += curvas[dedo] * (k === 1 ? 1 : 1.3);
      const d =
        dedo === 0
          ? normalizar(v3(0.55 - curva * 0.3, 0.6, 0.35 + curva * 0.4))
          : v3(Math.sin(abanico[dedo]) * Math.cos(curva), Math.cos(abanico[dedo]) * Math.cos(curva), Math.sin(curva));
      puntos[j] = sumar(puntos[j - 1], escalar(d, esqueleto.falanges[j]));
    }
  }
  return puntos;
}

/** Mano en reposo sobre la barriga (relativa a la muñeca): dedos hacia el centro y la palma hacia el cuerpo. */
export function manoEnReposo(esqueleto: EsqueletoMano, largoPalma: number, lado: Lado): { puntos: V3[]; base: BaseMano } {
  const q = quiralidadDeLado(lado);
  const y = normalizar(v3(-lado * 0.6, -0.72, 0.3));
  const palmaDeseada = v3(-lado * 0.15, 0.15, -1);
  const palma = normalizar(restar(palmaDeseada, escalar(y, punto(palmaDeseada, y))));
  const x = escalar(cruz(y, palma), q);
  const local = manoRelajadaLocal(esqueleto);
  const puntos = local.map((p) => escalar(sumar(sumar(escalar(x, p.x), escalar(y, p.y)), escalar(palma, p.z)), largoPalma));
  return { puntos, base: { x, y, palma } };
}

// ---------------------------------------------------------------------------
// Brazo: IK de dos huesos
// ---------------------------------------------------------------------------

/** Cuánto se puede estirar un brazo (toque "cartoon") cuando la mano queda lejos. */
export const ESTIRAMIENTO_MAX = 1.1;

/**
 * Codo y muñeca para llevar la muñeca a `objetivo` con brazo y antebrazo de
 * largo fijo. `flexion` indica hacia dónde se dobla el codo. Si no alcanza,
 * el brazo se estira como máximo `estiramientoMax` y la muñeca queda lo más
 * cerca posible del objetivo.
 */
export function resolverBrazo(
  hombro: V3,
  objetivo: V3,
  largoBrazo: number,
  largoAntebrazo: number,
  flexion: V3,
  estiramientoMax = ESTIRAMIENTO_MAX
): { codo: V3; muneca: V3 } {
  const d = restar(objetivo, hombro);
  const dist = largo(d);
  const dir = normalizar(d, v3(0, -1, 0));
  const estir = limitar(dist / (largoBrazo + largoAntebrazo), 1, estiramientoMax);
  const a1 = largoBrazo * estir;
  const a2 = largoAntebrazo * estir;
  const alcance = limitar(dist, Math.abs(a1 - a2) + 1e-4, (a1 + a2) * 0.9999);
  const muneca = sumar(hombro, escalar(dir, alcance));
  const proy = (a1 * a1 - a2 * a2 + alcance * alcance) / (2 * alcance);
  const h = Math.sqrt(Math.max(0, a1 * a1 - proy * proy));
  const perp = normalizar(restar(flexion, escalar(dir, punto(flexion, dir))), perpendicular(dir));
  return { codo: sumar(sumar(hombro, escalar(dir, proy)), escalar(perp, h)), muneca };
}

// ---------------------------------------------------------------------------
// Colisiones con el cuerpo
// ---------------------------------------------------------------------------

/** Cuánto hay que adelantar (en +z) los puntos para que queden delante de los elipsoides. */
export function desplazamientoFuera(puntos: V3[], cuerpos: Elipsoide[], margen: number): number {
  let dz = 0;
  for (const p of puntos) {
    for (const e of cuerpos) {
      const nx = (p.x - e.centro.x) / (e.radios.x + margen);
      const ny = (p.y - e.centro.y) / (e.radios.y + margen);
      const q = 1 - nx * nx - ny * ny;
      if (q <= 0) continue;
      const zSuperficie = e.centro.z + (e.radios.z + margen) * Math.sqrt(q);
      if (p.z < zSuperficie) dz = Math.max(dz, zSuperficie - p.z);
    }
  }
  return dz;
}

// ---------------------------------------------------------------------------
// Espacio de señas: de la imagen al cuerpo del personaje
// ---------------------------------------------------------------------------

/**
 * Zonas del cuerpo de una persona, en tamaños de palma (muñeca → nudillo
 * medio, ~10 cm en un adulto) bajo la altura de los ojos.
 */
export const REFERENCIA_HUMANA = { coronilla: -1.5, ojos: 0, menton: 1.15, hombros: 2.25, pecho: 3.4, cintura: 6 };

/** Dónde suele estar la cara (a la altura de los ojos) en una toma de cintura hacia arriba, como fracción de la imagen. */
export interface AnclaRostro {
  x: number;
  y: number;
}
export const ANCLA_ROSTRO_PREDETERMINADA: AnclaRostro = { x: 0.5, y: 0.3 };

/** Interpolación cúbica monótona (Fritsch–Carlson): suave y sin "rebotes" entre puntos. */
export function interpoladorMonotono(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + d[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + d[n - 2] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * Lleva una posición medida en tamaños de palma desde los ojos de la persona
 * (x a la derecha de quien mira, y hacia abajo) al cuerpo del personaje.
 * En vertical pasa por las mismas zonas (ojos, mentón, hombros, pecho,
 * cintura); en horizontal usa la escala del cuerpo, un poco ampliada a la
 * altura de la cara porque la cabeza del personaje es más grande.
 */
export class EspacioSenas {
  private readonly mapaY: (u: number) => number;
  private readonly escalaCuerpo: number;
  private readonly ampliacionCara = 1.7;

  constructor(rig: RigAvatar) {
    const h = REFERENCIA_HUMANA;
    this.mapaY = interpoladorMonotono(
      [h.coronilla, h.ojos, h.menton, h.hombros, h.pecho, h.cintura],
      [rig.yCoronilla, rig.yOjos, rig.yMenton, rig.yHombros, rig.yPecho, rig.yCintura]
    );
    this.escalaCuerpo = (rig.yHombros - rig.yCintura) / (h.cintura - h.hombros);
  }

  /** Unidades del avatar por tamaño de palma en el tronco. */
  get escala(): number {
    return this.escalaCuerpo;
  }

  mapear(ux: number, uy: number): { x: number; y: number } {
    const cara = 1 - suave(0.7, 2.2, uy);
    const sx = this.escalaCuerpo * (1 + (this.ampliacionCara - 1) * cara);
    return { x: ux * sx, y: this.mapaY(uy) };
  }
}

// ---------------------------------------------------------------------------
// Pose completa del personaje
// ---------------------------------------------------------------------------

export interface PoseBrazo {
  lado: Lado;
  hombro: V3;
  codo: V3;
  muneca: V3;
  /** 21 articulaciones de la mano en coordenadas del avatar (mismo orden que MediaPipe). */
  mano: V3[];
  base: BaseMano;
  /** +1 mano derecha, -1 mano izquierda (define de qué lado queda la palma). */
  quiralidad: Lado;
  /** 0 = brazo en reposo, 1 = siguiendo a la mano de la persona. */
  actividad: number;
}

export interface PoseAvatar {
  izq: PoseBrazo;
  der: PoseBrazo;
  /** Punto al que mira el personaje (la mano que está señando) o null para mirar al frente. */
  mirada: V3 | null;
}

export interface OpcionesCuadro {
  /** Lateralidad de MediaPipe de cada mano (mismo orden que `manos`). */
  lateralidad?: (Lateralidad | undefined)[];
  /** true si las x ya vienen espejadas (vista "espejo" de la cámara frontal). */
  espejado?: boolean;
  /** Ancho / alto del video del que salieron los landmarks. */
  aspecto?: number;
  ancla?: AnclaRostro;
}

interface EstadoLado {
  filtro: FiltroUnEuro;
  activa: { muneca: V3; puntos: V3[]; base: BaseMano; quiralidad: Lado } | null;
  ultimaVista: number;
  actividad: number;
  flexion: V3 | null;
}

/** Retención: si MediaPipe pierde la mano por menos que esto, el brazo se queda donde estaba. */
const RETENCION_MS = 250;

export class CinematicaAvatar {
  private espacio: EspacioSenas;
  private readonly asignador = new AsignadorManos();
  private lados!: Record<'-1' | '1', EstadoLado>;
  private palmaLenta: number | null = null;
  private tAnterior: number | null = null;
  private tamanoManos = 1;
  private suavizado = 0.35;

  constructor(private rig: RigAvatar) {
    this.espacio = new EspacioSenas(rig);
    this.reiniciar();
  }

  configurar(opciones: { tamanoManos?: number; suavizado?: number }): void {
    if (opciones.tamanoManos !== undefined) this.tamanoManos = limitar(opciones.tamanoManos, 0.6, 1.6);
    if (opciones.suavizado !== undefined) {
      this.suavizado = opciones.suavizado;
      for (const l of ['-1', '1'] as const) this.lados[l].filtro.minCorte = corteDeSuavizado(this.suavizado);
    }
  }

  cambiarRig(rig: RigAvatar): void {
    if (rig === this.rig) return;
    this.rig = rig;
    this.espacio = new EspacioSenas(rig);
    this.reiniciar();
  }

  reiniciar(): void {
    const nuevo = (): EstadoLado => ({
      filtro: new FiltroUnEuro(corteDeSuavizado(this.suavizado)),
      activa: null,
      ultimaVista: -Infinity,
      actividad: 0,
      flexion: null,
    });
    this.lados = { '-1': nuevo(), '1': nuevo() };
    this.asignador.reiniciar();
    this.palmaLenta = null;
    this.tAnterior = null;
  }

  private get largoPalma(): number {
    return this.rig.largoPalma * this.tamanoManos;
  }

  /** Distancia mínima entre las articulaciones de la mano y el cuerpo: el grosor de un dedo. */
  private get margenColision(): number {
    return this.largoPalma * Math.max(...this.rig.mano.radioDedos) + 0.02;
  }

  actualizar(manos: { x: number; y: number; z?: number }[][], tMs: number, opciones: OpcionesCuadro = {}): PoseAvatar {
    const aspecto = opciones.aspecto && opciones.aspecto > 0 ? opciones.aspecto : 4 / 3;
    const ancla = opciones.ancla ?? ANCLA_ROSTRO_PREDETERMINADA;
    const dt = this.tAnterior === null ? 1 / 60 : limitar((tMs - this.tAnterior) / 1000, 0, 0.25);
    this.tAnterior = tMs;

    // 1. A coordenadas isotrópicas (1 = alto de la imagen), descartando manos incompletas.
    const iso: V3[][] = [];
    const etiquetas: (Lateralidad | undefined)[] = [];
    (manos || []).forEach((m, i) => {
      if (!Array.isArray(m) || m.length < 21) return;
      const pts = m.slice(0, 21).map((p) => v3(p.x * aspecto, p.y, (p.z ?? 0) * aspecto));
      if (pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) {
        iso.push(pts);
        etiquetas.push(opciones.lateralidad?.[i]);
      }
    });
    const porLado = this.asignador.asignar(iso.slice(0, 2), etiquetas.slice(0, 2), !!opciones.espejado, aspecto, tMs);

    // 2. Tamaño de palma de referencia (lento: define la escala del espacio de señas).
    for (const m of [porLado.izq, porLado.der]) {
      if (!m) continue;
      const p = distancia(m[0], m[9]);
      if (!(p > 0.01)) continue;
      this.palmaLenta = this.palmaLenta === null ? p : this.palmaLenta + (p - this.palmaLenta) * (1 - Math.exp(-dt / 1.2));
    }

    const espejado = !!opciones.espejado;
    const izq = this.actualizarLado(-1, porLado.izq, porLado.etiquetaIzq, espejado, tMs, dt, aspecto, ancla);
    const der = this.actualizarLado(1, porLado.der, porLado.etiquetaDer, espejado, tMs, dt, aspecto, ancla);

    let mirada: V3 | null = null;
    const peso = izq.actividad + der.actividad;
    if (peso > 0.3) {
      mirada = escalar(sumar(escalar(centroPalma(izq.mano), izq.actividad), escalar(centroPalma(der.mano), der.actividad)), 1 / peso);
    }
    return { izq, der, mirada };
  }

  private actualizarLado(
    lado: Lado,
    mano: V3[] | null,
    etiqueta: Lateralidad | undefined,
    espejado: boolean,
    tMs: number,
    dt: number,
    aspecto: number,
    ancla: AnclaRostro
  ): PoseBrazo {
    const est = this.lados[String(lado) as '-1' | '1'];
    const rig = this.rig;
    const lp = this.largoPalma;
    // Mano derecha o izquierda: la etiqueta de MediaPipe manda (aunque la mano cruce al otro lado); sin etiqueta, el lado.
    const ladoEtiqueta = ladoDeEtiqueta(etiqueta, espejado);
    const q = quiralidadDeLado(ladoEtiqueta ?? lado);

    if (mano && this.palmaLenta) {
      if (tMs - est.ultimaVista > RETENCION_MS) est.filtro.reiniciar();
      est.ultimaVista = tMs;
      const crudo: number[] = [];
      for (const p of mano) crudo.push(p.x, p.y, p.z);
      const plano = est.filtro.filtrar(crudo, tMs);
      const m = Array.from({ length: 21 }, (_, i) => v3(plano[i * 3], plano[i * 3 + 1], plano[i * 3 + 2]));

      // Ejes del avatar: y hacia arriba, z hacia quien mira.
      const enAvatar = m.map((p) => v3(p.x, -p.y, -p.z));
      const { puntos, base } = retargetMano(enAvatar, rig.mano, lp, q);

      // Posición: centro de la palma, en tamaños de palma desde la cara.
      const c = centroPalma(m);
      const P = this.palmaLenta;
      const destino = this.espacio.mapear((c.x - ancla.x * aspecto) / P, (c.y - ancla.y) / P);
      // Profundidad: una mano más grande que lo normal está más cerca de la cámara.
      const cercania = limitar((distancia(m[0], m[9]) / P - 1) * 0.9, -0.25, 0.45);
      const centroLocal = centroPalma(puntos);
      const muneca = v3(
        limitar(destino.x, -rig.limites.xMax, rig.limites.xMax) - centroLocal.x,
        limitar(destino.y, rig.limites.yMin, rig.limites.yMax) - centroLocal.y,
        rig.zFrentePecho + 0.3 + cercania - centroLocal.z
      );
      muneca.z += desplazamientoFuera(
        puntos.map((p) => sumar(p, muneca)),
        rig.colisiones,
        this.margenColision
      );
      est.activa = { muneca, puntos, base, quiralidad: q };
    }

    // Actividad: entra rápido, sale suave (y solo después de la retención).
    const visible = tMs - est.ultimaVista <= RETENCION_MS && est.activa !== null;
    const objetivo = visible ? 1 : 0;
    const tau = visible ? 0.12 : 0.3;
    est.actividad += (objetivo - est.actividad) * (1 - Math.exp(-dt / tau));
    if (!visible && est.actividad < 0.002) {
      est.actividad = 0;
      est.activa = null;
    }

    // Reposo junto al cuerpo, con la mezcla hacia la pose activa.
    const reposo = manoEnReposo(rig.mano, lp, lado);
    const munecaReposo = v3(lado * rig.munecaReposo.x, rig.munecaReposo.y, rig.munecaReposo.z);
    const e = est.actividad * est.actividad * (3 - 2 * est.actividad);
    const a = est.activa;
    const munecaObjetivo = a ? mezclar(munecaReposo, a.muneca, e) : munecaReposo;
    const puntosMano = a ? reposo.puntos.map((p, i) => mezclar(p, a.puntos[i], e)) : reposo.puntos;
    const base: BaseMano = a
      ? {
          x: normalizar(mezclar(reposo.base.x, a.base.x, e)),
          y: normalizar(mezclar(reposo.base.y, a.base.y, e)),
          palma: normalizar(mezclar(reposo.base.palma, a.base.palma, e)),
        }
      : reposo.base;

    // Codo: hacia abajo y afuera, y alineado con la mano (el antebrazo sigue la dirección de la palma).
    const hombro = lado === -1 ? rig.hombroIzq : rig.hombroDer;
    const haciaCodo = escalar(base.y, -1);
    haciaCodo.y = Math.min(haciaCodo.y, 0.1);
    const flexionObjetivo = normalizar(sumar(escalar(v3(lado * 0.62, -0.68, -0.38), 0.6), escalar(normalizar(haciaCodo), 0.4)));
    est.flexion = est.flexion ? normalizar(mezclar(est.flexion, flexionObjetivo, 1 - Math.exp(-dt / 0.12))) : flexionObjetivo;
    let ik = resolverBrazo(hombro, munecaObjetivo, rig.largoBrazo, rig.largoAntebrazo, est.flexion);
    let manoFinal = puntosMano.map((p) => sumar(p, ik.muneca));
    // Si el brazo no alcanzaba y al acortarlo la mano quedó dentro de la cara o el cuerpo
    // (señas en la frente o los ojos), se adelanta y el brazo se estira lo necesario.
    const adelantar = desplazamientoFuera(manoFinal, rig.colisiones, this.margenColision);
    if (adelantar > 1e-4) {
      ik = resolverBrazo(hombro, sumar(ik.muneca, v3(0, 0, adelantar)), rig.largoBrazo, rig.largoAntebrazo, est.flexion, Infinity);
      manoFinal = puntosMano.map((p) => sumar(p, ik.muneca));
    }

    return {
      lado,
      hombro,
      codo: ik.codo,
      muneca: ik.muneca,
      mano: manoFinal,
      base,
      quiralidad: a && e > 0.5 ? a.quiralidad : quiralidadDeLado(lado),
      actividad: est.actividad,
    };
  }
}
