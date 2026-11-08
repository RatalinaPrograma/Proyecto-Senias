/**
 * Personajes 3D del avatar de señas, modelados por código (sin archivos
 * .glb): el Zorrito Signy de peluche, una persona con polerón, una versión de
 * alto contraste (ropa oscura y manos muy visibles, como visten los
 * intérpretes) y un maniquí translúcido para revisar el rig.
 *
 * Todos comparten el mismo esqueleto de brazos y manos (ver cinematica.ts),
 * así que una seña se ve igual en cualquiera de ellos.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TemaAvatar } from './config';
import { PoseAvatar, PoseBrazo } from './cinematica';
import { EsqueletoMano, RIG_PERSONA, RIG_ZORRO, RigAvatar, V3 } from './rig';
import { ATRIBUTO_LARGO_PELO, OpcionesPelaje, PELAJE_PELUCHE, agregarPelaje } from './pelaje';
import {
  TuboDinamico,
  geometriaCasquete,
  geometriaRadial,
  mezclarColor,
  muestrearBrazo,
  muestrearCurva,
  normalRadial,
  puntoRadial,
  suave,
  texturaBoca,
  texturaCeja,
  texturaInsignia,
  texturaMancha,
  texturaOjo,
  texturaParpado,
  texturaPelo,
} from './geometria';

export interface OpcionesPersonaje {
  mostrarRostro: boolean;
  mostrarAccesorios: boolean;
  sombras: boolean;
  /** Pelaje por capas (zorro). Más bonito pero más pesado: solo en calidad alta. */
  pelaje: boolean;
  tamanoManos: number;
}

export interface Personaje {
  readonly tema: TemaAvatar;
  readonly rig: RigAvatar;
  readonly raiz: Group;
  /** Color del resplandor detrás del personaje. */
  readonly colorAura: string;
  actualizar(pose: PoseAvatar, t: number, dt: number): void;
  aplicarOpciones(opciones: Partial<OpcionesPersonaje>): void;
  /** Descarga lo que el personaje necesita aparte de su código (p. ej. la textura de la cara). */
  cargarRecursos?(): Promise<void>;
  liberar(): void;
}

/**
 * Cara del zorrito horneada desde la ilustración oficial (assets/img/EstasListo.png)
 * con ml/avatar/proyectar.py. Ruta relativa a la app (o a la página que use el avatar).
 */
export const RUTA_CARA_ZORRO = 'assets/modelos/zorro-cara.webp';

const color = (hex: string) => new Color(hex);
const vec = (p: V3, out = new Vector3()) => out.set(p.x, p.y, p.z);
const EJE_Y = new Vector3(0, 1, 0);
const ANILLOS_BRAZO = 26;

// ---------------------------------------------------------------------------
// Brazos y manos (compartidos)
// ---------------------------------------------------------------------------

interface EstiloBrazo {
  material: Material;
  /** Pelo por capas sobre brazo y hombro (si el personaje lo usa y la calidad lo permite). */
  pelaje?: OpcionesPelaje;
  /** Radio del brazo a lo largo (t = 0 hombro, 1 muñeca). */
  radio: (t: number) => number;
  color?: (t: number, angulo: number, out: Color) => void;
  materialHombro: Material;
  radioHombro: number;
}

interface EstiloMano {
  material: Material;
  /** Almohadillas de patita en la palma y la yema de los dedos (zorro). */
  almohadillas: Material | null;
  /** Uñas en el dorso de las yemas (humanos): ayudan a leer si se ve la palma o el dorso. */
  unas: Material | null;
  /** Grosor de la palma respecto del radio de los dedos. */
  grosorPalma: number;
  radioMuneca: number;
}

const DEDOS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/** Base ortonormal → cuaternión (x, y, z deben ser ortonormales y de mano derecha). */
function cuaternionDeBase(x: Vector3, y: Vector3, z: Vector3, out = new Quaternion()): Quaternion {
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

class ManoMallas {
  readonly grupo = new Group();
  private readonly palma: Mesh;
  private readonly muneca: Mesh;
  private readonly falanges: { malla: Mesh; desde: number; hasta: number }[] = [];
  private readonly almohadillaPalma: Mesh | null = null;
  private readonly yemas: Mesh[] = [];
  private readonly unas: Mesh[] = [];
  private readonly geometrias: BufferGeometry[] = [];
  private readonly radioMedio: number;
  private readonly radios: number[];

  constructor(esqueleto: EsqueletoMano, largoPalma: number, private readonly estilo: EstiloMano, sombras: boolean) {
    const lp = largoPalma;
    this.radios = esqueleto.radioDedos.map((r) => r * lp);
    this.radioMedio = this.radios.slice(1).reduce((a, b) => a + b, 0) / 4;
    const esfera = this.geo(new SphereGeometry(1, 32, 22));

    this.palma = this.agregar(esfera, estilo.material, sombras);
    this.muneca = this.agregar(this.geo(new SphereGeometry(estilo.radioMuneca, 24, 16)), estilo.material, sombras);

    DEDOS.forEach((cadena, d) => {
      for (let k = 0; k < 3; k++) {
        const desde = cadena[k];
        const hasta = cadena[k + 1];
        const r = this.radios[d] * (d === 0 && k === 0 ? 1.35 : 1) * (k === 2 ? 0.96 : 1);
        const largo = esqueleto.falanges[hasta] * lp;
        const malla = this.agregar(this.geo(new CapsuleGeometry(r, largo, 8, 16)), estilo.material, sombras);
        this.falanges.push({ malla, desde, hasta });
      }
    });

    if (estilo.almohadillas) {
      this.almohadillaPalma = this.agregar(esfera, estilo.almohadillas, false);
      for (let d = 0; d < 5; d++) this.yemas.push(this.agregar(esfera, estilo.almohadillas, false));
    }
    if (estilo.unas) {
      for (let d = 0; d < 5; d++) this.unas.push(this.agregar(esfera, estilo.unas, false));
    }
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometrias.push(g);
    return g;
  }

  private agregar(geo: BufferGeometry, mat: Material, sombras: boolean): Mesh {
    const m = new Mesh(geo, mat);
    m.castShadow = sombras;
    m.receiveShadow = sombras;
    this.grupo.add(m);
    return m;
  }

  actualizar(pose: PoseBrazo): void {
    const m = pose.mano.map((p) => vec(p));
    const x = vec(pose.base.x);
    const y = vec(pose.base.y);
    const n = new Vector3().crossVectors(x, y).normalize();
    const palmaDir = vec(pose.base.palma);
    const q = pose.quiralidad;

    // Palma: un "mitón" redondeado entre la muñeca y los nudillos.
    const nudillos = new Vector3().add(m[5]).add(m[9]).add(m[13]).add(m[17]).multiplyScalar(0.25);
    const centro = new Vector3().copy(m[0]).multiplyScalar(0.36).addScaledVector(nudillos, 0.64);
    const anchoMedio = m[5].distanceTo(m[17]) / 2 + this.radioMedio * 0.95;
    const largoMedio = m[9].distanceTo(m[0]) * 0.6;
    const grosorMedio = this.radioMedio * this.estilo.grosorPalma;
    this.palma.position.copy(centro);
    cuaternionDeBase(x, y, n, this.palma.quaternion);
    this.palma.scale.set(anchoMedio, largoMedio, grosorMedio);
    this.muneca.position.copy(m[0]);

    const dir = new Vector3();
    for (const f of this.falanges) {
      const a = m[f.desde];
      const b = m[f.hasta];
      f.malla.position.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a).normalize();
      f.malla.quaternion.setFromUnitVectors(EJE_Y, dir);
    }

    if (this.almohadillaPalma) {
      this.almohadillaPalma.position.copy(centro).addScaledVector(palmaDir, grosorMedio * 0.9).addScaledVector(y, largoMedio * 0.12);
      cuaternionDeBase(x, y, n, this.almohadillaPalma.quaternion);
      this.almohadillaPalma.scale.set(anchoMedio * 0.62, largoMedio * 0.5, grosorMedio * 0.22);
    }

    // Yemas (palma) y uñas (dorso) en la última falange de cada dedo.
    const lado = new Vector3();
    const haciaPalma = new Vector3();
    for (let d = 0; d < 5; d++) {
      const punta = m[DEDOS[d][3]];
      const previo = m[DEDOS[d][2]];
      dir.subVectors(punta, previo).normalize();
      if (d === 0) haciaPalma.copy(palmaDir).addScaledVector(dir, -palmaDir.dot(dir));
      else haciaPalma.crossVectors(x, dir).multiplyScalar(q);
      if (haciaPalma.lengthSq() < 1e-8) haciaPalma.copy(palmaDir);
      haciaPalma.normalize();
      lado.crossVectors(dir, haciaPalma).normalize();
      const r = this.radios[d];
      const largo = punta.distanceTo(previo);
      if (this.yemas[d]) {
        const yema = this.yemas[d];
        yema.position.copy(punta).addScaledVector(dir, -largo * 0.12).addScaledVector(haciaPalma, r * 0.72);
        cuaternionDeBase(lado, dir, haciaPalma, yema.quaternion);
        yema.scale.set(r * 0.66, r * 0.72, r * 0.3);
      }
      if (this.unas[d]) {
        const una = this.unas[d];
        una.position.copy(punta).addScaledVector(dir, -largo * 0.05).addScaledVector(haciaPalma, -r * 0.8);
        cuaternionDeBase(lado, dir, haciaPalma, una.quaternion);
        una.scale.set(r * 0.68, r * 0.85, r * 0.22);
      }
    }
  }

  liberar(): void {
    for (const g of this.geometrias) g.dispose();
  }
}

class BrazoMallas {
  readonly malla: Mesh;
  readonly hombro: Mesh;
  mano: ManoMallas;
  private readonly materialesPelaje: Material[] = [];
  private readonly tubo: TuboDinamico;
  private readonly puntos: Vector3[] = [];
  private readonly radios: number[];
  private readonly referencia = new Vector3(0, 0, 1);

  constructor(
    padre: Object3D,
    estilo: EstiloBrazo,
    private readonly estiloMano: EstiloMano,
    private readonly esqueleto: EsqueletoMano,
    largoPalma: number,
    private readonly sombras: boolean,
    pelaje: boolean
  ) {
    this.tubo = new TuboDinamico(ANILLOS_BRAZO, 20, estilo.color);
    this.radios = Array.from({ length: ANILLOS_BRAZO }, (_, i) => estilo.radio(i / (ANILLOS_BRAZO - 1)));
    this.malla = new Mesh(this.tubo.geometria, estilo.material);
    this.malla.frustumCulled = false;
    this.malla.castShadow = sombras;
    this.malla.receiveShadow = sombras;
    this.hombro = new Mesh(new SphereGeometry(estilo.radioHombro, 32, 22), estilo.materialHombro);
    this.hombro.castShadow = sombras;
    this.hombro.receiveShadow = sombras;
    this.mano = new ManoMallas(esqueleto, largoPalma, estiloMano, sombras);
    padre.add(this.malla, this.hombro, this.mano.grupo);
    if (pelaje && estilo.pelaje) {
      this.materialesPelaje.push(...agregarPelaje(this.malla, estilo.pelaje), ...agregarPelaje(this.hombro, estilo.pelaje));
    }
  }

  cambiarTamanoMano(largoPalma: number): void {
    const padre = this.mano.grupo.parent;
    this.mano.grupo.removeFromParent();
    this.mano.liberar();
    this.mano = new ManoMallas(this.esqueleto, largoPalma, this.estiloMano, this.sombras);
    padre?.add(this.mano.grupo);
  }

  actualizar(pose: PoseBrazo): void {
    const hombro = vec(pose.hombro);
    const codo = vec(pose.codo);
    const muneca = vec(pose.muneca);
    muestrearBrazo(hombro, codo, muneca, ANILLOS_BRAZO, this.puntos);
    this.referencia.set(pose.lado * 0.3, 0, 1).normalize();
    this.tubo.actualizar(this.puntos, this.radios, this.referencia);
    this.hombro.position.copy(hombro);
    this.mano.actualizar(pose);
  }

  liberar(): void {
    this.tubo.liberar();
    this.hombro.geometry.dispose();
    this.mano.liberar();
    for (const m of this.materialesPelaje) m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Base común: brazos, mirada, parpadeo, respiración
// ---------------------------------------------------------------------------

interface Ojo {
  grupo: Group;
  globo: Mesh;
}

interface Delineado {
  material: Material;
  /** Grosor de la línea de arriba (al medio) y de la de abajo, en fracción del radio del ojo. */
  arriba: number;
  abajo: number;
  /** Lado del ojo en la pantalla (-1 izquierda, +1 derecha): hacia dónde sale la colita. */
  lado: -1 | 1;
}

abstract class PersonajeBase implements Personaje {
  readonly raiz = new Group();
  /** Torso, accesorios y cola: "respiran". */
  protected readonly cuerpo = new Group();
  /** Gira para mirar la mano que seña. */
  protected readonly cabeza = new Group();
  /** Ojos, boca, cejas y rubor (se ocultan sin rostro). */
  protected readonly rostro = new Group();
  protected readonly accesorios = new Group();
  protected readonly ojos: Ojo[] = [];
  protected readonly orejas: Object3D[] = [];
  private readonly brazos: BrazoMallas[] = [];
  private readonly desechables: { dispose(): void }[] = [];
  private posicionCabeza = new Vector3();
  private mirada = { yaw: 0, pitch: 0, ojoX: 0, ojoY: 0 };
  private parpadeo = { proximo: 1.5, inicio: -10 };
  private orejaMovida = { proxima: 3, inicio: -10, lado: 0 };
  protected opciones: OpcionesPersonaje;

  constructor(
    readonly tema: TemaAvatar,
    readonly rig: RigAvatar,
    readonly colorAura: string,
    opciones: OpcionesPersonaje,
    estiloBrazo: EstiloBrazo,
    estiloMano: EstiloMano
  ) {
    this.opciones = { ...opciones };
    this.raiz.add(this.cuerpo, this.cabeza);
    this.cabeza.add(this.rostro);
    this.cuerpo.add(this.accesorios);
    const lp = rig.largoPalma * opciones.tamanoManos;
    this.brazos.push(
      new BrazoMallas(this.raiz, estiloBrazo, estiloMano, rig.mano, lp, opciones.sombras, opciones.pelaje),
      new BrazoMallas(this.raiz, estiloBrazo, estiloMano, rig.mano, lp, opciones.sombras, opciones.pelaje)
    );
    for (const m of [estiloBrazo.material, estiloBrazo.materialHombro, estiloMano.material, estiloMano.almohadillas, estiloMano.unas]) {
      if (m) this.guardar(m);
    }
  }

  protected guardar<T extends { dispose(): void }>(x: T): T {
    this.desechables.push(x);
    return x;
  }

  protected malla(geo: BufferGeometry, mat: Material, padre: Object3D, sombra = true): Mesh {
    this.guardar(geo);
    const m = new Mesh(geo, mat);
    m.castShadow = sombra && this.opciones.sombras;
    m.receiveShadow = this.opciones.sombras;
    padre.add(m);
    return m;
  }

  /**
   * La cara no recibe sombras (como en las ilustraciones): la sombra de una
   * mano delante de la cara se ve como una mancha. El cuerpo sí las recibe.
   */
  protected sinSombraEncima(m: Mesh): Mesh {
    m.receiveShadow = false;
    return m;
  }

  /** Pelo por capas sobre `m` (solo si la calidad lo permite). */
  protected peludo(m: Mesh, op: OpcionesPelaje): Mesh {
    if (this.opciones.pelaje) for (const mat of agregarPelaje(m, op)) this.guardar(mat);
    return m;
  }

  /** Ubica la cabeza (después de construir su contenido en el origen). */
  protected ubicarCabeza(centro: V3): void {
    this.posicionCabeza.set(centro.x, centro.y, centro.z);
    this.cabeza.position.copy(this.posicionCabeza);
  }

  /**
   * Ojo que puede mirar: una esfera con el iris pintado, hundida en la cabeza,
   * con delineado opcional (línea gruesa arriba con "colita" hacia afuera y
   * fina abajo, como en las ilustraciones del zorrito).
   */
  protected crearOjo(
    radio: (d: Vector3) => number,
    dir: Vector3,
    rOjo: number,
    asomo: number,
    textura: Texture,
    delineado: Delineado | null
  ): Ojo {
    const p = puntoRadial(radio, dir);
    const n = normalRadial(radio, dir);
    const grupo = new Group();
    grupo.position.copy(p).addScaledVector(n, asomo - rOjo);
    grupo.lookAt(new Vector3().copy(grupo.position).add(n));
    const geo = this.guardar(new SphereGeometry(rOjo, 40, 28));
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * rOjo), 0.5 + pos.getY(i) / (2 * rOjo));
    const mat = this.guardar(
      new MeshPhysicalMaterial({ map: this.guardar(textura), roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.08, envMapIntensity: 0.15 })
    );
    const globo = new Mesh(geo, mat);
    grupo.add(globo);
    if (delineado) this.delinearOjo(grupo, rOjo, asomo, delineado);
    this.rostro.add(grupo);
    const ojo = { grupo, globo };
    this.ojos.push(ojo);
    return ojo;
  }

  private delinearOjo(grupo: Group, rOjo: number, asomo: number, d: Delineado): void {
    // Borde visible del ojo: el círculo donde la esfera sale de la cabeza.
    const v = Math.sqrt(Math.max(0, rOjo * rOjo - (rOjo - asomo) * (rOjo - asomo)));
    const z = rOjo - asomo + rOjo * 0.02;
    const abajo = new Mesh(this.guardar(new TorusGeometry(v * 1.01, rOjo * d.abajo, 8, 48)), d.material);
    abajo.position.z = z;
    grupo.add(abajo);
    // Línea de arriba: de la colita (afuera) por encima del ojo hasta el lagrimal, gruesa al medio.
    const puntos: Vector3[] = [
      new Vector3(d.lado * v * 1.36, v * 0.36, z),
      new Vector3(d.lado * v * 1.18, v * 0.14, z),
    ];
    const pasos = 22;
    for (let i = 0; i <= pasos; i++) {
      const a = -0.06 + (i / pasos) * (Math.PI * 0.94);
      puntos.push(new Vector3(d.lado * v * Math.cos(a) * 1.02, v * Math.sin(a) * 1.04, z + Math.sin(a) * rOjo * 0.03));
    }
    const radios = puntos.map((_, i) => {
      if (i < 2) return rOjo * d.arriba * (i === 0 ? 0.2 : 0.55);
      const t = (i - 2) / pasos;
      return rOjo * d.arriba * (0.75 + 0.25 * Math.sin(Math.min(1, t * 1.6) * Math.PI)) * (1 - 0.65 * suave(0.7, 1, t));
    });
    const tubo = new TuboDinamico(puntos.length, 12);
    tubo.actualizar(puntos, radios, new Vector3(0, 0, 1));
    this.guardar(tubo.geometria);
    grupo.add(new Mesh(tubo.geometria, d.material));
  }

  /** Calcomanía pintada que se adapta a la curva de la cara (boca, rubor, cejas). */
  protected calcomania(
    objetivo: Mesh,
    radio: (d: Vector3) => number,
    dir: Vector3,
    ancho: number,
    alto: number,
    textura: Texture,
    giro = 0,
    padre: Object3D = this.rostro
  ): Mesh {
    const p = puntoRadial(radio, dir);
    const n = normalRadial(radio, dir);
    const x = new Vector3().crossVectors(EJE_Y, n).normalize();
    const y = new Vector3().crossVectors(n, x).normalize();
    const q = cuaternionDeBase(x, y, n).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), giro));
    objetivo.updateMatrixWorld(true);
    const geo = this.guardar(new DecalGeometry(objetivo, p, new Euler().setFromQuaternion(q), new Vector3(ancho, alto, 0.5)));
    const mat = this.guardar(
      new MeshStandardMaterial({
        map: this.guardar(textura),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        roughness: 0.55,
      })
    );
    const m = new Mesh(geo, mat);
    padre.add(m);
    return m;
  }

  aplicarOpciones(op: Partial<OpcionesPersonaje>): void {
    const antes = this.opciones;
    this.opciones = { ...this.opciones, ...op };
    this.rostro.visible = this.opciones.mostrarRostro;
    this.accesorios.visible = this.opciones.mostrarAccesorios;
    if (op.tamanoManos !== undefined && op.tamanoManos !== antes.tamanoManos) {
      for (const b of this.brazos) b.cambiarTamanoMano(this.rig.largoPalma * this.opciones.tamanoManos);
    }
  }

  actualizar(pose: PoseAvatar, t: number, dt: number): void {
    const respira = Math.sin(t * 2.3);
    this.cuerpo.scale.set(1 + respira * 0.004, 1 + respira * 0.008, 1 + respira * 0.006);

    this.brazos[0].actualizar(pose.izq);
    this.brazos[1].actualizar(pose.der);

    // Mirada: la cabeza acompaña un poco y los ojos siguen a la mano que seña.
    let yaw = Math.sin(t * 0.45) * 0.06;
    let pitch = Math.sin(t * 0.7) * 0.025;
    let ojoX = 0;
    let ojoY = 0;
    if (pose.mirada) {
      const dx = pose.mirada.x - this.posicionCabeza.x;
      const dy = pose.mirada.y - this.posicionCabeza.y;
      const dz = pose.mirada.z - this.posicionCabeza.z + 2.2;
      yaw = Math.max(-0.32, Math.min(0.32, Math.atan2(dx, dz) * 0.55));
      pitch = Math.max(-0.22, Math.min(0.12, -Math.atan2(dy, dz) * 0.5));
      ojoX = Math.max(-0.38, Math.min(0.38, Math.atan2(dx, dz) * 0.7));
      ojoY = Math.max(-0.3, Math.min(0.25, -Math.atan2(dy, dz) * 0.6));
    }
    const k = 1 - Math.exp(-dt / 0.22);
    const kOjo = 1 - Math.exp(-dt / 0.08);
    this.mirada.yaw += (yaw - this.mirada.yaw) * k;
    this.mirada.pitch += (pitch - this.mirada.pitch) * k;
    this.mirada.ojoX += (ojoX - this.mirada.ojoX) * kOjo;
    this.mirada.ojoY += (ojoY - this.mirada.ojoY) * kOjo;
    const inclinacion = Math.sin(t * 0.9) * 0.03 - this.mirada.yaw * 0.25;
    this.cabeza.rotation.set(this.mirada.pitch, this.mirada.yaw, inclinacion, 'YXZ');
    this.cabeza.position.copy(this.posicionCabeza);
    this.cabeza.position.y += Math.sin(t * 2.3 - 0.5) * 0.008;

    // Parpadeo cada 2–5 s.
    if (t > this.parpadeo.proximo) {
      this.parpadeo.inicio = t;
      this.parpadeo.proximo = t + 2 + Math.random() * 3;
    }
    const fase = (t - this.parpadeo.inicio) / 0.16;
    const cierre = fase >= 0 && fase <= 1 ? Math.sin(fase * Math.PI) : 0;
    for (const ojo of this.ojos) {
      ojo.grupo.scale.y = (ojo.grupo.userData['escalaY'] ?? 1) * (1 - cierre * 0.9);
      ojo.globo.rotation.set(this.mirada.ojoY, this.mirada.ojoX, 0);
    }
    this.alParpadear(cierre);

    // Una oreja se mueve de vez en cuando.
    if (this.orejas.length) {
      if (t > this.orejaMovida.proxima) {
        this.orejaMovida = { proxima: t + 3 + Math.random() * 5, inicio: t, lado: Math.random() < 0.5 ? 0 : 1 };
      }
      const f = (t - this.orejaMovida.inicio) / 0.35;
      const tiron = f >= 0 && f <= 1 ? Math.sin(f * Math.PI * 2) * (1 - f) * 0.22 : 0;
      this.orejas.forEach((o, i) => (o.rotation.y = (o.userData['giroY'] ?? 0) + (i === this.orejaMovida.lado ? tiron : 0)));
    }
    this.animar(t, dt);
  }

  /** Animaciones propias de cada personaje (cola, etc.). */
  protected animar(_t: number, _dt: number): void {}

  /** Para personajes con ojos pintados: `cierre` va de 0 (abiertos) a 1 (cerrados). */
  protected alParpadear(_cierre: number): void {}

  liberar(): void {
    for (const b of this.brazos) b.liberar();
    for (const d of this.desechables) d.dispose();
    this.raiz.removeFromParent();
  }
}

/** Geometría de torso por revolución, con sección elíptica y color por zona. */
function geometriaTorso(
  perfil: [number, number][],
  escalaZ: number,
  pintar: (angulo: number, y: number, out: Color) => void,
  abultar?: (angulo: number, y: number) => number
): BufferGeometry {
  // El perfil se remuestrea fino (Catmull-Rom) para que los bordes de color (babero, bolsillo) queden nítidos.
  const control = perfil.map(([r, y]) => new Vector3(r, y, 0));
  const fino = muestrearCurva(control, 90, []).map((p) => new Vector2(Math.max(0.001, p.x), p.y));
  const lathe = new LatheGeometry(fino, 96);
  lathe.deleteAttribute('uv');
  lathe.deleteAttribute('normal');
  const g = mergeVertices(lathe, 1e-5);
  lathe.dispose();
  const pos = g.getAttribute('position') as BufferAttribute;
  const colores = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(x, z);
    const extra = abultar ? abultar(ang, y) : 0;
    const r = Math.hypot(x, z);
    const k = r > 1e-6 ? (r + extra) / r : 1;
    pos.setXYZ(i, x * k, y, z * k * escalaZ);
    pintar(ang, y, c);
    colores[i * 3] = c.r;
    colores[i * 3 + 1] = c.g;
    colores[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colores, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Zorrito Signy
// ---------------------------------------------------------------------------

// Paleta medida en las ilustraciones oficiales (assets/img/*.png).
const NARANJA = color('#F86F08');
const NARANJA_CLARO = color('#FF9A2E');
const NARANJA_OSCURO = color('#C9530A');
const CREMA = color('#FFE4C0');
const CREMA_CLARA = color('#FFF1DF');
const CAFE = color('#4E230A');
const CAFE_OSCURO = color('#2E1406');
const ROSADO_OREJA = color('#F3AE9C');
const RUBOR = color('#FF8F80');

/** Perfil del cuerpo (radio, altura): de pera, ancho en la barriga y angosto en los hombros. */
const PERFIL_TORSO_ZORRO: [number, number][] = [
  [0.76, -0.7],
  [0.81, -0.3],
  [0.82, 0.1],
  [0.77, 0.5],
  [0.66, 0.86],
  [0.54, 1.1],
  [0.43, 1.3],
  [0.32, 1.48],
  [0.17, 1.63],
  [0.001, 1.7],
];

/** Direcciones (desde el centro de la cabeza) de los ojos del zorro. */
const OJO_ZORRO = new Vector3(0.39, -0.03, 0.92).normalize();

function radioCabezaZorro(d: Vector3): number {
  // Proporciones calibradas con la ilustración (ml/avatar/calibracion.py): cráneo alto y rasgos juntos.
  let r = 1 / Math.sqrt((d.x / 0.98) ** 2 + (d.y / 0.9) ** 2 + (d.z / 0.84) ** 2);
  // Mitad de abajo más ancha: carita de peluche.
  r *= 1 + 0.03 * suave(0.1, -0.5, d.y) * (1 - Math.abs(d.z) * 0.5);
  // Mechones de los mofletes: puntas hacia los lados y abajo, como en las ilustraciones.
  const lateral = suave(0.58, 0.9, Math.abs(d.x)) * (1 - suave(0.35, 0.78, Math.abs(d.z)));
  if (lateral > 0) {
    const ang = Math.atan2(d.y, Math.abs(d.x));
    const pico = (c: number, w: number) => Math.max(0, 1 - Math.abs(ang - c) / w) ** 2;
    r += lateral * (0.1 * pico(-0.18, 0.17) + 0.15 * pico(-0.45, 0.17) + 0.07 * pico(-0.72, 0.15));
  }
  // Hocico corto y redondo, con la nariz arriba.
  r += 0.36 * Math.exp(-((d.x / 0.27) ** 2) - ((d.y + 0.3) / 0.2) ** 2) * suave(0.55, 0.95, d.z);
  // Barbilla suave bajo la boca.
  r += 0.06 * Math.exp(-((d.x / 0.25) ** 2) - ((d.y + 0.62) / 0.12) ** 2) * suave(0.4, 0.8, d.z);
  // Mechón despeinado en la frente (cuatro puntas).
  const arriba = suave(0.78, 0.97, d.y) * suave(-0.15, 0.35, d.z);
  if (arriba > 0) {
    const pico = (c: number, w: number) => Math.max(0, 1 - Math.abs(d.x - c) / w) ** 2;
    r += arriba * (0.05 * pico(-0.2, 0.1) + 0.09 * pico(-0.06, 0.11) + 0.11 * pico(0.08, 0.11) + 0.05 * pico(0.22, 0.09));
  }
  return r;
}

/** Distancia angular (aprox.) entre la dirección `d` y la del ojo de ese lado. */
function distanciaOjo(d: Vector3): number {
  const lado = d.x < 0 ? -1 : 1;
  return Math.hypot(d.x - lado * OJO_ZORRO.x, d.y - OJO_ZORRO.y, d.z - OJO_ZORRO.z);
}

function colorCabezaZorro(d: Vector3, out: Color): void {
  // Naranja con la coronilla y la nuca un poco más oscuras.
  mezclarColor(NARANJA, NARANJA_OSCURO, suave(0.4, 1, d.y) * 0.35 + suave(0, -0.9, d.z) * 0.3, out);
  // Zona más clara alrededor de los ojos.
  mezclarColor(out, NARANJA_CLARO, (1 - suave(0.18, 0.36, distanciaOjo(d))) * 0.7, out);
  // Cejas color crema, arqueadas sobre los ojos.
  const ax = Math.abs(d.x);
  const cx = ax - 0.31;
  const cy = d.y - (0.4 - 0.25 * cx * cx * 4);
  const ceja = Math.exp(-((cx / 0.12) ** 2) - ((cy + cx * 0.25) / 0.04) ** 2) * suave(0.5, 0.8, d.z);
  mezclarColor(out, CREMA_CLARA, Math.min(1, ceja * 1.6), out);
  // Máscara crema: hocico, bajo los ojos y la melena de los mofletes, con borde de pelaje.
  const borde = -0.13 - 0.13 * Math.sin(Math.min(1, ax / 0.75) * Math.PI) + 0.13 * suave(0.55, 0.9, ax) + 0.02 * Math.sin(ax * 46);
  const crema = suave(borde + 0.03, borde - 0.03, d.y) * suave(-0.45, -0.05, d.z);
  mezclarColor(out, CREMA, crema, out);
  // Centro del hocico, casi blanco.
  const hocico = Math.exp(-((d.x / 0.22) ** 2) - ((d.y + 0.36) / 0.18) ** 2) * suave(0.7, 0.95, d.z);
  mezclarColor(out, CREMA_CLARA, hocico * 0.8, out);
  // Rubor en las mejillas.
  const rubor = Math.exp(-(((ax - 0.6) / 0.13) ** 2) - ((d.y + 0.2) / 0.08) ** 2) * suave(0.4, 0.75, d.z);
  mezclarColor(out, RUBOR, rubor * 0.45, out);
  // Sombra suave bajo la barbilla (donde la cabeza se apoya en el cuerpo).
  out.multiplyScalar(1 - 0.18 * suave(-0.6, -0.95, d.y));
}

/** Largo del pelo por zona: corto en el hocico y la boca, más largo en la melena de los mofletes. */
function largoPeloZorro(d: Vector3): number {
  const ax = Math.abs(d.x);
  const boca = Math.exp(-((d.x / 0.32) ** 2) - ((d.y + 0.42) / 0.24) ** 2) * suave(0.45, 0.8, d.z);
  const ojos = 1 - suave(0.26, 0.38, distanciaOjo(d));
  const melena = suave(0.6, 0.9, ax) * suave(0.1, -0.4, d.y);
  return Math.max(0, (1 + 0.2 * melena + 0.3 * suave(0.85, 0.97, d.y)) * (1 - boca * 1.2) * (1 - ojos));
}

/** Copia el largo del pelo como atributo de la geometría radial (se recalcula desde la posición). */
function ponerLargoPelo(geo: BufferGeometry, largo: (d: Vector3) => number): void {
  const pos = geo.getAttribute('position');
  const valores = new Float32Array(pos.count);
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) valores[i] = largo(d.fromBufferAttribute(pos, i).normalize());
  geo.setAttribute(ATRIBUTO_LARGO_PELO, new BufferAttribute(valores, 1));
}

const PELO_CABEZA: OpcionesPelaje = { ...PELAJE_PELUCHE, largo: 0.036, densidad: 105, frente: 0.06 };
const PELO_CUERPO: OpcionesPelaje = PELAJE_PELUCHE;
const PELO_COLA: OpcionesPelaje = { ...PELAJE_PELUCHE, largo: 0.07, densidad: 80, caida: 0.02, frente: 0.15 };
const PELO_BRAZO: OpcionesPelaje = { ...PELAJE_PELUCHE, capas: 8, largo: 0.03, densidad: 105 };

class PersonajeZorro extends PersonajeBase {
  private cola!: { tubo: TuboDinamico; radios: number[]; puntos: Vector3[] };
  private cabezaMalla: Mesh | null = null;
  private readonly rasgosModelados: Object3D[] = [];
  private readonly parpados: Mesh[] = [];
  private materialCaraPintada: Material | null = null;
  private materialCaraModelada: Material | null = null;
  private liberado = false;

  constructor(opciones: OpcionesPersonaje) {
    // Con pelo por capas, la superficie base hace de "raíz" (un poco más oscura).
    // Brillo especular bajo y "sheen" anaranjado: el naranjo queda saturado como en las ilustraciones.
    const base = opciones.pelaje ? 0.9 : 1;
    const pelaje = new MeshPhysicalMaterial({
      color: new Color(base, base, base),
      vertexColors: true,
      roughness: 0.85,
      specularIntensity: 0.35,
      sheen: 0.7,
      sheenRoughness: 0.5,
      sheenColor: color('#FFA050'),
    });
    const patita = new MeshPhysicalMaterial({
      color: CAFE,
      roughness: 0.8,
      sheen: 0.8,
      sheenRoughness: 0.5,
      sheenColor: color('#B9805C'),
    });
    const brazo = new MeshPhysicalMaterial({
      color: new Color(base, base, base),
      vertexColors: true,
      roughness: 0.85,
      specularIntensity: 0.35,
      sheen: 0.7,
      sheenRoughness: 0.5,
      sheenColor: color('#FFA050'),
    });
    const hombro = new MeshPhysicalMaterial({
      color: NARANJA.clone().multiplyScalar(base),
      roughness: 0.85,
      specularIntensity: 0.35,
      sheen: 0.7,
      sheenRoughness: 0.5,
      sheenColor: color('#FFA050'),
    });
    super(
      'zorro',
      RIG_ZORRO,
      '#F5791F',
      opciones,
      {
        material: brazo,
        materialHombro: hombro,
        radioHombro: 0.165,
        radio: (t) => 0.165 - 0.035 * t + 0.012 * Math.sin(Math.min(1, t * 1.1) * Math.PI),
        // Antebrazo café oscuro desde el codo, con borde de pelaje (como las "calcetas" del zorrito).
        color: (t, ang, out) => {
          const borde = 0.58 + 0.04 * Math.sin(ang * 7) + 0.02 * Math.sin(ang * 17);
          mezclarColor(NARANJA, CAFE, suave(borde - 0.02, borde + 0.02, t), out);
        },
        pelaje: PELO_BRAZO,
      },
      {
        material: patita,
        almohadillas: new MeshPhysicalMaterial({ color: color('#D98E7C'), roughness: 0.5, clearcoat: 0.25 }),
        unas: null,
        grosorPalma: 1.35,
        radioMuneca: 0.128,
      }
    );
    this.guardar(pelaje);
    this.construirTorso(pelaje);
    this.construirCabeza(pelaje);
    this.construirCola(pelaje);
    this.construirPanuelo();
    this.aplicarOpciones({});
  }

  private construirTorso(pelaje: Material): void {
    const perfil = PERFIL_TORSO_ZORRO;
    // Babero crema con borde de pelaje en V (como el arte del zorrito).
    const bordeBabero = (ang: number) => 1.3 - 0.55 * Math.abs(ang) + 0.045 * Math.sin(ang * 26);
    const crema = (ang: number, y: number) =>
      suave(0.74, 0.64, Math.abs(ang) - 0.06 * suave(0.9, 0.1, y)) * suave(bordeBabero(ang) + 0.03, bordeBabero(ang) - 0.03, y);
    const geo = geometriaTorso(
      perfil,
      0.78,
      (ang, y, out) => {
        mezclarColor(NARANJA, NARANJA_OSCURO, suave(0.4, 3, Math.abs(ang)) * 0.45, out);
        mezclarColor(out, CREMA, crema(ang, y), out);
        // Sombra bajo la cabeza.
        out.multiplyScalar(1 - 0.22 * suave(1.25, 1.6, y));
      },
      (ang, y) => 0.035 * crema(ang, y) * suave(0.55, 1.05, y)
    );
    this.peludo(this.malla(geo, pelaje, this.cuerpo), PELO_CUERPO);
  }

  private construirCabeza(pelaje: Material): void {
    const radio = radioCabezaZorro;
    const geoCabeza = geometriaRadial(radio, colorCabezaZorro, 128, 96, true);
    ponerLargoPelo(geoCabeza, largoPeloZorro);
    const cabeza = this.peludo(this.sinSombraEncima(this.malla(geoCabeza, pelaje, this.cabeza)), PELO_CABEZA);
    this.cabezaMalla = cabeza;

    this.construirOrejas(pelaje);

    // Ojos grandes color chocolate con brillo y delineado grueso.
    // El borde visible del ojo queda a ~0,73 del radio: iris de 0,5 con blanco alrededor, tocando el párpado de arriba.
    const texOjo = texturaOjo({ esclerotica: true, irisClaro: '#A8642E', irisOscuro: '#3A1708', tamanoIris: 0.52, irisArriba: 0.18, brilloDerecha: true });
    const delineado = this.guardar(new MeshStandardMaterial({ color: color('#1E0C04'), roughness: 0.55 }));
    for (const lado of [-1, 1] as const) {
      const ojo = this.crearOjo(radio, new Vector3(lado * OJO_ZORRO.x, OJO_ZORRO.y, OJO_ZORRO.z), 0.265, 0.085, texOjo, {
        material: delineado,
        arriba: 0.1,
        abajo: 0.03,
        lado,
      });
      // Ojos un poco más altos que anchos, como los del zorrito.
      ojo.grupo.userData['escalaY'] = 1.1;
      ojo.grupo.scale.y = 1.1;
    }

    // Nariz grande, negra y brillante en la punta del hocico.
    let mejor = new Vector3(0, -0.3, 1).normalize();
    let mejorZ = -Infinity;
    for (let dy = -0.5; dy <= 0.0; dy += 0.02) {
      const d = new Vector3(0, dy, 1).normalize();
      const z = puntoRadial(radio, d).z;
      if (z > mejorZ) {
        mejorZ = z;
        mejor = d;
      }
    }
    const puntaHocico = puntoRadial(radio, mejor);
    const nariz = new SphereGeometry(1, 36, 24);
    const posN = nariz.getAttribute('position');
    for (let i = 0; i < posN.count; i++) posN.setX(i, posN.getX(i) * (1 + 0.3 * posN.getY(i)));
    nariz.computeVertexNormals();
    const matNariz = this.guardar(new MeshPhysicalMaterial({ color: color('#1B0D08'), roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }));
    const narizMalla = this.malla(nariz, matNariz, this.cabeza, false);
    narizMalla.scale.set(0.165, 0.105, 0.11);
    narizMalla.position.copy(puntaHocico).add(new Vector3(0, 0.05, -0.02));
    this.rasgosModelados.push(narizMalla);

    // Sonrisa abierta con lengüita (el pelo de esa zona es casi nulo para que se vea nítida).
    this.calcomania(
      cabeza,
      radio,
      new Vector3(0, -0.45, 0.88),
      0.46,
      0.52,
      texturaBoca({ abierta: true, linea: '#3B1606', interior: '#8A2A2A', lengua: '#F47E87', filtrum: true })
    );

    // Párpados para la cara pintada: solo se ven mientras parpadea. Color de la piel alrededor
    // del ojo en la ilustración y sin luz de la escena (igual que la cara).
    const texParpado = texturaParpado('#FA8510', '#2A1004');
    for (const lado of [-1, 1]) {
      const p = this.calcomania(cabeza, radio, new Vector3(lado * OJO_ZORRO.x, OJO_ZORRO.y - 0.02, OJO_ZORRO.z), 0.58, 0.58, texParpado, 0, this.cabeza);
      const mat = p.material as MeshStandardMaterial;
      p.material = this.guardar(new MeshBasicMaterial({ map: mat.map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }));
      p.visible = false;
      this.parpados.push(p);
    }
    this.ubicarCabeza({ x: 0, y: 2.3, z: 0.02 });
  }

  /**
   * Cambia la cara modelada por la cara pintada de la ilustración (ojos, cejas,
   * nariz y boca exactamente como el arte de la app). Si la textura no carga,
   * queda la cara modelada.
   */
  async cargarRecursos(): Promise<void> {
    let textura: Texture;
    try {
      textura = await new TextureLoader().loadAsync(RUTA_CARA_ZORRO);
    } catch (e) {
      console.warn('No se pudo cargar la cara del zorrito; se usa la cara modelada.', e);
      return;
    }
    if (this.liberado || !this.cabezaMalla) {
      textura.dispose();
      return;
    }
    textura.colorSpace = SRGBColorSpace;
    textura.anisotropy = 8;
    this.guardar(textura);
    // El arte ya trae su luz y sombra pintadas: la cara se dibuja tal cual (sin la luz de la escena
    // ni tone mapping), así los colores son exactamente los de la ilustración.
    this.materialCaraPintada = this.guardar(new MeshBasicMaterial({ map: textura, toneMapped: false }));
    this.materialCaraModelada = this.cabezaMalla.material as Material;
    // Sin pelo por capas en la cabeza: la ilustración tiene la cara lisa (el pelo sí sigue en cuerpo y cola).
    for (const capa of [...this.cabezaMalla.children]) if (capa.userData['capaPelo']) capa.removeFromParent();
    this.actualizarModoCara();
  }

  override aplicarOpciones(op: Partial<OpcionesPersonaje>): void {
    super.aplicarOpciones(op);
    this.actualizarModoCara();
  }

  /** Cara pintada mientras se muestre el rostro; sin rostro, la cabeza modelada lisa. */
  private get conCaraPintada(): boolean {
    return !!this.materialCaraPintada && this.opciones.mostrarRostro;
  }

  /** Con la cara pintada se ocultan los ojos, la boca y la nariz modelados (los trae la textura). */
  private actualizarModoCara(): void {
    if (!this.cabezaMalla || !this.materialCaraPintada || !this.materialCaraModelada) return;
    const pintada = this.conCaraPintada;
    this.cabezaMalla.material = pintada ? this.materialCaraPintada : this.materialCaraModelada;
    this.rostro.visible = this.opciones.mostrarRostro && !pintada;
    for (const r of this.rasgosModelados) r.visible = !pintada;
  }

  protected override alParpadear(cierre: number): void {
    const cerrado = this.conCaraPintada && cierre > 0.45;
    for (const p of this.parpados) p.visible = cerrado;
  }

  override liberar(): void {
    this.liberado = true;
    super.liberar();
  }

  private construirOrejas(pelaje: Material): void {
    // Orejas grandes: naranja abajo, borde y punta café oscuro, por dentro rosado con pelusa crema.
    const perfilOreja = [
      [0.37, -0.12],
      [0.38, 0.12],
      [0.34, 0.38],
      [0.25, 0.62],
      [0.13, 0.8],
      [0.03, 0.9],
      [0.001, 0.91],
    ].map(([r, y]) => new Vector2(r, y));
    const oreja = new LatheGeometry(perfilOreja, 48);
    const posO = oreja.getAttribute('position');
    const colO = new Float32Array(posO.count * 3);
    const c = new Color();
    for (let i = 0; i < posO.count; i++) {
      const y = posO.getY(i);
      const ang = Math.atan2(posO.getX(i), posO.getZ(i));
      const lateral = Math.abs(Math.sin(ang));
      const atras = suave(0.2, -0.6, Math.cos(ang));
      const punta = 0.48 - 0.22 * lateral - 0.1 * atras + 0.03 * Math.sin(ang * 9);
      mezclarColor(NARANJA, CAFE_OSCURO, suave(punta - 0.05, punta + 0.05, y), c);
      colO.set([c.r, c.g, c.b], i * 3);
    }
    oreja.setAttribute('color', new BufferAttribute(colO, 3));
    oreja.computeVertexNormals();
    const interior = new LatheGeometry(
      [
        [0.24, -0.05],
        [0.24, 0.12],
        [0.2, 0.32],
        [0.12, 0.52],
        [0.03, 0.64],
        [0.001, 0.65],
      ].map(([r, y]) => new Vector2(r, y)),
      36
    );
    const posI = interior.getAttribute('position');
    const colI = new Float32Array(posI.count * 3);
    for (let i = 0; i < posI.count; i++) {
      // Pelusa crema abajo y hacia el lado de la cara; rosado arriba.
      const xI = posI.getX(i);
      mezclarColor(CREMA_CLARA, ROSADO_OREJA, suave(0.1, 0.34, posI.getY(i) + 0.12 * xI), c);
      colI.set([c.r, c.g, c.b], i * 3);
    }
    interior.setAttribute('color', new BufferAttribute(colI, 3));
    const matInterior = this.guardar(new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, sheen: 0.8, sheenColor: color('#FFE6DC') }));
    this.guardar(oreja);
    this.guardar(interior);
    for (const lado of [-1, 1]) {
      const pivote = new Group();
      pivote.position.set(lado * 0.5, 0.46, -0.12);
      pivote.rotation.set(-0.1, lado * 0.12, lado * -0.44, 'YXZ');
      pivote.userData['giroY'] = lado * 0.12;
      const externa = new Mesh(oreja, pelaje);
      externa.scale.set(1, 1, 0.42);
      externa.castShadow = this.opciones.sombras;
      externa.receiveShadow = this.opciones.sombras;
      const interna = new Mesh(interior, matInterior);
      interna.position.set(0, 0.03, 0.32);
      interna.scale.set(1, 1, 0.5);
      externa.add(interna);
      pivote.add(externa);
      this.cabeza.add(pivote);
      this.orejas.push(pivote);
      this.peludo(externa, { ...PELO_CABEZA, capas: 8, largo: 0.05 });
    }
  }

  private construirCola(pelaje: Material): void {
    const anillos = 32;
    const tubo = new TuboDinamico(anillos, 24, (t, ang, out) => {
      const borde = 0.66 + 0.035 * Math.sin(ang * 8) + 0.015 * Math.sin(ang * 19);
      mezclarColor(NARANJA, CREMA_CLARA, suave(borde - 0.03, borde + 0.03, t), out);
    });
    // Cola grande y esponjosa, terminada en punta.
    const radios = Array.from({ length: anillos }, (_, i) => {
      const t = i / (anillos - 1);
      return 0.05 + 0.37 * Math.pow(Math.sin(Math.min(1, t * 1.06) * Math.PI * 0.92 + 0.08), 1.15) * (1 - t * 0.2);
    });
    const m = new Mesh(tubo.geometria, pelaje);
    m.frustumCulled = false;
    m.castShadow = this.opciones.sombras;
    m.receiveShadow = this.opciones.sombras;
    this.cuerpo.add(m);
    this.peludo(m, PELO_COLA);
    this.guardar(tubo.geometria);
    this.cola = { tubo, radios, puntos: [] };
    this.animar(0);
  }

  private construirPanuelo(): void {
    const tela = this.guardar(
      new MeshPhysicalMaterial({ color: color('#2A62D8'), roughness: 0.66, sheen: 0.7, sheenRoughness: 0.5, sheenColor: color('#A9C6FF') })
    );
    const rollo = this.malla(new TorusGeometry(0.36, 0.09, 18, 56), tela, this.accesorios);
    rollo.rotation.x = Math.PI / 2 - 0.12;
    rollo.scale.set(1.1, 0.95, 1);
    rollo.position.set(0, 1.55, 0.02);

    // Triángulo del pañuelo sobre el pecho, con la punta un poco ladeada.
    const forma = new Shape();
    forma.moveTo(-0.34, 0);
    forma.quadraticCurveTo(0, 0.05, 0.34, 0);
    forma.quadraticCurveTo(0.17, -0.26, 0.05, -0.46);
    forma.quadraticCurveTo(0.02, -0.5, -0.02, -0.46);
    forma.quadraticCurveTo(-0.17, -0.26, -0.34, 0);
    const triangulo = this.malla(
      new ExtrudeGeometry(forma, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 18 }),
      tela,
      this.accesorios
    );
    triangulo.position.set(0, 1.54, 0.36);
    triangulo.rotation.set(-0.32, 0, 0.06);

    // Insignia con la carita del zorrito.
    const insignia = new CylinderGeometry(0.085, 0.085, 0.024, 48);
    const tex = this.guardar(texturaInsignia());
    const lateral = this.guardar(new MeshStandardMaterial({ color: color('#E9C77A'), roughness: 0.35, metalness: 0.6 }));
    const frente = this.guardar(new MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    this.guardar(insignia);
    const pin = new Mesh(insignia, [lateral, frente, lateral]);
    pin.rotation.set(Math.PI / 2 - 0.32, 0, 0);
    pin.position.set(0.01, 1.39, 0.5);
    pin.castShadow = this.opciones.sombras;
    this.accesorios.add(pin);
  }

  protected override animar(t: number): void {
    if (!this.cola) return;
    const vaiven = Math.sin(t * 1.6) * 0.09;
    const control = [
      new Vector3(-0.2, 0.05, -0.32),
      new Vector3(-0.72, 0.05 + vaiven * 0.3, -0.38),
      new Vector3(-1.12, 0.45 + vaiven * 0.6, -0.34),
      new Vector3(-1.2 + vaiven * 0.5, 1.0, -0.22),
      new Vector3(-1.0 + vaiven, 1.4, -0.12),
    ];
    muestrearCurva(control, this.cola.radios.length, this.cola.puntos);
    this.cola.tubo.actualizar(this.cola.puntos, this.cola.radios, new Vector3(0, 0, 1));
  }
}

// ---------------------------------------------------------------------------
// Personas (amigable y alto contraste)
// ---------------------------------------------------------------------------

interface EstiloPersona {
  tema: 'persona' | 'cyber';
  aura: string;
  piel: string;
  pelo: string;
  ropa: string;
  ropaOscura: string;
  /** Peinado: 'melena' (con flequillo) o 'corto'. */
  peinado: 'melena' | 'corto';
  capucha: boolean;
  /** Brillo extra en las manos (alto contraste). */
  brilloManos: number;
  /** Color claro del iris. */
  iris: string;
  acento: string | null;
}

function radioCabezaPersona(d: Vector3): number {
  let r = 1 / Math.sqrt((d.x / 0.78) ** 2 + (d.y / 0.86) ** 2 + (d.z / 0.8) ** 2);
  // Mentón más angosto y mejillas redondas.
  r *= 1 - 0.1 * suave(-0.35, -0.95, d.y) * Math.abs(d.x);
  r += 0.03 * Math.exp(-(((Math.abs(d.x) - 0.5) / 0.2) ** 2) - ((d.y + 0.2) / 0.2) ** 2) * suave(0.3, 0.8, d.z);
  // Nariz pequeña.
  r += 0.07 * Math.exp(-((d.x / 0.09) ** 2) - ((d.y + 0.08) / 0.12) ** 2) * suave(0.85, 1, d.z);
  return r;
}

/** Línea del pelo (ángulo desde la coronilla) según hacia dónde se mire (φ = 0 al frente). */
function bordePelo(peinado: 'melena' | 'corto'): (phi: number) => number {
  const frente = peinado === 'melena' ? 1.2 : 1.0;
  const lados = peinado === 'melena' ? 1.95 : 1.5;
  const nuca = peinado === 'melena' ? 2.05 : 1.95;
  return (phi: number) => {
    const a = Math.abs(phi);
    let b = frente + (lados - frente) * suave(0.32, 1.25, a) + (nuca - lados) * suave(1.7, 2.8, a);
    if (peinado === 'melena') {
      // Flequillo de mechones redondeados, un poco cargado hacia un lado.
      b += 0.07 * Math.pow(Math.abs(Math.sin(phi * 5 + 0.6)), 0.6) * (1 - suave(0.45, 0.85, a)) - 0.08 * suave(0.2, -0.5, phi) * (1 - suave(0.5, 0.9, a));
    }
    return b;
  };
}

function grosorPelo(peinado: 'melena' | 'corto'): (theta: number, phi: number) => number {
  return (theta: number) =>
    peinado === 'melena' ? 0.07 + 0.05 * Math.cos(theta * 0.8) ** 2 + 0.16 * suave(1.25, 2.0, theta) : 0.045 + 0.04 * Math.cos(theta * 0.7) ** 2;
}

class PersonajePersona extends PersonajeBase {
  constructor(opciones: OpcionesPersonaje, private readonly e: EstiloPersona) {
    const piel = new MeshPhysicalMaterial({
      color: color(e.piel),
      roughness: 0.55,
      sheen: 0.35,
      sheenColor: color('#FFD9C7'),
      emissive: color(e.piel),
      emissiveIntensity: e.brilloManos,
    });
    const manga = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.78,
      sheen: 0.6,
      sheenRoughness: 0.6,
      sheenColor: color('#FFFFFF').lerp(color(e.ropa), 0.4),
      side: DoubleSide,
    });
    const hombro = new MeshPhysicalMaterial({ color: color(e.ropa), roughness: 0.78, sheen: 0.6, sheenColor: color('#FFFFFF').lerp(color(e.ropa), 0.4) });
    const ropa = color(e.ropa);
    const puno = color(e.ropaOscura);
    super(
      e.tema,
      RIG_PERSONA,
      e.aura,
      opciones,
      {
        material: manga,
        materialHombro: hombro,
        radioHombro: 0.165,
        radio: (t) => 0.15 - 0.022 * t + 0.016 * suave(0.86, 0.9, t) * suave(0.99, 0.95, t),
        color: (t, _ang, out) => mezclarColor(ropa, puno, suave(0.85, 0.88, t), out),
      },
      {
        material: piel,
        almohadillas: null,
        unas: new MeshPhysicalMaterial({ color: color('#FBE3DA'), roughness: 0.25, clearcoat: 0.8 }),
        grosorPalma: 1.25,
        radioMuneca: 0.072,
      }
    );
    const pielCabeza = this.guardar(new MeshPhysicalMaterial({ color: color(e.piel), roughness: 0.55, sheen: 0.35, sheenColor: color('#FFD9C7') }));
    this.construirTorso();
    this.construirCabeza(pielCabeza);
    this.aplicarOpciones({});
  }

  private construirTorso(): void {
    const e = this.e;
    const ropa = color(e.ropa);
    const oscura = color(e.ropaOscura);
    const perfil: [number, number][] = [
      [0.6, -0.7],
      [0.62, -0.3],
      [0.63, 0.15],
      [0.62, 0.6],
      [0.6, 0.95],
      [0.56, 1.14],
      [0.48, 1.28],
      [0.34, 1.4],
      [0.2, 1.47],
      [0.001, 1.5],
    ];
    const matRopa = this.guardar(
      new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.8, sheen: 0.6, sheenRoughness: 0.6, sheenColor: color('#FFFFFF').lerp(ropa, 0.4) })
    );
    const geo = geometriaTorso(perfil, 0.74, (ang, y, out) => {
      out.copy(ropa);
      if (e.capucha) {
        // Bolsillo canguro.
        const bolsillo = suave(0.62, 0.55, Math.abs(ang)) * suave(-0.05, 0.02, y) * suave(0.5, 0.43, y);
        mezclarColor(out, oscura, bolsillo * 0.55, out);
      }
    });
    this.malla(geo, matRopa, this.cuerpo);

    const pielCuello = this.guardar(new MeshPhysicalMaterial({ color: color(e.piel), roughness: 0.6 }));
    const cuello = this.malla(new CylinderGeometry(0.16, 0.19, 0.4, 32), pielCuello, this.cuerpo);
    cuello.position.set(0, 1.58, 0);

    if (e.capucha) {
      const matCapucha = this.guardar(new MeshPhysicalMaterial({ color: oscura, roughness: 0.8, sheen: 0.5, sheenColor: color('#FFFFFF').lerp(ropa, 0.5) }));
      // Capucha: un rollo grueso por detrás del cuello, abierto adelante.
      const arco = Math.PI * 1.35;
      const capucha = this.malla(new TorusGeometry(0.4, 0.11, 20, 56, arco), matCapucha, this.accesorios);
      capucha.rotation.set(Math.PI / 2 + 0.3, 0, Math.PI / 2 + (Math.PI * 2 - arco) / 2);
      capucha.position.set(0, 1.36, -0.08);
      capucha.scale.set(1.15, 1, 0.9);
      const cordon = this.guardar(new MeshPhysicalMaterial({ color: color('#F4F0E8'), roughness: 0.6 }));
      for (const lado of [-1, 1]) {
        const c = this.malla(new CapsuleGeometry(0.014, 0.3, 4, 8), cordon, this.accesorios);
        c.position.set(lado * 0.11, 1.26, 0.44);
        c.rotation.x = -0.18;
      }
    }
    if (e.acento) {
      const matAcento = this.guardar(new MeshPhysicalMaterial({ color: color(e.acento), roughness: 0.5, emissive: color(e.acento), emissiveIntensity: 0.25 }));
      const cuelloRopa = this.malla(new TorusGeometry(0.22, 0.035, 12, 40), matAcento, this.accesorios);
      cuelloRopa.rotation.x = Math.PI / 2 - 0.2;
      cuelloRopa.position.set(0, 1.45, 0.02);
    }
  }

  private construirCabeza(piel: Material): void {
    const e = this.e;
    const radio = radioCabezaPersona;
    const cabeza = this.sinSombraEncima(this.malla(geometriaRadial(radio, null, 96, 72), piel, this.cabeza));

    for (const lado of [-1, 1]) {
      const oreja = this.malla(new SphereGeometry(1, 20, 14), piel, this.cabeza);
      oreja.scale.set(0.1, 0.16, 0.07);
      oreja.position.set(lado * 0.76, -0.02, -0.04);
      oreja.rotation.y = lado * 0.3;
    }

    const matPelo = this.guardar(
      new MeshPhysicalMaterial({
        map: this.guardar(texturaPelo(e.pelo)),
        roughness: 0.6,
        envMapIntensity: 0.6,
        sheen: 0.8,
        sheenRoughness: 0.35,
        sheenColor: color('#FFFFFF').lerp(color(e.pelo), 0.5),
      })
    );
    this.sinSombraEncima(this.malla(geometriaCasquete(radio, bordePelo(e.peinado), grosorPelo(e.peinado)), matPelo, this.cabeza));
    if (e.peinado === 'corto' && e.tema === 'cyber') {
      // Moño alto.
      const mono = this.malla(new SphereGeometry(0.26, 28, 20), matPelo, this.cabeza);
      mono.position.set(0, 0.86, -0.32);
    }

    // Ojos grandes y expresivos: blanco, iris de color con brillo y delineado con pestañita.
    const texOjo = texturaOjo({ esclerotica: true, irisClaro: e.iris, irisOscuro: '#24140C', tamanoIris: 0.6, irisArriba: 0.12, brilloDerecha: true });
    const delineado = this.guardar(new MeshStandardMaterial({ color: color('#1E120C'), roughness: 0.55 }));
    for (const lado of [-1, 1] as const) {
      const ojo = this.crearOjo(radio, new Vector3(lado * 0.31, 0.0, 0.95), 0.15, 0.06, texOjo, { material: delineado, arriba: 0.13, abajo: 0.03, lado });
      ojo.grupo.scale.set(1, 1.12, 1);
      ojo.grupo.userData['escalaY'] = 1.12;
    }
    this.calcomania(
      cabeza,
      radio,
      new Vector3(0, -0.42, 0.9),
      0.24,
      0.2,
      texturaBoca({ abierta: true, linea: '#5A2A1E', interior: '#8E3B3B', lengua: '#F48A8A' })
    );
    for (const lado of [-1, 1]) {
      this.calcomania(cabeza, radio, new Vector3(lado * 0.5, -0.2, 0.84), 0.22, 0.14, texturaMancha('#FF8B7E', 0.45));
      this.calcomania(cabeza, radio, new Vector3(lado * 0.32, 0.27, 0.92), 0.2, 0.1, texturaCeja(e.pelo), lado * -0.12);
    }
    this.ubicarCabeza({ x: 0, y: 2.28, z: 0 });
  }
}

// ---------------------------------------------------------------------------
// Maniquí translúcido (para revisar el rig)
// ---------------------------------------------------------------------------

class PersonajeManiqui extends PersonajeBase {
  constructor(opciones: OpcionesPersonaje) {
    const vidrio = () =>
      new MeshPhysicalMaterial({
        color: color('#8FB8FF'),
        roughness: 0.25,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        clearcoat: 1,
      });
    const huesoMano = new MeshPhysicalMaterial({ color: color('#DDF3FF'), roughness: 0.35, emissive: color('#3FD8FF'), emissiveIntensity: 0.35 });
    super(
      'huesos',
      RIG_PERSONA,
      '#2EC8FF',
      { ...opciones, sombras: false },
      { material: vidrio(), materialHombro: vidrio(), radioHombro: 0.15, radio: (t) => 0.13 - 0.03 * t },
      { material: huesoMano, almohadillas: null, unas: null, grosorPalma: 1.1, radioMuneca: 0.07 }
    );
    const cuerpo = this.guardar(vidrio());
    this.malla(
      geometriaTorso(
        [
          [0.58, -0.7],
          [0.6, 0.2],
          [0.6, 0.9],
          [0.5, 1.25],
          [0.3, 1.45],
          [0.001, 1.5],
        ],
        0.7,
        (_a, _y, out) => out.set(1, 1, 1)
      ),
      cuerpo,
      this.cuerpo,
      false
    );
    const cuello = this.malla(new CylinderGeometry(0.15, 0.18, 0.4, 24), cuerpo, this.cuerpo, false);
    cuello.position.set(0, 1.58, 0);
    this.malla(geometriaRadial(radioCabezaPersona, null, 64, 48), cuerpo, this.cabeza, false);
    this.ubicarCabeza({ x: 0, y: 2.28, z: 0 });
    this.aplicarOpciones({});
  }
}

// ---------------------------------------------------------------------------

export function crearPersonaje(tema: TemaAvatar, opciones: OpcionesPersonaje): Personaje {
  switch (tema) {
    case 'zorro':
      return new PersonajeZorro(opciones);
    case 'persona':
      return new PersonajePersona(opciones, {
        tema: 'persona',
        aura: '#2CA6A4',
        piel: '#F2C3A0',
        pelo: '#3B2417',
        ropa: '#2CA6A4',
        ropaOscura: '#1E7F7D',
        peinado: 'melena',
        capucha: true,
        brilloManos: 0,
        acento: null,
        iris: '#7A4A2A',
      });
    case 'cyber':
      return new PersonajePersona(opciones, {
        tema: 'cyber',
        aura: '#3D6BFF',
        piel: '#C98B66',
        pelo: '#17141A',
        ropa: '#223150',
        ropaOscura: '#18233A',
        peinado: 'corto',
        capucha: false,
        brilloManos: 0.12,
        acento: '#F2701A',
        iris: '#5C7F3E',
      });
    case 'huesos':
    default:
      return new PersonajeManiqui(opciones);
  }
}
