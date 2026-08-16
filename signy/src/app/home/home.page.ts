import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { addIcons } from 'ionicons';
import { flame, star, heart, checkmark, lockClosed, paw, logOutOutline } from 'ionicons/icons';

addIcons({ flame, star, heart, checkmark, 'lock-closed': lockClosed, paw, 'log-out-outline': logOutOutline });

interface Nivel {
  numero: number;
  nombre: string;
  descripcion: string;
  estado: 'completado' | 'actual' | 'bloqueado';
}

interface Unidad {
  id: number;
  titulo: string;
  etiqueta: string;
  descripcion: string;
  color: string;
  colorOscuro: string;
  niveles: Nivel[];
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage {
  racha = 5;
  xp = 320;
  vidas = 4;

  unidades: Unidad[] = [
    {
      id: 1,
      titulo: 'Abecedario',
      etiqueta: 'Dactilología LSCh',
      descripcion: 'Deletrea con las manos',
      color: 'var(--signy-fox)',
      colorOscuro: 'var(--signy-fox-deep)',
      niveles: [
        { numero: 1, nombre: 'A - D', descripcion: 'Primeras letras', estado: 'completado' },
        { numero: 2, nombre: 'E - H', descripcion: 'Sigue el abecedario', estado: 'completado' },
        { numero: 3, nombre: 'I - L', descripcion: 'A mitad de camino', estado: 'actual' },
        { numero: 4, nombre: 'LL - Ñ', descripcion: 'Letras propias del español', estado: 'bloqueado' },
      ],
    },
    {
      id: 2,
      titulo: 'Vocabulario básico',
      etiqueta: 'Saludos y cortesía',
      descripcion: 'Lo esencial para partir',
      color: 'var(--signy-mint)',
      colorOscuro: 'var(--signy-mint-deep)',
      niveles: [
        { numero: 1, nombre: 'Hola y chao', descripcion: 'Saludos básicos', estado: 'bloqueado' },
        { numero: 2, nombre: '¿Cómo estás?', descripcion: 'Responde cómo te sientes', estado: 'bloqueado' },
        { numero: 3, nombre: 'Cortesía', descripcion: 'Por favor, gracias, perdón', estado: 'bloqueado' },
      ],
    },
    {
      id: 3,
      titulo: 'Familia',
      etiqueta: 'Personas cercanas',
      descripcion: 'Habla de tu gente',
      color: '#F2A93B',
      colorOscuro: '#C6841F',
      niveles: [
        { numero: 1, nombre: 'Papás', descripcion: 'Mamá y papá', estado: 'bloqueado' },
        { numero: 2, nombre: 'Hermanos', descripcion: 'Familia y casa', estado: 'bloqueado' },
        { numero: 3, nombre: 'Abuelos', descripcion: 'Tíos y abuelos', estado: 'bloqueado' },
      ],
    },
    {
      id: 4,
      titulo: 'Preguntas frecuentes',
      etiqueta: 'Para conversar',
      descripcion: 'Pregunta sin quedarte callado',
      color: 'var(--signy-error)',
      colorOscuro: '#8F2E22',
      niveles: [
        { numero: 1, nombre: 'Sobre ti', descripcion: '¿Cómo te llamas?', estado: 'bloqueado' },
        { numero: 2, nombre: 'Día a día', descripcion: '¿Qué hora es?', estado: 'bloqueado' },
      ],
    },
  ];

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  get totalNiveles(): number {
    return this.unidades.reduce((acc, u) => acc + u.niveles.length, 0);
  }

  get nivelesCompletados(): number {
    return this.unidades.reduce(
      (acc, u) => acc + u.niveles.filter(n => n.estado === 'completado').length,
      0
    );
  }

  async cerrarSesion() {
    await this.supabaseService.signOut();
    this.router.navigate(['/auth/login']);
  }
}
