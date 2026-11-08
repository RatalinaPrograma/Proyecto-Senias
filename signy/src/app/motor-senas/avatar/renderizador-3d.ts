/**
 * Avatar 3D de señas (three.js): escena, luces de estudio, cámara y bucle de
 * dibujo. La pose sale de `CinematicaAvatar` y el personaje de
 * `crearPersonaje`.
 *
 * Este archivo importa three.js (~150 KB comprimido): cárgalo con
 * `import('.../avatar/renderizador-3d')` solo en la pantalla que lo muestra,
 * para no sumarlo al resto de la app.
 *
 * Uso:
 *   const avatar = new RenderizadorAvatar3D(canvas, { tema: 'zorro' });
 *   // en cada requestAnimationFrame:
 *   avatar.renderizar(manos, { aspecto: ancho / alto, lateralidad });
 *   // al salir:
 *   avatar.liberar();
 */
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG_AVATAR_PREDETERMINADA, ConfiguracionAvatar } from './config';
import { CinematicaAvatar, OpcionesCuadro, PADRE_LANDMARK, PoseAvatar, PoseBrazo } from './cinematica';
import { Personaje, crearPersonaje } from './personajes';
import { rigDeTema } from './rig';
import { texturaAura } from './geometria';

/** Huesos del rig dibujados encima del personaje (hombro → codo → muñeca y los 20 huesos de cada mano). */
class GuiaEsqueleto {
  readonly lineas: LineSegments;
  readonly juntas: InstancedMesh;
  private readonly posiciones: Float32Array;
  private readonly matriz = new Matrix4();

  constructor() {
    const segmentos = 2 * (2 + 20);
    this.posiciones = new Float32Array(segmentos * 2 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.posiciones, 3));
    this.lineas = new LineSegments(
      geo,
      new LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false })
    );
    this.lineas.frustumCulled = false;
    this.lineas.renderOrder = 999;
    this.juntas = new InstancedMesh(
      new SphereGeometry(0.022, 10, 8),
      new MeshBasicMaterial({ color: 0x00f0ff, depthTest: false, toneMapped: false }),
      2 * (3 + 21)
    );
    this.juntas.frustumCulled = false;
    this.juntas.renderOrder = 1000;
  }

  set visible(v: boolean) {
    this.lineas.visible = v;
    this.juntas.visible = v;
  }

  actualizar(pose: PoseAvatar): void {
    let k = 0;
    let j = 0;
    const segmento = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      this.posiciones.set([a.x, a.y, a.z, b.x, b.y, b.z], k);
      k += 6;
    };
    const junta = (p: { x: number; y: number; z: number }) => {
      this.juntas.setMatrixAt(j++, this.matriz.makeTranslation(p.x, p.y, p.z));
    };
    for (const b of [pose.izq, pose.der] as PoseBrazo[]) {
      segmento(b.hombro, b.codo);
      segmento(b.codo, b.muneca);
      for (let i = 1; i < 21; i++) segmento(b.mano[PADRE_LANDMARK[i]], b.mano[i]);
      junta(b.hombro);
      junta(b.codo);
      junta(b.muneca);
      for (const p of b.mano) junta(p);
    }
    this.lineas.geometry.getAttribute('position').needsUpdate = true;
    this.juntas.instanceMatrix.needsUpdate = true;
  }

  liberar(): void {
    this.lineas.geometry.dispose();
    (this.lineas.material as LineBasicMaterial).dispose();
    this.juntas.geometry.dispose();
    (this.juntas.material as MeshBasicMaterial).dispose();
  }
}

export class RenderizadorAvatar3D {
  private readonly renderer: WebGLRenderer;
  private readonly escena = new Scene();
  private readonly camara = new PerspectiveCamera(28, 1, 0.1, 60);
  private readonly cinematica: CinematicaAvatar;
  private readonly luzClave: DirectionalLight;
  private readonly guia = new GuiaEsqueleto();
  private readonly aura: Mesh;
  private readonly entorno: Texture;
  private personaje: Personaje;
  private config: ConfiguracionAvatar;
  private ancho = 0;
  private alto = 0;
  private tAnterior: number | null = null;

  /** Lanza un error si el dispositivo no tiene WebGL. */
  constructor(private readonly canvas: HTMLCanvasElement, config: Partial<ConfiguracionAvatar> = {}) {
    this.config = { ...CONFIG_AVATAR_PREDETERMINADA, ...config };
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    // Reflejos suaves de "estudio" (brillo de ojos y nariz, relleno ambiental).
    const pmrem = new PMREMGenerator(this.renderer);
    const sala = new RoomEnvironment();
    this.entorno = pmrem.fromScene(sala, 0.04).texture;
    sala.dispose();
    pmrem.dispose();
    this.escena.environment = this.entorno;
    this.escena.environmentIntensity = 0.22;

    // Luz de tres puntos: principal cálida, relleno frío y contraluces que recortan la silueta.
    // El color de "suelo" es la luz cálida que rebota desde el cuerpo: aclara el mentón y bajo el hocico.
    this.escena.add(new HemisphereLight(0xfff2e4, 0x6a5444, 0.5));
    // Intensidades moderadas: los tonos quedan bajo el punto en que el tone mapping los blanquea (naranjo saturado).
    this.luzClave = new DirectionalLight(0xfff0e0, 2.5);
    this.luzClave.position.set(-3, 4.6, 4.6);
    this.luzClave.target.position.set(0, 1.6, 0);
    const sombra = this.luzClave.shadow;
    sombra.mapSize.set(1024, 1024);
    Object.assign(sombra.camera, { left: -2.3, right: 2.3, top: 2.6, bottom: -2.4, near: 2, far: 14 });
    sombra.bias = -0.0004;
    sombra.normalBias = 0.025;
    sombra.radius = 5;
    sombra.intensity = 0.7;
    this.escena.add(this.luzClave, this.luzClave.target);
    const relleno = new DirectionalLight(0xd4e2ff, 0.45);
    relleno.position.set(3.6, 1.6, 3.2);
    const contra1 = new DirectionalLight(0xffe2c4, 2.1);
    contra1.position.set(3, 3.8, -4.5);
    const contra2 = new DirectionalLight(0xcfe8ff, 1.1);
    contra2.position.set(-3.4, 2.6, -4);
    this.escena.add(relleno, contra1, contra2);

    this.aura = new Mesh(
      new PlaneGeometry(5.6, 5.6),
      new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
    );
    this.aura.position.set(0, 1.85, -1.6);
    this.aura.renderOrder = -1;
    this.escena.add(this.aura);
    this.escena.add(this.guia.lineas, this.guia.juntas);

    this.cinematica = new CinematicaAvatar(rigDeTema(this.config.tema));
    this.cinematica.configurar({ tamanoManos: this.config.tamanoManos, suavizado: this.config.suavizado });
    this.personaje = this.crearPersonaje();
    this.aplicarCalidad();
    this.aplicarVisibilidad();
  }

  obtenerConfig(): ConfiguracionAvatar {
    return { ...this.config };
  }

  actualizarConfig(nueva: Partial<ConfiguracionAvatar>): void {
    const antes = this.config;
    this.config = { ...this.config, ...nueva };
    const c = this.config;
    this.cinematica.configurar({ tamanoManos: c.tamanoManos, suavizado: c.suavizado });
    if (c.tema !== antes.tema || c.calidad !== antes.calidad) {
      this.personaje.liberar();
      this.cinematica.cambiarRig(rigDeTema(c.tema));
      this.personaje = this.crearPersonaje();
      this.aplicarCalidad();
    } else {
      this.personaje.aplicarOpciones({ mostrarRostro: c.mostrarRostro, mostrarAccesorios: c.mostrarAccesorios, tamanoManos: c.tamanoManos });
    }
    this.aplicarVisibilidad();
  }

  /** Olvida el movimiento anterior (al cambiar de fuente o de muestra). */
  reiniciar(): void {
    this.cinematica.reiniciar();
    this.tAnterior = null;
  }

  /**
   * Dibuja un cuadro. `manos`: landmarks de MediaPipe (coordenadas normalizadas
   * de imagen) de 0, 1 o 2 manos.
   */
  renderizar(manos: { x: number; y: number; z?: number }[][], opciones: OpcionesCuadro & { ahora?: number } = {}): PoseAvatar {
    const ahora = opciones.ahora ?? performance.now();
    const dt = this.tAnterior === null ? 1 / 60 : Math.min(0.1, Math.max(0, (ahora - this.tAnterior) / 1000));
    this.tAnterior = ahora;
    this.ajustarTamano();
    const pose = this.cinematica.actualizar(manos, ahora, opciones);
    this.personaje.actualizar(pose, ahora / 1000, dt);
    if (this.config.mostrarEsqueletoGuia || this.config.tema === 'huesos') this.guia.actualizar(pose);
    this.renderer.render(this.escena, this.camara);
    return pose;
  }

  liberar(): void {
    this.personaje.liberar();
    this.guia.liberar();
    this.aura.geometry.dispose();
    const mat = this.aura.material as MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.entorno.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private crearPersonaje(): Personaje {
    const c = this.config;
    const p = crearPersonaje(c.tema, {
      mostrarRostro: c.mostrarRostro,
      mostrarAccesorios: c.mostrarAccesorios,
      sombras: c.calidad === 'alta',
      pelaje: c.calidad === 'alta',
      tamanoManos: c.tamanoManos,
    });
    this.escena.add(p.raiz);
    void p.cargarRecursos?.();
    const mat = this.aura.material as MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = texturaAura(p.colorAura);
    mat.needsUpdate = true;
    return p;
  }

  private aplicarCalidad(): void {
    const alta = this.config.calidad === 'alta';
    this.renderer.shadowMap.enabled = alta;
    this.luzClave.castShadow = alta;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, alta ? 2 : 1.5));
    this.ancho = 0; // fuerza a recalcular el tamaño
  }

  private aplicarVisibilidad(): void {
    this.aura.visible = this.config.mostrarAura;
    this.guia.visible = this.config.mostrarEsqueletoGuia || this.config.tema === 'huesos';
  }

  /** Ajusta el lienzo a su tamaño en pantalla y encuadra al personaje de la cintura hacia arriba. */
  private ajustarTamano(): void {
    const ancho = this.canvas.clientWidth || this.canvas.width || 400;
    const alto = this.canvas.clientHeight || this.canvas.height || 300;
    if (ancho === this.ancho && alto === this.alto) return;
    this.ancho = ancho;
    this.alto = alto;
    this.renderer.setSize(ancho, alto, false);
    const aspecto = ancho / alto;
    this.camara.aspect = aspecto;
    const mitadFov = (this.camara.fov * Math.PI) / 360;
    // Cuadro: de la barriga (y ≈ 0,3) a la punta de las orejas, y manos estiradas a los lados.
    const centro = new Vector3(0, 1.92, 0);
    const distancia = Math.max(1.64 / Math.tan(mitadFov), 1.9 / (Math.tan(mitadFov) * aspecto));
    this.camara.position.set(0, centro.y + 0.2, distancia + 0.6);
    this.camara.lookAt(centro);
    this.camara.updateProjectionMatrix();
  }
}
