import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HomePage } from './home.page';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { NotificationsService } from '../services/notifications';
import { NivelConEstado } from '../data/db-types';
import { statsDePrueba, perfilDePrueba } from '../../testing/supabase-mock';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let contenidoSpy: jasmine.SpyObj<ContenidoService>;
  let notificationsSpy: jasmine.SpyObj<NotificationsService>;
  let routerSpy: jasmine.SpyObj<Router>;

  const mapaDePrueba: NivelConEstado[] = [{
    id: 1, numero_nivel: 1, nombre: 'Nivel 1', descripcion: null, dificultad: null,
    etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null,
    accesible: true, completado: false,
    subniveles: [
      { id: 10, nivel_id: 1, numero_subnivel: 1, nombre: 'Sub 1', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null, estado: 'completado' },
      { id: 11, nivel_id: 1, numero_subnivel: 2, nombre: 'Sub 2', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null, estado: 'actual' },
      { id: 12, nivel_id: 1, numero_subnivel: 3, nombre: 'Sub 3', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null, estado: 'bloqueado' },
    ],
  }];

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['getUser', 'getProfile', 'signOut']);
    contenidoSpy = jasmine.createSpyObj('ContenidoService', ['obtenerMapaDeAprendizaje', 'getMisStats', 'fechaHoy', 'minutosParaProximaVida']);
    notificationsSpy = jasmine.createSpyObj('NotificationsService', ['sincronizar', 'avisarEventoRacha', 'cancelarTodo']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    notificationsSpy.sincronizar.and.resolveTo();
    notificationsSpy.avisarEventoRacha.and.resolveTo();
    contenidoSpy.fechaHoy.and.returnValue('2026-09-08');
    contenidoSpy.minutosParaProximaVida.and.returnValue(0);

    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: ContenidoService, useValue: contenidoSpy },
        { provide: NotificationsService, useValue: notificationsSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('cargarTodo', () => {
    it('no hace nada si no hay usuario logueado', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: null }, error: null } as any);

      await component.cargarTodo();

      expect(contenidoSpy.obtenerMapaDeAprendizaje).not.toHaveBeenCalled();
      expect(component.cargando).toBeFalse();
    });

    it('carga el mapa, las stats y el perfil, y calcula los totales', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null } as any);
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaDePrueba);
      contenidoSpy.getMisStats.and.resolveTo(statsDePrueba({ racha_actual: 4, ultima_fecha_practica: '2026-09-08' }));
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ avatar_url: 'foto.png', es_admin: true }), error: null });

      await component.cargarTodo();

      expect(component.totalSubniveles).toBe(3);
      expect(component.subnivelesCompletados).toBe(1);
      expect(component.avatarUrl).toBe('foto.png');
      expect(component.esAdmin).toBeTrue();
      expect(component.error).toBe('');
      expect(component.cargando).toBeFalse();
    });

    it('muestra un mensaje de error si algo falla al cargar', async () => {
      supabaseSpy.getUser.and.rejectWith(new Error('sin conexión'));

      await component.cargarTodo();

      expect(component.error).toBe('No se pudo cargar tu progreso. Revisa tu conexión.');
      expect(component.cargando).toBeFalse();
    });

    it('avisa con una notificación si getMisStats detectó un evento de racha', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null } as any);
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaDePrueba);
      contenidoSpy.getMisStats.and.resolveTo(statsDePrueba({
        racha_actual: 5, eventoRacha: { tipo: 'congelado', diasCubiertos: 1, congeladoresRestantes: 1 },
      }));
      supabaseSpy.getProfile.and.resolveTo({ data: null, error: null });

      await component.cargarTodo();

      expect(notificationsSpy.avisarEventoRacha).toHaveBeenCalledWith(
        { tipo: 'congelado', diasCubiertos: 1, congeladoresRestantes: 1 }, 5
      );
    });
  });

  describe('ionViewWillEnter (throttle)', () => {
    it('recarga si todavía no hay niveles cargados', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null } as any);
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaDePrueba);
      contenidoSpy.getMisStats.and.resolveTo(statsDePrueba());
      supabaseSpy.getProfile.and.resolveTo({ data: null, error: null });

      await component.ionViewWillEnter();

      expect(contenidoSpy.obtenerMapaDeAprendizaje).toHaveBeenCalledTimes(1);
    });

    it('NO recarga si volvió a entrar antes de 2 segundos', async () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date());
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null } as any);
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaDePrueba);
      contenidoSpy.getMisStats.and.resolveTo(statsDePrueba());
      supabaseSpy.getProfile.and.resolveTo({ data: null, error: null });

      await component.ionViewWillEnter(); // primera carga
      jasmine.clock().tick(500);
      await component.ionViewWillEnter(); // vuelve casi de inmediato

      expect(contenidoSpy.obtenerMapaDeAprendizaje).toHaveBeenCalledTimes(1);
    });

    it('SÍ recarga si pasaron más de 2 segundos desde la última carga', async () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date());
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null } as any);
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaDePrueba);
      contenidoSpy.getMisStats.and.resolveTo(statsDePrueba());
      supabaseSpy.getProfile.and.resolveTo({ data: null, error: null });

      await component.ionViewWillEnter();
      jasmine.clock().tick(2500);
      await component.ionViewWillEnter();

      expect(contenidoSpy.obtenerMapaDeAprendizaje).toHaveBeenCalledTimes(2);
    });
  });

  describe('getters', () => {
    it('racha/xp/vidas devuelven valores por defecto sin stats cargadas', () => {
      expect(component.racha).toBe(0);
      expect(component.xp).toBe(0);
      expect(component.vidas).toBe(5);
    });

    it('rachaEnRiesgo es false sin racha activa', () => {
      (component as any).stats = statsDePrueba({ racha_actual: 0 });
      expect(component.rachaEnRiesgo).toBeFalse();
    });

    it('rachaEnRiesgo es true si hay racha pero no practicó hoy', () => {
      (component as any).stats = statsDePrueba({ racha_actual: 3, ultima_fecha_practica: '2026-09-07' });
      expect(component.rachaEnRiesgo).toBeTrue();
    });

    it('rachaEnRiesgo es false si hay racha y ya practicó hoy', () => {
      (component as any).stats = statsDePrueba({ racha_actual: 3, ultima_fecha_practica: '2026-09-08' });
      expect(component.rachaEnRiesgo).toBeFalse();
    });
  });

  describe('abrirLeccion', () => {
    it('no navega si el subnivel está bloqueado', () => {
      component.abrirLeccion(mapaDePrueba[0].subniveles[2]); // bloqueado
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('navega a /lesson/:id si el subnivel está disponible', () => {
      component.abrirLeccion(mapaDePrueba[0].subniveles[1]); // actual
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/lesson', 11]);
    });
  });

  describe('cerrarSesion', () => {
    it('cancela notificaciones, cierra sesión y navega a login', async () => {
      notificationsSpy.cancelarTodo.and.resolveTo();
      supabaseSpy.signOut.and.resolveTo({ error: null } as any);

      await component.cerrarSesion();

      expect(notificationsSpy.cancelarTodo).toHaveBeenCalled();
      expect(supabaseSpy.signOut).toHaveBeenCalled();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });
});
