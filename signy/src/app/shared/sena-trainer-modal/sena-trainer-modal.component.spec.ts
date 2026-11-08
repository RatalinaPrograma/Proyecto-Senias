import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { SenaTrainerModalComponent } from './sena-trainer-modal.component';
import { SupabaseService } from '../../services/supabase';
import { BotonAtrasService } from '../../services/boton-atras';
import { CapturaCruda, MediaPipeManosService } from '../../motor-senas';
import { generarCaptura } from '../../motor-senas/testing/manos-sinteticas';
import { Sena } from '../../data/db-types';

describe('SenaTrainerModalComponent', () => {
  let fixture: ComponentFixture<SenaTrainerModalComponent>;
  let c: SenaTrainerModalComponent;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let modalSpy: jasmine.SpyObj<ModalController>;
  let mediaPipeSpy: jasmine.SpyObj<MediaPipeManosService>;

  const senaBase = (): Sena => ({
    id: 7, subnivel_id: 1, palabra: 'hola', descripcion: null, video_url: null, icono: null, created_at: null,
  });

  async function crear(sena: Sena) {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['agregarMuestraSena', 'contarMuestrasPorSena', 'eliminarMuestraSena']);
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
    return grabarCaptura(generarCaptura(nombre, { pausaAntesMs: 200, pausaDespuesMs: 200, ...opciones }));
  }

  function grabarCaptura(captura: CapturaCruda): number {
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

  /** Concatena dos capturas (p. ej. una de 1 mano y otra de 2) para simular una seña compuesta. */
  function concatenar(a: CapturaCruda, b: CapturaCruda): CapturaCruda {
    const fin = a.frames[a.frames.length - 1].t;
    return { ancho: a.ancho, alto: a.alto, frames: [...a.frames, ...b.frames.map((f) => ({ ...f, t: f.t + fin }))] };
  }

  it('si MediaPipe no carga muestra el error en vez de quedarse cargando', async () => {
    await crear(senaBase());
    expect(c.estadoModelo).toBe('error');
    expect(c.mensajeError).toContain('sin cámara');
  });

  describe('persona que hace la seña', () => {
    beforeEach(() => localStorage.removeItem('signy.dataset.participante'));
    afterEach(() => localStorage.removeItem('signy.dataset.participante'));

    it('sin nada guardado, parte vacío (= la cuenta)', async () => {
      await crear(senaBase());
      expect(c.participante).toBe('');
    });

    it('se recuerda para la próxima seña', async () => {
      await crear(senaBase());
      c.participante = ' Benja ';
      c.recordarParticipante();
      expect(localStorage.getItem('signy.dataset.participante')).toBe('Benja');
    });

    it('al abrir otra seña aparece la última persona', async () => {
      localStorage.setItem('signy.dataset.participante', 'Benja');
      await crear(senaBase());
      expect(c.participante).toBe('Benja');
    });

    it('borrar el campo vuelve a "tu cuenta"', async () => {
      localStorage.setItem('signy.dataset.participante', 'Benja');
      await crear(senaBase());
      c.participante = '';
      c.recordarParticipante();
      expect(localStorage.getItem('signy.dataset.participante')).toBeNull();
    });
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

  describe('grabación', () => {
    beforeEach(async () => await crear(senaBase()));

    it('no empieza a grabar hasta ver las manos y termina por TIEMPO (no por frames de pantalla)', () => {
      c.duracionDinamicaMs = 2000;
      const grabado = grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      expect(grabado).toBeGreaterThanOrEqual(2000);
      expect(grabado).toBeLessThan(2100);
      expect(c.estadoGrabacion).toBe('grabado');
      expect(c.esperandoManos).toBeFalse();
      expect(c.puedeAgregarAlDataset).toBeTrue();
    });

    it('una seña estática graba 1,5 s', () => {
      c.tipoSena = 'estatica';
      const grabado = grabar('A', { duracionMs: 2000 });
      expect(grabado).toBeGreaterThanOrEqual(1500);
      expect(c.estadoGrabacion).toBe('grabado');
      expect(c.puedeAgregarAlDataset).toBeTrue();
    });

    it('cancelar a mitad de una re-grabación conserva la grabación anterior', async () => {
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      const anterior = (c as any).capturaReciente;
      c.iniciarCuentaAtras();
      c.cancelarGrabacion();
      expect(c.estadoGrabacion).toBe('grabado');
      expect((c as any).capturaReciente).toBe(anterior);
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

  describe('seña compuesta (cambia de cantidad de manos)', () => {
    beforeEach(async () => await crear(senaBase()));

    it('avisa si la grabación empieza con 1 mano y pasa a 2', () => {
      const compuesta = concatenar(
        generarCaptura('HOLA', { pausaAntesMs: 200, duracionMs: 1000, pausaDespuesMs: 0 }),
        generarCaptura('SEPARAR', { pausaAntesMs: 0, duracionMs: 1000, pausaDespuesMs: 200 })
      );
      grabarCaptura(compuesta);
      expect(c.estadoGrabacion).toBe('grabado');
      expect(c.avisoSenaCompuesta).toBe(2);
    });

    it('no avisa si la cantidad de manos se mantiene durante toda la grabación', () => {
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      expect(c.avisoSenaCompuesta).toBeNull();
    });

    it('se limpia al empezar una grabación nueva', () => {
      const compuesta = concatenar(
        generarCaptura('HOLA', { pausaAntesMs: 200, duracionMs: 1000, pausaDespuesMs: 0 }),
        generarCaptura('SEPARAR', { pausaAntesMs: 0, duracionMs: 1000, pausaDespuesMs: 200 })
      );
      grabarCaptura(compuesta);
      expect(c.avisoSenaCompuesta).not.toBeNull();
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      expect(c.avisoSenaCompuesta).toBeNull();
    });

    it('mientras espera para grabar, avisa si lleva un rato viendo otra cantidad de manos', () => {
      c.manosRequeridas = 2;
      c.estadoGrabacion = 'grabando';
      (c as any).inicioGrabacion = null;

      c.manosDetectadasCount = 1;
      (c as any).procesarFrame({ landmarks: [] }, 20000, 640, 480);
      expect(c.avisoManosDistintas).toBeFalse(); // recién empieza a esperar

      (c as any).procesarFrame({ landmarks: [] }, 20000 + 700, 640, 480);
      expect(c.avisoManosDistintas).toBeTrue();
      expect(c.estadoGrabacion).toBe('grabando'); // sigue esperando: solo es un aviso, no cancela nada

      c.manosDetectadasCount = 2; // aparece la segunda mano: arranca a grabar y se limpia el aviso
      (c as any).procesarFrame({ landmarks: [] }, 20000 + 800, 640, 480);
      expect(c.avisoManosDistintas).toBeFalse();
    });
  });

  describe('guardar', () => {
    beforeEach(async () => await crear(senaBase()));

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

    it('sin apodo no manda la columna "participante" (funciona aunque falte la migración nueva)', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      c.participante = '   ';
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      expect('participante' in supabaseSpy.agregarMuestraSena.calls.mostRecent().args[0]).toBeFalse();
    });

    it('con apodo guarda quién hizo la seña, limpio', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      c.participante = '  Cata  ';
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      expect(supabaseSpy.agregarMuestraSena.calls.mostRecent().args[0].participante).toBe('Cata');
      expect(c.mensajeDataset).toContain('Muestra de Cata guardada');
    });

    it('si falta la migración de "participante", lo explica', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({
        data: null,
        error: { code: 'PGRST204', message: "Could not find the 'participante' column of 'muestras_sena' in the schema cache" },
      } as any);
      c.participante = 'Cata';
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      expect(c.mensajeDataset).toContain('20261013120000_participante_muestras_sena.sql');
    });

    it('la muestra queda a nombre de quien estaba grabando, aunque se cambie el campo antes de guardar', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      c.participante = 'Cata';
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      c.participante = 'Benja'; // ya se escribió el nombre de la siguiente persona
      await c.agregarAlDataset();
      expect(supabaseSpy.agregarMuestraSena.calls.mostRecent().args[0].participante).toBe('Cata');
      expect(c.mensajeDataset).toContain('Muestra de Cata guardada');
    });

    it('si la cámara se interrumpe a mitad de la grabación, cancela esa toma en vez de guardarla con un hueco', () => {
      const captura = generarCaptura('HOLA', { pausaAntesMs: 0, duracionMs: 1500 });
      c.estadoGrabacion = 'grabando';
      (c as any).inicioGrabacion = null;
      (c as any).grabador.reiniciar();
      captura.frames.slice(0, 10).forEach((f) => {
        c.manosDetectadasCount = f.manos.length;
        (c as any).procesarFrame({ landmarks: f.manos }, 10000 + f.t, captura.ancho, captura.alto);
      });
      expect(c.estadoGrabacion).toBe('grabando');
      const f = captura.frames[11];
      (c as any).procesarFrame({ landmarks: f.manos }, 10000 + f.t + 2000, captura.ancho, captura.alto);
      expect(c.estadoGrabacion).toBe('inactivo');
      expect(c.puedeAgregarAlDataset).toBeFalse();
      expect(c.mensajeDataset).toContain('se interrumpió');
    });

    it('si la app pasa a segundo plano mientras graba, cancela la toma', () => {
      c.estadoGrabacion = 'grabando';
      spyOnProperty(document, 'hidden', 'get').and.returnValue(true);
      c.alCambiarVisibilidad();
      expect(c.estadoGrabacion).toBe('inactivo');
      expect(c.mensajeDataset).toContain('segundo plano');
    });

    it('no deja cambiar de cámara mientras graba', () => {
      c.estadoGrabacion = 'grabando';
      c.alternarCamara();
      expect(c.facingMode).toBe('user');
    });

    it('"Deshacer" con doble toque borra y descuenta una sola vez', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      supabaseSpy.eliminarMuestraSena.and.resolveTo({ error: null } as any);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      await Promise.all([c.deshacerUltimaMuestra(), c.deshacerUltimaMuestra()]);
      expect(supabaseSpy.eliminarMuestraSena).toHaveBeenCalledTimes(1);
      expect(c.muestrasEnDataset).toBe(4);
    });

    it('si mientras se borra se guardó otra muestra (ráfaga con red lenta), la nueva sigue siendo la reciente', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      let terminarBorrado!: (v: any) => void;
      supabaseSpy.eliminarMuestraSena.and.returnValue(new Promise((r) => (terminarBorrado = r)) as any);
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      const borrado = c.deshacerUltimaMuestra();
      (c as any).idMuestraReciente = 56; // la ráfaga guardó la siguiente mientras tanto
      terminarBorrado({ error: null });
      await borrado;
      expect((c as any).idMuestraReciente).toBe(56);
      expect(c.muestraRecienGuardada).toBeTrue();
      expect(c.puedeAgregarAlDataset).toBeFalse();
    });

    it('la X cierra normalmente cuando no hay nada guardándose', async () => {
      await c.cerrar();
      expect(modalSpy.dismiss).toHaveBeenCalledWith(c.sena);
    });

    it('no se cierra mientras está guardando una muestra', async () => {
      c.guardandoMuestra = true;
      await c.cerrar();
      expect(modalSpy.dismiss).not.toHaveBeenCalled();
    });

    it('si no se pudo contar al abrir, después de guardar vuelve a contar en vez de decir "1 en total"', async () => {
      supabaseSpy.agregarMuestraSena.and.resolveTo({ data: { id: 55 }, error: null } as any);
      (c as any).muestrasEnDataset = null; // no se pudo contar al abrir
      supabaseSpy.contarMuestrasPorSena.and.resolveTo(new Map([[7, 23]]));
      grabar('HOLA', { duracionMs: 1200, pausaDespuesMs: 1500 });
      await c.agregarAlDataset();
      expect(c.muestrasEnDataset).toBe(23);
      expect(c.mensajeDataset).toContain('23 en total');
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

    it('mientras guarda una muestra, espera', async () => {
      await crear(senaBase());
      c.guardandoMuestra = true;
      expect(c.alPresionarAtras()).toBeTrue();
      expect(modalSpy.dismiss).not.toHaveBeenCalled();
    });
  });
});
