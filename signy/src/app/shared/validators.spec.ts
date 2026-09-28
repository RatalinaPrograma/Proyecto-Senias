import { FormControl, FormGroup } from '@angular/forms';
import { passwordStrengthValidator, passwordsMatchValidator } from './validators';

describe('passwordStrengthValidator', () => {
  const validador = passwordStrengthValidator();

  it('no marca error cuando el campo está vacío (lo maneja "required")', () => {
    expect(validador(new FormControl(''))).toBeNull();
  });

  it('exige al menos una mayúscula', () => {
    const resultado = validador(new FormControl('abcdefg1'));
    expect(resultado).toEqual({ sinMayuscula: true });
  });

  it('exige al menos un número', () => {
    const resultado = validador(new FormControl('Abcdefgh'));
    expect(resultado).toEqual({ sinNumero: true });
  });

  it('reporta ambos errores si faltan mayúscula y número', () => {
    const resultado = validador(new FormControl('abcdefgh'));
    expect(resultado).toEqual({ sinMayuscula: true, sinNumero: true });
  });

  it('pasa con una contraseña que tiene mayúscula y número', () => {
    expect(validador(new FormControl('Abcdefg1'))).toBeNull();
  });
});

describe('passwordsMatchValidator', () => {
  function grupo(password: string, confirm: string): FormGroup {
    return new FormGroup({
      password: new FormControl(password),
      confirmPassword: new FormControl(confirm),
    });
  }

  const validador = passwordsMatchValidator('password', 'confirmPassword');

  it('no marca error si la confirmación está vacía (todavía no la escribió)', () => {
    expect(validador(grupo('Abcdefg1', ''))).toBeNull();
  });

  it('no marca error cuando ambas contraseñas coinciden', () => {
    expect(validador(grupo('Abcdefg1', 'Abcdefg1'))).toBeNull();
  });

  it('marca error cuando las contraseñas no coinciden', () => {
    expect(validador(grupo('Abcdefg1', 'Otra1234'))).toEqual({ passwordsNoCoinciden: true });
  });
});
