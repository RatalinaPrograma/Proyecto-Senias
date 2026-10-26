import { expandirCaptura } from './dataset';
import { mediana } from './geometria';
import { MedidasIntento, PerfilSena, Rango, medirIntento, retroalimentar } from './retroalimentacion';
import { generarCaptura, OpcionesCaptura } from './testing/manos-sinteticas';
import { CASOS_PARIDAD } from './testing/fixture-clasificador';
import { CapturaCruda } from './tipos';

/** Mismo resumen que `_rango` en ml/signy_ml/perfil.py. */
function rango(valores: number[]): Rango | null {
  if (!valores.length) return null;
  const med = mediana(valores);
  return [med, 1.4826 * mediana(valores.map((v) => Math.abs(v - med)))];
}

/** Perfil de una seña a partir de varias capturas "bien hechas" (como lo arma el entrenamiento). */
function perfilDe(capturas: CapturaCruda[]): PerfilSena {
  const m = capturas.map((c) => medirIntento(c)!);
  const ext = m.filter((x) => x.extension).map((x) => x.extension!);
  return {
    n: m.length,
    recorrido: rango(m.map((x) => x.recorrido)),
    duracionMs: rango(m.filter((x) => x.duracionMs !== null).map((x) => x.duracionMs!)),
    dosManos: rango(m.map((x) => x.dosManos)),
    distanciaManos: rango(m.filter((x) => x.distanciaManos !== null).map((x) => x.distanciaManos!)),
    extension: ext.length ? [0, 1, 2, 3, 4].map((d) => rango(ext.map((e) => e[d]))) : null,
  };
}

const NORMAL: OpcionesCaptura = { duracionMs: 1200, pausaAntesMs: 300, pausaDespuesMs: 500 };
const muestras = (nombre: string, o: OpcionesCaptura = {}) =>
  [1, 2, 3, 4, 5].map((semilla) => generarCaptura(nombre, { ...NORMAL, ...o, semilla, persona: { tamano: 0.16 + semilla * 0.01 } }));
const codigos = (r: { pistas: { codigo: string }[] }) => r.pistas.map((p) => p.codigo);

/** Medidas "sin problemas" para probar cada regla por separado. */
function medidas(cambios: Partial<MedidasIntento> = {}): MedidasIntento {
  return {
    recorrido: 3, duracionMs: 1000, dosManos: 0, distanciaManos: null, extension: [0.6, 1.9, 2, 1.9, 1.7],
    visibles: 0.9, tamano: 0.18, borde: 0, inicio: 0.05, huecoMs: 60, cortada: false, ...cambios,
  };
}
const PERFIL: PerfilSena = {
  n: 8, recorrido: [3, 0.4], duracionMs: [1000, 150], dosManos: [0, 0], distanciaManos: null,
  extension: [[0.6, 0.05], [1.9, 0.05], [2, 0.05], [1.9, 0.05], [1.7, 0.05]],
};
const base = { senaId: 7, palabra: 'hola', aprobado: false, sinModelo: false, umbral: 0.8 };

describe('motor-senas / retroalimentación', () => {
  describe('paridad con ml/signy_ml/perfil.py (mismas medidas)', () => {
    for (const [i, caso] of CASOS_PARIDAD.entries()) {
      it(`caso ${i + 1} (${caso.nombre})`, () => {
        const python = (caso as any).medidas;
        const ts = medirIntento(expandirCaptura(caso.captura as any));
        if (python === null) {
          expect(ts).toBeNull();
          return;
        }
        expect(ts).not.toBeNull();
        const cerca = (a: number | null, b: number | null, campo: string) => {
          if (b === null) expect(a).withContext(campo).toBeNull();
          else expect(Math.abs((a as number) - b)).withContext(campo).toBeLessThan(1e-6);
        };
        cerca(ts!.recorrido, python.recorrido, 'recorrido');
        cerca(ts!.duracionMs, python.duracionMs, 'duracionMs');
        cerca(ts!.dosManos, python.dosManos, 'dosManos');
        cerca(ts!.distanciaManos, python.distanciaManos, 'distanciaManos');
        if (python.extension === null) expect(ts!.extension).toBeNull();
        else python.extension.forEach((v: number, d: number) => cerca(ts!.extension![d], v, `extension[${d}]`));
      });
    }
  });

  describe('medirIntento', () => {
    it('sin manos devuelve null', () => {
      expect(medirIntento({ ancho: 640, alto: 480, frames: [{ t: 0, manos: [] }, { t: 33, manos: [] }] })).toBeNull();
    });

    it('la misma seña hecha más rápido dura menos', () => {
      const rapida = medirIntento(generarCaptura('HOLA', { ...NORMAL, duracionMs: 500 }))!;
      const lenta = medirIntento(generarCaptura('HOLA', { ...NORMAL, duracionMs: 1600 }))!;
      expect(rapida.duracionMs!).toBeLessThan(0.5 * lenta.duracionMs!);
      expect(rapida.recorrido).toBeGreaterThan(0.6 * lenta.recorrido); // el suavizado achata un poco lo rápido, no tanto
    });

    it('una seña quieta casi no tiene recorrido ni duración de movimiento', () => {
      const m = medirIntento(generarCaptura('L', { ...NORMAL, ruido: 0.01 }))!;
      expect(m.recorrido).toBeLessThan(0.3);
      expect(m.duracionMs).toBeNull();
    });

    it('en una seña de dos manos mide ambas y la distancia entre ellas', () => {
      const m = medirIntento(generarCaptura('SEPARAR', NORMAL))!;
      expect(m.dosManos).toBeGreaterThan(0.9);
      expect(m.distanciaManos!).toBeGreaterThan(1);
    });

    it('la otra mano descansando abajo no cuenta como segunda mano', () => {
      const m = medirIntento(generarCaptura('HOLA', { ...NORMAL, manoPasiva: true }))!;
      expect(m.dosManos).toBe(0);
    });

    it('detecta que la persona está lejos de la cámara', () => {
      expect(medirIntento(generarCaptura('HOLA', { ...NORMAL, persona: { tamano: 0.05 } }))!.tamano).toBeLessThan(0.07);
    });

    it('detecta que la mano apareció tarde', () => {
      const c = generarCaptura('HOLA', { duracionMs: 900 });
      const vacios = Array.from({ length: 50 }, (_, i) => ({ t: i * 33, manos: [] }));
      const corrida = c.frames.map((f) => ({ ...f, t: f.t + 50 * 33 }));
      expect(medirIntento({ ...c, frames: [...vacios, ...corrida] })!.inicio).toBeGreaterThan(0.45);
    });

    it('detecta que la seña quedó cortada al final', () => {
      const completa = generarCaptura('HOLA', { duracionMs: 1500, pausaAntesMs: 200, pausaDespuesMs: 400 });
      const cortada = { ...completa, frames: completa.frames.filter((f) => f.t <= 1100) };
      expect(medirIntento(completa)!.cortada).toBeFalse();
      expect(medirIntento(cortada)!.cortada).toBeTrue();
    });
  });

  describe('retroalimentar: comparando con cómo se hace la seña', () => {
    it('"fue muy rápido" cuando la seña duró mucho menos que lo normal', () => {
      const perfil = perfilDe(muestras('HOLA'));
      const r = retroalimentar({ ...base, medidas: medirIntento(generarCaptura('HOLA', { ...NORMAL, duracionMs: 450 })), perfil });
      expect(codigos(r)).toContain('rapido');
      expect(r.pistas.find((p) => p.codigo === 'rapido')!.texto).toMatch(/muy rápido/);
    });

    it('a velocidad normal no dice nada de la velocidad', () => {
      const perfil = perfilDe(muestras('HOLA'));
      const r = retroalimentar({ ...base, medidas: medirIntento(generarCaptura('HOLA', { ...NORMAL, semilla: 9 })), perfil });
      expect(codigos(r)).not.toContain('rapido');
      expect(codigos(r)).not.toContain('lento');
    });

    it('"usa las dos manos" si la seña es de dos manos y se vio una', () => {
      const perfil = perfilDe(muestras('SEPARAR'));
      const r = retroalimentar({ ...base, medidas: medirIntento(generarCaptura('HOLA', NORMAL)), perfil });
      expect(codigos(r)[0]).toBe('dos-manos');
    });

    it('"junta tus manos" si en una seña de dos manos van mucho más separadas', () => {
      const r = retroalimentar({
        ...base,
        medidas: medidas({ dosManos: 1, distanciaManos: 4 }),
        perfil: { ...PERFIL, dosManos: [1, 0], distanciaManos: [1.5, 0.2] },
      });
      expect(codigos(r)).toContain('juntar');
      expect(r.pistas.find((p) => p.codigo === 'juntar')!.texto).toMatch(/Junta un poco/);
    });

    it('"abre más la mano" si la seña va con la palma abierta y se hizo con el puño', () => {
      const perfil = perfilDe(muestras('B'));
      const r = retroalimentar({ ...base, medidas: medirIntento(generarCaptura('A', NORMAL)), perfil });
      expect(codigos(r)).toContain('abrir-mano');
    });

    it('señala el dedo que quedó doblado', () => {
      const r = retroalimentar({ ...base, medidas: medidas({ extension: [0.6, 1.2, 2, 1.9, 1.7] }), perfil: PERFIL });
      expect(r.pistas.map((p) => p.texto)).toContain('Estira más el dedo índice.');
    });

    it('"esta seña va quieta" si se movió mucho en una seña estática', () => {
      const perfil = perfilDe(muestras('L'));
      const r = retroalimentar({ ...base, medidas: medirIntento(generarCaptura('HOLA', NORMAL)), perfil });
      expect(codigos(r)).toContain('quieta');
    });

    it('"casi no te moviste" en una seña con movimiento', () => {
      const r = retroalimentar({ ...base, medidas: medidas({ recorrido: 0.2, duracionMs: null }), perfil: PERFIL });
      expect(codigos(r)).toContain('sin-movimiento');
    });

    it('con un perfil de pocas muestras no compara (no es confiable)', () => {
      const r = retroalimentar({ ...base, medidas: medidas({ duracionMs: 300 }), perfil: { ...PERFIL, n: 2 } });
      expect(codigos(r)).not.toContain('rapido');
    });

    it('nunca muestra más de 3 pistas', () => {
      const r = retroalimentar({
        ...base,
        medidas: medidas({ tamano: 0.04, borde: 0.6, inicio: 0.6, huecoMs: 900, duracionMs: 300, extension: [0.6, 1.2, 2, 1.9, 1.7] }),
        perfil: PERFIL,
      });
      expect(r.pistas.length).toBe(3);
      expect(codigos(r)[0]).toBe('lejos'); // primero lo de la grabación: sin eso no se puede juzgar lo demás
    });
  });

  describe('retroalimentar: cómo se grabó y qué vio el clasificador', () => {
    it('sin manos: explica cómo ponerse frente a la cámara', () => {
      const r = retroalimentar({ ...base, medidas: null });
      expect(r.titulo).toContain('No logramos ver bien tus manos');
      expect(codigos(r)).toEqual(['no-visible', 'luz']);
    });

    it('empezar tarde y alejarse se dicen aunque no haya perfil', () => {
      const r = retroalimentar({ ...base, medidas: medidas({ inicio: 0.6, tamano: 0.05 }) });
      expect(codigos(r)).toEqual(['lejos', 'tarde']);
    });

    it('si se pareció más a otra seña, la nombra', () => {
      const r = retroalimentar({
        ...base,
        medidas: medidas(),
        perfil: PERFIL,
        mejores: [{ senaId: 3, palabra: 'chao', probabilidad: 0.7 }, { senaId: 7, palabra: 'hola', probabilidad: 0.2 }],
      });
      expect(r.titulo).toBe('Casi: se pareció más a «chao»');
      expect(r.parecidaA).toEqual({ palabra: 'chao', probabilidad: 0.7 });
      expect(codigos(r)).toContain('otra-sena');
    });

    it('"¡casi!" si la seña pedida fue la primera opción pero sin llegar al umbral', () => {
      const r = retroalimentar({ ...base, medidas: medidas(), perfil: PERFIL, mejores: [{ senaId: 7, palabra: 'hola', probabilidad: 0.6 }] });
      expect(r.titulo).toBe('¡Casi lo logras!');
      expect(codigos(r)).toEqual(['general']);
    });

    it('aprobada: felicita y, como mucho, una sugerencia', () => {
      const r = retroalimentar({ ...base, aprobado: true, medidas: medidas({ duracionMs: 300, tamano: 0.05 }), perfil: PERFIL });
      expect(r.titulo).toBe('¡Excelente! Seña reconocida.');
      expect(r.pistas.length).toBe(1);
      expect(r.pistas[0].texto).toMatch(/^Para que salga aún mejor: /);
    });

    it('seña sin entrenar: no inventa una evaluación', () => {
      const r = retroalimentar({ ...base, sinModelo: true, aprobado: true, medidas: medidas() });
      expect(r.titulo).toBe('¡Buena práctica de manos!');
      expect(codigos(r)).toEqual(['sin-modelo']);
    });
  });
});
