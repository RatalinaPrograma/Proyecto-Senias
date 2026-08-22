import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase';
import { passwordStrengthValidator, passwordsMatchValidator } from '../../shared/validators';

@Component({
  selector: 'app-recuperar',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IonicModule],
  templateUrl: './recuperar.page.html',
  styleUrls: ['./recuperar.page.scss'],
})
export class RecuperarPage {
  paso: 'email' | 'codigo' | 'listo' = 'email';
  cargando = false;
  errorMsg = '';
  emailEnviado = '';

  formEmail = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  formCodigo = this.fb.group({
    codigo: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
    password: ['', [Validators.required, Validators.minLength(8), passwordStrengthValidator()]],
    confirmPassword: ['', [Validators.required]],
  }, {
    validators: passwordsMatchValidator('password', 'confirmPassword'),
  });

  constructor(
    private fb: FormBuilder,
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  async enviarCodigo() {
    this.errorMsg = '';
    if (this.formEmail.invalid) {
      this.formEmail.markAllAsTouched();
      return;
    }

    this.cargando = true;
    const email = this.formEmail.value.email!;
    const { error } = await this.supabaseService.requestPasswordResetCode(email);
    this.cargando = false;

    if (error) {
      this.errorMsg = error.message;
      return;
    }

    this.emailEnviado = email;
    this.paso = 'codigo';
  }

  async confirmarNuevaPassword() {
    this.errorMsg = '';
    if (this.formCodigo.invalid) {
      this.formCodigo.markAllAsTouched();
      return;
    }

    this.cargando = true;
    const { codigo, password } = this.formCodigo.value;
    const { error } = await this.supabaseService.confirmPasswordResetCode(this.emailEnviado, codigo!, password!);
    this.cargando = false;

    if (error) {
      this.errorMsg = 'Código inválido o expirado. Intenta pedirlo de nuevo.';
      return;
    }

    this.paso = 'listo';
  }

  volverAEmail() {
    this.paso = 'email';
    this.errorMsg = '';
    this.formCodigo.reset();
  }

  irALogin() {
    this.router.navigate(['/auth/login']);
  }
}
