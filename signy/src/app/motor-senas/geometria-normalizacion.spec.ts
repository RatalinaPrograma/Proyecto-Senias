import { FrameManos, aIsotropico, aplanar, desaplanar, remuestrear, tamanoMano, mediana, redondear } from './geometria';
import {
  anguloAlineacion,
  canonicalizar,
  formaEstatica,
  medoide,
  recortarQuietud,
  referenciaEstatica,
  rotarManos,
  suavizar,
} from './normalizacion';
import { manoLocal, POSES, ubicarMano } from './testing/manos-sinteticas';
import { Mano } from './tipos';

const mano = (x = 0.5, y = 0.5, tamano = 0.2, giro = 0, pose = POSES.palma): Mano =>
  ubicarMano(manoLocal(pose), { pose, x, y, tamano, giro });

describe('motor-senas / geometría', () => {
  it('aIsotropico multiplica x y z por ancho/alto y respeta y', () => {
    const [f] = aIsotropico({ ancho: 640, alto: 480, frames: [{ t: 0, manos: [mano(0.5, 0.4)] }] });
    const original = mano(0.5, 0.4);
    expect(f.manos[0][5].x).toBeCloseTo(original[5].x * (640 / 480), 9);
    expect(f.manos[0][5].y).toBeCloseTo(original[5].y, 9);
    expect(f.manos[0][5].z).toBeCloseTo(original[5].z * (640 / 480), 9);
  });

  it('aIsotropico descarta manos incompletas', () => {
    const [f] = aIsotropico({ ancho: 1, alto: 1, frames: [{ t: 0, manos: [mano(), mano().slice(0, 10)] }] });
    expect(f.manos.length).toBe(1);
  });

  it('la misma mano física mide lo mismo en cámara horizontal y vertical tras la corrección', () => {
    const iso = mano(0.6, 0.5, 0.2);
    const enCamara = (ancho: number, alto: number) =>
      aIsotropico({ ancho, alto, frames: [{ t: 0, manos: [iso.map((p) => ({ x: p.x / (ancho / alto), y: p.y, z: p.z / (ancho / alto) }))] }] })[0]
        .manos[0];
    expect(tamanoMano(enCamara(640, 480))).toBeCloseTo(tamanoMano(enCamara(480, 640)), 9);
  });

  it('aplanar y desaplanar son inversas', () => {
    const manos = [mano(), mano(0.2)];
    expect(desaplanar(aplanar(manos))).toEqual(manos);
    expect(aplanar(manos).length).toBe(126);
  });

  describe('remuestrear', () => {
    const frames = (tiempos: number[]): FrameManos[] => tiempos.map((t) => ({ t, manos: [mano(t / 1000, 0.5)] }));

    it('lleva una secuencia de 30 fps a 20 fps interpolando posiciones', () => {
      const r = remuestrear(frames([0, 33, 67, 100, 133, 167, 200]), 20);
      expect(r.map((f) => f.t)).toEqual([0, 50, 100, 150, 200]);
      expect(r[1].manos[0][0].x).toBeCloseTo(0.05, 6);
    });

    it('no inventa frames dentro de un hueco largo (la mano salió de cuadro)', () => {
      const r = remuestrear(frames([0, 50, 100, 900, 950]), 20);
      expect(r.some((f) => f.t > 150 && f.t < 850)).toBeFalse();
    });

    it('con menos de 2 frames devuelve una copia', () => {
      expect(remuestrear(frames([0]), 20).length).toBe(1);
    });
  });

  it('mediana y redondear', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBe(0);
    expect(redondear([[0.123456, 1.99995]])).toEqual([[0.1235, 2]]);
  });
});

describe('motor-senas / normalización', () => {
  it('canonicalizar es invariante a dónde está la persona y a qué tan cerca está de la cámara', () => {
    const recorrido = [0.4, 0.45, 0.5, 0.55].map((x) => [mano(x, 0.5, 0.2)]);
    const lejosYCorrido = [0.4, 0.45, 0.5, 0.55].map((x) => [mano(0.2 + x * 0.5, 0.3, 0.1)]);
    const a = canonicalizar(recorrido);
    const b = canonicalizar(lejosYCorrido);
    a.forEach((f, i) => f.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], 6)));
  });

  it('canonicalizar conserva la trayectoria (la muñeca se desplaza entre frames)', () => {
    const c = canonicalizar([0.3, 0.5, 0.7].map((x) => [mano(x, 0.5)]));
    expect(c[0][0]).toBeLessThan(c[1][0]);
    expect(c[1][0]).toBeLessThan(c[2][0]);
    expect(c[1][0]).toBeCloseTo(0, 6); // centro = muñeca promedio
  });

  it('formaEstatica ignora posición y tamaño, pero no la forma', () => {
    const a = formaEstatica([mano(0.2, 0.3, 0.1)]);
    const b = formaEstatica([mano(0.8, 0.6, 0.3)]);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
    const puno = formaEstatica([mano(0.5, 0.5, 0.2, 0, POSES.puno)]);
    expect(puno[8 * 3 + 1]).not.toBeCloseTo(a[8 * 3 + 1], 2);
  });

  describe('alineación de giro', () => {
    const base = formaEstatica([mano(0.5, 0.5, 0.2, 0, POSES.ele)]);
    const girada = (rad: number) => formaEstatica([mano(0.5, 0.5, 0.2, rad, POSES.ele)]);

    it('recupera el giro dentro del límite', () => {
      expect(anguloAlineacion(base, girada(0.2), 1)).toBeCloseTo(-0.2, 3);
    });

    it('nunca gira más que el máximo permitido', () => {
      expect(Math.abs(anguloAlineacion(base, girada(1.2), 0.4))).toBeCloseTo(0.4, 6);
    });

    it('rotarManos deshace el giro y deja la muñeca en su lugar', () => {
      const corregida = rotarManos(girada(0.2), anguloAlineacion(base, girada(0.2), 1));
      corregida.forEach((v, i) => expect(v).toBeCloseTo(base[i], 4));
      expect(corregida.slice(0, 3)).toEqual(girada(0.2).slice(0, 3));
    });

    it('rotarManos con ángulo 0 devuelve el mismo frame', () => {
      expect(rotarManos(base, 0)).toBe(base);
    });
  });

  it('suavizar promedia ventanas consecutivas', () => {
    expect(suavizar([[0], [2], [4], [6]], 2)).toEqual([[1], [3], [5]]);
    expect(suavizar([[0], [2]], 5)).toEqual([[1]]);
    expect(suavizar([], 5)).toEqual([]);
  });

  it('medoide elige el frame central y referenciaEstatica descarta los atípicos', () => {
    const frames = [[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0], [0.3, 0, 0], [5, 0, 0]];
    expect(medoide(frames)).toEqual([0.2, 0, 0]);
    // Promedio de los 3 más cercanos al medoide (0,1 · 0,2 · 0,3): el 5 queda fuera.
    expect(referenciaEstatica(frames)[0]).toBeCloseTo(0.2, 6);
  });

  it('recortarQuietud quita la quietud inicial y final', () => {
    const quieto = Array.from({ length: 10 }, () => [0, 0, 0]);
    const movimiento = Array.from({ length: 10 }, (_, i) => [i * 0.1, 0, 0]);
    const final = Array.from({ length: 10 }, () => [0.9, 0, 0]);
    const r = recortarQuietud([...quieto, ...movimiento, ...final]);
    expect(r.length).toBeLessThan(18);
    expect(r.length).toBeGreaterThanOrEqual(10);
  });

  it('recortarQuietud no toca secuencias cortas o sin movimiento', () => {
    const quieto = Array.from({ length: 10 }, () => [0, 0, 0]);
    expect(recortarQuietud(quieto)).toBe(quieto);
    expect(recortarQuietud([[0], [1]]).length).toBe(2);
  });
});
