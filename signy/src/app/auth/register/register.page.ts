import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase';
import { passwordStrengthValidator, passwordsMatchValidator } from '../../shared/validators';
import { addIcons } from 'ionicons';
import { paw } from 'ionicons/icons';

addIcons({ paw });

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule],
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
})
export class RegisterPage implements OnDestroy {
  errorMsg = '';
  exito = false;
  cargando = false;

  form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
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

  get fullName() { return this.form.get('fullName'); }
  get email() { return this.form.get('email'); }
  get password() { return this.form.get('password'); }
  get confirmPassword() { return this.form.get('confirmPassword'); }

  async registrar() {
    this.errorMsg = '';
    this.exito = false;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.cargando = true;
    const { fullName, email, password } = this.form.value;
    const { data, error } = await this.supabaseService.signUp(email!, password!, fullName!);
    this.cargando = false;

    if (error) {
      this.errorMsg = error.message;
      return;
    }

    console.log('Registro exitoso:', data);
    this.exito = true;
    this.form.reset();
  }

  irALogin() {
    this.router.navigate(['/auth/login']);
  }

  ngOnDestroy() {
    this.form.reset();
    this.errorMsg = '';
    this.exito = false;
  }
}