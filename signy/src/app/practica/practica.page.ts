import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { addIcons } from 'ionicons';
import {
  arrowBack,
  checkmarkCircle,
  closeCircle,
  trophy,
  sadOutline,
  paw,
} from 'ionicons/icons';

addIcons({
  'arrow-back': arrowBack,
  'checkmark-circle': checkmarkCircle,
  'close-circle': closeCircle,
  trophy,
  'sad-outline': sadOutline,
  paw,
});

interface Sena {
  id: number;
  palabra: string;
  descripcion: string;
  video_url: string | null;
}

interface Pregunta {
  senaCorrecta: Sena;
  opciones: string[]; // palabras mezcladas
}

@Component({
  selector: 'app-practica',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './practica.page.html',
  styleUrls: ['./practica.page.scss'],
})
export class PracticaPage implements OnInit {
  subnivelId!: number;
  fase: 'cargando' | 'estudio' | 'quiz' | 'resultado' | 'vacio' = 'cargando';

  senas: Sena[] = [];
  indiceEstudio = 0;

  preguntas: Pregunta[] = [];
  indicePregunta = 0;
  opcionSeleccionada: string | null = null;
  respuestaCorrecta = false;
  mostrarFeedback = false;

  aciertos = 0;
  userId!: string;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabaseService: SupabaseService
  ) { }

  async ngOnInit() {
    this.subnivelId = Number(this.route.snapshot.paramMap.get('subnivelId'));
    const user = await this.supabaseService.getCurrentUser();

    if (!user) {
      this.router.navigate(['/auth/login']);
      return;
    }

    this.userId = user.id;
    await this.cargarSenas();
  }

  async cargarSenas() {
    this.senas = await this.supabaseService.obtenerSenasDeSubnivel(this.subnivelId);

    if (!this.senas || this.senas.length === 0) {
      this.fase = 'vacio';
      return;
    }

    this.fase = 'estudio';
    this.indiceEstudio = 0;
  }

  get senaEstudioActual(): Sena {
    return this.senas[this.indiceEstudio];
  }

  get esUltimaEnEstudio(): boolean {
    return this.indiceEstudio === this.senas.length - 1;
  }

  get progresoEstudio(): number {
    if (!this.senas.length) return 0;
    return ((this.indiceEstudio + 1) / this.senas.length) * 100;
  }

  get progresoQuiz(): number {
    if (!this.preguntas.length) return 0;
    return ((this.indicePregunta + 1) / this.preguntas.length) * 100;
  }

  siguienteEnEstudio() {
    if (this.esUltimaEnEstudio) {
      this.iniciarQuiz();
    } else {
      this.indiceEstudio++;
    }
  }

  async iniciarQuiz() {
    const idsDelSubnivel = this.senas.map(s => s.id);
    this.preguntas = [];

    for (const sena of this.senas) {
      const distractores = await this.supabaseService.obtenerDistractores(idsDelSubnivel, 3);
      const opciones = [sena.palabra, ...distractores.map(d => d.palabra)]
        .sort(() => Math.random() - 0.5);

      this.preguntas.push({ senaCorrecta: sena, opciones });
    }

    this.fase = 'quiz';
    this.indicePregunta = 0;
    this.aciertos = 0;
  }

  get preguntaActual(): Pregunta {
    return this.preguntas[this.indicePregunta];
  }

  async elegirOpcion(opcion: string) {
    if (this.mostrarFeedback) return; // evitar doble click

    this.opcionSeleccionada = opcion;
    this.respuestaCorrecta = opcion === this.preguntaActual.senaCorrecta.palabra;
    this.mostrarFeedback = true;

    if (this.respuestaCorrecta) {
      this.aciertos++;
    }

    await this.supabaseService.registrarIntento(
      this.userId,
      this.preguntaActual.senaCorrecta.id,
      this.respuestaCorrecta
    );

    if (!this.respuestaCorrecta) {
      await this.supabaseService.registrarFallo(this.userId, this.preguntaActual.senaCorrecta.id);
    }
  }

  async siguientePregunta() {
    this.mostrarFeedback = false;
    this.opcionSeleccionada = null;

    if (this.indicePregunta === this.preguntas.length - 1) {
      await this.finalizarQuiz();
    } else {
      this.indicePregunta++;
    }
  }

  async finalizarQuiz() {
    const porcentaje = (this.aciertos / this.preguntas.length) * 100;

    if (porcentaje >= 70) {
      await this.supabaseService.marcarSubnivelCompletado(this.userId, this.subnivelId, this.aciertos);
    }

    this.fase = 'resultado';
  }

  get porcentajeFinal(): number {
    return Math.round((this.aciertos / this.preguntas.length) * 100);
  }

  get aprobado(): boolean {
    return this.porcentajeFinal >= 70;
  }

  volverAlHome() {
    this.router.navigate(['/home']);
  }

  reintentar() {
    this.fase = 'cargando';
    this.iniciarQuiz();
  }
}
