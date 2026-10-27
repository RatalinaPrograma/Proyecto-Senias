import {
  ANCLA_ROSTRO_PREDETERMINADA,
  AsignadorManos,
  CinematicaAvatar,
  ESTIRAMIENTO_MAX,
  EspacioSenas,
  FiltroUnEuro,
  PADRE_LANDMARK,
  PoseAvatar,
  REFERENCIA_HUMANA,
  V3,
  centroPalma,
  desplazamientoFuera,
  distancia,
  interpoladorMonotono,
  ladoDeEtiqueta,
  resolverBrazo,
  retargetMano,
  v3,
} from './cinematica';
import { RIG_PERSONA, RIG_ZORRO } from './rig';
import { POSES, Pose, generarCaptura, manoLocal } from '../testing/manos-sinteticas';
import { Lateralidad, Punto3D } from '../tipos';

const ASPECTO = 4 / 3;

/**
 * Mano sintética (coordenadas normalizadas de imagen, como MediaPipe) con el
 * centro de la palma a (ux, uy) tamaños de palma de la cara.
 * Por defecto es una mano DERECHA con la palma hacia la cámara.
 */
function manoEn(ux: number, uy: number, o: { pose?: Pose; tamano?: number; izquierda?: boolean } = {}): Punto3D[] {
  const t = o.tamano ?? 0.17;
  const local = manoLocal(o.pose ?? POSES.palma);
  const c = centroPalma(local);
  const cx = ANCLA_ROSTRO_PREDETERMINADA.x * ASPECTO + ux * t;
  const cy = ANCLA_ROSTRO_PREDETERMINADA.y + uy * t;
  const espejo = o.izquierda ? -1 : 1;
  return local.map((p) => ({ x: (cx + (p.x - c.x) * t * espejo) / ASPECTO, y: cy + (p.y - c.y) * t, z: (p.z * t) / ASPECTO }));
}

/** Corre la cinemática ~1 s con las mismas manos (para que se asiente el filtro y la transición). */
function asentar(c: CinematicaAvatar, manos: Punto3D[][], lateralidad?: Lateralidad[], espejado = false): PoseAvatar {
  let pose!: PoseAvatar;
  for (let i = 0; i < 40; i++) pose = c.actualizar(manos, 1000 + i * 33, { aspecto: ASPECTO, lateralidad, espejado });
  return pose;
}

function largosDeHuesos(mano: V3[]): number[] {
  return PADRE_LANDMARK.slice(1).map((padre, i) => distancia(mano[padre], mano[i + 1]));
}

describe('Avatar: cinemática', () => {
  describe('retargetMano', () => {
    it('usa siempre los largos del personaje, aunque la mano medida sea más larga o tenga ruido', () => {
      const lp = 0.4;
      const esperados = RIG_ZORRO.mano.falanges;
      for (const proporcion of [0.8, 1, 1.3]) {
        const cap = generarCaptura('LLAMAR', { persona: { proporcion }, ruido: 0.03, semilla: 3 });
        for (const f of cap.frames.slice(0, 10)) {
          const lm = f.manos[0].map((p) => v3(p.x * ASPECTO, -p.y, -p.z * ASPECTO));
          const { puntos } = retargetMano(lm, RIG_ZORRO.mano, lp, 1);
          for (let j = 1; j < 21; j++) {
            if ([1, 5, 9, 13, 17].includes(j)) continue;
            expect(distancia(puntos[PADRE_LANDMARK[j]], puntos[j])).toBeCloseTo(esperados[j] * lp, 6);
          }
        }
      }
    });

    it('la palma de una mano derecha de frente a la cámara mira hacia quien mira (+z)', () => {
      const lm = manoLocal(POSES.palma).map((p) => v3(p.x, -p.y, -p.z));
      const { base } = retargetMano(lm, RIG_PERSONA.mano, 1, 1);
      expect(base.palma.z).toBeGreaterThan(0.9);
      // Vista de dorso (girada 180° en el eje vertical): la palma mira hacia atrás.
      const dorso = lm.map((p) => v3(-p.x, p.y, -p.z));
      expect(retargetMano(dorso, RIG_PERSONA.mano, 1, 1).base.palma.z).toBeLessThan(-0.9);
    });

    it('no dobla los dedos hacia el dorso más de lo anatómico', () => {
      const lm = manoLocal(POSES.palma).map((p) => v3(p.x, -p.y, -p.z));
      // Índice muy doblado hacia atrás (hacia -z, el dorso de una mano derecha de frente).
      lm[6] = v3(lm[5].x, lm[5].y + 0.1, lm[5].z - 0.4);
      const { puntos, base } = retargetMano(lm, RIG_PERSONA.mano, 1, 1);
      const d = v3(puntos[6].x - puntos[5].x, puntos[6].y - puntos[5].y, puntos[6].z - puntos[5].z);
      const haciaDorso = -(d.x * base.palma.x + d.y * base.palma.y + d.z * base.palma.z) / distancia(puntos[5], puntos[6]);
      expect(haciaDorso).toBeLessThanOrEqual(0.35);
    });
  });

  describe('resolverBrazo (IK de dos huesos)', () => {
    const hombro = v3(0.55, 1.3, 0);
    const flexion = v3(0.6, -0.7, -0.4);

    it('respeta el largo de brazo y antebrazo y llega al objetivo', () => {
      const objetivo = v3(0.2, 1.6, 0.7);
      const { codo, muneca } = resolverBrazo(hombro, objetivo, 0.64, 0.6, flexion);
      expect(distancia(hombro, codo)).toBeCloseTo(0.64, 6);
      expect(distancia(codo, muneca)).toBeCloseTo(0.6, 6);
      expect(distancia(muneca, objetivo)).toBeLessThan(1e-6);
      // El codo queda hacia abajo/afuera, del lado de la flexión.
      expect(codo.y).toBeLessThan(Math.max(hombro.y, objetivo.y));
    });

    it('si no alcanza, se estira como máximo ESTIRAMIENTO_MAX en la dirección del objetivo', () => {
      const objetivo = v3(3, 1.3, 0);
      const { muneca } = resolverBrazo(hombro, objetivo, 0.64, 0.6, flexion);
      expect(distancia(hombro, muneca)).toBeCloseTo(1.24 * ESTIRAMIENTO_MAX, 3);
      expect(muneca.y).toBeCloseTo(1.3, 6);
    });

    it('el codo se mueve de forma continua cuando la mano recorre el espacio (sin saltos)', () => {
      let anterior: V3 | null = null;
      for (let i = 0; i <= 200; i++) {
        const a = (i / 200) * Math.PI * 2;
        const objetivo = v3(0.1 + 0.5 * Math.cos(a), 1.5 + 0.6 * Math.sin(a), 0.6);
        const { codo } = resolverBrazo(hombro, objetivo, 0.64, 0.6, flexion);
        if (anterior) expect(distancia(anterior, codo)).toBeLessThan(0.05);
        anterior = codo;
      }
    });
  });

  it('desplazamientoFuera adelanta lo que cae dentro de la cabeza hasta su superficie', () => {
    const cabeza = { centro: v3(0, 2, 0), radios: v3(1, 1, 1) };
    expect(desplazamientoFuera([v3(0, 2, 0.5)], [cabeza], 0.1)).toBeCloseTo(0.6, 6);
    expect(desplazamientoFuera([v3(0, 2, 2)], [cabeza], 0.1)).toBe(0);
    expect(desplazamientoFuera([v3(1.5, 2, 0)], [cabeza], 0.1)).toBe(0);
  });

  describe('asignación de manos a brazos', () => {
    const c = (x: number): V3[] => Array.from({ length: 21 }, () => v3(x, 0.5, 0));

    it('la etiqueta de MediaPipe es la mano real: la derecha va a la izquierda de la pantalla (sin espejo)', () => {
      expect(ladoDeEtiqueta('Right', false)).toBe(-1);
      expect(ladoDeEtiqueta('Left', false)).toBe(1);
      expect(ladoDeEtiqueta('Right', true)).toBe(1);
      expect(ladoDeEtiqueta(null, false)).toBeNull();
    });

    it('con dos manos ordena por posición, salvo que las etiquetas digan otra cosa (manos cruzadas)', () => {
      const a = new AsignadorManos();
      const r1 = a.asignar([c(1.0), c(0.3)], [], false, ASPECTO, 0);
      expect(r1.izq![0].x).toBe(0.3);
      const r2 = a.asignar([c(1.0), c(0.3)], ['Right', 'Left'], false, ASPECTO, 33);
      expect(r2.izq![0].x).toBe(1.0);
    });

    it('una mano que cruza la línea media sigue en el mismo brazo', () => {
      const a = new AsignadorManos();
      let lado: 'izq' | 'der' | null = null;
      for (let i = 0; i <= 30; i++) {
        const r = a.asignar([c(0.35 + i * 0.02)], [], false, ASPECTO, i * 33);
        const actual = r.izq ? 'izq' : 'der';
        if (lado) expect(actual).toBe(lado);
        lado = actual;
      }
    });

    it('sin etiqueta y al centro, supone la mano derecha (izquierda de la pantalla sin espejo)', () => {
      expect(new AsignadorManos().asignar([c(ASPECTO / 2)], [], false, ASPECTO, 0).izq).not.toBeNull();
      expect(new AsignadorManos().asignar([c(ASPECTO / 2)], [], true, ASPECTO, 0).der).not.toBeNull();
    });
  });

  describe('espacio de señas', () => {
    it('lleva las zonas del cuerpo de la persona a las del personaje', () => {
      for (const rig of [RIG_ZORRO, RIG_PERSONA]) {
        const e = new EspacioSenas(rig);
        const h = REFERENCIA_HUMANA;
        expect(e.mapear(0, h.ojos).y).toBeCloseTo(rig.yOjos, 6);
        expect(e.mapear(0, h.menton).y).toBeCloseTo(rig.yMenton, 6);
        expect(e.mapear(0, h.hombros).y).toBeCloseTo(rig.yHombros, 6);
        expect(e.mapear(0, h.pecho).y).toBeCloseTo(rig.yPecho, 6);
        let anterior = Infinity;
        for (let u = -3; u <= 8; u += 0.05) {
          const y = e.mapear(0, u).y;
          expect(y).toBeLessThan(anterior);
          anterior = y;
        }
      }
    });

    it('interpoladorMonotono pasa por los puntos y no rebota entre ellos', () => {
      const f = interpoladorMonotono([0, 1, 2, 3], [0, 0.1, 2, 2.05]);
      expect(f(1)).toBeCloseTo(0.1, 9);
      expect(f(2)).toBeCloseTo(2, 9);
      let anterior = -Infinity;
      for (let x = 0; x <= 3; x += 0.01) {
        expect(f(x)).toBeGreaterThanOrEqual(anterior - 1e-12);
        anterior = f(x);
      }
    });
  });

  it('FiltroUnEuro quita el temblor de una mano quieta y sigue rápido a una mano que se mueve', () => {
    const quieto = new FiltroUnEuro(3, 3);
    let semilla = 1;
    const ruido = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const salidas: number[] = [];
    for (let i = 0; i < 90; i++) salidas.push(quieto.filtrar([0.5 + ruido(), 0.5, 0], i * 33)[0]);
    const desviacion = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + (x - 0.5) ** 2, 0) / v.length);
    expect(desviacion(salidas.slice(30))).toBeLessThan(0.0058 * 0.75);

    const salto = new FiltroUnEuro(3, 3);
    for (let i = 0; i < 10; i++) salto.filtrar([0, 0, 0], i * 33);
    let x = 0;
    for (let i = 10; i < 15; i++) x = salto.filtrar([0.4, 0, 0], i * 33)[0];
    expect(x).toBeGreaterThan(0.36);
  });

  describe('CinematicaAvatar', () => {
    it('sin manos, los dos brazos descansan con las manos sobre la barriga', () => {
      const c = new CinematicaAvatar(RIG_ZORRO);
      const pose = asentar(c, []);
      for (const b of [pose.izq, pose.der]) {
        expect(b.actividad).toBe(0);
        expect(b.muneca.y).toBeLessThan(RIG_ZORRO.yPecho);
        expect(b.muneca.z).toBeGreaterThan(RIG_ZORRO.zFrentePecho);
      }
      expect(pose.mirada).toBeNull();
    });

    it('una mano en el mentón de la persona queda en el mentón del personaje, delante de la cara', () => {
      for (const rig of [RIG_ZORRO, RIG_PERSONA]) {
        const c = new CinematicaAvatar(rig);
        const pose = asentar(c, [manoEn(0, REFERENCIA_HUMANA.menton)], ['Right']);
        const b = pose.izq;
        expect(b.actividad).toBeGreaterThan(0.95);
        expect(centroPalma(b.mano).y).toBeCloseTo(rig.yMenton, 1);
        expect(desplazamientoFuera(b.mano, rig.colisiones, 0)).toBeLessThan(1e-3);
      }
    });

    it('las manos nunca atraviesan la cabeza, aunque la seña sea en la cara', () => {
      const c = new CinematicaAvatar(RIG_ZORRO);
      for (const uy of [-1, 0, 0.6, 1.2]) {
        for (const ux of [-0.8, 0, 0.8]) {
          c.reiniciar();
          const pose = asentar(c, [manoEn(ux, uy, { pose: POSES.garra })], ['Right']);
          expect(desplazamientoFuera(pose.izq.mano, RIG_ZORRO.colisiones, 0)).toBeLessThan(1e-3);
        }
      }
    });

    it('brazo y antebrazo mantienen su largo en toda la seña', () => {
      const c = new CinematicaAvatar(RIG_PERSONA);
      const cap = generarCaptura('SEPARAR', { semilla: 5 });
      cap.frames.forEach((f, i) => {
        const pose = c.actualizar(f.manos, i * 33, { aspecto: ASPECTO });
        for (const b of [pose.izq, pose.der]) {
          const estir = distancia(b.hombro, b.codo) / RIG_PERSONA.largoBrazo;
          expect(estir).toBeGreaterThanOrEqual(1 - 1e-6);
          expect(estir).toBeLessThanOrEqual(ESTIRAMIENTO_MAX + 1e-6);
          expect(distancia(b.codo, b.muneca) / RIG_PERSONA.largoAntebrazo).toBeCloseTo(estir, 6);
        }
      });
    });

    it('la mano conserva los largos del personaje (con el tamaño de manos elegido)', () => {
      const c = new CinematicaAvatar(RIG_ZORRO);
      c.configurar({ tamanoManos: 1.2 });
      const pose = asentar(c, [manoEn(0.5, 2.5, { pose: POSES.ve, tamano: 0.22 })], ['Right']);
      const lp = RIG_ZORRO.largoPalma * 1.2;
      const largos = largosDeHuesos(pose.izq.mano);
      [6, 7, 8, 10, 11, 12, 18, 19, 20].forEach((j) => expect(largos[j - 1]).toBeCloseTo(RIG_ZORRO.mano.falanges[j] * lp, 5));
    });

    it('mano derecha → brazo de la izquierda de la pantalla con la palma hacia quien mira; izquierda → el otro', () => {
      const c = new CinematicaAvatar(RIG_PERSONA);
      const pose = asentar(c, [manoEn(-1.2, 2.5), manoEn(1.2, 2.5, { izquierda: true })], ['Right', 'Left']);
      expect(pose.izq.quiralidad).toBe(1);
      expect(pose.der.quiralidad).toBe(-1);
      expect(pose.izq.base.palma.z).toBeGreaterThan(0.8);
      expect(pose.der.base.palma.z).toBeGreaterThan(0.8);
      expect(centroPalma(pose.izq.mano).x).toBeLessThan(0);
      expect(centroPalma(pose.der.mano).x).toBeGreaterThan(0);
    });

    it('si MediaPipe pierde la mano un instante, el brazo no vuelve al reposo', () => {
      const c = new CinematicaAvatar(RIG_ZORRO);
      const mano = manoEn(0, 2.5);
      asentar(c, [mano], ['Right']);
      const pose = c.actualizar([], 1000 + 40 * 33 + 150, { aspecto: ASPECTO });
      expect(pose.izq.actividad).toBeGreaterThan(0.95);
    });
  });
});
