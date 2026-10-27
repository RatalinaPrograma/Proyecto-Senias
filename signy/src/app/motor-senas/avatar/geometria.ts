/**
 * Piezas de geometría del avatar 3D, generadas por código (sin archivos de
 * modelos): superficies suaves deformadas desde una esfera, tubos que se
 * actualizan en cada cuadro (brazos, cola) y texturas pintadas en un canvas
 * (ojos, boca, rubor).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const suave = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Mezcla `a` → `b` según t (0..1) y deja el resultado en `out`. */
export function mezclarColor(a: Color, b: Color, t: number, out: Color): Color {
  return out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));
}

/**
 * Superficie "estrellada" desde su centro: una esfera en la que cada
 * dirección `d` se lleva a la distancia `radio(d)`. Sirve para cabezas con
 * hocico, mofletes y mechones de pelo con un solo contorno suave, sin
 * costuras. `color` pinta cada vértice (pelaje naranja, máscara crema, etc.).
 */
export function geometriaRadial(
  radio: (d: Vector3) => number,
  color: ((d: Vector3, out: Color) => void) | null,
  segmentosAncho = 96,
  segmentosAlto = 72,
  conUV = false
): BufferGeometry {
  // Con UV: mapa equirectangular con u = 0,5 al frente (+z), costura atrás y v = 1 arriba
  // (el mismo que usa ml/avatar/proyectar.py para hornear la cara del zorrito).
  const esfera = new SphereGeometry(1, segmentosAncho, segmentosAlto, -Math.PI / 2);
  if (!conUV) esfera.deleteAttribute('uv');
  esfera.deleteAttribute('normal');
  const g = mergeVertices(esfera, 1e-5);
  esfera.dispose();
  const pos = g.getAttribute('position') as BufferAttribute;
  const colores = color ? new Float32Array(pos.count * 3) : null;
  const d = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const r = radio(d);
    pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
    if (colores && color) {
      color(d, c);
      colores[i * 3] = c.r;
      colores[i * 3 + 1] = c.g;
      colores[i * 3 + 2] = c.b;
    }
  }
  if (colores) g.setAttribute('color', new BufferAttribute(colores, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Casquete sobre una superficie radial (pelo, gorros): cubre desde la
 * coronilla hasta `borde(φ)` (ángulo desde arriba, φ = 0 al frente) y su
 * última fila cae justo en ese borde, así la línea del pelo queda suave sin
 * importar su forma (flequillo, patillas). El borde se dobla hacia adentro
 * para que se vea el grosor del pelo.
 */
export function geometriaCasquete(
  radio: (d: Vector3) => number,
  borde: (phi: number) => number,
  grosor: (theta: number, phi: number) => number,
  segmentosPhi = 96,
  segmentosTheta = 40
): BufferGeometry {
  const filas = segmentosTheta + 3;
  const pos: number[] = [];
  const d = new Vector3();
  for (let k = 0; k <= filas; k++) {
    for (let i = 0; i <= segmentosPhi; i++) {
      const phi = (i / segmentosPhi) * Math.PI * 2 - Math.PI;
      const limite = borde(phi);
      const t = Math.min(1, k / segmentosTheta);
      const theta = t * limite;
      d.set(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
      const base = radio(d);
      // Filas extra: el borde redondeado que se mete bajo el pelo.
      const extra = k - segmentosTheta;
      const g = grosor(theta, phi);
      const r = extra <= 0 ? base * (1 + g) : base * (1 + g * [0.55, 0.15, -0.04][extra - 1]);
      const tEfectivo = extra <= 0 ? theta : limite - [0.012, 0.02, 0.03][extra - 1];
      d.set(Math.sin(tEfectivo) * Math.sin(phi), Math.cos(tEfectivo), Math.sin(tEfectivo) * Math.cos(phi));
      pos.push(d.x * r, d.y * r, d.z * r);
    }
  }
  const indices: number[] = [];
  const fila = segmentosPhi + 1;
  for (let k = 0; k < filas; k++) {
    for (let i = 0; i < segmentosPhi; i++) {
      const a = k * fila + i;
      const b = a + fila;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(indices);
  const unida = mergeVertices(g, 1e-5);
  g.dispose();
  unida.computeVertexNormals();
  // UV para la textura de mechones: u alrededor de la cabeza (costura atrás), v de la coronilla (0) al borde (1).
  const p = unida.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const phi = Math.atan2(x, z);
    const theta = Math.acos(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))));
    uv[i * 2] = phi / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = Math.min(1, theta / borde(phi));
  }
  unida.setAttribute('uv', new BufferAttribute(uv, 2));
  return unida;
}

/** Punto de la superficie radial en la dirección `d` (normalizada). */
export function puntoRadial(radio: (d: Vector3) => number, d: Vector3): Vector3 {
  const n = d.clone().normalize();
  return n.multiplyScalar(radio(n));
}

/** Normal aproximada de la superficie radial en la dirección `d` (diferencias finitas). */
export function normalRadial(radio: (d: Vector3) => number, d: Vector3): Vector3 {
  const n = d.clone().normalize();
  const t1 = new Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
  const t2 = new Vector3().crossVectors(n, t1).normalize();
  const e = 0.01;
  const p = puntoRadial(radio, n);
  const a = puntoRadial(radio, n.clone().addScaledVector(t1, e)).sub(p);
  const b = puntoRadial(radio, n.clone().addScaledVector(t2, e)).sub(p);
  const normal = new Vector3().crossVectors(a, b).normalize();
  return normal.dot(n) < 0 ? normal.negate() : normal;
}

/**
 * Tubo de radio variable que se rehace en cada cuadro siguiendo una curva
 * (brazos, cola, delineado de ojos). Usa marcos de transporte paralelo para que no se
 * retuerza, y escribe posiciones y normales directamente (sin recalcular).
 */
export class TuboDinamico {
  readonly geometria = new BufferGeometry();
  private readonly posiciones: Float32Array;
  private readonly normales: Float32Array;
  private readonly normalAnterior = new Vector3();

  constructor(
    readonly anillos: number,
    readonly lados: number,
    /** Color de cada vértice según el avance t (0..1) y el ángulo alrededor del tubo. */
    color?: (t: number, angulo: number, out: Color) => void
  ) {
    const n = anillos * (lados + 1);
    this.posiciones = new Float32Array(n * 3);
    this.normales = new Float32Array(n * 3);
    this.geometria.setAttribute('position', new BufferAttribute(this.posiciones, 3));
    this.geometria.setAttribute('normal', new BufferAttribute(this.normales, 3));
    if (color) {
      const colores = new Float32Array(n * 3);
      const c = new Color();
      for (let i = 0; i < anillos; i++) {
        for (let j = 0; j <= lados; j++) {
          color(i / (anillos - 1), (j / lados) * Math.PI * 2, c);
          const k = (i * (lados + 1) + j) * 3;
          colores[k] = c.r;
          colores[k + 1] = c.g;
          colores[k + 2] = c.b;
        }
      }
      this.geometria.setAttribute('color', new BufferAttribute(colores, 3));
    }
    const indices: number[] = [];
    for (let i = 0; i < anillos - 1; i++) {
      for (let j = 0; j < lados; j++) {
        const a = i * (lados + 1) + j;
        const b = a + lados + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    this.geometria.setIndex(indices);
  }

  /** `puntos.length` debe ser igual a `anillos`; `radios[i]` es el radio en cada punto. */
  actualizar(puntos: Vector3[], radios: number[], referencia = new Vector3(0, 0, 1)): void {
    const tangente = new Vector3();
    const normal = this.normalAnterior;
    const binormal = new Vector3();
    const dir = new Vector3();
    for (let i = 0; i < this.anillos; i++) {
      const a = puntos[Math.max(0, i - 1)];
      const b = puntos[Math.min(this.anillos - 1, i + 1)];
      tangente.subVectors(b, a);
      if (tangente.lengthSq() < 1e-12) tangente.set(0, 1, 0);
      tangente.normalize();
      if (i === 0) {
        normal.copy(referencia).addScaledVector(tangente, -referencia.dot(tangente));
        if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0).addScaledVector(tangente, -tangente.x);
      } else {
        normal.addScaledVector(tangente, -normal.dot(tangente));
      }
      normal.normalize();
      binormal.crossVectors(tangente, normal);
      const p = puntos[i];
      const r = radios[i];
      for (let j = 0; j <= this.lados; j++) {
        const ang = (j / this.lados) * Math.PI * 2;
        dir.copy(normal).multiplyScalar(Math.cos(ang)).addScaledVector(binormal, Math.sin(ang));
        const k = (i * (this.lados + 1) + j) * 3;
        this.posiciones[k] = p.x + dir.x * r;
        this.posiciones[k + 1] = p.y + dir.y * r;
        this.posiciones[k + 2] = p.z + dir.z * r;
        this.normales[k] = dir.x;
        this.normales[k + 1] = dir.y;
        this.normales[k + 2] = dir.z;
      }
    }
    this.geometria.getAttribute('position').needsUpdate = true;
    this.geometria.getAttribute('normal').needsUpdate = true;
  }

  liberar(): void {
    this.geometria.dispose();
  }
}

/**
 * Curva suave hombro → codo → muñeca (Hermite): pasa por el codo con una
 * curvatura redondeada, como un brazo de peluche, sin quebrarse.
 */
export function muestrearBrazo(a: Vector3, b: Vector3, c: Vector3, n: number, salida: Vector3[]): Vector3[] {
  const tA = new Vector3().subVectors(b, a);
  const tC = new Vector3().subVectors(c, b);
  const tB = new Vector3().subVectors(c, a).multiplyScalar(0.42);
  const mitad = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    const enPrimero = i < mitad;
    const t = enPrimero ? i / mitad : (i - mitad) / (n - 1 - mitad);
    const p0 = enPrimero ? a : b;
    const p1 = enPrimero ? b : c;
    const m0 = enPrimero ? tA : tB;
    const m1 = enPrimero ? tB : tC;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const p = salida[i] ?? (salida[i] = new Vector3());
    p.set(0, 0, 0).addScaledVector(p0, h00).addScaledVector(m0, h10).addScaledVector(p1, h01).addScaledVector(m1, h11);
  }
  return salida;
}

/** Curva Catmull-Rom uniforme por varios puntos de control (cola, perfiles). */
export function muestrearCurva(control: Vector3[], n: number, salida: Vector3[]): Vector3[] {
  const tramos = control.length - 1;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * tramos;
    const k = Math.min(tramos - 1, Math.floor(u));
    const t = u - k;
    const p0 = control[Math.max(0, k - 1)];
    const p1 = control[k];
    const p2 = control[k + 1];
    const p3 = control[Math.min(control.length - 1, k + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const p = salida[i] ?? (salida[i] = new Vector3());
    p.set(0, 0, 0)
      .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
      .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
      .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
      .addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Texturas pintadas
// ---------------------------------------------------------------------------

/**
 * Componentes 0..255 de un color "#RRGGBB" para usar en el canvas. No pasa por `Color` de
 * three.js, que guarda los colores en espacio lineal (el canvas los espera en sRGB).
 */
function rgbCanvas(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function texturaDeCanvas(ancho: number, alto: number, pintar: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (ctx) pintar(ctx, ancho, alto);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

export interface EstiloOjo {
  /** Blanco del ojo visible alrededor del iris (zorro) o solo iris oscuro (persona). */
  esclerotica: boolean;
  irisClaro: string;
  irisOscuro: string;
  /** Radio del iris respecto del ojo (0..1). */
  tamanoIris: number;
  /** Brillo grande arriba a la derecha (como el zorrito de las ilustraciones) en vez de a la izquierda. */
  brilloDerecha?: boolean;
  /** Corre el iris hacia arriba (fracción del radio): el párpado lo "tapa" un poco y la mirada es más tierna. */
  irisArriba?: number;
}

/**
 * Ojo brillante estilo kawaii: iris con degradé (más claro abajo, como en el
 * arte del zorrito), pupila y dos brillos. Se proyecta de frente sobre la
 * esfera del ojo, así que al rotar el ojo el iris "mira".
 */
export function texturaOjo(e: EstiloOjo): CanvasTexture {
  return texturaDeCanvas(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = e.esclerotica ? '#FFFDF8' : e.irisOscuro;
    ctx.fillRect(0, 0, w, w);
    const rIris = c * e.tamanoIris;
    const cy = c - c * (e.irisArriba ?? 0);
    const g = ctx.createRadialGradient(c, cy + rIris * 0.45, rIris * 0.1, c, cy, rIris);
    g.addColorStop(0, e.irisClaro);
    g.addColorStop(0.75, e.irisOscuro);
    g.addColorStop(1, '#140802');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, cy, rIris, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0B0402';
    ctx.beginPath();
    ctx.arc(c, cy - rIris * 0.04, rIris * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Brillos pintados (se ven "vivos" aunque la luz cambie).
    const s = e.brilloDerecha ? 1 : -1;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(c + s * rIris * 0.34, cy - rIris * 0.38, rIris * 0.3, rIris * 0.34, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(c - s * rIris * 0.36, cy + rIris * 0.34, rIris * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

export interface EstiloBoca {
  abierta: boolean;
  /** Línea vertical de la nariz a la boca (hocico del zorrito). */
  filtrum?: boolean;
  /** Color del borde y de la "w" del labio superior. */
  linea: string;
  interior: string;
  lengua: string;
}

/** Sonrisa: abierta con lengüita (zorro) o cerrada y tierna (persona). */
export function texturaBoca(e: EstiloBoca): CanvasTexture {
  return texturaDeCanvas(256, 256, (ctx, w, h) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (e.abierta) {
      // Boca abierta y redonda (zorrito feliz): labio superior en "w" que nace de la nariz y lengua grande.
      const top = h * 0.24;
      const trazar = () => {
        ctx.beginPath();
        ctx.moveTo(w * 0.14, top);
        ctx.quadraticCurveTo(w * 0.32, top + h * 0.13, w * 0.5, top + h * 0.05);
        ctx.quadraticCurveTo(w * 0.68, top + h * 0.13, w * 0.86, top);
        ctx.bezierCurveTo(w * 0.84, h * 0.96, w * 0.16, h * 0.96, w * 0.14, top);
        ctx.closePath();
      };
      ctx.save();
      trazar();
      ctx.fillStyle = e.interior;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = e.lengua;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.86, w * 0.26, h * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(170, 60, 70, 0.55)';
      ctx.lineWidth = w * 0.014;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.68);
      ctx.lineTo(w * 0.5, h * 0.82);
      ctx.stroke();
      ctx.restore();
      trazar();
      ctx.lineWidth = w * 0.035;
      ctx.strokeStyle = e.linea;
      ctx.stroke();
      // Comisuras levantadas (sonrisa).
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(w * (0.5 + sx * 0.36), top);
        ctx.quadraticCurveTo(w * (0.5 + sx * 0.42), top - h * 0.02, w * (0.5 + sx * 0.44), top - h * 0.08);
        ctx.stroke();
      }
      if (e.filtrum) {
        ctx.beginPath();
        ctx.moveTo(w * 0.5, 0);
        ctx.lineTo(w * 0.5, top + h * 0.05);
        ctx.lineWidth = w * 0.03;
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.42);
      ctx.quadraticCurveTo(w * 0.5, h * 0.78, w * 0.76, h * 0.42);
      ctx.quadraticCurveTo(w * 0.5, h * 0.56, w * 0.24, h * 0.42);
      ctx.fillStyle = e.interior;
      ctx.fill();
      ctx.lineWidth = w * 0.045;
      ctx.strokeStyle = e.linea;
      ctx.stroke();
    }
  });
}

/**
 * Pelo estilizado para el casquete (u alrededor, v de la coronilla al borde):
 * mechones finos en tonos un poco más claros y oscuros, y el "anillo" de
 * brillo típico del pelo en las animaciones.
 */
export function texturaPelo(base: string, brillo = '#E8C9A8'): CanvasTexture {
  const tex = texturaDeCanvas(1024, 256, (ctx, w, h) => {
    const c = rgbCanvas(base);
    const l = rgbCanvas(brillo);
    // Mezcla hacia el color de brillo (en pelo oscuro, multiplicar casi no se nota).
    const tono = (t: number, a = 1) => {
      const hacia = t >= 0 ? l : [0, 0, 0];
      const k = Math.abs(t);
      const m = c.map((v, i) => Math.round(v + (hacia[i] - v) * k));
      return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})`;
    };
    const fondo = ctx.createLinearGradient(0, 0, 0, h);
    fondo.addColorStop(0, tono(-0.15));
    fondo.addColorStop(0.6, tono(0));
    fondo.addColorStop(1, tono(0.08));
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, w, h);
    // Semilla fija: el pelo se ve igual siempre.
    let semilla = 7;
    const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
    ctx.lineCap = 'round';
    for (let i = 0; i < 1100; i++) {
      const x = azar() * w;
      ctx.strokeStyle = tono(azar() < 0.5 ? -0.25 * azar() : 0.22 * azar(), 0.5 + azar() * 0.4);
      ctx.lineWidth = 1 + azar() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, azar() * h * 0.3);
      ctx.quadraticCurveTo(x + (azar() - 0.5) * 12, h * 0.5, x + (azar() - 0.5) * 18, h * (0.7 + azar() * 0.3));
      ctx.stroke();
    }
    // Anillo de brillo ondulado, cortado por los mechones.
    for (let x = 0; x < w; x += 2) {
      const centro = h * (0.34 + 0.035 * Math.sin((x / w) * Math.PI * 2 * 9) + 0.015 * Math.sin((x / w) * Math.PI * 2 * 23));
      const alto = h * (0.045 + 0.035 * azar());
      const g = ctx.createLinearGradient(0, centro - alto, 0, centro + alto);
      g.addColorStop(0, tono(0.45, 0));
      g.addColorStop(0.5, tono(0.55, 0.35 + azar() * 0.45));
      g.addColorStop(1, tono(0.45, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, centro - alto, 2, alto * 2);
    }
  });
  tex.wrapS = RepeatWrapping;
  return tex;
}

/** Ojo cerrado (para parpadear sobre ojos pintados): piel del color de alrededor y la línea de pestañas. */
export function texturaParpado(piel: string, linea: string): CanvasTexture {
  return texturaDeCanvas(256, 256, (ctx, w, h) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, w * 0.3, c, c, w * 0.48);
    const rgb = rgbCanvas(piel).join(', ');
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(0.75, `rgba(${rgb}, 1)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c, c, w * 0.48, h * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ojo cerrado feliz: arco hacia abajo con pestañas en las puntas.
    ctx.strokeStyle = linea;
    ctx.lineCap = 'round';
    ctx.lineWidth = w * 0.055;
    ctx.beginPath();
    ctx.moveTo(w * 0.24, h * 0.5);
    ctx.quadraticCurveTo(c, h * 0.68, w * 0.76, h * 0.5);
    ctx.stroke();
    ctx.lineWidth = w * 0.035;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(c + s * w * 0.26, h * 0.51);
      ctx.lineTo(c + s * w * 0.33, h * 0.44);
      ctx.stroke();
    }
  });
}

/** Mancha suave (rubor, cejas claras): un óvalo con borde difuminado. */
export function texturaMancha(color: string, opacidad: number, dureza = 0.35): CanvasTexture {
  return texturaDeCanvas(128, 128, (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    const rgb = rgbCanvas(color).join(', ');
    g.addColorStop(0, `rgba(${rgb}, ${opacidad})`);
    g.addColorStop(dureza, `rgba(${rgb}, ${opacidad * 0.92})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Ceja: un arco grueso y redondeado. */
export function texturaCeja(color: string): CanvasTexture {
  return texturaDeCanvas(128, 64, (ctx, w, h) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = h * 0.3;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h * 0.68);
    ctx.quadraticCurveTo(w * 0.5, h * 0.12, w * 0.85, h * 0.6);
    ctx.stroke();
  });
}

/** Resplandor radial para el aura de fondo. */
export function texturaAura(color: string): CanvasTexture {
  return texturaDeCanvas(256, 256, (ctx, w) => {
    const c = w / 2;
    const rgb = rgbCanvas(color).join(', ');
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, `rgba(${rgb}, 0.55)`);
    g.addColorStop(0.45, `rgba(${rgb}, 0.22)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Insignia del pañuelo: la carita del zorrito sobre un círculo crema con borde dorado. */
export function texturaInsignia(): CanvasTexture {
  return texturaDeCanvas(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#E9C77A';
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFF1DC';
    ctx.beginPath();
    ctx.arc(c, c, c * 0.88, 0, Math.PI * 2);
    ctx.fill();
    // Orejas
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#F86F08';
      ctx.beginPath();
      ctx.moveTo(c + s * w * 0.08, c - w * 0.12);
      ctx.quadraticCurveTo(c + s * w * 0.24, c - w * 0.4, c + s * w * 0.3, c - w * 0.36);
      ctx.quadraticCurveTo(c + s * w * 0.33, c - w * 0.18, c + s * w * 0.28, c - w * 0.04);
      ctx.fill();
      ctx.fillStyle = '#3A1708';
      ctx.beginPath();
      ctx.moveTo(c + s * w * 0.22, c - w * 0.32);
      ctx.quadraticCurveTo(c + s * w * 0.27, c - w * 0.4, c + s * w * 0.3, c - w * 0.36);
      ctx.quadraticCurveTo(c + s * w * 0.31, c - w * 0.3, c + s * w * 0.3, c - w * 0.26);
      ctx.fill();
    }
    // Cabeza naranja
    ctx.fillStyle = '#F86F08';
    ctx.beginPath();
    ctx.ellipse(c, c + w * 0.02, w * 0.28, w * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    // Máscara crema
    ctx.fillStyle = '#FCEBD5';
    ctx.beginPath();
    ctx.moveTo(c - w * 0.3, c + w * 0.02);
    ctx.quadraticCurveTo(c - w * 0.12, c - w * 0.02, c, c + w * 0.06);
    ctx.quadraticCurveTo(c + w * 0.12, c - w * 0.02, c + w * 0.3, c + w * 0.02);
    ctx.quadraticCurveTo(c + w * 0.2, c + w * 0.3, c, c + w * 0.3);
    ctx.quadraticCurveTo(c - w * 0.2, c + w * 0.3, c - w * 0.3, c + w * 0.02);
    ctx.fill();
    // Ojos, nariz y sonrisa
    ctx.fillStyle = '#2A1206';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(c + s * w * 0.11, c - w * 0.02, w * 0.04, w * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(c, c + w * 0.1, w * 0.045, w * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2A1206';
    ctx.lineWidth = w * 0.018;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c - w * 0.07, c + w * 0.16);
    ctx.quadraticCurveTo(c, c + w * 0.22, c + w * 0.07, c + w * 0.16);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c + s * w * 0.11 + w * 0.012, c - w * 0.04, w * 0.013, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
