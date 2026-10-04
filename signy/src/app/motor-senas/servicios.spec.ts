import { TestBed } from '@angular/core/testing';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Sena } from '../data/db-types';
import { construirModeloReferencia } from './comparacion';
import { MediaPipeManosService, URL_WASM_MEDIAPIPE, VERSION_TASKS_VISION } from './mediapipe-manos.service';
import { ReconocedorSenasService, modeloDeSena } from './reconocedor.service';
import { generarCaptura, SENAS } from './testing/manos-sinteticas';
import { MODELO_PARIDAD } from './testing/fixture-clasificador';
import { CapturaCruda } from './tipos';
import pkg from '../../../package.json';

function sena(id: number, nombre: string | null): Sena {
  const landmarks = nombre
    ? construirModeloReferencia(generarCaptura(nombre, { semilla: 100, pausaAntesMs: 300, pausaDespuesMs: 300, ruido: 0.03 }), {
        palabra: nombre,
        tipo: SENAS[nombre].tipo,
        manosRequeridas: SENAS[nombre].manos,
      })
    : null;
  return { id, subnivel_id: 1, palabra: nombre ?? 'sin-modelo', descripcion: null, video_url: null, icono: null, landmarks_referencia: landmarks, created_at: null };
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

  it('modeloDeSena ignora modelos v1, vacíos o corruptos y acepta JSON en texto', () => {
    expect(modeloDeSena(null)).toBeNull();
    expect(modeloDeSena({ landmarks_referencia: { version: 1, frames: [[0]] } })).toBeNull();
    expect(modeloDeSena({ landmarks_referencia: '{roto' })).toBeNull();
    expect(modeloDeSena({ landmarks_referencia: { version: 3, frames: [] } })).toBeNull();
    expect(modeloDeSena({ landmarks_referencia: JSON.stringify({ version: 3, tipo: 'estatica', frames: [[0, 0, 0]] }) })).not.toBeNull();
  });

  it('sin clasificador entrenado (404) usa el modelo de referencia', async () => {
    conClasificador(null);
    const r = await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
    expect(r.fuente).toBe('referencia');
    expect(r.aprobado).toBeTrue();
    expect(r.clasificador).toBeUndefined();
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
    expect(r.fuente).toBe('referencia');
  });

  it('rechaza una seña equivocada', async () => {
    conClasificador(null);
    const r = await servicio.evaluar(sena(1, 'HOLA'), alumno('SI'));
    expect(r.aprobado).toBeFalse();
    expect(r.sinManos).toBeFalse();
  });

  it('seña sin modelo ni clasificador: solo verifica que se vieron las manos', async () => {
    conClasificador(null);
    const conManos = await servicio.evaluar(sena(5, null), alumno('HOLA'));
    expect(conManos).toEqual(jasmine.objectContaining({ fuente: 'deteccion', aprobado: true, similitudPct: 80 }));
    const sinManos = await servicio.evaluar(sena(5, null), vacia);
    expect(sinManos).toEqual(jasmine.objectContaining({ fuente: 'deteccion', aprobado: false, sinManos: true }));
  });

  it('marca sinManos cuando la cámara no vio nada aunque haya modelo', async () => {
    conClasificador(null);
    expect((await servicio.evaluar(sena(1, 'HOLA'), vacia)).sinManos).toBeTrue();
  });

  describe('con el clasificador entrenado', () => {
    // El fixture de paridad conoce: 1=hola, 2=si, 3=l, 4=separar.
    beforeEach(() => conClasificador(MODELO_PARIDAD));

    it('aprueba con el clasificador una seña que conoce aunque no tenga referencia', async () => {
      const r = await servicio.evaluar(sena(1, null), alumno('HOLA'));
      expect(r.fuente).toBe('clasificador');
      expect(r.aprobado).toBeTrue();
      expect(r.clasificador!.mejores[0].senaId).toBe(1);
      expect(r.similitudPct).toBe(Math.round(r.clasificador!.probabilidad * 100));
    });

    it('rechaza si el clasificador ve otra seña', async () => {
      const r = await servicio.evaluar(sena(1, null), alumno('SI'));
      expect(r.aprobado).toBeFalse();
      expect(r.clasificador!.mejores[0].senaId).toBe(2);
    });

    it('si la referencia aprueba, el resultado se informa como "referencia"', async () => {
      const r = await servicio.evaluar(sena(1, 'HOLA'), alumno('HOLA'));
      expect(r.aprobado).toBeTrue();
      expect(r.fuente).toBe('referencia');
      expect(r.clasificador).toBeDefined();
    });

    it('una seña que el clasificador no conoce solo usa la referencia', async () => {
      const r = await servicio.evaluar(sena(99, 'GRACIAS'), alumno('GRACIAS'));
      expect(r.clasificador).toBeUndefined();
      expect(r.fuente).toBe('referencia');
    });
  });
});
