import { SenaIconComponent } from './sena-icon.component';

describe('SenaIconComponent', () => {
  it('gradId combina seed y tamaño para no chocar entre íconos distintos en la misma página', () => {
    const a = new SenaIconComponent();
    a.seed = 3;
    a.size = 40;
    expect(a.gradId).toBe('sena-grad-3-40');
  });

  it('gradId redondea tamaños no enteros', () => {
    const a = new SenaIconComponent();
    a.seed = 1;
    a.size = 39.6;
    expect(a.gradId).toBe('sena-grad-1-40');
  });

  it('dedosDoblados varía según el seed (no siempre los mismos puntos)', () => {
    const a = new SenaIconComponent();
    a.seed = 0;
    const conSeedCero = a.dedosDoblados;

    a.seed = 5; // 0b0101
    const conSeedCinco = a.dedosDoblados;

    expect(conSeedCero).not.toEqual(conSeedCinco);
  });

  it('seed 0 activa los 4 puntos (todos los bits en 0 cuentan como "doblado")', () => {
    const a = new SenaIconComponent();
    a.seed = 0;
    expect(a.dedosDoblados.length).toBe(4);
  });
});
