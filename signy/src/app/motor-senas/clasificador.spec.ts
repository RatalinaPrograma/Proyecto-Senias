import { caracteristicasClasificador, ClasificadorSenas, decodificarNumeros, dimensionPorFrame, ModeloClasificadorJson } from './clasificador';
import { construirDatasetExportable, compactarCaptura, expandirCaptura, MuestraSena } from './dataset';
import { generarCaptura } from './testing/manos-sinteticas';
import { CASOS_PARIDAD, MODELO_PARIDAD } from './testing/fixture-clasificador';

const modelo = () => JSON.parse(JSON.stringify(MODELO_PARIDAD)) as ModeloClasificadorJson;

describe('motor-senas / clasificador', () => {
  describe('paridad con el entrenamiento en Python (ml/generar_fixture_paridad.py)', () => {
    const clf = ClasificadorSenas.desdeJson(modelo());

    for (const [i, caso] of CASOS_PARIDAD.entries()) {
      it(`caso ${i + 1} (${caso.nombre}): mismas características y probabilidades que Python`, () => {
        const captura = expandirCaptura(caso.captura as any);
        const vector = caracteristicasClasificador(captura, clf.modelo.caracteristicas)!;
        expect(vector.length).toBe(caso.vector.length);
        vector.forEach((v, j) => expect(Math.abs(v - caso.vector[j])).toBeLessThan(1e-8));

        const p = clf.probabilidades(vector);
        p.forEach((v, j) => expect(Math.abs(v - caso.probabilidades[j])).toBeLessThan(1e-6));
      });
    }

    it('predecir ordena por probabilidad y la mejor coincide con la de Python', () => {
      const caso = CASOS_PARIDAD[0];
      const pred = clf.predecir(expandirCaptura(caso.captura as any));
      const mejorPython = caso.probabilidades.indexOf(Math.max(...caso.probabilidades));
      expect(pred[0].senaId).toBe(clf.clases[mejorPython].senaId);
      for (let i = 1; i < pred.length; i++) expect(pred[i - 1].probabilidad).toBeGreaterThanOrEqual(pred[i].probabilidad);
      expect(pred.reduce((s, x) => s + x.probabilidad, 0)).toBeCloseTo(1, 6);
    });

    it('reconoce las señas sintéticas con las que se entrenó', () => {
      const ids = new Map(clf.clases.map((c) => [c.palabra, c.senaId]));
      for (const nombre of ['HOLA', 'SI', 'L', 'SEPARAR']) {
        const [top] = clf.predecir(generarCaptura(nombre, { semilla: 3, ruido: 0.02 }));
        expect(top.senaId).withContext(nombre).toBe(ids.get(nombre.toLowerCase())!);
      }
    });
  });

  describe('validación del modelo', () => {
    it('rechaza archivos que no son un clasificador de Signy', () => {
      expect(() => ClasificadorSenas.desdeJson({ formato: 'otro' })).toThrowError(/No es un modelo/);
      expect(() => ClasificadorSenas.desdeJson(null)).toThrowError(/No es un modelo/);
    });

    it('rechaza versiones no soportadas', () => {
      expect(() => ClasificadorSenas.desdeJson({ ...modelo(), version: 99 })).toThrowError(/Versión/);
    });

    it('rechaza capas que no coinciden con las características o las clases', () => {
      const m1 = modelo();
      m1.caracteristicas = { ...m1.caracteristicas, frames: 3 };
      expect(() => ClasificadorSenas.desdeJson(m1)).toThrowError(/características/);
      const m2 = modelo();
      m2.clases = m2.clases.slice(1);
      expect(() => ClasificadorSenas.desdeJson(m2)).toThrowError(/clases/);
    });

    it('rechaza pesos truncados', () => {
      const m = modelo();
      m.capas[0].sesgos = m.capas[0].sesgos.slice(0, 8);
      expect(() => ClasificadorSenas.desdeJson(m)).toThrowError(/tamaño inválido/);
    });

    it('conoce() indica si una seña está en el modelo', () => {
      const clf = ClasificadorSenas.desdeJson(modelo());
      expect(clf.conoce(clf.clases[0].senaId)).toBeTrue();
      expect(clf.conoce(-1)).toBeFalse();
      expect(clf.umbralSugerido).toBeGreaterThan(0);
    });
  });

  it('decodifica float16 y float32 en little-endian', () => {
    // float16: 1.0 = 0x3C00, -2.0 = 0xC000, 0.5 = 0x3800
    const f16 = btoa(String.fromCharCode(0x00, 0x3c, 0x00, 0xc0, 0x00, 0x38));
    expect(Array.from(decodificarNumeros(f16, 'float16'))).toEqual([1, -2, 0.5]);
    const f32 = btoa(String.fromCharCode(...new Uint8Array(new Float32Array([1.5, -3]).buffer)));
    expect(Array.from(decodificarNumeros(f32, 'float32'))).toEqual([1.5, -3]);
  });

  it('sin manos no hay características ni predicciones', () => {
    const vacia = { ancho: 640, alto: 480, frames: [{ t: 0, manos: [] }] };
    expect(caracteristicasClasificador(vacia, { frames: 8, usarZ: true })).toBeNull();
    expect(ClasificadorSenas.desdeJson(modelo()).predecir(vacia)).toEqual([]);
  });

  it('dimensionPorFrame cuenta 2 manos + bandera de presencia', () => {
    expect(dimensionPorFrame({ frames: 1, usarZ: true })).toBe(127);
    expect(dimensionPorFrame({ frames: 1, usarZ: false })).toBe(85);
  });
});

describe('motor-senas / dataset', () => {
  it('compactar → expandir conserva la captura (a 5 decimales)', () => {
    const original = generarCaptura('SEPARAR', { semilla: 4 });
    original.frames[0].lateralidad = ['Left', 'Right'];
    const ida = expandirCaptura(JSON.parse(JSON.stringify(compactarCaptura(original))));
    expect(ida.ancho).toBe(original.ancho);
    expect(ida.frames.length).toBe(original.frames.length);
    expect(ida.frames[0].lateralidad).toEqual(['Left', 'Right']);
    expect(ida.frames[5].manos[1][8].x).toBeCloseTo(original.frames[5].manos[1][8].x, 5);
  });

  it('expandirCaptura descarta manos corruptas', () => {
    const c = expandirCaptura({ ancho: 1, alto: 1, frames: [{ t: 0, m: [[1, 2, 3], new Array(63).fill(NaN), new Array(63).fill(0.5)] }] });
    expect(c.frames[0].manos.length).toBe(1);
  });

  it('el archivo exportado anonimiza a las personas y solo incluye señas con muestras', () => {
    const muestra = (id: number, sena_id: number, autor_id: string | null): MuestraSena => ({
      id, sena_id, autor_id, formato: 1, tipo: 'dinamica', manos_requeridas: 1,
      ancho: 640, alto: 480, duracion_ms: 1000, total_frames: 2, captura: { ancho: 640, alto: 480, frames: [] }, created_at: '',
    });
    const ds = construirDatasetExportable(
      [{ id: 1, palabra: 'hola', subnivel_id: 1 }, { id: 2, palabra: 'chao', subnivel_id: 1 }],
      [muestra(10, 1, 'uuid-ana'), muestra(11, 1, 'uuid-beto'), muestra(12, 1, 'uuid-ana'), muestra(13, 1, null)],
      new Date('2026-10-04T00:00:00Z')
    );
    expect(ds.formato).toBe('signy-dataset');
    expect(ds.senas.map((s) => s.id)).toEqual([1]);
    expect(ds.muestras.map((m) => m.participante)).toEqual(['p1', 'p2', 'p1', 'p3']);
    expect(JSON.stringify(ds)).not.toContain('uuid-');
  });
});
