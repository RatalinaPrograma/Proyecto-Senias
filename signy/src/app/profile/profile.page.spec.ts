import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ProfilePage } from './profile.page';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { NotificationsService } from '../services/notifications';
import { statsDePrueba, perfilDePrueba } from '../../testing/supabase-mock';

describe('ProfilePage', () => {
  let component: ProfilePage;
  let fixture: ComponentFixture<ProfilePage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let contenidoSpy: jasmine.SpyObj<ContenidoService>;
  let notificationsSpy: jasmine.SpyObj<NotificationsService>;
  let routerSpy: jasmine.SpyObj<Router>;

  function prepararCargaExitosa() {
    supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1', user_metadata: { full_name: 'Benja' } } }, error: null } as any);
    supabaseSpy.getOCrearProfile.and.resolveTo(perfilDePrueba());
    contenidoSpy.getMisStats.and.resolveTo(statsDePrueba({ puntos_experiencia: 300, racha_congeladores: 0 }));
    supabaseSpy.contarSeguidores.and.resolveTo(3);
    supabaseSpy.contarSeguidos.and.resolveTo(5);
    contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);
    contenidoSpy.getLogros.and.resolveTo([]);
    contenidoSpy.getMisLogrosIds.and.resolveTo(new Set());
    contenidoSpy.getMisFallos.and.resolveTo([]);
    contenidoSpy.getAmigosBajosEnCongelador.and.resolveTo([]);
  }

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['getUser', 'getOCrearProfile', 'contarSeguidores', 'contarSeguidos', 'signOut']);
    contenidoSpy = jasmine.createSpyObj('ContenidoService', [
      'getMisStats', 'obtenerHistorialRacha', 'getLogros', 'getMisLogrosIds', 'getMisFallos',
      'getAmigosBajosEnCongelador', 'comprarCongelador', 'regalarCongelador', 'fechaHoy', 'sumarDias',
    ]);
    notificationsSpy = jasmine.createSpyObj('NotificationsService', ['cancelarTodo']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    contenidoSpy.fechaHoy.and.returnValue('2026-09-08');
    contenidoSpy.sumarDias.and.callFake((fecha: string, dias: number) => {
      const d = new Date(fecha + 'T12:00:00'); // mediodía local: evita cruces de día por huso horario
      d.setDate(d.getDate() + dias);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dia = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dia}`;
    });

    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: ContenidoService, useValue: contenidoSpy },
        { provide: NotificationsService, useValue: notificationsSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePage);
    component = fixture.componentInstance;
  });

  describe('ionViewWillEnter', () => {
    it('redirige a login si no hay sesión', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: null }, error: null } as any);

      await component.ionViewWillEnter();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('carga todo en paralelo y arma el calendario de 28 días', async () => {
      prepararCargaExitosa();

      await component.ionViewWillEnter();

      expect(component.diasCalendario.length).toBe(28);
      expect(component.diasCalendario[27].esHoy).toBeTrue();
      expect(component.cargando).toBeFalse();
      expect(component.seguidores).toBe(3);
      expect(component.seguidos).toBe(5);
    });

    it('usa el nombre de los metadatos del usuario como respaldo si el perfil aún no existe', async () => {
      prepararCargaExitosa();

      await component.ionViewWillEnter();

      expect(supabaseSpy.getOCrearProfile).toHaveBeenCalledWith('user-1', 'Benja');
    });

    it('un día sin fila en el historial pero anterior a hoy se marca "sin-datos"', async () => {
      prepararCargaExitosa();
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([]);

      await component.ionViewWillEnter();

      expect(component.diasCalendario[0].estado).toBe('sin-datos');
    });

    it('un día con fila en el historial usa ese estado', async () => {
      prepararCargaExitosa();
      contenidoSpy.obtenerHistorialRacha.and.resolveTo([{ fecha: '2026-09-07', estado: 'practicado' } as any]);

      await component.ionViewWillEnter();

      const diaAyer = component.diasCalendario.find(d => d.fecha === '2026-09-07');
      expect(diaAyer?.estado).toBe('practicado');
    });

    it('ordena los logros desbloqueados primero', async () => {
      prepararCargaExitosa();
      contenidoSpy.getLogros.and.resolveTo([
        { id: 1, codigo: 'a', nombre: 'A', descripcion: null, icono_url: null, icono: null, created_at: null },
        { id: 2, codigo: 'b', nombre: 'B', descripcion: null, icono_url: null, icono: null, created_at: null },
      ]);
      contenidoSpy.getMisLogrosIds.and.resolveTo(new Set([2]));

      await component.ionViewWillEnter();

      expect(component.logros[0].id).toBe(2);
      expect(component.logros[0].desbloqueado).toBeTrue();
      expect(component.logros[1].desbloqueado).toBeFalse();
    });
  });

  describe('comprarCongelador', () => {
    beforeEach(async () => {
      prepararCargaExitosa();
      await component.ionViewWillEnter();
    });

    it('actualiza el estado local sin recargar todo el perfil cuando la compra funciona', async () => {
      contenidoSpy.comprarCongelador.and.resolveTo({ ok: true });

      await component.comprarCongelador();

      expect(component.stats?.puntos_experiencia).toBe(100); // 300 - 200
      expect(component.stats?.racha_congeladores).toBe(1);
      expect(component.mensajeCongelador).toContain('¡Listo!');
    });

    it('muestra el error del servicio si la compra falla', async () => {
      contenidoSpy.comprarCongelador.and.resolveTo({ ok: false, error: 'Te faltan 50 XP.' });

      await component.comprarCongelador();

      expect(component.mensajeCongelador).toBe('Te faltan 50 XP.');
    });

    it('evita una doble compra si ya hay una en curso', async () => {
      component.comprandoCongelador = true;

      await component.comprarCongelador();

      expect(contenidoSpy.comprarCongelador).not.toHaveBeenCalled();
    });
  });

  describe('regalarCongelador', () => {
    const amigo = { id: 'amigo-1', full_name: 'Ana', racha_congeladores: 0 };

    beforeEach(async () => {
      prepararCargaExitosa();
      contenidoSpy.getAmigosBajosEnCongelador.and.resolveTo([{ ...amigo, avatar_url: null }]);
      await component.ionViewWillEnter();
    });

    it('descuenta el XP local y saca al amigo de la lista cuando el regalo funciona', async () => {
      contenidoSpy.regalarCongelador.and.resolveTo({ ok: true });

      await component.regalarCongelador(amigo);

      expect(component.stats?.puntos_experiencia).toBe(200); // 300 - 100
      expect(component.amigosBajosCongelador.find(a => a.id === 'amigo-1')).toBeUndefined();
      expect(component.mensajeCongelador).toContain('Ana');
    });

    it('muestra el error y NO saca al amigo de la lista si el regalo falla', async () => {
      contenidoSpy.regalarCongelador.and.resolveTo({ ok: false, error: 'Ya le regalaste esta semana.' });

      await component.regalarCongelador(amigo);

      expect(component.mensajeCongelador).toBe('Ya le regalaste esta semana.');
      expect(component.amigosBajosCongelador.find(a => a.id === 'amigo-1')).toBeDefined();
    });
  });

  describe('navegación', () => {
    beforeEach(async () => {
      prepararCargaExitosa();
      await component.ionViewWillEnter();
    });

    it('irABuscarAmigos navega a /friends con tab=buscar', () => {
      component.irABuscarAmigos();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/friends'], { queryParams: { tab: 'buscar' } });
    });

    it('irASeguidores navega a /friends con tab=seguidores', () => {
      component.irASeguidores();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/friends'], { queryParams: { tab: 'seguidores' } });
    });

    it('cerrarSesion cancela notificaciones, cierra sesión y navega a login', async () => {
      notificationsSpy.cancelarTodo.and.resolveTo();
      supabaseSpy.signOut.and.resolveTo({ error: null } as any);

      await component.cerrarSesion();

      expect(notificationsSpy.cancelarTodo).toHaveBeenCalled();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });
});
