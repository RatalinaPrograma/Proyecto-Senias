import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { LessonPage } from './lesson.page';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { TtsService } from '../services/tts';
import { ImageCacheService } from '../services/image-cache';
import { statsDePrueba } from '../../testing/supabase-mock';
import { Sena, Nivel, Subnivel } from '../data/db-types';
import { EvaluacionSena, MediaPipeManosService, ReconocedorSenasService } from '../motor-senas';
import { BotonAtrasService } from '../services/boton-atras';

describe('LessonPage', () => {
  let component: LessonPage;
  let fixture: ComponentFixture<LessonPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let contenidoSpy: jasmine.SpyObj<ContenidoService>;
  let ttsSpy: jasmine.SpyObj<TtsService>;
  let cacheSpy: jasmine.SpyObj<ImageCacheService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let botonAtrasSpy: jasmine.SpyObj<BotonAtrasService>;
  let quitarManejador: jasmine.Spy;
  let alertCtrlSpy: jasmine.SpyObj<AlertController>;
  let alertaFalsa: { present: jasmine.Spy; dismiss: jasmine.Spy; onDidDismiss: () => Promise<unknown>; cerrar: () => void };

  const nivel: Nivel = { id: 1, numero_nivel: 1, nombre: 'Nivel 1', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null };
  const subnivel: Subnivel = { id: 10, nivel_id: 1, numero_subnivel: 1, nombre: 'Sub 1', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null };
  const senas: Sena[] = [
    { id: 1, subnivel_id: 10, palabra: 'hola', video_url: 'https://cdn/hola.gif', icono: '👋', descripcion: null, created_at: null } as any,
    { id: 2, subnivel_id: 10, palabra: 'gato', video_url: 'https://cdn/gato.gif', icono: '🐱', descripcion: null, created_at: null } as any,
  ];
  const pool = [
    { palabra: 'hola', icono: '👋' }, { palabra: 'gato', icono: '🐱' },
    { palabra: 'perro', icono: '🐶' }, { palabra: 'casa', icono: '🏠' }, { palabra: 'sol', icono: '☀️' },
  ];

  function rutaConSubnivel(id = '10') {
    return { snapshot: { paramMap: convertToParamMap({ subnivelId: id }) } } as any;
  }

  function prepararCargaExitosa() {
    supabaseSpy.getUsuarioLocal.and.resolveTo({ user: { id: 'user-1' }, error: null } as any);
    supabaseSpy.getProfile.and.resolveTo({ data: { full_name: 'Benja Muñoz' } as any, error: null });
    contenidoSpy.getSubnivelPorId.and.resolveTo(subnivel);
    contenidoSpy.getNivelPorId.and.resolveTo(nivel);
    contenidoSpy.getSenas.and.resolveTo(senas);
    contenidoSpy.getMisStats.and.resolveTo(statsDePrueba({ vidas: 5, ultima_fecha_practica: null, racha_congeladores: 0 }));
    contenidoSpy.getPoolDePalabras.and.resolveTo(pool);
    contenidoSpy.minutosParaProximaVida.and.returnValue(0);
    contenidoSpy.fechaHoy.and.returnValue('2026-09-08');
    cacheSpy.precargarSubnivel.and.resolveTo();
  }

  async function crearComponente(ruta = rutaConSubnivel()) {
    await TestBed.configureTestingModule({
      imports: [LessonPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: ContenidoService, useValue: contenidoSpy },
        { provide: TtsService, useValue: ttsSpy },
        { provide: ImageCacheService, useValue: cacheSpy },
        { provide: ActivatedRoute, useValue: ruta },
        { provide: Router, useValue: routerSpy },
        { provide: BotonAtrasService, useValue: botonAtrasSpy },
        { provide: AlertController, useValue: alertCtrlSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LessonPage);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['getUsuarioLocal', 'getProfile']);
    contenidoSpy = jasmine.createSpyObj('ContenidoService', [
      'getSubnivelPorId', 'getNivelPorId', 'getSenas', 'getMisStats', 'getPoolDePalabras',
      'minutosParaProximaVida', 'fechaHoy', 'sumarDias', 'descontarVida', 'registrarIntento',
      'marcarSubnivelCompletado', 'actualizarStatsTrasLeccion', 'avanzarNivelSiCorresponde',
      'obtenerHistorialRacha', 'otorgarLogroPorCodigo',
    ]);
    ttsSpy = jasmine.createSpyObj('TtsService', ['hablarSiHabilitado']);
    cacheSpy = jasmine.createSpyObj('ImageCacheService', ['precargarSubnivel', 'liberarMemoriaRAM']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    quitarManejador = jasmine.createSpy('quitarManejador');
    botonAtrasSpy = jasmine.createSpyObj('BotonAtrasService', ['registrar', 'paraPantalla']);
    botonAtrasSpy.registrar.and.returnValue(quitarManejador);
    // paraPantalla real (es solo azúcar sobre registrar).
    botonAtrasSpy.paraPantalla.and.callFake((m) => BotonAtrasService.prototype.paraPantalla.call(botonAtrasSpy, m));
    let alCerrar: (v: unknown) => void = () => {};
    const cerrada = new Promise((r) => (alCerrar = r));
    alertaFalsa = {
      present: jasmine.createSpy('present').and.resolveTo(),
      dismiss: jasmine.createSpy('dismiss').and.resolveTo(true),
      onDidDismiss: () => cerrada,
      cerrar: () => alCerrar({ role: 'cancel' }),
    };
    alertCtrlSpy = jasmine.createSpyObj('AlertController', ['create']);
    alertCtrlSpy.create.and.resolveTo(alertaFalsa as any);

    contenidoSpy.registrarIntento.and.resolveTo();
    contenidoSpy.otorgarLogroPorCodigo.and.resolveTo();
    contenidoSpy.sumarDias.and.callFake((fecha: string, dias: number) => {
      const d = new Date(fecha + 'T12:00:00');
      d.setDate(d.getDate() + dias);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dia = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dia}`;
    });
  });

  describe('ngOnInit', () => {
    it('redirige a login si no hay sesión', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: null, error: null } as any);
      await crearComponente();

      await component.ngOnInit();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('pasa a "error" si el subnivel no existe', async () => {
      prepararCargaExitosa();
      contenidoSpy.getSubnivelPorId.and.resolveTo(null);
      await crearComponente();

      await component.ngOnInit();

      expect(component.fase).toBe('error');
      expect(component.errorMsg).toContain('no existe');
    });

    it('pasa a "error" si el subnivel no tiene señas cargadas todavía', async () => {
      prepararCargaExitosa();
      contenidoSpy.getSenas.and.resolveTo([]);
      await crearComponente();

      await component.ngOnInit();

      expect(component.fase).toBe('error');
      expect(component.errorMsg).toContain('no tiene señas');
    });

    it('pasa a "sinvidas" si el usuario llega sin vidas', async () => {
      prepararCargaExitosa();
      contenidoSpy.getMisStats.and.resolveTo(statsDePrueba({ vidas: 0 }));
      await crearComponente();

      await component.ngOnInit();

      expect(component.fase).toBe('sinvidas');
    });

    it('carga a "flash" con vidas disponibles, arma rondas y preguntas', async () => {
      prepararCargaExitosa();
      await crearComponente();

      await component.ngOnInit();

      expect(component.fase).toBe('flash');
      expect(component.senas.length).toBe(2);
      expect(component.preguntas.length).toBe(2);
      expect(component.cargaProgreso).toBe(100);
    });

    it('extrae solo el primer nombre del perfil', async () => {
      prepararCargaExitosa();
      await crearComponente();

      await component.ngOnInit();

      expect(component.primerNombre).toBe('Benja');
    });

    it('no llama a precargarSubnivel si ninguna seña tiene video_url', async () => {
      prepararCargaExitosa();
      contenidoSpy.getSenas.and.resolveTo(senas.map(s => ({ ...s, video_url: null })));
      await crearComponente();

      await component.ngOnInit();

      expect(cacheSpy.precargarSubnivel).not.toHaveBeenCalled();
    });

    it('muestra un error de conexión si algo inesperado revienta', async () => {
      prepararCargaExitosa();
      supabaseSpy.getUsuarioLocal.and.rejectWith(new Error('sin red'));
      await crearComponente();

      await component.ngOnInit();

      expect(component.fase).toBe('error');
      expect(component.errorMsg).toContain('No se pudo cargar la lección');
    });
  });

  describe('flashcards', () => {
    beforeEach(async () => { prepararCargaExitosa(); await crearComponente(); await component.ngOnInit(); });

    it('voltear() alterna el estado de la tarjeta', () => {
      expect(component.flipped).toBeFalse();
      component.voltear();
      expect(component.flipped).toBeTrue();
    });

    it('escucharPalabra lee la palabra actual', () => {
      component.escucharPalabra();
      expect(ttsSpy.hablarSiHabilitado).toHaveBeenCalledWith('user-1', 'hola');
    });

    it('siguienteFlash avanza a la próxima tarjeta y resetea el flip', () => {
      component.flipped = true;
      component.siguienteFlash();
      expect(component.flashIndex).toBe(1);
      expect(component.flipped).toBeFalse();
    });

    it('siguienteFlash en la última tarjeta pasa a la fase "match"', () => {
      component.flashIndex = component.senas.length - 1;
      component.siguienteFlash();
      expect(component.fase).toBe('match');
    });
  });

  describe('emparejar (match)', () => {
    beforeEach(async () => { prepararCargaExitosa(); await crearComponente(); await component.ngOnInit(); component.fase = 'match'; });

    it('arma una sola ronda cuando hay 4 o menos señas', () => {
      expect(component.totalRondas).toBe(1);
    });

    it('un par correcto se agrega a emparejados y limpia la selección', () => {
      const mano = component.manos[0];
      component.elegirMano(mano);
      component.elegirPalabra(mano.palabra);

      expect(component.emparejados).toContain(mano.palabra);
      expect(component.selMano).toBeNull();
      expect(component.selPalabra).toBeNull();
    });

    it('un par incorrecto marca matchMal y se limpia solo después de 500ms', () => {
      jasmine.clock().install();
      const [manoA, manoB] = component.manos;
      const otraPalabra = component.palabrasMezcladas.find(p => p.palabra !== manoA.palabra)!.palabra;

      component.elegirMano(manoA);
      component.elegirPalabra(otraPalabra);

      expect(component.matchMal).toBeTrue();
      jasmine.clock().tick(600);
      expect(component.matchMal).toBeFalse();
      expect(component.selMano).toBeNull();
      jasmine.clock().uninstall();
    });

    it('no permite volver a elegir una palabra ya emparejada', () => {
      const mano = component.manos[0];
      component.elegirMano(mano);
      component.elegirPalabra(mano.palabra);
      const llamadasPrevias = ttsSpy.hablarSiHabilitado.calls.count();

      component.elegirPalabra(mano.palabra); // ya está emparejada

      expect(ttsSpy.hablarSiHabilitado.calls.count()).toBe(llamadasPrevias);
    });

    it('matchCompleto es true cuando se emparejaron todas las manos de la ronda', () => {
      for (const mano of component.manos) {
        component.elegirMano(mano);
        component.elegirPalabra(mano.palabra);
      }
      expect(component.matchCompleto).toBeTrue();
    });

    it('siguienteRondaOQuiz pasa a "quiz" si no hay más rondas', () => {
      component.siguienteRondaOQuiz();
      expect(component.fase).toBe('quiz');
    });
  });

  describe('emparejar con más de 4 señas (varias rondas)', () => {
    beforeEach(async () => {
      prepararCargaExitosa();
      const muchasSenas: Sena[] = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1, subnivel_id: 10, palabra: `palabra${i}`, video_url: null, icono: null, descripcion: null, created_at: null,
      } as any));
      contenidoSpy.getSenas.and.resolveTo(muchasSenas);
      await crearComponente();
      await component.ngOnInit();
    });

    it('reparte en rondas de a 4, con la última más chica', () => {
      expect(component.totalRondas).toBe(2);
    });

    it('siguienteRondaOQuiz avanza de ronda en vez de ir directo al quiz', () => {
      component.siguienteRondaOQuiz();
      expect(component.fase).not.toBe('quiz');
      expect(component.rondaActual).toBe(1);
    });
  });

  describe('quiz', () => {
    beforeEach(async () => { prepararCargaExitosa(); await crearComponente(); await component.ngOnInit(); component.fase = 'quiz'; });

    it('progresoPct calcula el porcentaje sobre el total de preguntas', () => {
      expect(component.progresoPct).toBe(0);
      component.qi = 1;
      expect(component.progresoPct).toBe(50);
    });

    it('una respuesta correcta suma 10 XP', async () => {
      await component.elegirOpcion(component.preguntaActual.palabra);
      expect(component.estado).toBe('correcto');
      expect(component.xpGanado).toBe(10);
    });

    it('una respuesta incorrecta descuenta una vida y la guarda para repasar', async () => {
      contenidoSpy.descontarVida.and.resolveTo(4);
      const incorrecta = component.preguntaActual.opciones.find(o => o !== component.preguntaActual.palabra)!;

      await component.elegirOpcion(incorrecta);

      expect(component.estado).toBe('incorrecto');
      expect(component.vidas).toBe(4);
      expect(component.xpGanado).toBe(0);
    });

    it('no permite responder dos veces la misma pregunta', async () => {
      await component.elegirOpcion(component.preguntaActual.palabra);
      contenidoSpy.registrarIntento.calls.reset();

      const otra = component.preguntaActual.opciones.find(o => o !== component.preguntaActual.palabra)!;
      await component.elegirOpcion(otra);

      expect(contenidoSpy.registrarIntento).not.toHaveBeenCalled();
    });

    it('siguientePregunta avanza a la próxima si quedan preguntas', async () => {
      await component.elegirOpcion(component.preguntaActual.palabra);
      component.siguientePregunta();
      expect(component.qi).toBe(1);
      expect(component.estado).toBeNull();
    });

    it('siguientePregunta entra en modo repaso si falló alguna y ya no quedan preguntas', async () => {
      contenidoSpy.descontarVida.and.resolveTo(4);
      // Falla ambas preguntas de la ronda principal.
      for (let i = 0; i < component.preguntas.length; i++) {
        const incorrecta = component.preguntaActual.opciones.find(o => o !== component.preguntaActual.palabra)!;
        await component.elegirOpcion(incorrecta);
        component.siguientePregunta();
      }

      expect(component.modoRepaso).toBeTrue();
      expect(component.qi).toBe(0);
      expect(component.preguntas.length).toBe(2); // las 2 falladas vuelven a preguntarse
    });

    it('en modo repaso, fallar de nuevo te deja en la misma pregunta', async () => {
      (component as any).modoRepaso = true;
      contenidoSpy.descontarVida.and.resolveTo(5);
      const incorrecta = component.preguntaActual.opciones.find(o => o !== component.preguntaActual.palabra)!;

      await component.elegirOpcion(incorrecta);
      const qiAntes = component.qi;
      component.siguientePregunta();

      expect(component.qi).toBe(qiAntes); // no avanza
      expect(component.seleccionada).toBeNull(); // pero se limpia la selección para reintentar
    });

    it('en modo repaso, una respuesta incorrecta NO descuenta vida ni suma XP de nuevo', async () => {
      (component as any).modoRepaso = true;
      const vidasAntes = component.vidas;
      const incorrecta = component.preguntaActual.opciones.find(o => o !== component.preguntaActual.palabra)!;

      await component.elegirOpcion(incorrecta);

      expect(component.vidas).toBe(vidasAntes);
      expect(contenidoSpy.descontarVida).not.toHaveBeenCalled();
    });

    it('sin vidas al fallar la última, pasa a "sinvidas" con 240 minutos de espera', async () => {
      contenidoSpy.descontarVida.and.resolveTo(0);
      component.qi = component.preguntas.length - 1;
      const incorrecta = component.preguntaActual.opciones.find(o => o !== component.preguntaActual.palabra)!;
      await component.elegirOpcion(incorrecta);

      component.siguientePregunta();

      expect(component.fase).toBe('sinvidas');
      expect(component.minutosParaVida).toBe(240);
    });

    it('termina la ronda y pasa a "record" si respondió todo bien', async () => {
      for (let i = 0; i < component.preguntas.length; i++) {
        await component.elegirOpcion(component.preguntaActual.palabra);
        component.siguientePregunta();
      }
      expect(component.fase).toBe('record');
    });
  });

  describe('cámara', () => {
    beforeEach(async () => {
      // iniciarCamara() ESPERA a que termine inicializarMediaPipe() (línea
      // "await promesaMediaPipe") antes de pasar a "countdown". Sin mockear
      // FilesetResolver/HandLandmarker, esa función hace fetch de verdad
      // contra cdn.jsdelivr.net y storage.googleapis.com — en un entorno
      // con red real (como `ng test` en una máquina normal, a diferencia de
      // un sandbox con la red de salida bloqueada) esa descarga puede
      // demorar más que el timeout de 5s de Jasmine, y el test se cae con
      // un timeout que no tiene nada que ver con el código bajo prueba.
      // Se mockean para que la prueba no dependa de la red ni de cuánto
      // tarde esa descarga.
      const handLandmarkerFalso = {
        detectForVideo: () => ({ landmarks: [] }),
        close: () => {},
      } as any;
      spyOn(FilesetResolver, 'forVisionTasks').and.resolveTo({} as any);
      spyOn(HandLandmarker, 'createFromOptions').and.resolveTo(handLandmarkerFalso);

      prepararCargaExitosa();
      await crearComponente();
      await component.ngOnInit();
    });

    it('iniciarCamara pasa a "countdown" si el usuario da permiso', async () => {
      const streamFalso = { getTracks: () => [] } as any;
      spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(streamFalso);

      await component.iniciarCamara();

      expect(component.camStage).toBe('countdown');
    });

    it('iniciarCamara pasa a "denied" si el usuario rechaza el permiso', async () => {
      spyOn(navigator.mediaDevices, 'getUserMedia').and.rejectWith(new Error('Permission denied'));

      await component.iniciarCamara();

      expect(component.camStage).toBe('denied');
    });

    it('reintentarCamara vuelve a "idle" y limpia el puntaje', () => {
      component.camScore = 80;
      component.camStage = 'result';

      component.reintentarCamara();

      expect(component.camStage).toBe('idle');
      expect(component.camScore).toBe(0);
    });

    it('saltarCamara termina la lección solo con el XP ya ganado', async () => {
      component.xpGanado = 20;
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba());
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: false });
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await component.saltarCamara();

      expect(contenidoSpy.marcarSubnivelCompletado).toHaveBeenCalledWith('user-1', 10, 20);
    });

    it('confirmarCamara suma 15 XP extra si pasó la práctica', async () => {
      component.xpGanado = 20;
      component.camPassed = true;
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba());
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: false });
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await component.confirmarCamara();

      expect(contenidoSpy.marcarSubnivelCompletado).toHaveBeenCalledWith('user-1', 10, 35);
    });

    it('confirmarCamara solo suma 5 XP extra si no pasó la práctica', async () => {
      component.xpGanado = 20;
      component.camPassed = false;
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba());
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: false });
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await component.confirmarCamara();

      expect(contenidoSpy.marcarSubnivelCompletado).toHaveBeenCalledWith('user-1', 10, 25);
    });
  });

  describe('cámara — evaluación con el motor de señas', () => {
    let evaluar: jasmine.Spy;

    beforeEach(async () => {
      prepararCargaExitosa();
      await crearComponente();
      await component.ngOnInit();
      evaluar = spyOn(TestBed.inject(ReconocedorSenasService), 'evaluar');
      contenidoSpy.registrarIntento.and.resolveTo();
      contenidoSpy.otorgarLogroPorCodigo.and.resolveTo();
    });

    const resultado = (r: Partial<EvaluacionSena>): EvaluacionSena => ({
      similitudPct: 0, aprobado: false, fuente: 'referencia', espejo: false, sinManos: false, ...r,
    });

    it('registra el intento con el puntaje real del reconocedor', async () => {
      evaluar.and.resolveTo(resultado({ similitudPct: 88, aprobado: true }));
      await (component as any).terminarGrabacion();
      expect(component.camStage).toBe('result');
      expect(component.camPassed).toBeTrue();
      expect(component.camScore).toBe(88);
      expect(component.camFuente).toBe('referencia');
      expect(contenidoSpy.registrarIntento).toHaveBeenCalledWith('user-1', component.senaCamara.id, true, 88);
    });

    it('evalúa la seña de la práctica de cámara (la última de la lección)', async () => {
      evaluar.and.resolveTo(resultado({}));
      await (component as any).terminarGrabacion();
      expect(evaluar.calls.mostRecent().args[0]).toBe(component.senaCamara);
    });

    it('si no se vieron las manos, lo dice claramente', async () => {
      evaluar.and.resolveTo(resultado({ sinManos: true }));
      await (component as any).terminarGrabacion();
      expect(component.camMsg).toContain('No logramos ver bien tus manos');
      expect(component.camPassed).toBeFalse();
    });

    it('informa cuando la decisión la tomó el modelo entrenado', async () => {
      evaluar.and.resolveTo(resultado({ similitudPct: 91, aprobado: true, fuente: 'clasificador' }));
      await (component as any).terminarGrabacion();
      expect(component.camFuente).toBe('clasificador');
    });

    it('si falla el registro del intento (sin red), igual muestra el resultado', async () => {
      evaluar.and.resolveTo(resultado({ aprobado: true, similitudPct: 80 }));
      contenidoSpy.registrarIntento.and.rejectWith(new Error('sin red'));
      await expectAsync((component as any).terminarGrabacion()).toBeResolved();
      expect(component.camStage).toBe('result');
    });

    it('salir de la lección durante la cuenta regresiva no deja una grabación corriendo', fakeAsync(() => {
      const grabar = spyOn(component as any, 'grabar');
      component.camStage = 'countdown';
      (component as any).contarRegresiva();
      component.ngOnDestroy();
      tick(5000);
      expect(grabar).not.toHaveBeenCalled();
    }));

    it('no cierra el HandLandmarker compartido al salir', () => {
      const cerrar = jasmine.createSpy('close');
      (component as any).handLandmarker = { close: cerrar };
      component.ngOnDestroy();
      expect(cerrar).not.toHaveBeenCalled();
    });
  });

  describe('terminarLeccion (vía saltarCamara) — celebraciones', () => {
    // OJO: saltarCamara()/confirmarCamara() son "fire-and-forget" en el
    // código fuente (llaman a terminarLeccion() SIN esperarlo), así que
    // `await component.saltarCamara()` no garantiza que termine el trabajo
    // interno (que tiene varios await en cadena). Para probar el resultado
    // final de forma confiable, esperamos terminarLeccion() directamente.
    beforeEach(async () => { prepararCargaExitosa(); await crearComponente(); await component.ngOnInit(); });

    it('activa la celebración de racha si es la primera lección del día', async () => {
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba({ racha_actual: 5, racha_congeladores: 0 }));
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: false });
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await (component as any).terminarLeccion(component.xpGanado);

      expect(component.hayRachaParaCelebrar).toBeTrue();
      expect(component.racha).toBe(5);
      expect(component.fase).toBe('complete');
    });

    it('NO celebra la racha de nuevo si ya había practicado hoy antes de entrar', async () => {
      (component as any).practicoAntesHoy = true; // mismo componente, sin recrear el TestBed
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba({ racha_actual: 5 }));
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: false });

      await (component as any).terminarLeccion(component.xpGanado);

      expect(component.hayRachaParaCelebrar).toBeFalse();
      expect(contenidoSpy.obtenerHistorialRacha).not.toHaveBeenCalled();
    });

    it('activa la celebración de nivel si avanzarNivelSiCorresponde lo indica', async () => {
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba());
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: true });
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await (component as any).terminarLeccion(component.xpGanado);

      expect(component.hayNivelParaCelebrar).toBeTrue();
    });

    it('detecta que se ganó un congelador comparando contra el valor de entrada', async () => {
      contenidoSpy.marcarSubnivelCompletado.and.resolveTo();
      contenidoSpy.actualizarStatsTrasLeccion.and.resolveTo(statsDePrueba({ racha_congeladores: 1 })); // entró con 0
      contenidoSpy.avanzarNivelSiCorresponde.and.resolveTo({ nivelRecienCompletado: false });
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await (component as any).terminarLeccion(component.xpGanado);

      expect(component.congeladorGanadoHoy).toBeTrue();
    });

    it('pasa a "complete" igual aunque algo falle al guardar el progreso', async () => {
      contenidoSpy.marcarSubnivelCompletado.and.rejectWith(new Error('sin conexión'));

      await (component as any).terminarLeccion(component.xpGanado);

      expect(component.fase).toBe('complete');
    });
  });

  describe('navegación entre pantallas de celebración', () => {
    beforeEach(async () => { prepararCargaExitosa(); await crearComponente(); await component.ngOnInit(); });

    it('continuarLeccion va a "nivel" primero si hay nivel Y racha para celebrar', () => {
      component.hayNivelParaCelebrar = true;
      component.hayRachaParaCelebrar = true;
      component.continuarLeccion();
      expect(component.fase).toBe('nivel');
    });

    it('continuarLeccion va directo a "racha" si no hay nivel para celebrar', () => {
      component.hayNivelParaCelebrar = false;
      component.hayRachaParaCelebrar = true;
      component.continuarLeccion();
      expect(component.fase).toBe('racha');
    });

    it('continuarLeccion sale de la lección si no hay nada que celebrar', () => {
      component.hayNivelParaCelebrar = false;
      component.hayRachaParaCelebrar = false;
      component.continuarLeccion();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('continuarDesdeNivel pasa a "racha" si corresponde, si no sale', () => {
      component.hayRachaParaCelebrar = true;
      component.continuarDesdeNivel();
      expect(component.fase).toBe('racha');
    });

    it('salir libera la memoria de imágenes y navega a /home', () => {
      component.salir();
      expect(cacheSpy.liberarMemoriaRAM).toHaveBeenCalled();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });
  });

  describe('salir de la lección (botón atrás del teléfono y la X)', () => {
    beforeEach(async () => { prepararCargaExitosa(); await crearComponente(); await component.ngOnInit(); });

    /** Opciones con las que se creó el aviso de confirmación. */
    const opcionesAviso = () => alertCtrlSpy.create.calls.mostRecent().args[0]!;
    const boton = (rol: string) => (opcionesAviso().buttons as any[]).find((b) => b.role === rol);

    it('al entrar se hace cargo del botón atrás, y lo suelta al salir', () => {
      component.ionViewWillEnter();
      expect(botonAtrasSpy.registrar).toHaveBeenCalledTimes(1);

      // El botón del teléfono ejecuta lo mismo que la X.
      const manejador = botonAtrasSpy.registrar.calls.mostRecent().args[0];
      expect(manejador()).toBeTrue();
      expect(alertCtrlSpy.create).toHaveBeenCalled();

      component.ionViewWillLeave();
      expect(quitarManejador).toHaveBeenCalled();
    });

    it('también lo suelta si se destruye sin pasar por ionViewWillLeave', () => {
      component.ionViewWillEnter();
      component.ngOnDestroy();
      expect(quitarManejador).toHaveBeenCalled();
    });

    for (const fase of ['flash', 'match', 'quiz', 'record'] as const) {
      it(`a mitad de la lección (${fase}) pregunta antes de salir`, async () => {
        component.fase = fase;
        expect(component.alPresionarAtras()).toBeTrue();
        await Promise.resolve();
        await Promise.resolve();

        expect(opcionesAviso().header).toBe('¿Salir de la lección?');
        expect(opcionesAviso().message).toContain('empezarla de nuevo');
        expect(alertaFalsa.present).toHaveBeenCalled();
        expect(routerSpy.navigate).not.toHaveBeenCalled();
      });
    }

    it('"Salir" vuelve al camino; "Seguir practicando" solo cierra el aviso', async () => {
      component.fase = 'quiz';
      component.alPresionarAtras();
      await Promise.resolve();

      expect(boton('cancel').text).toBe('Seguir practicando');
      expect(boton('cancel').handler).toBeUndefined();
      expect(boton('destructive').text).toBe('Salir');

      boton('destructive').handler();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
      expect(cacheSpy.liberarMemoriaRAM).toHaveBeenCalled();
    });

    it('presionar atrás varias veces no apila avisos', async () => {
      component.fase = 'flash';
      component.alPresionarAtras();
      await Promise.resolve();
      await Promise.resolve();
      component.alPresionarAtras();
      component.alPresionarAtras();
      await Promise.resolve();
      expect(alertCtrlSpy.create).toHaveBeenCalledTimes(1);

      // Cerrado el aviso, se puede volver a abrir.
      alertaFalsa.cerrar();
      await new Promise((r) => setTimeout(r));
      component.alPresionarAtras();
      await Promise.resolve();
      expect(alertCtrlSpy.create).toHaveBeenCalledTimes(2);
    });

    for (const fase of ['cargando', 'error', 'sinvidas', 'complete', 'nivel', 'racha'] as const) {
      it(`en "${fase}" sale directo, sin preguntar`, () => {
        component.fase = fase;
        expect(component.alPresionarAtras()).toBeTrue();
        expect(alertCtrlSpy.create).not.toHaveBeenCalled();
        expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
      });
    }

    it('mientras se guarda el progreso final, atrás no hace nada', fakeAsync(() => {
      contenidoSpy.marcarSubnivelCompletado.and.returnValue(new Promise(() => {})); // queda guardando
      component.fase = 'record';
      component.saltarCamara();
      tick();

      expect(component.alPresionarAtras()).toBeTrue();
      tick();
      expect(alertCtrlSpy.create).not.toHaveBeenCalled();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    }));

    it('el aviso corta la cuenta regresiva: no se graba ni se evalúa detrás del aviso', fakeAsync(() => {
      const grabar = spyOn(component as any, 'grabar');
      component.fase = 'record';
      component.camStage = 'countdown';
      (component as any).contarRegresiva();

      component.alPresionarAtras();
      tick(5000);

      expect(grabar).not.toHaveBeenCalled();
      expect(component.camStage).toBe('idle');
    }));

    it('si se cierra la lección con el aviso abierto, el aviso también se cierra', async () => {
      component.fase = 'match';
      component.alPresionarAtras();
      await Promise.resolve();
      await Promise.resolve();
      component.ngOnDestroy();
      expect(alertaFalsa.dismiss).toHaveBeenCalled();
    });
  });

  describe('cámara y segundo plano', () => {
    let oculto: jasmine.Spy;

    beforeEach(async () => {
      prepararCargaExitosa();
      await crearComponente();
      await component.ngOnInit();
      oculto = spyOnProperty(document, 'hidden').and.returnValue(true);
    });

    it('si la app pasa a segundo plano a mitad de la grabación, se corta sin evaluar', () => {
      const evaluar = spyOn(TestBed.inject(ReconocedorSenasService), 'evaluar');
      component.camStage = 'recording';
      document.dispatchEvent(new Event('visibilitychange'));
      expect(component.camStage).toBe('idle');
      expect(evaluar).not.toHaveBeenCalled();
    });

    it('volver a primer plano o salir con un resultado a la vista no toca nada', () => {
      component.camStage = 'result';
      document.dispatchEvent(new Event('visibilitychange'));
      expect(component.camStage).toBe('result');

      oculto.and.returnValue(false);
      component.camStage = 'recording';
      component.alCambiarVisibilidad();
      expect(component.camStage).toBe('recording');
      (component as any).detenerCamara();
    });

    it('si se sale de la lección mientras se pedía permiso, la cámara no queda encendida', async () => {
      const detener = jasmine.createSpy('stop');
      let darPermiso: (s: MediaStream) => void = () => {};
      spyOn(navigator.mediaDevices, 'getUserMedia').and.returnValue(new Promise((r) => (darPermiso = r)));
      spyOn(TestBed.inject(MediaPipeManosService), 'obtener').and.resolveTo(null as any);

      const pedido = component.iniciarCamara();
      component.ngOnDestroy();
      darPermiso({ getTracks: () => [{ stop: detener }] } as any);
      await pedido;

      expect(detener).toHaveBeenCalled();
      expect(component.camStage).not.toBe('countdown');
    });
  });

  describe('ngOnDestroy', () => {
    it('libera la memoria de imágenes al destruirse', async () => {
      prepararCargaExitosa();
      await crearComponente();
      await component.ngOnInit();

      component.ngOnDestroy();

      expect(cacheSpy.liberarMemoriaRAM).toHaveBeenCalled();
    });
  });
});
