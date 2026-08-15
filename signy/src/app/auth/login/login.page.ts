import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './login.page.html',
})
export class LoginPage {
  email = '';
  password = '';
  errorMsg = '';
  cargando = false;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  async iniciarSesion() {
    this.errorMsg = '';
    this.cargando = true;

    const { data, error } = await this.supabaseService.signIn(this.email, this.password);

    this.cargando = false;

    if (error) {
      this.errorMsg = error.message;
      return;
    }

    console.log('Login exitoso:', data);
    this.router.navigate(['/home']);
  }

  irARegistro() {
    this.router.navigate(['/auth/register']);
  }
}