import { Component } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonAlert,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonAlert,
    FormsModule,
  ],
})
export class HomePage {
  email = '';
  password = '';

  // Para mostrar alertas
  isAlertOpen = false;
  alertHeader = '';
  alertMessage = '';
  alertButtons = ['OK'];

  constructor(private readonly supabase: SupabaseService) {}

  async handleLogin() {
    if (!this.email || !this.password) {
      this.showAlert('Error', 'Por favor, ingresa tu correo y contraseña.');
      return;
    }

    try {
      const { data, error } =
        await this.supabase.supabase.auth.signInWithPassword({
          email: this.email,
          password: this.password,
        });

      if (error) throw error;

      this.showAlert('Éxito', `¡Bienvenido! Sesión iniciada para ${data.user?.email}`);
    } catch (error: any) {
      this.showAlert('Error de inicio de sesión', error.message);
    }
  }

  async handleRegister() {
    if (!this.email || !this.password) {
      this.showAlert('Error', 'Por favor, ingresa un correo y contraseña para registrarte.');
      return;
    }

    try {
      const { data, error } = await this.supabase.supabase.auth.signUp({
        email: this.email,
        password: this.password,
      });

      if (error) throw error;

      this.showAlert('Registro exitoso', 'Se ha enviado un correo de confirmación. Por favor, revisa tu bandeja de entrada.');
    } catch (error: any) {
      this.showAlert('Error en el registro', error.message);
    }
  }

  // Helper para mostrar alertas
  showAlert(header: string, message: string) {
    this.alertHeader = header;
    this.alertMessage = message;
    this.isAlertOpen = true;
  }
}
