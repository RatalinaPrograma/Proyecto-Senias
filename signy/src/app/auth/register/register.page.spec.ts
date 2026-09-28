import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RegisterPage } from './register.page';
import { SupabaseService } from '../../services/supabase';

describe('RegisterPage', () => {
  let component: RegisterPage;
  let fixture: ComponentFixture<RegisterPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let routerSpy: jasmine.SpyObj<Router>;

  const formularioValido = {
    fullName: 'Benja Muñoz',
    email: 'benja@example.com',
    password: 'Abcdefg1',
    confirmPassword: 'Abcdefg1',
  };

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['signUp', 'upsertProfile']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('el formulario empieza inválido', () => {
    expect(component.form.valid).toBeFalse();
  });

  it('marca "passwordsNoCoinciden" si las contraseñas no coinciden', () => {
    component.form.setValue({ ...formularioValido, confirmPassword: 'OtraClave1' });
    expect(component.form.hasError('passwordsNoCoinciden')).toBeTrue();
  });

  it('rechaza una contraseña sin mayúscula ni número', () => {
    component.form.setValue({ ...formularioValido, password: 'abcdefgh', confirmPassword: 'abcdefgh' });
    expect(component.password?.hasError('sinMayuscula')).toBeTrue();
    expect(component.password?.hasError('sinNumero')).toBeTrue();
  });

  it('no llama a signUp si el formulario es inválido', async () => {
    await component.registrar();
    expect(supabaseSpy.signUp).not.toHaveBeenCalled();
  });

  it('muestra el error del servidor si el registro falla', async () => {
    component.form.setValue(formularioValido);
    supabaseSpy.signUp.and.resolveTo({ data: { user: null }, error: { message: 'El correo ya está registrado' } } as any);

    await component.registrar();

    expect(component.errorMsg).toBe('El correo ya está registrado');
    expect(component.exito).toBeFalse();
    expect(supabaseSpy.upsertProfile).not.toHaveBeenCalled();
  });

  it('crea el perfil y muestra éxito cuando el registro funciona', async () => {
    component.form.setValue(formularioValido);
    supabaseSpy.signUp.and.resolveTo({ data: { user: { id: 'nuevo-user' } }, error: null } as any);
    supabaseSpy.upsertProfile.and.resolveTo({ data: null, error: null } as any);

    await component.registrar();

    expect(supabaseSpy.upsertProfile).toHaveBeenCalledWith({ id: 'nuevo-user', full_name: 'Benja Muñoz' });
    expect(component.exito).toBeTrue();
    expect(component.form.value.email).toBeFalsy(); // el form se resetea
  });

  it('irALogin navega a /auth/login', () => {
    component.irALogin();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});
