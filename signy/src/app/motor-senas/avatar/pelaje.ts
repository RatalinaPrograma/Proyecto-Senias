/**
 * Pelaje por capas ("shell fur", la técnica de los juegos para pelo y pasto):
 * la misma malla se dibuja varias veces, cada capa un poco más afuera a lo
 * largo de la normal, y en cada capa solo quedan los puntos que pertenecen a
 * una hebra. Las hebras se adelgazan hacia la punta y la raíz es más oscura,
 * así el peluche tiene volumen y el borde se ve esponjoso, como el zorrito
 * de las ilustraciones.
 *
 * Las capas comparten la geometría con la malla base: si la geometría se
 * actualiza en cada cuadro (brazos, cola), el pelo la sigue sin costo extra.
 *
 * Si la geometría trae el atributo `largoPelo` (0..1+), el pelo se acorta
 * donde haga falta (hocico, boca, alrededor de los ojos).
 */
import { BufferGeometry, Color, Material, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';

export interface OpcionesPelaje {
  /** Cantidad de capas (más = más suave, más costo). */
  capas: number;
  /** Largo del pelo, en unidades del avatar. */
  largo: number;
  /** Hebras por unidad de largo (más = pelo más fino). */
  densidad: number;
  /** Grosor de la hebra en la raíz (fracción de la celda, 0..0.5). */
  grosor: number;
  /** Cuánto se inclina la punta hacia abajo (gravedad). */
  caida: number;
  /** Brillo de la raíz (0 = negra, 1 = igual que la punta). */
  raiz: number;
  /**
   * Cuánto pelo se ve en las zonas que miran de frente a la cámara (0..1). El
   * pelo se nota sobre todo en el borde de la silueta; de frente, poco pelo
   * evita el aspecto "granulado" y deja la superficie suave como en las
   * ilustraciones.
   */
  frente: number;
  roughness?: number;
}

export const PELAJE_PELUCHE: OpcionesPelaje = { capas: 10, largo: 0.045, densidad: 95, grosor: 0.5, caida: 0.01, raiz: 0.82, frente: 0.18 };

/** Nombre del atributo de geometría que acorta el pelo por zonas. */
export const ATRIBUTO_LARGO_PELO = 'largoPelo';

function materialCapa(
  capa: number,
  op: OpcionesPelaje,
  conColores: boolean,
  conLargo: boolean,
  color: Color,
  mapa: Texture | null
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color,
    map: mapa,
    vertexColors: conColores && !mapa,
    roughness: op.roughness ?? 0.9,
    alphaToCoverage: true,
  });
  const uniforms = {
    uFurCapa: { value: capa },
    uFurLargo: { value: op.largo },
    uFurCaida: { value: op.caida },
    uFurDensidad: { value: op.densidad },
    uFurGrosor: { value: op.grosor },
    uFurRaiz: { value: op.raiz },
    uFurFrente: { value: op.frente },
  };
  if (conLargo) mat.defines = { ...(mat.defines ?? {}), USE_LARGO_PELO: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFurCapa;
        uniform float uFurLargo;
        uniform float uFurCaida;
        varying vec3 vFurBase;
        varying float vFurLargo;
        #ifdef USE_LARGO_PELO
          attribute float ${ATRIBUTO_LARGO_PELO};
        #endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFurBase = position;
        #ifdef USE_LARGO_PELO
          vFurLargo = ${ATRIBUTO_LARGO_PELO};
        #else
          vFurLargo = 1.0;
        #endif
        transformed += normalize(objectNormal) * (uFurLargo * uFurCapa * vFurLargo);
        transformed.y -= uFurCaida * uFurCapa * uFurCapa * vFurLargo;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFurCapa;
        uniform float uFurDensidad;
        uniform float uFurGrosor;
        uniform float uFurRaiz;
        uniform float uFurFrente;
        varying vec3 vFurBase;
        varying float vFurLargo;
        float furHash(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Dominio girado: la grilla de celdas no queda alineada con los ejes (sin patrones de moiré).
          vec3 q = mat3(0.788, -0.394, 0.473, 0.577, 0.718, -0.389, -0.186, 0.574, 0.797) * vFurBase * uFurDensidad;
          vec3 celda = floor(q);
          float h = furHash(celda);
          vec3 jitter = vec3(furHash(celda + 17.1), furHash(celda + 31.7), furHash(celda + 53.3)) - 0.5;
          float d = length(fract(q) - 0.5 - jitter * 0.4);
          // Cada hebra tiene su largo (h) y se adelgaza hacia la punta.
          float punta = uFurCapa / max(0.35, 0.4 + 0.6 * h);
          float radio = uFurGrosor * (1.0 - punta);
          float hebra = (1.0 - smoothstep(radio - 0.12, radio, d)) * step(punta, 1.0) * step(0.03, vFurLargo);
          // Más pelo en el borde de la silueta que de frente.
          float deFrente = abs(dot(normalize(vNormal), normalize(vViewPosition)));
          hebra *= mix(1.0, uFurFrente, smoothstep(0.3, 0.75, deFrente));
          if (hebra < 0.02) discard;
          diffuseColor.a = hebra;
          // Raíz más oscura y punta un poco más clara (el pelo atrapa la luz).
          diffuseColor.rgb *= mix(uFurRaiz, 1.1, uFurCapa);
        }`
      );
  };
  mat.customProgramCacheKey = () => `pelaje-${conColores && !mapa}-${conLargo}-${!!mapa}`;
  return mat;
}

/**
 * Agrega las capas de pelo a `base` (como hijas, comparten su geometría).
 * Con `mapa`, el pelo toma el color de la textura (cara pintada del zorrito).
 * Devuelve los materiales creados para liberarlos después.
 */
export function agregarPelaje(base: Mesh, op: OpcionesPelaje, color = new Color(1, 1, 1), mapa: Texture | null = null): Material[] {
  const geo: BufferGeometry = base.geometry;
  const conColores = !!geo.getAttribute('color');
  const conLargo = !!geo.getAttribute(ATRIBUTO_LARGO_PELO);
  const materiales: Material[] = [];
  for (let i = 1; i <= op.capas; i++) {
    const mat = materialCapa(i / op.capas, op, conColores, conLargo, color, mapa);
    const capa = new Mesh(geo, mat);
    capa.frustumCulled = base.frustumCulled;
    capa.receiveShadow = base.receiveShadow;
    capa.castShadow = false;
    capa.renderOrder = i;
    capa.raycast = () => undefined;
    capa.userData['capaPelo'] = true;
    (base as Object3D).add(capa);
    materiales.push(mat);
  }
  return materiales;
}
