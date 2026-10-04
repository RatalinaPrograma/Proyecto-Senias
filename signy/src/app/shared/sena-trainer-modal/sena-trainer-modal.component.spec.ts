import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { SenaTrainerModalComponent } from './sena-trainer-modal.component';
import { SupabaseService } from '../../services/supabase';
import { BotonAtrasService } from '../../services/boton-atras';
import { MediaPipeManosService, VERSION_MOTOR, construirModeloReferencia } from '../../motor-senas';
import { generarCaptura } from '../../motor-senas/testing/manos-sinteticas';
import { grabarReferenciaAnterior } from '../../motor-senas/testing/motor-anterior';
import { Sena } from '../../data/db-types';

describe('SenaTrainerModalComponent', () => {
  let fixture: ComponentFixture<SenaTrainerModalComponent>;
  let c: SenaTrainerModalComponent;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let modalSpy: jasmine.SpyObj<ModalController>;
  let mediaPipeSpy: jasmine.SpyObj<MediaPipeManosService>;

  const senaBase = (landmarks: unknown = null): Sena => ({
    id: 7, subnivel_id: 1, palabra: 'hola', descripcion: null, video_url: null, icono: null, landmarks_referencia: landmarks, created_at: null,
  });

  async function crear(sena: Sena) {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['actualizarSena', 'agregarMuestraSena', 'contarMuestrasPorSena', 'eliminarMuestraSena']);
    supabaseSpy.contarMuestrasPorSena.and.resolveTo(new Map([[7, 4]]));
    modalSpy = jasmine.createSpyObj('ModalController', ['dismiss']);
    modalSpy.dismiss.and.resolveTo(true);
    mediaPipeSpy = jasmine.createSpyObj('MediaPipeManosService', ['obtener']);
    mediaPipeSpy.obtener.and.rejectWith(new Error('sin cámara en pruebas'));
    spyOn(console, 'error');

    await TestBed.configureTestingModule({
      imports: [SenaTrainerModalComponent],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: ModalController, useValue: modalSpy },
        { provide: MediaPipeManosService, useValue: mediaPipeSpy },
      ],
    });
    // El componente importa IonicModule, que trae su propio ModalController (con
    // dependencias que no existen en pruebas): se reemplaza igual que en admin-vocabulario.
    TestBed.overrideProvider(ModalController, { useValue: modalSpy });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(SenaTrainerModalComponent);
    c = fixture.componentInstance;
    c.sena = sena;
    await c.ngOnInit();
  }

  /**
   * Simula los frames que entregaría MediaPipe durante una grabación. Si la
   * captura sintética se acaba antes del tiempo de grabación, se siguen
   * entregando frames sin manos (la cámara no se detiene). Devuelve el tiempo
   * grabado en ms.
   */
  function grabar(nombre: string, opciones = {}): number {
    const captura = generarCaptura(nombre, { pausaAntesMs: 200, pausaDespuesMs: 200, ...opciones });
    c.estadoGrabacion = 'grabando';
    (c as any).inicioGrabacion = null;
    (c as any).grabador.reiniciar();
    const ultimo = captura.frames[captura.frames.length - 1].t;
    for (let i = 0; c.estadoGrabacion === 'grabando' && i < captura.frames.length + 300; i++) {
      const f = captura.frames[i] ?? { t: ultimo + (i - captura.frames.length + 1) * 33, manos: [] };
      c.manosDetectadasCount = f.manos.length;
      (c as any).procesarFrame({ landmarks: f.manos }, 10000 + f.t, captura.ancho, captura.alto);
    }
    return (c as any).grabador.duracionMs;
  }

  it('si MediaPipe no carga muestra el error en vez de quedarse cargando', async () => {
    await crear(senaBase());
    expect(c.estadoModelo).toBe('error');
    expect(c.mensajeError).toContain('sin cámara');
  });

  it('carga cuántas muestras tiene la seña en el dataset', async () => {
    await crear(senaBase());
    expect(c.muestrasEnDataset).toBe(4);
  });

  it('si la tabla del dataset aún no existe, no rompe la pantalla', async () => {
    supabaseSpy = undefined as any;
    await crear(senaBase());
    supabaseSpy.contarMuestrasPorSena.and.rejectWith({ code: '42P01' });
    await (c as any).cargarConteoDataset();
    expect(c.muestrasEnDataset).toBeNull();
  });

  it('una referencia v2 existente se marca como desactualizada pero se puede probar', async () => {
    const v2 = grabarReferenciaAnterior(generarCaptura('HOLA', { semilla: 1 }), 'dinamica', 1);
    await crear(senaBase(v2));
    expect(c.modeloExistente).not.toBeNull();
    expect(c.modeloDesactualizado).toBeTrue();
    expect(c.estadoGrabacion).toBe('grabado');
  });

  it('una referencia v1 (ya no comparable) se marca desactualizada y no se usa', async () => {
    await crear(senaBase({ version: 1, frames: [[0]] }));
    expect(c.modeloExistente).toBeNull();
    expect(c.modeloDesactualizado).toBeTrue();
  });

  describe('grabación', () => {
    beforeEach(async () => await crear(senaBase()));

    it('no empieza a grabar hasta ver las manos y termina por TIEMPO (no por frames de pantalla)', () => {
      c.duracionDinamicaMs = 2000;
      const grabado = grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      expect(grabado).toBeGreaterThanOrEqual(2000);
      expect(grabado).toBeLessThan(2100);
      expect(c.estadoGrabacion).toBe('grabado');
      expect(c.esperandoManos).toBeFalse();
      expect(c.modeloNuevo!.version).toBe(VERSION_MOTOR);
      expect(c.modeloNuevo!.tipo).toBe('dinamica');
      expect(c.modoPruebaActivo).toBeTrue();
      expect(c.puedeAgregarAlDataset).toBeTrue();
    });

    it('una seña estática graba 1,5 s y guarda un solo frame', () => {
      c.tipoSena = 'estatica';
      grabar('A', { duracionMs: 2000 });
      expect(c.modeloNuevo!.frames.length).toBe(1);
    });

    it('la prueba en vivo reconoce la seña recién grabada y rechaza otra', fakeAsync(() => {
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1800 });
      const probar = (nombre: string) => {
        c.activarModoPrueba();
        const cap = generarCaptura(nombre, { pausaAntesMs: 200, pausaDespuesMs: 200, semilla: 5 });
        for (const f of cap.frames) (c as any).procesarFrame({ landmarks: f.manos }, 50000 + f.t, cap.ancho, cap.alto);
        return c.resultadoEnVivo;
      };
      expect(probar('HOLA')!.esCoincidente).toBeTrue();
      expect(probar('SI')?.esCoincidente ?? false).toBeFalse();
    }));

    it('cancelar a mitad de una re-grabación conserva la referencia anterior', async () => {
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      const anterior = c.modeloNuevo;
      c.iniciarCuentaAtras();
      c.cancelarGrabacion();
      expect(c.estadoGrabacion).toBe('grabado');
      expect(c.modeloVigente).toBe(anterior);
    });

    it('si nunca aparecen las manos, se cancela sola a los 15 s', fakeAsync(() => {
      spyOn(window, 'alert');
      c.iniciarCuentaAtras();
      tick(3000);
      expect(c.estadoGrabacion).toBe('grabando');
      tick(15000);
      expect(c.estadoGrabacion).toBe('inactivo');
      expect(window.alert).toHaveBeenCalled();
    }));
  });

  describe('guardar', () => {
    beforeEach(async () => await crear(senaBase()));

    it('"Usar como referencia" guarda el modelo v3 y cierra devolviendo la seña', async () => {
      supabaseSpy.actualizarSena.and.resolveTo({ error: null } as any);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      const modelo = c.modeloNuevo;
      await c.guardarModelo();
      expect(supabaseSpy.actualizarSena).toHaveBeenCalledWith(7, { landmarks_referencia: modelo });
      expect(c.sena.landmarks_referencia).toBe(modelo);
      expect(modalSpy.dismiss).toHaveBeenCalledWith(c.sena);
    });

    it('sin grabación nueva no guarda nada', async () => {
      await c.guardarModelo();
      expect(supabaseSpy.actualizarSena).not.toHaveBeenCalled();
    });

    it('"Al dataset" guarda la captura CRUDA compacta y suma al contador', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      const fila = supabaseSpy.agregarMuestraSena.calls.mostRecent().args[0];
      expect(fila.sena_id).toBe(7);
      expect(fila.tipo).toBe('dinamica');
      expect(fila.captura.frames[0].m[0].length).toBe(63);
      expect(fila.total_frames).toBe(fila.captura.frames.length);
      expect(c.muestrasEnDataset).toBe(5);
      expect(c.puedeAgregarAlDataset).toBeFalse(); // no duplicar la misma grabación
    });

    it('"Deshacer" borra exactamente la muestra recién guardada', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      supabaseSpy.eliminarMuestraSena.and.resolveTo({ error: null } as any);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      await c.deshacerUltimaMuestra();
      expect(supabaseSpy.eliminarMuestraSena).toHaveBeenCalledWith(55);
      expect(c.muestrasEnDataset).toBe(4);
      expect(c.puedeAgregarAlDataset).toBeTrue();
    });

    it('si falta la migración, lo explica en vez de mostrar un error críptico', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: null, error: { code: '42P01', message: 'relation "muestras_sena" does not exist' } } as any);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      expect(c.mensajeDataset).toContain('20261004120000_dataset_muestras_sena.sql');
    });
  });

  describe('ráfaga de muestras', () => {
    beforeEach(async () => {
      await crear(senaBase());
      c.estadoCamara = 'activa';
      c.estadoModelo = 'listo';
    });

    it('graba 5 muestras seguidas y guarda cada una en el dataset', fakeAsync(() => {
      let id = 100;
      supabaseSpy.agregarMuestraSena.and.callFake(async () => ({ data: { id: id++ }, error: null }) as any);
      c.iniciarRafaga();
      expect(c.enRafaga).toBeTrue();
      for (let i = 0; i < 5; i++) {
        tick(3000); // cuenta atrás
        expect(c.estadoGrabacion).toBe('grabando');
        grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500, semilla: i + 1 });
        tick(); // continuarRafaga guarda la muestra
        tick(1200); // pausa antes de la siguiente
      }
      expect(supabaseSpy.agregarMuestraSena).toHaveBeenCalledTimes(5);
      expect(c.enRafaga).toBeFalse();
      expect(c.muestrasEnDataset).toBe(9);
      expect(c.mensajeDataset).toContain('Ráfaga lista: 5');
    }));

    it('si falla un guardado, la ráfaga se detiene y explica por qué', fakeAsync(() => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: null, error: { code: '42P01', message: 'x' } } as any);
      c.iniciarRafaga();
      tick(3000);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      tick();
      tick(5000);
      expect(c.enRafaga).toBeFalse();
      expect(c.estadoGrabacion).toBe('grabado');
      expect(c.mensajeDataset).toContain('migración');
      expect(supabaseSpy.agregarMuestraSena).toHaveBeenCalledTimes(1);
    }));

    it('"Cancelar" detiene la ráfaga', fakeAsync(() => {
      c.iniciarRafaga();
      tick(1000);
      c.cancelarGrabacion();
      tick(10000);
      expect(c.enRafaga).toBeFalse();
      expect(c.estadoGrabacion).toBe('inactivo');
    }));

    it('no arranca sin cámara ni dos veces a la vez', () => {
      c.estadoCamara = 'apagada';
      c.iniciarRafaga();
      expect(c.enRafaga).toBeFalse();
      c.estadoCamara = 'activa';
      c.iniciarRafaga();
      const total = c.rafagaTotal;
      c.iniciarRafaga();
      expect(c.rafagaTotal).toBe(total);
      c.terminarRafaga();
    });
  });

  it('el modelo que construye coincide con construirModeloReferencia (misma lógica que la app)', async () => {
    await crear(senaBase());
    grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 300 });
    const esperado = construirModeloReferencia((c as any).capturaReciente, { palabra: 'hola', tipo: 'dinamica', manosRequeridas: 1 });
    expect(c.modeloNuevo).toEqual(esperado);
  });

  describe('botón atrás del teléfono', () => {
    it('se hace cargo mientras el modal está abierto', async () => {
      await crear(senaBase());
      const servicio = TestBed.inject(BotonAtrasService);
      const quitar = jasmine.createSpy('quitar');
      spyOn(servicio, 'registrar').and.returnValue(quitar);
      await c.ngOnInit();
      expect(servicio.registrar).toHaveBeenCalled();
      c.ngOnDestroy();
      expect(quitar).toHaveBeenCalled();
    });

    it('sin nada en curso, cierra el modal como la X', async () => {
      await crear(senaBase());
      expect(c.alPresionarAtras()).toBeTrue();
      await Promise.resolve();
      expect(modalSpy.dismiss).toHaveBeenCalled();
    });

    it('corta primero una grabación en curso, sin cerrar el modal', async () => {
      await crear(senaBase());
      c.estadoGrabacion = 'grabando';
      expect(c.alPresionarAtras()).toBeTrue();
      expect(c.estadoGrabacion).toBe('inactivo');
      expect(modalSpy.dismiss).not.toHaveBeenCalled();
    });

    it('detiene una ráfaga en curso', async () => {
      await crear(senaBase());
      c.rafagaTotal = 5;
      c.estadoGrabacion = 'grabado';
      expect(c.alPresionarAtras()).toBeTrue();
      expect(c.enRafaga).toBeFalse();
      expect(modalSpy.dismiss).not.toHaveBeenCalled();
    });

    it('mientras guarda, espera', async () => {
      await crear(senaBase());
      c.guardando = true;
      expect(c.alPresionarAtras()).toBeTrue();
      expect(modalSpy.dismiss).not.toHaveBeenCalled();
    });
  });
});
