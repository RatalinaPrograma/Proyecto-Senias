import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase';
import { addIcons } from 'ionicons';
import { paw } from 'ionicons/icons';

addIcons({ paw });

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, IonicModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
})
export class LoginPage implements OnDestroy {
  errorMsg = '';
  cargando = false;

  // Paso 2: código de la app autenticadora (solo si el usuario activó 2FA)
  pidiendoCodigoMfa = false;
  codigoMfa = '';
  private factorIdMfa: string | null = null;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor(
    private fb: FormBuilder,
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  get email() { return this.form.get('email'); }
  get password() { return this.form.get('password'); }

  async iniciarSesion() {
    this.errorMsg = '';

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.cargando = true;
    const { email, password } = this.form.value;
    const { data, error } = await this.supabaseService.signIn(email!, password!);

    if (error) {
      this.cargando = false;
      this.errorMsg = error.message === 'Invalid login credentials'
        ? 'Email o contraseña incorrectos'
        : error.message;
      return;
    }

    // ¿La cuenta tiene 2FA activado y falta verificarlo en esta sesión?
    const { data: aal } = await this.supabaseService.getAuthenticatorAssuranceLevel();
    const requiereMfa = aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2';

    if (requiereMfa) {
      const { data: factores } = await this.supabaseService.mfaListFactors();
      const factorVerificado = factores?.totp?.find(f => f.status === 'verified');

      this.cargando = false;

      if (!factorVerificado) {
        // Caso raro: pide aal2 pero no hay factor verificado listado.
        this.errorMsg = 'No se pudo verificar tu segundo factor. Intenta de nuevo.';
        return;
      }

      this.factorIdMfa = factorVerificado.id;
      this.pidiendoCodigoMfa = true;
      return;
    }

    this.cargando = false;
    this.router.navigate(['/home']);
  }

  async verificarCodigoMfa() {
    if (!this.factorIdMfa || this.codigoMfa.length !== 6) return;

    this.errorMsg = '';
    this.cargando = true;
    const { error } = await this.supabaseService.mfaChallengeAndVerifyLogin(this.factorIdMfa, this.codigoMfa);
    this.cargando = false;

    if (error) {
      this.errorMsg = 'Código incorrecto. Revisa tu app autenticadora.';
      this.codigoMfa = '';
      return;
    }

    this.router.navigate(['/home']);
  }

  cancelarMfa() {
    this.pidiendoCodigoMfa = false;
    this.codigoMfa = '';
    this.factorIdMfa = null;
    this.errorMsg = '';
    // No hay una forma limpia de "deshacer" el signIn ya hecho salvo cerrar
    // la sesión, así que la cerramos para dejar todo en estado consistente.
    this.supabaseService.signOut();
  }

  irARegistro() {
    this.router.navigate(['/auth/register']);
  }

  irARecuperar() {
    this.router.navigate(['/auth/recuperar']);
  }

  ngOnDestroy() {
    this.form.reset();
    this.errorMsg = '';
  }
}
