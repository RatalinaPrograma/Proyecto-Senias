import { construirModeloReferencia, dtw, evaluarCaptura, similitudDesdeDistancia, UMBRAL_DINAMICA, UMBRAL_ESTATICA, VERSION_MOTOR } from './comparacion';
import { generarCaptura, OpcionesCaptura, SENAS } from './testing/manos-sinteticas';
import { evaluarAnterior, grabarReferenciaAnterior } from './testing/motor-anterior';
import { CapturaCruda, ModeloReferenciaSena } from './tipos';

/** Referencia grabada por "el admin": laptop 640x480, con pausas antes y después. */
function referencia(nombre: string): ModeloReferenciaSena {
  const { tipo, manos } = SENAS[nombre];
  const captura = generarCaptura(nombre, { semilla: 100, pausaAntesMs: 400, pausaDespuesMs: 400, ruido: 0.03 });
  return construirModeloReferencia(captura, { palabra: nombre, tipo, manosRequeridas: manos })!;
}

/** Lo que hace "el alumno" frente a la cámara (por defecto, con pausas y ruido realista). */
function alumno(nombre: string, o: OpcionesCaptura = {}): CapturaCruda {
  return generarCaptura(nombre, { pausaAntesMs: 400, pausaDespuesMs: 400, ruido: 0.03, semilla: 7, ...o });
}

function puntaje(ref: string, hace: string, o: OpcionesCaptura = {}): number {
  return evaluarCaptura(referencia(ref), alumno(hace, o)).similitudPct;
}

describe('motor-senas / comparación', () => {
  describe('dtw', () => {
    const seq = (valores: number[]) => valores.map((v) => [v, 0, 0]);

    it('distancia 0 para secuencias idénticas', () => {
      expect(dtw(seq([0, 1, 2, 3]), seq([0, 1, 2, 3])).distancia).toBeCloseTo(0, 6);
    });

    it('tolera la misma secuencia a otra velocidad (frames repetidos)', () => {
      expect(dtw(seq([0, 1, 2, 3]), seq([0, 0, 1, 1, 2, 2, 3, 3])).distancia).toBeCloseTo(0, 6);
    });

    it('por subsecuencia encuentra el tramo de la seña dentro de una captura más larga', () => {
      const r = dtw(seq([5, 6, 7]), seq([0, 0, 0, 5, 6, 7, 0, 0]), true);
      expect(r.distancia).toBeCloseTo(0, 6);
      expect([r.inicio, r.fin]).toEqual([3, 5]);
    });

    it('sin subsecuencia, el tiempo muerto alrededor sí suma distancia', () => {
      expect(dtw(seq([5, 6, 7]), seq([0, 0, 0, 5, 6, 7, 0, 0]), false).distancia).toBeGreaterThan(1);
    });

    it('devuelve distancia infinita si alguna secuencia está vacía', () => {
      expect(dtw([], seq([1])).distancia).toBe(Infinity);
    });
  });

  it('similitudDesdeDistancia mapea 0 → 100 % y satura en 0 %', () => {
    expect(similitudDesdeDistancia(0, 'dinamica')).toBe(100);
    expect(similitudDesdeDistancia(10, 'dinamica')).toBe(0);
    expect(similitudDesdeDistancia(0.2, 'estatica')).toBe(50);
  });

  describe('construirModeloReferencia', () => {
    it('genera un modelo v3 dinámico, recortando la quietud y redondeado a 4 decimales', () => {
      const m = referencia('HOLA');
      expect(m.version).toBe(VERSION_MOTOR);
      expect(m.tipo).toBe('dinamica');
      expect(m.frames[0].length).toBe(63);
      // 1,2 s de seña a 20 fps ≈ 25 frames; las pausas de 0,4 s no deberían quedar.
      expect(m.totalFrames).toBeGreaterThan(18);
      expect(m.totalFrames).toBeLessThan(34);
      expect(m.frames.every((f) => f.every((v) => Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-6))).toBeTrue();
    });

    it('una seña estática guarda un único frame con la forma de la mano', () => {
      const m = referencia('A');
      expect(m.frames.length).toBe(1);
      expect(m.frames[0].slice(0, 3)).toEqual([0, 0, 0]); // muñeca en el origen
    });

    it('una seña de 2 manos guarda 126 valores por frame', () => {
      expect(referencia('SEPARAR').frames[0].length).toBe(126);
    });

    it('devuelve null si la cámara nunca vio las manos', () => {
      const vacia: CapturaCruda = { ancho: 640, alto: 480, frames: [{ t: 0, manos: [] }, { t: 33, manos: [] }] };
      expect(construirModeloReferencia(vacia, { palabra: 'x', tipo: 'dinamica', manosRequeridas: 1 })).toBeNull();
    });

    it('devuelve null para 2 manos si solo se vio una', () => {
      const unaMano = generarCaptura('HOLA');
      expect(construirModeloReferencia(unaMano, { palabra: 'x', tipo: 'dinamica', manosRequeridas: 2 })).toBeNull();
    });
  });

  describe('evaluarCaptura — reconoce la seña correcta en condiciones reales', () => {
    const casos: [string, string, OpcionesCaptura][] = [
      ['misma cámara', 'HOLA', {}],
      ['celular en vertical (480x640) contra referencia de laptop (640x480)', 'HOLA', { ancho: 480, alto: 640 }],
      ['mano que entra desde abajo antes de empezar', 'HOLA', { pausaAntesMs: 600, entraDesdeAbajo: true }],
      ['persona zurda', 'HOLA', { persona: { zurda: true } }],
      ['otra persona: mano más grande, corrida y más lenta', 'HOLA', { persona: { tamano: 0.24, proporcion: 1.07, dx: 0.1 }, duracionMs: 1600 }],
      ['mano pasiva visible y ejecución rápida', 'HOLA', { duracionMs: 900, manoPasiva: true }],
      ['mano inclinada 20°', 'HOLA', { persona: { giro: 0.35 } }],
      ['ruido alto, 15 fps y 20 % de frames perdidos', 'HOLA', { ruido: 0.06, fps: 15, probPerdida: 0.2 }],
      ['GRACIAS', 'GRACIAS', {}],
      ['LLAMAR en celular vertical', 'LLAMAR', { ancho: 480, alto: 640 }],
      ['2 manos', 'SEPARAR', {}],
      ['2 manos con MediaPipe intercambiando su orden', 'SEPARAR', { probIntercambio: 0.3 }],
      ['2 manos en celular vertical', 'SEPARAR', { ancho: 480, alto: 640 }],
    ];
    for (const [nombre, sena, o] of casos) {
      it(`dinámica: ${nombre}`, () => {
        expect(puntaje(sena, sena, o)).toBeGreaterThanOrEqual(UMBRAL_DINAMICA + 10);
      });
    }

    const estaticas: [string, string, OpcionesCaptura][] = [
      ['misma cámara', 'A', {}],
      ['celular en vertical', 'L', { ancho: 480, alto: 640 }],
      ['mano que entra desde abajo', 'A', { pausaAntesMs: 700, entraDesdeAbajo: true }],
      ['persona zurda', 'L', { persona: { zurda: true } }],
      ['mano inclinada 20° y ruido alto', 'L', { persona: { giro: 0.35 }, ruido: 0.06 }],
    ];
    for (const [nombre, sena, o] of estaticas) {
      it(`estática: ${nombre}`, () => {
        expect(puntaje(sena, sena, o)).toBeGreaterThanOrEqual(UMBRAL_ESTATICA + 10);
      });
    }
  });

  describe('evaluarCaptura — rechaza señas distintas', () => {
    const negativos: [string, string, OpcionesCaptura][] = [
      ['HOLA', 'SI', {}],
      ['HOLA', 'LLAMAR', {}],
      ['HOLA', 'GRACIAS', {}],
      ['GRACIAS', 'HOLA', {}],
      ['LLAMAR', 'SI', {}],
      ['SEPARAR', 'JUNTAR', {}],
      ['HOLA', 'LLAMAR', { ruido: 0.06, fps: 15, probPerdida: 0.2 }],
      ['HOLA', 'SI', { duracionMs: 2200 }],
    ];
    for (const [ref, hace, o] of negativos) {
      it(`dinámica: ${hace} no pasa como ${ref}`, () => {
        expect(puntaje(ref, hace, o)).toBeLessThan(UMBRAL_DINAMICA - 15);
      });
    }

    const negativosEstaticos: [string, string, OpcionesCaptura][] = [
      ['A', 'B', {}],
      ['L', 'V', {}],
      ['L', 'A', {}],
      ['L', 'INDICE', {}],
      ['L', 'A', { persona: { giro: 0.35 } }],
      ['L', 'V', { ruido: 0.06 }],
    ];
    for (const [ref, hace, o] of negativosEstaticos) {
      it(`estática: ${hace} no pasa como ${ref}`, () => {
        expect(puntaje(ref, hace, o)).toBeLessThan(UMBRAL_ESTATICA);
      });
    }

    it('sin permitir espejo, la forma espejada (otra mano) no pasa en una seña asimétrica', () => {
      const r = evaluarCaptura(referencia('L'), alumno('L', { persona: { zurda: true } }), { permitirEspejo: false });
      expect(r.esCoincidente).toBeFalse();
      const conEspejo = evaluarCaptura(referencia('L'), alumno('L', { persona: { zurda: true } }));
      expect(conEspejo.esCoincidente).toBeTrue();
      expect(conEspejo.espejo).toBeTrue();
    });
  });

  describe('evaluarCaptura — casos borde', () => {
    it('sin modelo devuelve motivo "sin_modelo"', () => {
      expect(evaluarCaptura(null, alumno('HOLA')).motivo).toBe('sin_modelo');
    });

    it('rechaza modelos v1 (autocentrados por frame, sin trayectoria)', () => {
      const v1 = { ...referencia('HOLA'), version: 1 as const };
      expect(evaluarCaptura(v1, alumno('HOLA')).motivo).toBe('sin_modelo');
    });

    it('con muy pocos frames con manos devuelve motivo "pocos_frames"', () => {
      const corta: CapturaCruda = { ...alumno('HOLA'), frames: alumno('HOLA').frames.slice(0, 3) };
      const r = evaluarCaptura(referencia('HOLA'), corta);
      expect(r.motivo).toBe('pocos_frames');
      expect(r.esCoincidente).toBeFalse();
    });

    it('usa el umbral recomendado del modelo', () => {
      const exigente = { ...referencia('HOLA'), umbralRecomendado: 99 };
      expect(evaluarCaptura(exigente, alumno('HOLA')).esCoincidente).toBeFalse();
    });
  });

  describe('compatibilidad con modelos v2 ya guardados', () => {
    it('una referencia v2 sigue reconociendo la seña correcta con la misma cámara', () => {
      const v2 = grabarReferenciaAnterior(generarCaptura('HOLA', { semilla: 100, pausaDespuesMs: 300, ruido: 0.03 }), 'dinamica', 1);
      expect(evaluarCaptura(v2, alumno('HOLA')).similitudPct).toBeGreaterThanOrEqual(UMBRAL_DINAMICA);
      expect(evaluarCaptura(v2, alumno('SI')).similitudPct).toBeLessThan(UMBRAL_DINAMICA);
    });

    it('una referencia v2 de 2 manos grabada con el orden intercambiado se reordena', () => {
      const cap = generarCaptura('SEPARAR', { semilla: 100, pausaDespuesMs: 300, probIntercambio: 0.3 });
      const v2 = grabarReferenciaAnterior(cap, 'dinamica', 2);
      expect(evaluarCaptura(v2, alumno('SEPARAR')).similitudPct).toBeGreaterThanOrEqual(UMBRAL_DINAMICA);
    });
  });

  describe('mejora respecto del motor anterior (regresión documentada)', () => {
    // El motor anterior grababa la referencia a la tasa de la pantalla (60 Hz
    // en la laptop del admin → solo medio segundo de seña) y el alumno se
    // evaluaba a 120 Hz, sin corregir aspecto ni orden de manos.
    const escenarios: [string, string, OpcionesCaptura][] = [
      ['caso ideal', 'HOLA', {}],
      ['celular vertical', 'HOLA', { ancho: 480, alto: 640 }],
      ['zurdo', 'HOLA', { persona: { zurda: true } }],
      ['2 manos con orden intercambiado', 'SEPARAR', { probIntercambio: 0.3 }],
    ];
    for (const [nombre, sena, o] of escenarios) {
      it(`${nombre}: el motor anterior no alcanzaba el umbral y el nuevo sí`, () => {
        const { tipo, manos } = SENAS[sena];
        const v2 = grabarReferenciaAnterior(generarCaptura(sena, { semilla: 100, pausaDespuesMs: 300, ruido: 0.03 }), tipo, manos, 60);
        const captura = alumno(sena, o);
        expect(evaluarAnterior(v2, captura, 120)).toBeLessThan(UMBRAL_DINAMICA);
        expect(evaluarCaptura(referencia(sena), captura).similitudPct).toBeGreaterThanOrEqual(UMBRAL_DINAMICA + 10);
      });
    }

    it('el motor anterior aprobaba una seña EQUIVOCADA más que la correcta; el nuevo no', () => {
      const v2 = grabarReferenciaAnterior(generarCaptura('HOLA', { semilla: 100, pausaDespuesMs: 300, ruido: 0.03 }), 'dinamica', 1, 60);
      expect(evaluarAnterior(v2, alumno('LLAMAR'), 120)).toBeGreaterThan(evaluarAnterior(v2, alumno('HOLA'), 120));
      expect(puntaje('HOLA', 'LLAMAR')).toBeLessThan(puntaje('HOLA', 'HOLA') - 40);
    });
  });
});
