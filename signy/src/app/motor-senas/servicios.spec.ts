import { TestBed } from '@angular/core/testing';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Sena } from '../data/db-types';
import { MediaPipeManosService, URL_WASM_MEDIAPIPE, VERSION_TASKS_VISION } from './mediapipe-manos.service';
import { ReconocedorSenasService, UMBRAL_APROBACION, unirEquivalentes } from './reconocedor.service';
import { generarCaptura } from './testing/manos-sinteticas';
import { MODELO_PARIDAD } from './testing/fixture-clasificador';
import { CapturaCruda } from './tipos';
import pkg from '../../../package.json';

function sena(id: number, nombre: string): Sena {
  return { id, subnivel_id: 1, palabra: nombre, descripcion: null, video_url: null, icono: null, created_at: null };
}

const alumno = (nombre: string): CapturaCruda => generarCaptura(nombre, { pausaAntesMs: 300, pausaDespuesMs: 300, ruido: 0.03, semilla: 9 });
const vacia: CapturaCruda = { ancho: 640, alto: 480, frames: Array.from({ length: 20 }, (_, i) => ({ t: i * 33, manos: [] })) };

describe('motor-senas / MediaPipeManosService', () => {
  let servicio: MediaPipeManosService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    servicio = TestBed.inject(MediaPipeManosService);
    spyOn(console, 'warn');
  });

  it('la versión del WASM coincide con la del paquete instalado', () => {
    const declarada = (pkg as any).dependencies['@mediapipe/tasks-vision'].replace(/^[\^~]/, '');
    expect(VERSION_TASKS_VISION).toBe(declarada);
    expect(URL_WASM_MEDIAPIPE).toContain(`@${declarada}/`);
  });

  it('crea un único HandLandmarker y lo reutiliza', async () => {
    const falso = {} as HandLandmarker;
    spyOn(FilesetResolver, 'forVisionTasks').and.resolveTo({} as any);
    const crear = spyOn(HandLandmarker, 'createFromOptions').and.resolveTo(falso);
    expect(await servicio.obtener()).toBe(falso);
    expect(await servicio.obtener()).toBe(falso);
    expect(crear).toHaveBeenCalledTimes(1);
    expect((crear.calls.argsFor(0)[1] as any).baseOptions.delegate).toBe('GPU');
  });

  it('si la GPU no está disponible, reintenta con CPU', async () => {
    spyOn(FilesetResolver, 'forVisionTasks').and.resolveTo({} as any);
    const crear = spyOn(HandLandmarker, 'createFromOptions').and.callFake(async (_v: any, o: any) => {
      if (o.baseOptions.delegate === 'GPU') throw new Error('WebGL no soportado');
      return { cpu: true } as any;
    });
    expect(await servicio.obtener()).toEqual({ cpu: true } as any);
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it('si falla la descarga, permite reintentar después', async () => {
    const wasm = spyOn(FilesetResolver, 'forVisionTasks').and.rejectWith(new Error('sin red'));
    spyOn(HandLandmarker, 'createFromOptions').and.resolveTo({} as any);
    await expectAsync(servicio.obtener()).toBeRejected();
    wasm.and.resolveTo({} as any);
    await expectAsync(servicio.obtener()).toBeResolved();
  });
});

describe('motor-senas / ReconocedorSenasService', () => {
  let servicio: ReconocedorSenasService;
  let fetchSpy: jasmine.Spy;

  function conClasificador(json: unknown | null) {
    fetchSpy.and.resolveTo(json ? new Response(JSON.stringify(json)) : new Response('', { status: 404 }));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    servicio = TestBed.inject(ReconocedorSenasService);
    fetchSpy = spyOn(window, 'fetch');
    spyOn(console, 'warn');
  });

  it('sin clasificador entrenado (404): solo verifica que se vieron las manos', async () => {
    conClasificador(null);
    const conManos = await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
    expect(conManos).toEqual(jasmine.objectContaining({ fuente: 'deteccion', aprobado: true, similitudPct: 80 }));
    expect(await servicio.clasificador()).toBeNull();
  });

  it('carga el clasificador una sola vez', async () => {
    conClasificador(null);
    await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
    await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('un archivo de modelo inválido no rompe la evaluación', async () => {
    conClasificador({ formato: 'cualquier-cosa' });
    const r = await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
    expect(r.fuente).toBe('deteccion');
  });

  it('seña sin clasificador: sin manos no aprueba', async () => {
    conClasificador(null);
    const sinManos = await servicio.evaluar(sena(5, 'HOLA'), vacia);
    expect(sinManos).toEqual(jasmine.objectContaining({ fuente: 'deteccion', aprobado: false, sinManos: true }));
  });

  describe('con el clasificador entrenado', () => {
    // El fixture de paridad conoce: 1=hola, 2=si, 3=l, 4=separar.
    beforeEach(() => conClasificador(MODELO_PARIDAD));

    it('aprueba con el clasificador una seña que conoce', async () => {
      const r = await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
      expect(r.fuente).toBe('clasificador');
      expect(r.aprobado).toBeTrue();
      expect(r.clasificador!.mejores[0].senaId).toBe(1);
      expect(r.similitudPct).toBe(Math.round(r.clasificador!.probabilidad * 100));
    });

    it('aprueba desde 75 % de seguridad (UMBRAL_APROBACION) y rechaza por debajo', async () => {
      expect(UMBRAL_APROBACION).toBe(0.75);
      const clf = (await servicio.clasificador())!;
      const predecir = spyOn(clf, 'predecir');
      predecir.and.returnValue([{ senaId: 1, palabra: 'HOLA', probabilidad: 0.76 }, { senaId: 2, palabra: 'SI', probabilidad: 0.24 }]);
      expect((await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'))).aprobado).toBeTrue();
      predecir.and.returnValue([{ senaId: 1, palabra: 'HOLA', probabilidad: 0.74 }, { senaId: 2, palabra: 'SI', probabilidad: 0.26 }]);
      expect((await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'))).aprobado).toBeFalse();
    });

    it('rechaza si el clasificador ve otra seña', async () => {
      const r = await servicio.evaluar(sena(1, 'HOLA'), alumno('SI'));
      expect(r.aprobado).toBeFalse();
      expect(r.clasificador!.mejores[0].senaId).toBe(2);
    });

    it('una seña que el clasificador no conoce cae a solo detección de manos', async () => {
      const r = await servicio.evaluar(sena(99, 'GRACIAS'), alumno('GRACIAS'));
      expect(r.clasificador).toBeUndefined();
      expect(r.fuente).toBe('deteccion');
    });
  });
});

describe('motor-senas / unirEquivalentes (Hola y Chao son la misma seña)', () => {
  const mejores = [
    { senaId: 1, palabra: 'Hola', probabilidad: 0.5 },
    { senaId: 2, palabra: 'Chao', probabilidad: 0.3 },
    { senaId: 3, palabra: 'Gracias', probabilidad: 0.2 },
  ];

  it('al pedir "Chao", la predicción de "Hola" cuenta como la misma seña', () => {
    const r = unirEquivalentes(mejores, sena(2, 'Chao'));
    expect(r[0].senaId).toBe(2);
    expect(r[0].probabilidad).toBeCloseTo(0.8, 5);
    expect(r.map((p) => p.senaId)).toEqual([2, 3]);
  });

  it('al pedir "Hola", también suma "Chao" (sin importar mayúsculas)', () => {
    const r = unirEquivalentes(mejores, sena(1, 'HOLA'));
    expect(r[0]).toEqual({ senaId: 1, palabra: 'HOLA', probabilidad: jasmine.any(Number) });
    expect(r[0].probabilidad).toBeCloseTo(0.8, 5);
  });

  it('las demás señas no cambian', () => {
    expect(unirEquivalentes(mejores, sena(3, 'Gracias'))).toBe(mejores);
  });
});
