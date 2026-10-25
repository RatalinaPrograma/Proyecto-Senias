import { aIsotropico, mediana, tamanoMano } from './geometria';
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

  it('mediana', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    expect(mediana([])).toBe(0);
  });
});
