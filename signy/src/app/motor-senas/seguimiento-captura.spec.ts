import { ControlFramesVideo, GrabadorCaptura, manosDesdeResultado } from './captura';
import { FrameManos } from './geometria';
import { secuenciasCandidatas, seguirManos, resumirPistas } from './seguimiento';
import { manoLocal, POSES, ubicarMano } from './testing/manos-sinteticas';
import { Mano } from './tipos';

const mano = (x: number, y = 0.5): Mano => ubicarMano(manoLocal(POSES.palma), { pose: POSES.palma, x, y, tamano: 0.15 });
const frame = (t: number, ...manos: Mano[]): FrameManos => ({ t, manos });

describe('motor-senas / seguimiento de manos', () => {
  it('mantiene cada mano en su pista aunque MediaPipe invierta el orden', () => {
    const izq = (t: number) => mano(0.3 + t * 0.001);
    const der = (t: number) => mano(0.7 - t * 0.001);
    const pistas = seguirManos([frame(0, izq(0), der(0)), frame(1, der(1), izq(1)), frame(2, izq(2), der(2)), frame(3, der(3), izq(3))]);
    for (const [a, b] of pistas) {
      expect(a![0].x).toBeLessThan(0.5);
      expect(b![0].x).toBeGreaterThan(0.5);
    }
  });

  it('una mano que reaparece cerca de donde estaba vuelve a su misma pista', () => {
    const pistas = seguirManos([frame(0, mano(0.3), mano(0.7)), frame(1, mano(0.71)), frame(2, mano(0.3), mano(0.7))]);
    expect(pistas[1][0]).toBeNull();
    expect(pistas[1][1]).not.toBeNull();
  });

  it('una mano nueva lejos de la única conocida abre la otra pista', () => {
    const pistas = seguirManos([frame(0, mano(0.2)), frame(1, mano(0.8))]);
    expect(pistas[1][0]).toBeNull();
    expect(pistas[1][1]).not.toBeNull();
  });

  it('resumirPistas calcula presencia y posición media', () => {
    const r = resumirPistas(seguirManos([frame(0, mano(0.3), mano(0.7)), frame(1, mano(0.3))]));
    expect(r.find((p) => p.indice === 0)!.presencia).toBe(1);
    expect(r.find((p) => p.indice === 1)!.presencia).toBe(0.5);
  });

  it('para 2 manos ordena las pistas de izquierda a derecha según su posición media', () => {
    const [seq] = secuenciasCandidatas([frame(0, mano(0.8), mano(0.2)), frame(1, mano(0.2), mano(0.8))], 2);
    expect(seq.every((f) => f.manos[0][0].x < f.manos[1][0].x)).toBeTrue();
  });

  it('para 2 manos devuelve vacío si solo se vio una', () => {
    expect(secuenciasCandidatas([frame(0, mano(0.5)), frame(1, mano(0.5))], 2)).toEqual([]);
  });

  it('para 1 mano propone primero la mano más alta (la que hace la seña)', () => {
    const arriba = mano(0.5, 0.3);
    const abajo = mano(0.2, 0.9);
    const candidatas = secuenciasCandidatas([frame(0, abajo, arriba), frame(1, abajo, arriba)], 1);
    expect(candidatas.length).toBe(2);
    expect(candidatas[0][0].manos[0][0].y).toBeCloseTo(arriba[0].y, 9);
  });

  it('ignora una pista que aparece en muy pocos frames', () => {
    const frames = Array.from({ length: 10 }, (_, i) => (i === 0 ? frame(i, mano(0.5), mano(0.1)) : frame(i, mano(0.5))));
    expect(secuenciasCandidatas(frames, 1).length).toBe(1);
  });
});

describe('motor-senas / captura', () => {
  describe('ControlFramesVideo', () => {
    it('solo procesa cuando el video avanzó (evita frames duplicados en pantallas de 60–120 Hz)', () => {
      const c = new ControlFramesVideo();
      const video = { currentTime: 0.033 };
      expect(c.esFrameNuevo(video)).toBeTrue();
      expect(c.esFrameNuevo(video)).toBeFalse();
      expect(c.esFrameNuevo(video)).toBeFalse();
      video.currentTime = 0.066;
      expect(c.esFrameNuevo(video)).toBeTrue();
      c.reiniciar();
      expect(c.esFrameNuevo(video)).toBeTrue();
    });

    it('entrega marcas de tiempo estrictamente crecientes aunque el reloj se repita o retroceda', () => {
      const c = new ControlFramesVideo();
      const a = c.marcaDeTiempo(1000);
      const b = c.marcaDeTiempo(1000);
      const d = c.marcaDeTiempo(900);
      expect(b).toBeGreaterThan(a);
      expect(d).toBeGreaterThan(b);
    });
  });

  it('manosDesdeResultado convierte landmarks y lateralidad, y descarta manos incompletas', () => {
    const lm = mano(0.5).map((p) => ({ x: p.x, y: p.y }));
    const r = manosDesdeResultado({
      landmarks: [lm, lm.slice(0, 5)],
      handedness: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
    });
    expect(r.manos.length).toBe(1);
    expect(r.manos[0][0].z).toBe(0);
    expect(r.lateralidad).toEqual(['Right']);
    expect(manosDesdeResultado(null).manos).toEqual([]);
    expect(manosDesdeResultado({ landmarks: [lm], handedness: [[{ categoryName: '?' }]] }).lateralidad).toEqual([null]);
  });

  describe('GrabadorCaptura', () => {
    const resultado = (n: number) => ({ landmarks: Array.from({ length: n }, () => mano(0.5)) });

    it('acumula frames con tiempos relativos y el tamaño del video', () => {
      const g = new GrabadorCaptura();
      g.agregar(resultado(1), 5000, 640, 480);
      g.agregar(resultado(0), 5033, 640, 480);
      g.agregar(resultado(2), 5066, 640, 480);
      const c = g.captura();
      expect(c.ancho).toBe(640);
      expect(c.frames.map((f) => f.t)).toEqual([0, 33, 66]);
      expect(g.totalFrames).toBe(3);
      expect(g.framesConManos(1)).toBe(2);
      expect(g.framesConManos(2)).toBe(1);
      expect(g.duracionMs).toBe(66);
    });

    it('como búfer circular conserva solo la ventana pedida y reinicia los tiempos en 0', () => {
      const g = new GrabadorCaptura(100);
      for (let t = 0; t <= 300; t += 50) g.agregar(resultado(1), t, 640, 480);
      const c = g.captura();
      expect(c.frames.length).toBe(3);
      expect(c.frames[0].t).toBe(0);
      expect(c.frames[2].t).toBe(100);
    });

    it('reiniciar vacía la captura', () => {
      const g = new GrabadorCaptura();
      g.agregar(resultado(1), 0, 640, 480);
      g.reiniciar();
      expect(g.totalFrames).toBe(0);
      expect(g.duracionMs).toBe(0);
    });
  });
});
