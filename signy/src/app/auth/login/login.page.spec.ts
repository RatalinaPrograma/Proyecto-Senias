import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LoginPage } from './login.page';
import { SupabaseService } from '../../services/supabase';

describe('LoginPage', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', [
      'signIn', 'signOut', 'getAuthenticatorAssuranceLevel', 'mfaListFactors', 'mfaChallengeAndVerifyLogin',
    ]);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('el formulario empieza inválido (email y password son requeridos)', () => {
    expect(component.form.valid).toBeFalse();
  });

  it('no intenta iniciar sesión si el formulario es inválido', async () => {
    await component.iniciarSesion();

    expect(supabaseSpy.signIn).not.toHaveBeenCalled();
    expect(component.email?.touched).toBeTrue(); // markAllAsTouched
  });

  it('muestra un mensaje amigable cuando las credenciales son inválidas', async () => {
    component.form.setValue({ email: 'a@a.com', password: 'mala-clave' });
    supabaseSpy.signIn.and.resolveTo({ data: null, error: { message: 'Invalid login credentials' } } as any);

    await component.iniciarSesion();

    expect(component.errorMsg).toBe('Email o contraseña incorrectos');
    expect(component.cargando).toBeFalse();
  });

  it('navega a /home tras un login exitoso sin 2FA', async () => {
    component.form.setValue({ email: 'a@a.com', password: 'Buena1234' });
    supabaseSpy.signIn.and.resolveTo({ data: { user: { id: 'u1' } }, error: null } as any);
    supabaseSpy.getAuthenticatorAssuranceLevel.and.resolveTo({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null } as any);

    await component.iniciarSesion();

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    expect(component.pidiendoCodigoMfa).toBeFalse();
  });

  it('pide el código de 2FA en vez de navegar si la cuenta lo requiere', async () => {
    component.form.setValue({ email: 'a@a.com', password: 'Buena1234' });
    supabaseSpy.signIn.and.resolveTo({ data: { user: { id: 'u1' } }, error: null } as any);
    supabaseSpy.getAuthenticatorAssuranceLevel.and.resolveTo({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null } as any);
    supabaseSpy.mfaListFactors.and.resolveTo({ data: { totp: [{ id: 'factor-1', status: 'verified' }] }, error: null } as any);

    await component.iniciarSesion();

    expect(component.pidiendoCodigoMfa).toBeTrue();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('verificarCodigoMfa navega a /home cuando el código es correcto', async () => {
    (component as any).factorIdMfa = 'factor-1';
    component.codigoMfa = '123456';
    supabaseSpy.mfaChallengeAndVerifyLogin.and.resolveTo({ data: {}, error: null } as any);

    await component.verificarCodigoMfa();

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
  });

  it('verificarCodigoMfa muestra error y limpia el código si es incorrecto', async () => {
    (component as any).factorIdMfa = 'factor-1';
    component.codigoMfa = '000000';
    supabaseSpy.mfaChallengeAndVerifyLogin.and.resolveTo({ error: { message: 'Invalid code' } } as any);

    await component.verificarCodigoMfa();

    expect(component.errorMsg).toContain('Código incorrecto');
    expect(component.codigoMfa).toBe('');
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('cancelarMfa limpia el estado y cierra la sesión ya iniciada', () => {
    component.pidiendoCodigoMfa = true;
    component.codigoMfa = '123456';

    component.cancelarMfa();

    expect(component.pidiendoCodigoMfa).toBeFalse();
    expect(component.codigoMfa).toBe('');
    expect(supabaseSpy.signOut).toHaveBeenCalled();
  });

  it('irARegistro navega a /auth/register', () => {
    component.irARegistro();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/register']);
  });
});
