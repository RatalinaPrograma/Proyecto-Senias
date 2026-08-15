import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './register.page.html',
})
export class RegisterPage {
  fullName = '';
  email = '';
  password = '';
  errorMsg = '';
  exito = false;
  cargando = false;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  async registrar() {
    this.errorMsg = '';
    this.exito = false;
    this.cargando = true;

    const { data, error } = await this.supabaseService.signUp(
      this.email,
      this.password,
      this.fullName
    );

    this.cargando = false;

    if (error) {
      this.errorMsg = error.message;
      return;
    }

    console.log('Registro exitoso:', data);
    this.exito = true;
  }

  irALogin() {
    this.router.navigate(['/auth/login']);
  }
}