import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { FriendsPage } from './friends.page';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { perfilDePrueba } from '../../testing/supabase-mock';

describe('FriendsPage', () => {
  let component: FriendsPage;
  let fixture: ComponentFixture<FriendsPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let contenidoSpy: jasmine.SpyObj<ContenidoService>;
  let routerSpy: jasmine.SpyObj<Router>;

  function crearActivatedRoute(tab: string | null) {
    return { snapshot: { queryParamMap: convertToParamMap(tab ? { tab } : {}) } } as any;
  }

  async function crearComponente(tabInicial: string | null = null) {
    await TestBed.configureTestingModule({
      imports: [FriendsPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: ContenidoService, useValue: contenidoSpy },
        { provide: ActivatedRoute, useValue: crearActivatedRoute(tabInicial) },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendsPage);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', [
      'getUser', 'idsSeguidos', 'listaSeguidores', 'listaSeguidos', 'buscarPersonas', 'seguir', 'dejarDeSeguir',
    ]);
    contenidoSpy = jasmine.createSpyObj('ContenidoService', ['getRanking']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null } as any);
    supabaseSpy.idsSeguidos.and.resolveTo([]);
  });

  afterEach(() => jasmine.clock().uninstall());

  describe('ngOnInit', () => {
    it('redirige a login si no hay usuario', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: null }, error: null } as any);
      await crearComponente();

      await component.ngOnInit();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('usa "buscar" como pestaña por defecto si no viene un ?tab= válido', async () => {
      await crearComponente(null);
      await component.ngOnInit();
      expect(component.tab).toBe('buscar');
    });

    it('ignora un valor de ?tab= que no es una pestaña válida', async () => {
      await crearComponente('no-existe');
      await component.ngOnInit();
      expect(component.tab).toBe('buscar');
    });

    it('respeta un ?tab=ranking válido y carga el ranking', async () => {
      contenidoSpy.getRanking.and.resolveTo([]);
      await crearComponente('ranking');

      await component.ngOnInit();

      expect(component.tab).toBe('ranking');
      expect(contenidoSpy.getRanking).toHaveBeenCalledWith('user-1');
    });
  });

  describe('cambiarTab / cargarTabActual', () => {
    beforeEach(async () => {
      await crearComponente();
      await component.ngOnInit();
    });

    it('carga seguidores al cambiar a esa pestaña', async () => {
      supabaseSpy.listaSeguidores.and.resolveTo([perfilDePrueba()]);
      await component.cambiarTab('seguidores');
      expect(component.seguidores.length).toBe(1);
      expect(component.cargandoListas).toBeFalse();
    });

    it('carga seguidos al cambiar a esa pestaña', async () => {
      supabaseSpy.listaSeguidos.and.resolveTo([perfilDePrueba()]);
      await component.cambiarTab('seguidos');
      expect(component.seguidos.length).toBe(1);
    });
  });

  describe('búsqueda con debounce', () => {
    beforeEach(async () => {
      await crearComponente();
      await component.ngOnInit();
      jasmine.clock().install();
    });

    it('no busca antes de que pasen 350ms desde la última tecla', () => {
      component.query = 'ben';
      component.onBuscarInput();
      jasmine.clock().tick(200);

      expect(supabaseSpy.buscarPersonas).not.toHaveBeenCalled();
    });

    it('busca recién a los 350ms de inactividad', async () => {
      supabaseSpy.buscarPersonas.and.resolveTo([perfilDePrueba()]);
      component.query = 'benja';
      component.onBuscarInput();
      jasmine.clock().tick(350);
      await Promise.resolve(); // deja correr el then() de ejecutarBusqueda

      expect(supabaseSpy.buscarPersonas).toHaveBeenCalledWith('benja', 'user-1');
    });

    it('cada tecla reinicia el temporizador (solo busca una vez al final)', async () => {
      supabaseSpy.buscarPersonas.and.resolveTo([]);
      component.query = 'b';
      component.onBuscarInput();
      jasmine.clock().tick(200);
      component.query = 'be';
      component.onBuscarInput(); // reinicia el debounce
      jasmine.clock().tick(200);
      component.query = 'ben';
      component.onBuscarInput();
      jasmine.clock().tick(350);
      await Promise.resolve();

      expect(supabaseSpy.buscarPersonas).toHaveBeenCalledTimes(1);
      expect(supabaseSpy.buscarPersonas).toHaveBeenCalledWith('ben', 'user-1');
    });

    it('con el buscador vacío, limpia los resultados sin consultar el servidor', () => {
      component.query = '   ';
      component.onBuscarInput();
      jasmine.clock().tick(350);

      expect(supabaseSpy.buscarPersonas).not.toHaveBeenCalled();
      expect(component.resultadosBusqueda).toEqual([]);
    });
  });

  describe('toggleSeguir', () => {
    beforeEach(async () => {
      await crearComponente();
      await component.ngOnInit();
    });

    it('sigue a alguien que todavía no seguía', async () => {
      supabaseSpy.seguir.and.resolveTo({ error: null } as any);

      await component.toggleSeguir(perfilDePrueba({ id: 'nueva-amiga' }));

      expect(supabaseSpy.seguir).toHaveBeenCalledWith('nueva-amiga');
      expect(component.loSigo('nueva-amiga')).toBeTrue();
    });

    it('deja de seguir a alguien que ya seguía', async () => {
      await component.toggleSeguir(perfilDePrueba({ id: 'amiga' })); // primero la sigue
      supabaseSpy.dejarDeSeguir.and.resolveTo({ error: null } as any);

      await component.toggleSeguir(perfilDePrueba({ id: 'amiga' }));

      expect(supabaseSpy.dejarDeSeguir).toHaveBeenCalledWith('amiga');
      expect(component.loSigo('amiga')).toBeFalse();
    });

    it('si está en la pestaña "seguidos", la refresca al dejar de seguir a alguien', async () => {
      await component.cambiarTab('seguidos');
      await component.toggleSeguir(perfilDePrueba({ id: 'amiga' }));
      supabaseSpy.listaSeguidos.calls.reset();
      supabaseSpy.listaSeguidos.and.resolveTo([]);

      await component.toggleSeguir(perfilDePrueba({ id: 'amiga' }));

      expect(supabaseSpy.listaSeguidos).toHaveBeenCalled();
    });
  });

  it('volver navega a /profile', async () => {
    await crearComponente();
    await component.ngOnInit();
    component.volver();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/profile']);
  });
});
