import { TestBed } from '@angular/core/testing';
import { Router, convertToParamMap } from '@angular/router';
import { authGuard, guestGuard, adminGuard, lessonGuard } from './auth.guard';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { NivelConEstado } from '../data/db-types';

describe('Guards de autenticación y rutas', () => {
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let contenidoSpy: jasmine.SpyObj<ContenidoService>;
  let routerSpy: jasmine.SpyObj<Router>;

  const usuarioLogueado = { id: 'user-1' } as any;

  beforeEach(() => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['getUsuarioLocal', 'esAdmin']);
    contenidoSpy = jasmine.createSpyObj('ContenidoService', ['obtenerMapaDeAprendizaje']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: ContenidoService, useValue: contenidoSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });
  });

  function correr<T>(guard: (...args: any[]) => T, ...args: any[]): T {
    return TestBed.runInInjectionContext(() => guard(...args));
  }

  describe('authGuard', () => {
    it('deja pasar si hay un usuario en la sesión local', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });

      const resultado = await correr(authGuard, {} as any, {} as any);

      expect(resultado).toBeTrue();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('redirige a login y bloquea si no hay usuario', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: null, error: null });

      const resultado = await correr(authGuard, {} as any, {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('guestGuard', () => {
    it('deja pasar si NO hay sesión (para ver login/register)', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: null, error: null });

      const resultado = await correr(guestGuard, {} as any, {} as any);

      expect(resultado).toBeTrue();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('redirige a home y bloquea si ya hay sesión activa', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });

      const resultado = await correr(guestGuard, {} as any, {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });
  });

  describe('adminGuard', () => {
    it('redirige a login si no hay sesión', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: null, error: null });

      const resultado = await correr(adminGuard, {} as any, {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
      expect(supabaseSpy.esAdmin).not.toHaveBeenCalled();
    });

    it('redirige a home si hay sesión pero no es admin', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });
      supabaseSpy.esAdmin.and.resolveTo(false);

      const resultado = await correr(adminGuard, {} as any, {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('deja pasar si hay sesión y es admin', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });
      supabaseSpy.esAdmin.and.resolveTo(true);

      const resultado = await correr(adminGuard, {} as any, {} as any);

      expect(resultado).toBeTrue();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });
  });

  describe('lessonGuard', () => {
    function mapaConSubnivel(id: number, estado: 'completado' | 'actual' | 'bloqueado' | 'proximamente'): NivelConEstado[] {
      return [{
        id: 1, numero_nivel: 1, nombre: 'Nivel 1', descripcion: null, dificultad: null,
        etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null,
        accesible: true, completado: false,
        subniveles: [{
          id, nivel_id: 1, numero_subnivel: 1, nombre: 'Sub 1', tipo: null,
          pagina_quiz_local: null, descripcion: null, created_at: null, estado,
        }],
      }];
    }

    function rutaConSubnivel(subnivelId: string) {
      return { paramMap: convertToParamMap({ subnivelId }) } as any;
    }

    it('redirige a login si no hay sesión', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: null, error: null });

      const resultado = await correr(lessonGuard, rutaConSubnivel('5'), {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('deja pasar si el subnivel está "actual"', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaConSubnivel(5, 'actual'));

      const resultado = await correr(lessonGuard, rutaConSubnivel('5'), {} as any);

      expect(resultado).toBeTrue();
    });

    it('deja pasar si el subnivel ya está "completado" (repaso)', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaConSubnivel(5, 'completado'));

      const resultado = await correr(lessonGuard, rutaConSubnivel('5'), {} as any);

      expect(resultado).toBeTrue();
    });

    it('bloquea y redirige a home si el subnivel está "bloqueado"', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaConSubnivel(5, 'bloqueado'));

      const resultado = await correr(lessonGuard, rutaConSubnivel('5'), {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('bloquea si alguien navega directo a un subnivelId que no existe en el mapa', async () => {
      supabaseSpy.getUsuarioLocal.and.resolveTo({ user: usuarioLogueado, error: null });
      contenidoSpy.obtenerMapaDeAprendizaje.and.resolveTo(mapaConSubnivel(5, 'actual'));

      const resultado = await correr(lessonGuard, rutaConSubnivel('999'), {} as any);

      expect(resultado).toBeFalse();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });
  });
});
