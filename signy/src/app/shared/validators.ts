import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function passwordStrengthValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: string = control.value || '';
    const tieneMayuscula = /[A-Z]/.test(value);
    const tieneNumero = /[0-9]/.test(value);

    if (!value) return null; // deja que 'required' maneje el caso vacío

    const errores: ValidationErrors = {};
    if (!tieneMayuscula) errores['sinMayuscula'] = true;
    if (!tieneNumero) errores['sinNumero'] = true;

    return Object.keys(errores).length > 0 ? errores : null;
  };
}

export function passwordsMatchValidator(passwordKey: string, confirmKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey)?.value;
    const confirm = group.get(confirmKey)?.value;

    if (!confirm) return null;

    return password === confirm ? null : { passwordsNoCoinciden: true };
  };
}