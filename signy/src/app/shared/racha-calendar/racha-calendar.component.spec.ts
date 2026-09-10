import { RachaCalendarComponent, DiaRachaVista } from './racha-calendar.component';

describe('RachaCalendarComponent', () => {
  let component: RachaCalendarComponent;

  beforeEach(() => {
    component = new RachaCalendarComponent();
  });

  function dia(estado: DiaRachaVista['estado'], esHoy = false): DiaRachaVista {
    return { fecha: '2026-09-08', numero: 8, estado, esHoy };
  }

  describe('semanaPerfecta', () => {
    it('false si la variante es "mes", aunque todos los días estén practicados', () => {
      component.variante = 'mes';
      component.dias = Array.from({ length: 7 }, () => dia('practicado'));
      expect(component.semanaPerfecta).toBeFalse();
    });

    it('false si son menos de 7 días', () => {
      component.variante = 'semana';
      component.dias = Array.from({ length: 6 }, () => dia('practicado'));
      expect(component.semanaPerfecta).toBeFalse();
    });

    it('false si algún día de la semana no está practicado', () => {
      component.variante = 'semana';
      component.dias = [...Array.from({ length: 6 }, () => dia('practicado')), dia('perdido')];
      expect(component.semanaPerfecta).toBeFalse();
    });

    it('true solo con variante "semana", 7 días, todos practicados', () => {
      component.variante = 'semana';
      component.dias = Array.from({ length: 7 }, () => dia('practicado'));
      expect(component.semanaPerfecta).toBeTrue();
    });
  });

  describe('retraso', () => {
    it('escalona 35ms por índice', () => {
      expect(component.retraso(0)).toBe('0ms');
      expect(component.retraso(1)).toBe('35ms');
      expect(component.retraso(5)).toBe('175ms');
    });

    it('no pasa el tope de 420ms aunque el índice sea muy alto', () => {
      expect(component.retraso(50)).toBe('420ms');
    });
  });
});
