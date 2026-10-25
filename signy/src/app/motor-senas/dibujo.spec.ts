import { ajustarEncuadre, dibujarFrameModelo, desaplanar } from './dibujo';
import { ModeloReferenciaSena } from './tipos';

describe('ajustarEncuadre / dibujarFrameModelo', () => {
  // Una mano de 21 puntos entre (1, -1.5) y (3, -0.5): el "centro" (bbox) queda en (2, -1).
  const frame: number[] = [];
  for (let i = 0; i < 21; i++) frame.push(1 + (2 * i) / 20, -1.5 + i / 20, 0);
  const modelo: ModeloReferenciaSena = {
    version: 3, palabra: 'hola', tipo: 'dinamica', manosRequeridas: 1, totalFrames: 1, fpsObjetivo: 10, frames: [frame],
  };

  it('centra el contenido del modelo en el canvas', () => {
    const e = ajustarEncuadre(modelo, 200, 100);
    expect(2 * e.escala + e.centroX).toBeCloseTo(100, 5); // (2, -1) es el centro del modelo → centro del canvas
    expect(-1 * e.escala + e.centroY).toBeCloseTo(50, 5);
    expect(e.escala).toBeGreaterThan(0);
  });

  it('dibuja sin lanzar error con un contexto real', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    const e = ajustarEncuadre(modelo, 200, 100);
    expect(() => dibujarFrameModelo(ctx, desaplanar(frame), e)).not.toThrow();
  });
});
