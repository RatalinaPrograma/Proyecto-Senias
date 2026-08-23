import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { Nivel, Subnivel, Sena } from '../data/db-types';
import { SenaIconComponent } from '../shared/sena-icon/sena-icon.component';
import { addIcons } from 'ionicons';
import { close, heart, checkmarkCircle, camera, videocam } from 'ionicons/icons';

addIcons({ close, heart, 'checkmark-circle': checkmarkCircle, camera, videocam });

type Fase = 'cargando' | 'flash' | 'match' | 'quiz' | 'record' | 'complete' | 'sinvidas' | 'error';

interface Par { palabra: string; senaId: number; seed: number; videoUrl: string | null; }
interface Pregunta { palabra: string; senaId: number; opciones: string[]; seed: number; videoUrl: string | null; }

const MENSAJES_OK = ['¡Mano correcta!', '¡Excelente forma!', '¡Así se hace!'];
const MENSAJES_MAL = ['Ajusta el pulgar', 'Centra tu mano en el óvalo', 'Prueba con un movimiento más marcado'];

@Component({
  selector: 'app-lesson',
  standalone: true,
  imports: [CommonModule, IonicModule, SenaIconComponent],
  templateUrl: './lesson.page.html',
  styleUrls: ['./lesson.page.scss'],
})
export class LessonPage implements OnInit, OnDestroy {
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  fase: Fase = 'cargando';
  errorMsg = '';

  userId = '';
  nivel!: Nivel;
  subnivel!: Subnivel;
  senas: Sena[] = [];

  vidas = 5;
  xpGanado = 0;

  // ---- flashcards ----
  flashIndex = 0;
  flipped = false;

  // ---- match ----
  manos: Par[] = [];
  palabrasMezcladas: Par[] = [];
  selMano: Par | null = null;
  selPalabra: string | null = null;
  emparejados: string[] = [];
  matchMal = false;

  // ---- quiz ----
  preguntas: Pregunta[] = [];
  qi = 0;
  seleccionada: string | null = null;
  estado: 'correcto' | 'incorrecto' | null = null;

  // ---- repaso: preguntas falladas en la ronda principal, que hay que
  // volver a responder al final hasta acertarlas ----
  modoRepaso = false;
  private preguntasFalladas: Pregunta[] = [];

  // Minutos que faltan para recuperar la próxima vida (0 si no aplica)
  minutosParaVida = 0;

  // ---- cámara ----
  camStage: 'idle' | 'requesting' | 'denied' | 'countdown' | 'recording' | 'result' = 'idle';
  camCount = 3;
  camScore = 0;
  camPassed = false;
  camMsg = '';
  private stream: MediaStream | null = null;
  private rafId = 0;
  private prevFrame: Uint8ClampedArray | null = null;
  private muestras: number[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private supabaseService: SupabaseService,
    private contenidoService: ContenidoService
  ) {}

  async ngOnInit() {
    try {
      const subnivelId = Number(this.route.snapshot.paramMap.get('subnivelId'));

      const { data: userData } = await this.supabaseService.getUser();
      if (!userData?.user) { this.router.navigate(['/auth/login']); return; }
      this.userId = userData.user.id;

      const subnivel = await this.contenidoService.getSubnivelPorId(subnivelId);
      if (!subnivel) { this.fase = 'error'; this.errorMsg = 'Esta lección no existe.'; return; }
      this.subnivel = subnivel;

      const [nivel, senas, stats] = await Promise.all([
        this.contenidoService.getNivelPorId(subnivel.nivel_id),
        this.contenidoService.getSenas(subnivelId),
        this.contenidoService.getMisStats(this.userId),
      ]);

      if (!nivel) { this.fase = 'error'; this.errorMsg = 'No se encontró la categoría de esta lección.'; return; }
      if (!senas.length) { this.fase = 'error'; this.errorMsg = 'Esta lección todavía no tiene señas cargadas.'; return; }

      this.nivel = nivel;
      this.senas = senas;
      this.vidas = stats.vidas ?? 5;
      this.minutosParaVida = this.contenidoService.minutosParaProximaVida(stats);

      const pares: Par[] = senas.map((s, i) => ({ palabra: s.palabra, senaId: s.id, seed: this.nivel.id * 10 + i, videoUrl: s.video_url }));
      this.manos = this.mezclar([...pares]);
      this.palabrasMezcladas = this.mezclar([...pares]);
      this.preguntas = await this.construirPreguntas();

      this.fase = this.vidas <= 0 ? 'sinvidas' : 'flash';
    } catch (e) {
      console.error(e);
      this.fase = 'error';
      this.errorMsg = 'No se pudo cargar la lección. Revisa tu conexión.';
    }
  }

  ngOnDestroy() {
    this.detenerCamara();
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private mezclar<T>(arr: T[]): T[] {
    return arr.sort(() => 0.5 - Math.random());
  }

  private async construirPreguntas(): Promise<Pregunta[]> {
    const pool = await this.contenidoService.getPoolDePalabras();
    return this.senas.map((s, i) => {
      const distractores = this.mezclar(pool.filter(w => w !== s.palabra)).slice(0, 3);
      const opciones = this.mezclar([...distractores, s.palabra]);
      return { palabra: s.palabra, senaId: s.id, opciones, seed: i, videoUrl: s.video_url };
    });
  }

  get preguntaActual(): Pregunta {
    return this.preguntas[this.qi];
  }

  get progresoPct(): number {
    return Math.round((this.qi / this.preguntas.length) * 100);
  }

  // ---------- Flashcards ----------
  voltear() {
    this.flipped = !this.flipped;
  }

  siguienteFlash() {
    if (this.flashIndex + 1 >= this.senas.length) {
      this.fase = 'match';
      return;
    }
    this.flashIndex++;
    this.flipped = false;
  }

  // ---------- Match ----------
  elegirMano(m: Par) {
    if (this.emparejados.includes(m.palabra)) return;
    this.selMano = m;
    this.evaluarMatch();
  }

  elegirPalabra(p: string) {
    if (this.emparejados.includes(p)) return;
    this.selPalabra = p;
    this.evaluarMatch();
  }

  private evaluarMatch() {
    if (!this.selMano || !this.selPalabra) return;
    if (this.selMano.palabra === this.selPalabra) {
      this.emparejados.push(this.selPalabra);
      this.selMano = null;
      this.selPalabra = null;
    } else {
      this.matchMal = true;
      setTimeout(() => {
        this.matchMal = false;
        this.selMano = null;
        this.selPalabra = null;
      }, 500);
    }
  }

  get matchCompleto(): boolean {
    return this.emparejados.length === this.manos.length;
  }

  irAQuiz() {
    this.fase = 'quiz';
  }

  // ---------- Quiz ----------
  async elegirOpcion(opt: string) {
    if (this.estado) return;
    this.seleccionada = opt;
    const correcto = opt === this.preguntaActual.palabra;

    if (correcto) {
      this.estado = 'correcto';
      // En la ronda de repaso no se vuelve a dar XP, ya se contó la primera vez.
      if (!this.modoRepaso) this.xpGanado += 10;
    } else {
      this.estado = 'incorrecto';

      if (!this.modoRepaso) {
        // Solo se pierde vida en la ronda principal. En repaso ya perdiste
        // la vida la primera vez; aquí solo estás reforzando.
        this.vidas = await this.contenidoService.descontarVida(this.userId);

        // Se guarda para volver a preguntarla al final, evitando duplicados.
        if (!this.preguntasFalladas.some(p => p.senaId === this.preguntaActual.senaId)) {
          this.preguntasFalladas.push(this.preguntaActual);
        }
      }
    }

    // Se registra en segundo plano, sin bloquear la interacción
    this.contenidoService.registrarIntento(this.userId, this.preguntaActual.senaId, correcto).catch(console.error);
  }

  siguientePregunta() {
    if (!this.modoRepaso && this.vidas <= 0) {
      // Se acaba de perder la última vida ahora mismo, así que faltan las
      // 4 horas completas de regeneración.
      this.minutosParaVida = 240;
      this.fase = 'sinvidas';
      return;
    }

    // En repaso, si la fallaste, te quedas en la MISMA pregunta hasta acertarla.
    if (this.modoRepaso && this.estado === 'incorrecto') {
      this.seleccionada = null;
      this.estado = null;
      return;
    }

    if (this.qi + 1 >= this.preguntas.length) {
      // Terminó la ronda principal y quedaron preguntas falladas: se arma
      // una ronda de repaso solo con esas, y hay que responderlas bien
      // para poder avanzar.
      if (!this.modoRepaso && this.preguntasFalladas.length > 0) {
        this.preguntas = [...this.preguntasFalladas];
        this.preguntasFalladas = [];
        this.modoRepaso = true;
        this.qi = 0;
        this.seleccionada = null;
        this.estado = null;
        return;
      }

      this.fase = 'record';
      return;
    }

    this.qi++;
    this.seleccionada = null;
    this.estado = null;
  }

  // ---------- Cámara ----------
  get senaCamara(): Sena {
    return this.senas[this.senas.length - 1];
  }

  async iniciarCamara() {
    this.camStage = 'requesting';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 } },
        audio: false,
      });
      if (this.videoRef) {
        this.videoRef.nativeElement.srcObject = this.stream;
        await this.videoRef.nativeElement.play();
      }
      this.camStage = 'countdown';
      this.contarRegresiva();
    } catch {
      this.camStage = 'denied';
    }
  }

  private contarRegresiva() {
    this.camCount = 3;
    const iv = setInterval(() => {
      this.camCount--;
      if (this.camCount <= 0) {
        clearInterval(iv);
        this.camStage = 'recording';
        this.grabar();
      }
    }, 700);
  }

  private grabar() {
    this.muestras = [];
    this.prevFrame = null;
    const inicio = performance.now();
    const duracion = 2500;

    const sample = () => {
      const video = this.videoRef?.nativeElement;
      const canvas = this.canvasRef?.nativeElement;
      if (video && canvas && video.videoWidth) {
        const ctx = canvas.getContext('2d')!;
        canvas.width = 48;
        canvas.height = 36;
        ctx.drawImage(video, 0, 0, 48, 36);
        const frame = ctx.getImageData(0, 0, 48, 36).data;
        if (this.prevFrame) {
          let diff = 0;
          for (let i = 0; i < frame.length; i += 4) {
            diff += Math.abs(frame[i] - this.prevFrame[i]);
          }
          this.muestras.push(diff);
        }
        this.prevFrame = frame;
      }
      if (performance.now() - inicio < duracion) {
        this.rafId = requestAnimationFrame(sample);
      } else {
        this.terminarGrabacion();
      }
    };
    this.rafId = requestAnimationFrame(sample);
  }

  private async terminarGrabacion() {
    const avg = this.muestras.length ? this.muestras.reduce((a, b) => a + b, 0) / this.muestras.length : 0;
    const normalizado = Math.min(100, Math.round((avg / 4000) * 100));
    const paso = normalizado > 18;
    const pool = paso ? MENSAJES_OK : MENSAJES_MAL;
    this.camMsg = pool[Math.floor(Math.random() * pool.length)];
    this.camScore = normalizado;
    this.camPassed = paso;
    this.camStage = 'result';
    this.detenerCamara();

    // Nota: score_similitud hoy viene de una heurística de movimiento en
    // cámara, no de comparación real de landmarks (eso es MediaPipe Hands,
    // pendiente). El campo en la base de datos ya está listo para cuando
    // se conecte el modelo real.
    await this.contenidoService.registrarIntento(this.userId, this.senaCamara.id, this.camPassed, this.camScore);
  }

  private detenerCamara() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  reintentarCamara() {
    this.camStage = 'idle';
    this.camScore = 0;
  }

  saltarCamara() {
    this.terminarLeccion(this.xpGanado);
  }

  confirmarCamara() {
    this.terminarLeccion(this.xpGanado + (this.camPassed ? 15 : 5));
  }

  private async terminarLeccion(xpFinal: number) {
    this.xpGanado = xpFinal;
    try {
      await this.contenidoService.marcarSubnivelCompletado(this.userId, this.subnivel.id, xpFinal);
      await this.contenidoService.actualizarStatsTrasLeccion(this.userId, xpFinal);
      await this.contenidoService.avanzarNivelSiCorresponde(this.userId, this.nivel.id);
    } catch (e) {
      console.error('No se pudo guardar el progreso', e);
    }
    this.fase = 'complete';
  }

  // ---------- Salidas ----------
  salir() {
    this.detenerCamara();
    this.router.navigate(['/home']);
  }
}
