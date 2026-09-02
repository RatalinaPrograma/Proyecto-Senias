import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { Preferences } from '@capacitor/preferences';
import { CachedSrcDirective } from '../shared/cached-src.directive';
import { SupabaseService } from '../services/supabase';

interface Slide {
  imagen: string;
  titulo: string;
  texto: string;
}

const STORAGE_KEY = 'signy_onboarding_visto';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, IonicModule, CachedSrcDirective],
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
})
export class OnboardingPage implements OnInit {
  paso = 0;
  // Recién en true cuando confirmamos que el tutorial SÍ hay que mostrarlo;
  // evita el parpadeo de la slide 1 antes de redirigir a quien ya lo vio.
  listo = false;

  slides: Slide[] = [
    {
      imagen: 'https://bjxcdhtigbsbibcltnup.supabase.co/storage/v1/object/public/icons/login.png',
      titulo: 'Bienvenido a Signy',
      texto: 'La Lengua de Señas Chilena (LSCh) es la lengua de la comunidad sorda en Chile. Muy pocas personas oyentes la aprenden — vamos a cambiar eso.',
    },
    {
      imagen: 'https://bjxcdhtigbsbibcltnup.supabase.co/storage/v1/object/public/icons/registro.png',
      titulo: 'Aprende como jugando',
      texto: 'Lecciones cortas, racha diaria, vidas y niveles. Aprender LSCh se siente como avanzar en un juego, no como estudiar.',
    },
    {
      imagen: 'https://bjxcdhtigbsbibcltnup.supabase.co/storage/v1/object/public/icons/login.png',
      titulo: 'Practica con tu cámara',
      texto: 'Al final de cada lección, activa tu cámara y practica el gesto. Signy te da retroalimentación al momento.',
    },
    {
      imagen: 'https://bjxcdhtigbsbibcltnup.supabase.co/storage/v1/object/public/icons/registro.png',
      titulo: '¿Listo para empezar?',
      texto: 'Crea tu cuenta gratis y da tu primer paso para comunicarte con la comunidad sorda chilena.',
    },
  ];

  constructor(
    private router: Router,
    private supabaseService: SupabaseService
  ) {}

  async ngOnInit() {
    // El tutorial se muestra una sola vez. Si ya se vio, esta página no
    // debería aparecer nunca más: se salta directo a donde corresponda
    // según haya sesión o no.
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value === '1') {
      await this.irADestino();
      return;
    }
    this.listo = true;
  }

  // Manda a /home si hay sesión, a /auth/login si no. Los guards de cada
  // ruta revalidan igual; esto solo evita el rebote login -> home.
  private async irADestino() {
    const { user } = await this.supabaseService.getUsuarioLocal();
    const destino = user ? '/home' : '/auth/login';
    this.router.navigate([destino], { replaceUrl: true });
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

  irALab() {
    this.router.navigate(['/mediapipe-test']);
  }

  private async terminar() {
    await Preferences.set({ key: STORAGE_KEY, value: '1' });
    await this.irADestino();
  }
}
