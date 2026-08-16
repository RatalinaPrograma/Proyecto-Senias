import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase';
import { addIcons } from 'ionicons';
import { paw } from 'ionicons/icons';

addIcons({ paw });

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
})
export class LoginPage implements OnDestroy {
  errorMsg = '';
  cargando = false;

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
    this.cargando = false;

    if (error) {
      this.errorMsg = error.message === 'Invalid login credentials'
        ? 'Email o contraseña incorrectos'
        : error.message;
      return;
    }

    console.log('Login exitoso:', data);
    this.router.navigate(['/home']);
  }

  irARegistro() {
    this.router.navigate(['/auth/register']);
  }

  ngOnDestroy() {
    this.form.reset();
    this.errorMsg = '';
  }
}