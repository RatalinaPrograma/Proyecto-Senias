import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { NotificationsService } from './notifications';
import { PreferencesAdapter, LocalNotificationsAdapter } from './capacitor-plugins';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let preferencesSpy: jasmine.SpyObj<PreferencesAdapter>;
  let localNotifSpy: jasmine.SpyObj<LocalNotificationsAdapter>;

  beforeEach(() => {
    preferencesSpy = jasmine.createSpyObj('PreferencesAdapter', ['get', 'set']);
    localNotifSpy = jasmine.createSpyObj('LocalNotificationsAdapter', [
      'checkPermissions', 'requestPermissions', 'createChannel', 'schedule', 'cancel',
    ]);

    preferencesSpy.get.and.resolveTo({ value: null });
    preferencesSpy.set.and.resolveTo();
    localNotifSpy.checkPermissions.and.resolveTo({ display: 'granted' });
    localNotifSpy.requestPermissions.and.resolveTo({ display: 'granted' });
    localNotifSpy.createChannel.and.resolveTo();
    localNotifSpy.schedule.and.resolveTo({ notifications: [] });
    localNotifSpy.cancel.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        NotificationsService,
        { provide: PreferencesAdapter, useValue: preferencesSpy },
        { provide: LocalNotificationsAdapter, useValue: localNotifSpy },
      ],
    });
    service = TestBed.inject(NotificationsService);

    // Elegir siempre el primer mensaje de cada pool -> asserts deterministas.
    spyOn(Math, 'random').and.returnValue(0);
  });

  function noDisponible() {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
  }

  function disponible() {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
  }

  describe('disponible()', () => {
    it('refleja Capacitor.isNativePlatform()', () => {
      disponible();
      expect(service.disponible()).toBeTrue();
    });

    it('es false fuera de una plataforma nativa', () => {
      noDisponible();
      expect(service.disponible()).toBeFalse();
    });
  });

  describe('obtenerConfiguracion / guardarConfiguracion', () => {
    it('devuelve la config por defecto si no es una plataforma nativa', async () => {
      noDisponible();
      const config = await service.obtenerConfiguracion();
      expect(config).toEqual({ recordatorioActivado: true, horaRecordatorio: '19:00', avisoVidasActivado: true });
      expect(preferencesSpy.get).not.toHaveBeenCalled();
    });

    it('devuelve la config por defecto si nunca se guardó nada', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: null });
      const config = await service.obtenerConfiguracion();
      expect(config.horaRecordatorio).toBe('19:00');
    });

    it('devuelve la config por defecto si lo guardado es JSON inválido', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: '{esto no es json' });
      const config = await service.obtenerConfiguracion();
      expect(config.recordatorioActivado).toBeTrue();
    });

    it('combina lo guardado con los defaults', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ horaRecordatorio: '08:30' }) });
      const config = await service.obtenerConfiguracion();
      expect(config).toEqual({ recordatorioActivado: true, horaRecordatorio: '08:30', avisoVidasActivado: true });
    });

    it('guardarConfiguracion persiste la fusión de cambios sobre lo existente', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ horaRecordatorio: '08:30' }) });

      const nueva = await service.guardarConfiguracion({ avisoVidasActivado: false });

      expect(nueva).toEqual({ recordatorioActivado: true, horaRecordatorio: '08:30', avisoVidasActivado: false });
      expect(preferencesSpy.set).toHaveBeenCalledWith({ key: 'signy_notif_config', value: JSON.stringify(nueva) });
    });
  });

  describe('verificarPermiso / pedirPermiso', () => {
    it('devuelven "denied" sin plataforma nativa, sin llamar al plugin', async () => {
      noDisponible();
      expect(await service.verificarPermiso()).toBe('denied');
      expect(await service.pedirPermiso()).toBe('denied');
      expect(localNotifSpy.checkPermissions).not.toHaveBeenCalled();
    });

    it('devuelven el estado real del plugin en plataforma nativa', async () => {
      disponible();
      localNotifSpy.checkPermissions.and.resolveTo({ display: 'prompt' });
      expect(await service.verificarPermiso()).toBe('prompt');
    });
  });

  describe('sincronizar', () => {
    it('no hace nada fuera de una plataforma nativa', async () => {
      noDisponible();
      await service.sincronizar(5, 0, 3, false);
      expect(localNotifSpy.schedule).not.toHaveBeenCalled();
    });

    it('cancela todo si ambos tipos de notificación están desactivados', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ recordatorioActivado: false, avisoVidasActivado: false }) });

      await service.sincronizar(5, 0, 3, false);

      expect(localNotifSpy.cancel).toHaveBeenCalledTimes(5); // cancelarTodo() cancela 5 ids
      expect(localNotifSpy.schedule).not.toHaveBeenCalled();
    });

    it('pide permiso si está en "prompt", y no programa nada si lo rechaza', async () => {
      disponible();
      localNotifSpy.checkPermissions.and.resolveTo({ display: 'prompt' });
      localNotifSpy.requestPermissions.and.resolveTo({ display: 'denied' });

      await service.sincronizar(5, 0, 0, false);

      expect(localNotifSpy.requestPermissions).toHaveBeenCalled();
      expect(localNotifSpy.schedule).not.toHaveBeenCalled();
    });

    it('programa el recordatorio diario cuando está activado', async () => {
      disponible();

      await service.sincronizar(5, 0, 3, false);

      const idsProgramados = localNotifSpy.schedule.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(idsProgramados).toContain(1001); // recordatorio diario
    });

    it('cancela los IDs de recordatorio/racha si el recordatorio está desactivado', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ recordatorioActivado: false, avisoVidasActivado: true }) });

      await service.sincronizar(0, 30, 5, false);

      const idsCancelados = localNotifSpy.cancel.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(idsCancelados).toEqual(jasmine.arrayContaining([1001, 1003, 1004]));
    });

    it('programa el aviso de vidas solo si vidas=0 y hay minutos de espera', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ recordatorioActivado: false, avisoVidasActivado: true }) });

      await service.sincronizar(0, 45, 0, false);

      const llamada = localNotifSpy.schedule.calls.allArgs().find(a => a[0].notifications[0].id === 1002);
      expect(llamada).toBeDefined();
    });

    it('NO programa el aviso de vidas si ya tiene vidas disponibles', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ recordatorioActivado: false, avisoVidasActivado: true }) });

      await service.sincronizar(3, 0, 0, false);

      const llamada = localNotifSpy.schedule.calls.allArgs().find(a => a[0].notifications[0].id === 1002);
      expect(llamada).toBeUndefined();
    });
  });

  describe('cancelarTodo', () => {
    it('no hace nada fuera de plataforma nativa', async () => {
      noDisponible();
      await service.cancelarTodo();
      expect(localNotifSpy.cancel).not.toHaveBeenCalled();
    });

    it('cancela los 5 IDs conocidos', async () => {
      disponible();
      await service.cancelarTodo();
      expect(localNotifSpy.cancel).toHaveBeenCalledTimes(5);
    });
  });

  describe('avisarEventoRacha', () => {
    it('no hace nada si el recordatorio está desactivado', async () => {
      disponible();
      preferencesSpy.get.and.resolveTo({ value: JSON.stringify({ recordatorioActivado: false }) });

      await service.avisarEventoRacha({ tipo: 'congelado', diasCubiertos: 1, congeladoresRestantes: 1 }, 5);

      expect(localNotifSpy.schedule).not.toHaveBeenCalled();
    });

    it('sustituye {n} y {c} en el mensaje de congelador usado', async () => {
      disponible();

      await service.avisarEventoRacha({ tipo: 'congelado', diasCubiertos: 1, congeladoresRestantes: 1 }, 7);

      const [args] = localNotifSpy.schedule.calls.mostRecent().args;
      const notif = args.notifications[0];
      expect(notif.id).toBe(1005);
      expect(notif.body).not.toContain('{c}');
      expect(notif.body).toContain('1 congelador'); // singular, no "1 congeladores"
    });

    it('usa el pool de racha perdida cuando el evento es "perdida"', async () => {
      disponible();

      await service.avisarEventoRacha({ tipo: 'perdida', diasCubiertos: 2, congeladoresRestantes: 0 }, 0);

      const [args] = localNotifSpy.schedule.calls.mostRecent().args;
      expect(args.notifications[0].title).not.toContain('{n}');
    });
  });

  describe('notificacionDePrueba', () => {
    it('no hace nada fuera de plataforma nativa', async () => {
      noDisponible();
      await service.notificacionDePrueba(5);
      expect(localNotifSpy.schedule).not.toHaveBeenCalled();
    });

    it('programa con el ID de prueba y sustituye la racha en el mensaje', async () => {
      disponible();
      await service.notificacionDePrueba(12);

      const [args] = localNotifSpy.schedule.calls.mostRecent().args;
      const notif = args.notifications[0];
      expect(notif.id).toBe(1099);
      expect(notif.title + notif.body).not.toContain('{n}');
    });
  });

  describe('programarAvisoRachaEnRiesgo (vía sincronizar) — horarios límite', () => {
    afterEach(() => jasmine.clock().uninstall());

    it('antes de las 21:00: programa ambas alertas para hoy', async () => {
      disponible();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 8, 8, 15, 0, 0));

      await service.sincronizar(5, 0, 4, false);

      const ids = localNotifSpy.schedule.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(ids).toEqual(jasmine.arrayContaining([1003, 1004]));
    });

    it('entre 21:00 y 23:00: cancela la alerta temprana (ya pasó) y programa la urgente', async () => {
      disponible();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 8, 8, 22, 0, 0));

      await service.sincronizar(5, 0, 4, false);

      const cancelIds = localNotifSpy.cancel.calls.allArgs().map(a => a[0].notifications[0].id);
      const scheduleIds = localNotifSpy.schedule.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(cancelIds).toContain(1003);
      expect(scheduleIds).toContain(1004);
    });

    it('después de las 23:00 con margen: dispara la alerta urgente casi de inmediato en vez de perderla', async () => {
      disponible();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 8, 8, 23, 30, 0)); // 30 min para medianoche

      await service.sincronizar(5, 0, 4, false);

      const scheduleIds = localNotifSpy.schedule.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(scheduleIds).toContain(1004);
    });

    it('a menos de 2 minutos de medianoche: ya no dispara la urgente, solo cancela', async () => {
      disponible();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 8, 8, 23, 59, 0)); // 1 min para medianoche

      await service.sincronizar(5, 0, 4, false);

      const cancelIds = localNotifSpy.cancel.calls.allArgs().map(a => a[0].notifications[0].id);
      const scheduleIds = localNotifSpy.schedule.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(cancelIds).toContain(1004);
      expect(scheduleIds).not.toContain(1004);
    });

    it('sin racha activa, cancela ambas alertas en vez de programarlas', async () => {
      disponible();

      await service.sincronizar(5, 0, 0, false);

      const cancelIds = localNotifSpy.cancel.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(cancelIds).toEqual(jasmine.arrayContaining([1003, 1004]));
    });

    it('si ya practicó hoy, cancela ambas alertas aunque haya racha activa', async () => {
      disponible();

      await service.sincronizar(5, 0, 10, true);

      const cancelIds = localNotifSpy.cancel.calls.allArgs().map(a => a[0].notifications[0].id);
      expect(cancelIds).toEqual(jasmine.arrayContaining([1003, 1004]));
    });
  });
});
