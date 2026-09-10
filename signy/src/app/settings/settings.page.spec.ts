import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SettingsPage } from './settings.page';
import { SupabaseService } from '../services/supabase';
import { TtsService } from '../services/tts';
import { ContenidoService } from '../services/contenido';
import { NotificationsService } from '../services/notifications';
import { statsDePrueba, perfilDePrueba } from '../../testing/supabase-mock';

describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let ttsSpy: jasmine.SpyObj<TtsService>;
  let contenidoSpy: jasmine.SpyObj<ContenidoService>;
  let notificationsSpy: jasmine.SpyObj<NotificationsService>;
  let routerSpy: jasmine.SpyObj<Router>;

  function prepararCargaExitosa() {
    supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1', email: 'a@a.com', user_metadata: { full_name: 'Benja' } } }, error: null } as any);
    supabaseSpy.getOCrearProfile.and.resolveTo(perfilDePrueba());
    supabaseSpy.mfaListFactors.and.resolveTo({ data: { totp: [] }, error: null } as any);
    ttsSpy.disponible.and.returnValue(true);
    ttsSpy.estaHabilitado.and.resolveTo(true);
    ttsSpy.listarVoces.and.resolveTo([]);
    ttsSpy.obtenerVozPreferida.and.resolveTo(null);
    notificationsSpy.disponible.and.returnValue(true);
    notificationsSpy.obtenerConfiguracion.and.resolveTo({ recordatorioActivado: true, horaRecordatorio: '19:00', avisoVidasActivado: true });
    notificationsSpy.verificarPermiso.and.resolveTo('granted');
  }

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', [
      'getUser', 'getOCrearProfile', 'uploadAvatar', 'upsertProfile', 'usernameDisponible',
      'changePassword', 'mfaListFactors', 'mfaEnroll', 'mfaVerifyEnrollment', 'mfaUnenroll',
      'deleteAccount', 'signOut',
    ]);
    ttsSpy = jasmine.createSpyObj('TtsService', [
      'disponible', 'estaHabilitado', 'listarVoces', 'obtenerVozPreferida', 'establecerHabilitado', 'establecerVoz', 'hablar',
    ]);
    contenidoSpy = jasmine.createSpyObj('ContenidoService', ['getMisStats', 'minutosParaProximaVida', 'fechaHoy']);
    notificationsSpy = jasmine.createSpyObj('NotificationsService', [
      'disponible', 'obtenerConfiguracion', 'verificarPermiso', 'guardarConfiguracion', 'sincronizar',
      'pedirPermiso', 'notificacionDePrueba', 'cancelarTodo',
    ]);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    contenidoSpy.fechaHoy.and.returnValue('2026-09-08');
    contenidoSpy.minutosParaProximaVida.and.returnValue(0);
    contenidoSpy.getMisStats.and.resolveTo(statsDePrueba());

    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: TtsService, useValue: ttsSpy },
        { provide: ContenidoService, useValue: contenidoSpy },
        { provide: NotificationsService, useValue: notificationsSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPage);
    component = fixture.componentInstance;
  });

  afterEach(() => jasmine.clock().uninstall());

  describe('ngOnInit', () => {
    it('redirige a login si no hay sesión', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: null }, error: null } as any);
      await component.ngOnInit();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('carga el perfil y precompleta el formulario', async () => {
      prepararCargaExitosa();
      await component.ngOnInit();

      expect(component.formPerfil.value.full_name).toBe(perfilDePrueba().full_name);
      expect(component.cargando).toBeFalse();
    });

    it('no pide voces de TTS si el dispositivo no lo soporta', async () => {
      prepararCargaExitosa();
      ttsSpy.disponible.and.returnValue(false);

      await component.ngOnInit();

      expect(ttsSpy.listarVoces).not.toHaveBeenCalled();
    });

    it('detecta un factor MFA verificado como "activado"', async () => {
      prepararCargaExitosa();
      supabaseSpy.mfaListFactors.and.resolveTo({ data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null } as any);

      await component.ngOnInit();

      expect(component.mfaActivado).toBeTrue();
    });

    it('no carga configuración de notificaciones si no están disponibles', async () => {
      prepararCargaExitosa();
      notificationsSpy.disponible.and.returnValue(false);

      await component.ngOnInit();

      expect(notificationsSpy.obtenerConfiguracion).not.toHaveBeenCalled();
    });
  });

  describe('subirAvatar', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    function eventoConArchivo(file: File | null): any {
      return { target: { files: file ? [file] : [] } };
    }

    it('no hace nada si no se seleccionó ningún archivo', async () => {
      await component.subirAvatar(eventoConArchivo(null));
      expect(supabaseSpy.uploadAvatar).not.toHaveBeenCalled();
    });

    it('actualiza el avatar y lo persiste cuando la subida funciona', async () => {
      supabaseSpy.uploadAvatar.and.resolveTo({ data: 'https://cdn/avatar.png', error: null });
      supabaseSpy.upsertProfile.and.resolveTo({ data: null, error: null } as any);

      await component.subirAvatar(eventoConArchivo(new File(['x'], 'foto.png')));

      expect(component.avatarUrlActual).toBe('https://cdn/avatar.png');
      expect(supabaseSpy.upsertProfile).toHaveBeenCalledWith({ id: 'user-1', avatar_url: 'https://cdn/avatar.png' });
    });

    it('muestra un error amigable si la subida falla', async () => {
      supabaseSpy.uploadAvatar.and.resolveTo({ data: null, error: { message: 'boom' } as any });

      await component.subirAvatar(eventoConArchivo(new File(['x'], 'foto.png')));

      expect(component.errorPerfil).toContain('No se pudo subir la foto');
      expect(supabaseSpy.upsertProfile).not.toHaveBeenCalled();
    });
  });

  describe('guardarPerfil', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('muestra un mensaje específico si el username no cumple el patrón', async () => {
      component.formPerfil.setValue({ full_name: 'Benja', username: 'Mayúscula-Invalida' });

      await component.guardarPerfil();

      expect(component.errorPerfil).toContain('minúsculas, números');
      expect(supabaseSpy.upsertProfile).not.toHaveBeenCalled();
    });

    it('rechaza el guardado si el username ya está en uso', async () => {
      component.formPerfil.setValue({ full_name: 'Benja', username: 'benja123' });
      supabaseSpy.usernameDisponible.and.resolveTo(false);

      await component.guardarPerfil();

      expect(component.errorPerfil).toBe('Ese nombre de usuario ya está en uso');
      expect(supabaseSpy.upsertProfile).not.toHaveBeenCalled();
    });

    it('guarda y muestra éxito cuando todo es válido', async () => {
      component.formPerfil.setValue({ full_name: 'Benja', username: 'benja123' });
      supabaseSpy.usernameDisponible.and.resolveTo(true);
      supabaseSpy.upsertProfile.and.resolveTo({ data: null, error: null } as any);

      await component.guardarPerfil();

      expect(component.exitoPerfil).toBeTrue();
    });

    it('el aviso de éxito se apaga solo después de 2.5s', async () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date());
      component.formPerfil.setValue({ full_name: 'Benja', username: '' });
      supabaseSpy.upsertProfile.and.resolveTo({ data: null, error: null } as any);

      await component.guardarPerfil();
      expect(component.exitoPerfil).toBeTrue();
      jasmine.clock().tick(2600);

      expect(component.exitoPerfil).toBeFalse();
    });
  });

  describe('accesibilidad (TTS)', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('cambiarTts aplica el cambio optimista y lo mantiene si se guarda bien', async () => {
      ttsSpy.establecerHabilitado.and.resolveTo({ data: null, error: null } as any);

      await component.cambiarTts({ detail: { checked: false } });

      expect(component.ttsHabilitado).toBeFalse();
    });

    it('cambiarTts revierte el cambio optimista si falla el guardado', async () => {
      ttsSpy.establecerHabilitado.and.resolveTo({ data: null, error: { message: 'boom' } } as any);

      await component.cambiarTts({ detail: { checked: false } });

      expect(component.ttsHabilitado).toBeTrue(); // vuelve al valor anterior
    });

    it('cambiarVoz revierte si falla el guardado', async () => {
      ttsSpy.establecerVoz.and.resolveTo({ data: null, error: { message: 'boom' } } as any);
      component.vozSeleccionada = 'Voz Anterior';

      await component.cambiarVoz({ detail: { value: 'Voz Nueva' } });

      expect(component.vozSeleccionada).toBe('Voz Anterior');
    });

    it('probarTts llama a hablar con la voz seleccionada', () => {
      component.vozSeleccionada = 'Mi Voz';
      component.probarTts();
      expect(ttsSpy.hablar).toHaveBeenCalledWith('Así sonará el texto a voz en Signy', 'Mi Voz');
    });
  });

  describe('labelHora', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('convierte medianoche a 12:00 AM', () => {
      expect(component.labelHora('00:00')).toBe('12:00 AM');
    });

    it('convierte el mediodía a 12:00 PM', () => {
      expect(component.labelHora('12:00')).toBe('12:00 PM');
    });

    it('convierte una hora de la tarde a formato 12h', () => {
      expect(component.labelHora('19:00')).toBe('7:00 PM');
    });

    it('convierte una hora de la mañana a formato 12h', () => {
      expect(component.labelHora('08:00')).toBe('8:00 AM');
    });
  });

  describe('notificaciones', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('cambiarRecordatorio guarda y resincroniza', async () => {
      notificationsSpy.guardarConfiguracion.and.resolveTo({ recordatorioActivado: false, horaRecordatorio: '19:00', avisoVidasActivado: true });

      await component.cambiarRecordatorio({ detail: { checked: false } });

      expect(component.recordatorioActivado).toBeFalse();
      expect(notificationsSpy.sincronizar).toHaveBeenCalled();
    });

    it('cambiarHoraRecordatorio revierte la hora si falla el guardado', async () => {
      notificationsSpy.guardarConfiguracion.and.rejectWith(new Error('sin conexión'));

      await component.cambiarHoraRecordatorio({ detail: { value: '08:00' } });

      expect(component.horaRecordatorio).toBe('19:00'); // vuelve al valor anterior
    });

    it('probarNotificacion pide permiso si está en "prompt" antes de disparar la prueba', async () => {
      notificationsSpy.verificarPermiso.and.resolveTo('prompt');
      notificationsSpy.pedirPermiso.and.resolveTo('granted');

      await component.probarNotificacion();

      expect(notificationsSpy.pedirPermiso).toHaveBeenCalled();
      expect(notificationsSpy.notificacionDePrueba).toHaveBeenCalled();
    });

    it('probarNotificacion no dispara nada si el permiso queda denegado', async () => {
      notificationsSpy.verificarPermiso.and.resolveTo('denied');

      await component.probarNotificacion();

      expect(notificationsSpy.notificacionDePrueba).not.toHaveBeenCalled();
    });
  });

  describe('cambiarPassword', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('no llama al servicio si el formulario es inválido', async () => {
      await component.cambiarPassword();
      expect(supabaseSpy.changePassword).not.toHaveBeenCalled();
    });

    it('muestra el error si la contraseña actual es incorrecta', async () => {
      component.formPassword.setValue({ currentPassword: 'mala', newPassword: 'Buena1234', confirmPassword: 'Buena1234' });
      supabaseSpy.changePassword.and.resolveTo({ error: { message: 'Tu contraseña actual no es correcta' } } as any);

      await component.cambiarPassword();

      expect(component.errorPassword).toBe('Tu contraseña actual no es correcta');
    });

    it('resetea el formulario y muestra éxito cuando funciona', async () => {
      component.formPassword.setValue({ currentPassword: 'buena', newPassword: 'Buena1234', confirmPassword: 'Buena1234' });
      supabaseSpy.changePassword.and.resolveTo({ error: null } as any);

      await component.cambiarPassword();

      expect(component.exitoPassword).toBeTrue();
      expect(component.formPassword.value.newPassword).toBeFalsy();
    });
  });

  describe('2FA', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('iniciarActivacionMfa guarda el QR y el secreto', async () => {
      supabaseSpy.mfaEnroll.and.resolveTo({ data: { id: 'factor-1', totp: { qr_code: 'data:image/png;...', secret: 'ABC123' } }, error: null } as any);

      await component.iniciarActivacionMfa();

      expect(component.qrCode).toBe('data:image/png;...');
      expect(component.inscribiendoMfa).toBeTrue();
    });

    it('iniciarActivacionMfa muestra un mensaje si MFA no está habilitado en el proyecto', async () => {
      supabaseSpy.mfaEnroll.and.resolveTo({ data: null, error: null } as any);

      await component.iniciarActivacionMfa();

      expect(component.errorMfa).toContain('No se pudo iniciar');
    });

    it('confirmarActivacionMfa no hace nada si el código no tiene 6 dígitos', async () => {
      (component as any).factorIdPendiente = 'factor-1';
      component.codigoMfa = '123';

      await component.confirmarActivacionMfa();

      expect(supabaseSpy.mfaVerifyEnrollment).not.toHaveBeenCalled();
    });

    it('confirmarActivacionMfa activa el MFA con un código correcto', async () => {
      (component as any).factorIdPendiente = 'factor-1';
      component.codigoMfa = '123456';
      supabaseSpy.mfaVerifyEnrollment.and.resolveTo({ error: null } as any);

      await component.confirmarActivacionMfa();

      expect(component.mfaActivado).toBeTrue();
      expect(component.inscribiendoMfa).toBeFalse(); // cancelarActivacionMfa() limpia el estado
    });

    it('confirmarActivacionMfa muestra error con un código incorrecto', async () => {
      (component as any).factorIdPendiente = 'factor-1';
      component.codigoMfa = '000000';
      supabaseSpy.mfaVerifyEnrollment.and.resolveTo({ error: { message: 'Invalid code' } } as any);

      await component.confirmarActivacionMfa();

      expect(component.errorMfa).toContain('Código incorrecto');
      expect(component.mfaActivado).toBeFalse();
    });

    it('desactivarMfa limpia el estado si funciona', async () => {
      (component as any).factorIdActivo = 'factor-1';
      component.mfaActivado = true;
      supabaseSpy.mfaUnenroll.and.resolveTo({ error: null } as any);

      await component.desactivarMfa();

      expect(component.mfaActivado).toBeFalse();
    });
  });

  describe('eliminar cuenta', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('confirmacionValida exige escribir "ELIMINAR" (sin importar mayúsculas/espacios)', () => {
      component.textoConfirmacion = '  eliminar  ';
      expect(component.confirmacionValida).toBeTrue();
      component.textoConfirmacion = 'elimiar'; // typo
      expect(component.confirmacionValida).toBeFalse();
    });

    it('no llama al servicio si la confirmación no es válida', async () => {
      component.textoConfirmacion = 'no estoy seguro';
      await component.eliminarCuenta();
      expect(supabaseSpy.deleteAccount).not.toHaveBeenCalled();
    });

    it('cancela notificaciones, cierra sesión y navega a onboarding si funciona', async () => {
      component.textoConfirmacion = 'ELIMINAR';
      supabaseSpy.deleteAccount.and.resolveTo({ error: null } as any);
      notificationsSpy.cancelarTodo.and.resolveTo();
      supabaseSpy.signOut.and.resolveTo({ error: null } as any);

      await component.eliminarCuenta();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/onboarding']);
    });

    it('muestra el error y NO cierra sesión si falla', async () => {
      component.textoConfirmacion = 'ELIMINAR';
      supabaseSpy.deleteAccount.and.resolveTo({ error: { message: 'No se pudo' } } as any);

      await component.eliminarCuenta();

      expect(component.errorEliminar).toBe('No se pudo');
      expect(supabaseSpy.signOut).not.toHaveBeenCalled();
    });
  });

  it('volver navega a /profile', async () => {
    prepararCargaExitosa();
    await component.ngOnInit();
    component.volver();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/profile']);
  });
});
