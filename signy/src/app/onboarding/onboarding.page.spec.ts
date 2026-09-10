import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { OnboardingPage } from './onboarding.page';
import { SupabaseService } from '../services/supabase';
import { PreferencesAdapter } from '../services/capacitor-plugins';

describe('OnboardingPage', () => {
  let component: OnboardingPage;
  let fixture: ComponentFixture<OnboardingPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let preferencesSpy: jasmine.SpyObj<PreferencesAdapter>;

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['getUser']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    preferencesSpy = jasmine.createSpyObj('PreferencesAdapter', ['get', 'set']);
    preferencesSpy.get.and.resolveTo({ value: null });
    preferencesSpy.set.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [OnboardingPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: routerSpy },
        { provide: PreferencesAdapter, useValue: preferencesSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingPage);
    component = fixture.componentInstance;
  });

  describe('ngOnInit', () => {
    it('muestra el tutorial si nunca se vio', async () => {
      await component.ngOnInit();
      expect(component.listo).toBeTrue();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });

    it('si ya se vio y hay sesión, salta directo a /home', async () => {
      preferencesSpy.get.and.resolveTo({ value: '1' });
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'u1' } }, error: null } as any);

      await component.ngOnInit();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home'], { replaceUrl: true });
      expect(component.listo).toBeFalse();
    });

    it('si ya se vio y NO hay sesión, salta directo a /auth/login', async () => {
      preferencesSpy.get.and.resolveTo({ value: '1' });
      supabaseSpy.getUser.and.resolveTo({ data: { user: null }, error: null } as any);

      await component.ngOnInit();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login'], { replaceUrl: true });
    });
  });

  describe('navegación entre slides', () => {
    it('esUltimo es true solo en la última diapositiva', () => {
      component.paso = component.slides.length - 1;
      expect(component.esUltimo).toBeTrue();
      component.paso = 0;
      expect(component.esUltimo).toBeFalse();
    });

    it('siguiente() avanza un paso si no es la última', () => {
      component.paso = 0;
      component.siguiente();
      expect(component.paso).toBe(1);
    });

    it('siguiente() en la última diapositiva termina el tutorial en vez de avanzar', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: null }, error: null } as any);
      component.paso = component.slides.length - 1;

      component.siguiente();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(preferencesSpy.set).toHaveBeenCalledWith({ key: 'signy_onboarding_visto', value: '1' });
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login'], { replaceUrl: true });
    });

    it('anterior() retrocede un paso, sin bajar de 0', () => {
      component.paso = 1;
      component.anterior();
      expect(component.paso).toBe(0);
      component.anterior();
      expect(component.paso).toBe(0);
    });

    it('irAPaso() salta directo a un índice', () => {
      component.irAPaso(3);
      expect(component.paso).toBe(3);
    });

    it('saltar() marca el tutorial como visto y redirige', async () => {
      supabaseSpy.getUser.and.resolveTo({ data: { user: { id: 'u1' } }, error: null } as any);

      component.saltar();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(preferencesSpy.set).toHaveBeenCalled();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home'], { replaceUrl: true });
    });
  });

  it('irALab navega a /mediapipe-test', () => {
    component.irALab();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/mediapipe-test']);
  });
});
