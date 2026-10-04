import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ModalController, NavController, Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Subscription } from 'rxjs';
import { BotonAtrasService, PRIORIDAD_BOTON_ATRAS } from './boton-atras';
import { AppAdapter } from './capacitor-plugins';

describe('BotonAtrasService', () => {
  let servicio: BotonAtrasService;
  let navSpy: jasmine.SpyObj<NavController>;
  let appSpy: jasmine.SpyObj<AppAdapter>;
  let router: { url: string };
  let suscribir: jasmine.Spy;
  let nativo: jasmine.Spy;
  let modalSpy: jasmine.SpyObj<ModalController>;

  beforeEach(() => {
    navSpy = jasmine.createSpyObj('NavController', ['pop', 'navigateBack']);
    navSpy.pop.and.resolveTo(true);
    navSpy.navigateBack.and.resolveTo(true);
    appSpy = jasmine.createSpyObj('AppAdapter', ['tomarControlBotonAtras', 'minimizar']);
    appSpy.tomarControlBotonAtras.and.resolveTo({});
    appSpy.minimizar.and.resolveTo();
    router = { url: '/profile' };
    suscribir = jasmine.createSpy('subscribeWithPriority').and.returnValue(new Subscription());
    nativo = spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    modalSpy = jasmine.createSpyObj('ModalController', ['getTop']);
    modalSpy.getTop.and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: Platform, useValue: { backButton: { subscribeWithPriority: suscribir } } },
        { provide: NavController, useValue: navSpy },
        { provide: Router, useValue: router },
        { provide: AppAdapter, useValue: appSpy },
        { provide: ModalController, useValue: modalSpy },
      ],
    });
    servicio = TestBed.inject(BotonAtrasService);
  });

  describe('iniciar', () => {
    it('se engancha una sola vez a la cola de Ionic, entre los overlays y la navegación por defecto', () => {
      servicio.iniciar();
      servicio.iniciar();
      expect(suscribir).toHaveBeenCalledTimes(1);
      const prioridad = suscribir.calls.mostRecent().args[0];
      expect(prioridad).toBe(PRIORIDAD_BOTON_ATRAS);
      expect(prioridad).toBeGreaterThan(0); // la navegación por defecto de Ionic
      expect(prioridad).toBeLessThan(99); // menú (99) y overlays (100) van primero
    });

    it('en el celular le avisa a Android que el botón atrás lo maneja la app', () => {
      servicio.iniciar();
      expect(appSpy.tomarControlBotonAtras).toHaveBeenCalled();
    });

    it('en el navegador no toca el plugin', () => {
      nativo.and.returnValue(false);
      servicio.iniciar();
      expect(appSpy.tomarControlBotonAtras).not.toHaveBeenCalled();
    });

    it('el botón del teléfono ejecuta la navegación hacia atrás', async () => {
      servicio.iniciar();
      const alPresionar = suscribir.calls.mostRecent().args[1];
      await alPresionar(() => {});
      expect(navSpy.pop).toHaveBeenCalled();
    });
  });

  describe('volver', () => {
    it('vuelve a la pantalla anterior de la pila', async () => {
      await servicio.alPresionar();
      expect(navSpy.pop).toHaveBeenCalled();
      expect(navSpy.navigateBack).not.toHaveBeenCalled();
      expect(appSpy.minimizar).not.toHaveBeenCalled();
    });

    const padres: [string, string][] = [
      ['/settings', '/profile'],
      ['/friends?tab=buscar', '/profile'],
      ['/profile', '/home'],
      ['/auth/register', '/auth/login'],
      ['/auth/recuperar', '/auth/login'],
      ['/admin/ai-studio', '/home'],
      ['/mediapipe-test', '/home'],
    ];
    for (const [ruta, padre] of padres) {
      it(`sin pantalla anterior, ${ruta} vuelve a ${padre}`, async () => {
        router.url = ruta;
        navSpy.pop.and.resolveTo(false);
        await servicio.alPresionar();
        expect(navSpy.navigateBack).toHaveBeenCalledWith(padre);
      });
    }

    for (const raiz of ['/home', '/auth/login', '/onboarding']) {
      it(`en ${raiz} minimiza la app en vez de volver`, async () => {
        router.url = raiz;
        await servicio.alPresionar();
        expect(appSpy.minimizar).toHaveBeenCalled();
        expect(navSpy.pop).not.toHaveBeenCalled();
      });
    }

    it('en el navegador una pantalla raíz no hace nada', async () => {
      nativo.and.returnValue(false);
      router.url = '/home';
      await servicio.alPresionar();
      expect(appSpy.minimizar).not.toHaveBeenCalled();
      expect(navSpy.pop).not.toHaveBeenCalled();
    });

    it('si minimizar falla no revienta', async () => {
      router.url = '/home';
      appSpy.minimizar.and.rejectWith(new Error('sin actividad'));
      spyOn(console, 'warn');
      await expectAsync(servicio.alPresionar()).toBeResolved();
    });
  });

  describe('manejadores de pantalla', () => {
    it('si la pantalla lo resuelve, no se navega', async () => {
      const manejador = jasmine.createSpy('manejador').and.returnValue(true);
      servicio.registrar(manejador);
      await servicio.alPresionar();
      expect(manejador).toHaveBeenCalled();
      expect(navSpy.pop).not.toHaveBeenCalled();
    });

    it('si la pantalla devuelve false, sigue la navegación normal', async () => {
      servicio.registrar(() => false);
      await servicio.alPresionar();
      expect(navSpy.pop).toHaveBeenCalled();
    });

    it('acepta manejadores asíncronos', async () => {
      servicio.registrar(async () => true);
      await servicio.alPresionar();
      expect(navSpy.pop).not.toHaveBeenCalled();
    });

    it('responde solo la pantalla registrada más reciente', async () => {
      const anterior = jasmine.createSpy('anterior').and.returnValue(true);
      const visible = jasmine.createSpy('visible').and.returnValue(true);
      servicio.registrar(anterior);
      servicio.registrar(visible);
      await servicio.alPresionar();
      expect(visible).toHaveBeenCalled();
      expect(anterior).not.toHaveBeenCalled();
    });

    it('al quitarlo (una o varias veces) vuelve a responder la navegación normal', async () => {
      const otro = jasmine.createSpy('otro').and.returnValue(true);
      servicio.registrar(otro);
      const quitar = servicio.registrar(() => true);
      quitar();
      quitar();
      await servicio.alPresionar();
      expect(otro).toHaveBeenCalled(); // el que quedó sigue registrado

      const quitarOtro = servicio.registrar(() => true);
      quitarOtro();
      expect(otro).toHaveBeenCalledTimes(1);
    });

    it('con un modal abierto que nadie manejó, no navega por debajo de él', async () => {
      modalSpy.getTop.and.resolveTo({} as HTMLIonModalElement);
      await servicio.alPresionar();
      expect(navSpy.pop).not.toHaveBeenCalled();
      expect(navSpy.navigateBack).not.toHaveBeenCalled();
      expect(appSpy.minimizar).not.toHaveBeenCalled();
    });

    it('el manejador registrado por el modal decide antes que la pantalla de abajo', async () => {
      const pantalla = jasmine.createSpy('pantalla').and.returnValue(true);
      const modal = jasmine.createSpy('modal').and.returnValue(true);
      servicio.registrar(pantalla);
      const quitarModal = servicio.registrar(modal);
      await servicio.alPresionar();
      expect(modal).toHaveBeenCalled();
      expect(pantalla).not.toHaveBeenCalled();

      quitarModal(); // se cerró el modal
      await servicio.alPresionar();
      expect(pantalla).toHaveBeenCalled();
    });

    it('paraPantalla activa y desactiva sin duplicar el manejador', async () => {
      const manejador = jasmine.createSpy('manejador').and.returnValue(true);
      const atras = servicio.paraPantalla(manejador);
      atras.activar();
      atras.activar();
      await servicio.alPresionar();
      expect(manejador).toHaveBeenCalledTimes(1);
      atras.desactivar();
      atras.desactivar();
      await servicio.alPresionar();
      expect(manejador).toHaveBeenCalledTimes(1);
      expect(navSpy.pop).toHaveBeenCalledTimes(1);
    });

    it('si el manejador falla, igual se vuelve atrás', async () => {
      spyOn(console, 'error');
      servicio.registrar(() => { throw new Error('ups'); });
      await servicio.alPresionar();
      expect(navSpy.pop).toHaveBeenCalled();
    });
  });
});

describe('BotonAtrasService con Ionic real', () => {
  type Registrado = { prioridad: number; handler: (siguiente: () => void) => unknown };

  /** Emula a ion-app al recibir el "backbutton" de Android (startHardwareBackButton):
   * junta los manejadores y ejecuta el de mayor prioridad; con empate, el último registrado. */
  function presionarAtras(): { ganador: Registrado; todos: Registrado[] } {
    const todos: Registrado[] = [];
    document.dispatchEvent(new CustomEvent('ionBackButton', {
      detail: { register: (prioridad: number, handler: Registrado['handler']) => todos.push({ prioridad, handler }) },
    }));
    let ganador = todos[0];
    for (const r of todos) if (r.prioridad >= ganador.prioridad) ganador = r;
    return { ganador, todos };
  }

  it('le gana a la navegación por defecto de Ionic, que ya no se ejecuta', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const nav = TestBed.inject(NavController); // registra su propio manejador (prioridad 0)
    const servicio = TestBed.inject(BotonAtrasService);
    const pop = spyOn(nav, 'pop').and.resolveTo(true);
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
    servicio.iniciar();
    spyOnProperty(TestBed.inject(Router), 'url').and.returnValue('/settings');

    const { ganador, todos } = presionarAtras();
    expect(ganador.prioridad).toBe(PRIORIDAD_BOTON_ATRAS);
    expect(todos.some((r) => r.prioridad === 0)).toBeTrue();

    await ganador.handler(() => fail('no debe ceder el turno a la navegación por defecto'));
    expect(pop).toHaveBeenCalledTimes(1);
  });
});
