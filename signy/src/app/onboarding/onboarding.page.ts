import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';

interface Slide {
  imagen: string;
  titulo: string;
  texto: string;
}

const STORAGE_KEY = 'signy_onboarding_visto';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
})
export class OnboardingPage implements OnInit {
  paso = 0;

  slides: Slide[] = [
    {
      imagen: 'assets/img/login.png',
      titulo: 'Bienvenido a Signy',
      texto: 'La Lengua de Señas Chilena (LSCh) es la lengua de la comunidad sorda en Chile. Muy pocas personas oyentes la aprenden — vamos a cambiar eso.',
    },
    {
      imagen: 'assets/img/registro.png',
      titulo: 'Aprende como jugando',
      texto: 'Lecciones cortas, racha diaria, vidas y niveles. Aprender LSCh se siente como avanzar en un juego, no como estudiar.',
    },
    {
      imagen: 'assets/img/login.png',
      titulo: 'Practica con tu cámara',
      texto: 'Al final de cada lección, activa tu cámara y practica el gesto. Signy te da retroalimentación al momento.',
    },
    {
      imagen: 'assets/img/registro.png',
      titulo: '¿Listo para empezar?',
      texto: 'Crea tu cuenta gratis y da tu primer paso para comunicarte con la comunidad sorda chilena.',
    },
  ];

  constructor(private router: Router) {}

  ngOnInit() {
    if (localStorage.getItem(STORAGE_KEY) === '1') {
      this.router.navigate(['/auth/login'], { replaceUrl: true });
    }
  }

  get esUltimo(): boolean {
    return this.paso === this.slides.length - 1;
  }

  siguiente() {
    if (this.esUltimo) {
      this.terminar();
      return;
    }
    this.paso++;
  }

  anterior() {
    if (this.paso > 0) this.paso--;
  }

  irAPaso(i: number) {
    this.paso = i;
  }

  saltar() {
    this.terminar();
  }

  private terminar() {
    localStorage.setItem(STORAGE_KEY, '1');
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
