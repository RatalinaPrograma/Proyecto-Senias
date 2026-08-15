import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

interface NivelMock {
  numero_nivel: number;
  nombre: string;
  descripcion: string;
  estado: 'completado' | 'actual' | 'bloqueado';
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './home.page.html',
})
export class HomePage {
  racha = 5;
  xp = 320;
  vidas = 4;

  niveles: NivelMock[] = [
    { numero_nivel: 1, nombre: 'Saludos', descripcion: 'Saluda y preséntate', estado: 'completado' },
    { numero_nivel: 2, nombre: 'Familia', descripcion: 'Nombra a tu familia', estado: 'completado' },
    { numero_nivel: 3, nombre: 'Números', descripcion: 'Del 1 al 20', estado: 'actual' },
    { numero_nivel: 4, nombre: 'Colores', descripcion: 'Colores básicos', estado: 'bloqueado' },
    { numero_nivel: 5, nombre: 'Comida', descripcion: 'Pide y ofrece comida', estado: 'bloqueado' },
  ];
}