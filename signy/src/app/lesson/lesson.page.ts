import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { TtsService } from '../services/tts';
import { Nivel, Subnivel, Sena, RachaHistorialDia } from '../data/db-types';
import { SenaIconComponent } from '../shared/sena-icon/sena-icon.component';
import { CachedSrcDirective } from '../shared/cached-src.directive';
import { esVideoMp4 } from '../shared/media-utils';
import { GifTileComponent } from '../shared/gif-tile/gif-tile.component';
import { RachaCalendarComponent, DiaRachaVista } from '../shared/racha-calendar/racha-calendar.component';
import { ImageCacheService } from '../services/image-cache';
import { addIcons } from 'ionicons';
import { close, heart, checkmarkCircle, closeCircle, camera, videocam, volumeHigh, snowOutline, trophy } from 'ionicons/icons';

addIcons({ close, heart, 'checkmark-circle': checkmarkCircle, 'close-circle': closeCircle, camera, videocam, 'volume-high': volumeHigh, 'snow-outline': snowOutline, trophy });

type Fase = 'cargando' | 'flash' | 'match' | 'quiz' | 'record' | 'complete' | 'nivel' | 'racha' | 'sinvidas' | 'error';

interface Par { palabra: string; senaId: number; seed: number; videoUrl: string | null; }
interface Pregunta { palabra: string; senaId: number; opciones: string[]; seed: number; videoUrl: string | null; }

const MENSAJES_OK = ['¡Mano correcta!', '¡Excelente forma!', '¡Así se hace!'];
const MENSAJES_MAL = ['Ajusta el pulgar', 'Centra tu mano en el óvalo', 'Prueba con un movimiento más marcado'];

/** Mensaje corto y variable para la pantalla de "lección superada" — antes
 * era un texto fijo, ahora rota para que no se sienta repetitivo lección
 * tras lección. */
const MENSAJES_LECCION = [
  'Cachai cada vez más señas. 🤟',
  'Una lección menos, un paso más cerca. 🦊',
  '¡Se nota la práctica!',
  'Tus manos están aprendiendo rápido. 👏',
  'Directo a la próxima. 🔥',
];

/** Frase para la pantalla de nivel completado — un logro más grande que
 * una lección normal, así que el tono es un poco más "arriba". */
const MENSAJES_NIVEL = [
  '¡Un nivel entero abajo! Nada te detiene. 🏆',
  'De principio a fin, sin dejar nada pendiente. 🦊',
  'Así se construye el dominio de una lengua. 🤟',
  '¡Otro paso gigante en tu camino con LSCh!',
];

/** Frase corta y variable para la pantalla de racha activada — se elige una
 * al azar cada vez, para que no se sienta repetitivo día tras día. */
const MENSAJES_RACHA = [
  'Un día más, una razón más para seguir. 🔥',
  '¡Imparable! Nadie te para ahora. 🦊',
  'Cada día cuenta — y hoy contó.',
  'Así se construye un hábito de verdad. 🔥',
  'Otra piedrita más en el camino. 🧱',
  'Tus manos ya saben que hoy tocaba. 🤟',
];

@Component({
  selector: 'app-lesson',
  standalone: true,
  imports: [CommonModule, IonicModule, SenaIconComponent, CachedSrcDirective, GifTileComponent, RachaCalendarComponent],
  templateUrl: './lesson.page.html',
  styleUrls: ['./lesson.page.scss'],
})
export class LessonPage implements OnInit, OnDestroy {
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  /** Referencia al helper compartido para poder llamarlo desde el template. */
  esVideoMp4 = esVideoMp4;

  fase: Fase = 'cargando';
  errorMsg = '';

  // ---- barra de carga: progreso real (0-100) repartido entre las etapas
  // de ngOnInit, no una animación decorativa ----
  cargaProgreso = 0;
  cargaMensaje = 'Preparando tu lección…';

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

  // Si el subnivel tiene muchas señas, se reparten en tandas de a
  // TAMANO_RONDA para que cada tile del emparejar quepa grande y legible
  // en vez de apretar todo en una sola pantalla.
  private readonly TAMANO_RONDA = 4;
  private rondas: Par[][] = [];
  rondaActual = 0;

  // ---- quiz ----
  preguntas: Pregunta[] = [];
  qi = 0;
  seleccionada: string | null = null;
  estado: 'correcto' | 'incorrecto' | null = null;

  /** palabra -> ícono de concepto (emoji), para mostrar junto al texto en
   * emparejar y en las opciones del quiz. Ver comentario en Sena.icono. */
  private mapaIconos = new Map<string, string | null>();

  // ---- repaso: preguntas falladas en la ronda principal, que hay que
  // volver a responder al final hasta acertarlas ----
  modoRepaso = false;
  private preguntasFalladas: Pregunta[] = [];

  // Minutos que faltan para recuperar la próxima vida (0 si no aplica)
  minutosParaVida = 0;

  // ---- lección completa (pantalla base, siempre se muestra) ----
  mensajeLeccion = MENSAJES_LECCION[Math.floor(Math.random() * MENSAJES_LECCION.length)];

  // ---- nivel completado (pantalla de celebración al terminar TODAS las
  // lecciones de un nivel — solo la primera vez que pasa, no de nuevo si
  // se repasa algo dentro de un nivel ya completo) ----
  hayNivelParaCelebrar = false;
  mensajeNivel = '';

  // ---- racha activada (pantalla de celebración al terminar la primera
  // lección del día) ----
  private practicoAntesHoy = false;
  private congeladoresAlEntrar = 0;
  hayRachaParaCelebrar = false;
  racha = 0;
  congeladorGanadoHoy = false;
  semanaCalendario: DiaRachaVista[] = [];
  primerNombre = '';
  mensajeRacha = '';
  // Confetti compartido entre las pantallas de "lección", "nivel" y
  // "racha" — es puramente decorativo, no hace falta un set por pantalla.
  readonly confeti = Array.from({ length: 16 }, (_, i) => ({
    left: Math.round(Math.random() * 92) + 4,
    delay: `${(Math.random() * 0.6).toFixed(2)}s`,
    color: ['#F2701A', '#FF9A52', '#2CA6A4', '#F7F5F0'][i % 4],
  }));
  // Versión más liviana para "lección completa" (pasa más seguido que
  // "nivel" o "racha", así que un confetti más discreto se siente mejor).
  // Se calcula una sola vez acá, no con .slice() en el template, para que
  // no se reinicie la animación en cada detección de cambios de Angular.
  readonly confetiLeccion = this.confeti.slice(0, 8);

  get textoBotonRacha(): string {
    return this.primerNombre
      ? `¡Nada detiene a ${this.primerNombre.toUpperCase()}!`
      : '¡Sigue así, no te detengas!';
  }

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
    private contenidoService: ContenidoService,
    private ttsService: TtsService,
    private imageCacheService: ImageCacheService
  ) {}

  async ngOnInit() {
    try {
      // El caché de medios es permanente en disco (no se purga al salir de
      // una lección), así que si el usuario ya vio este subnivel antes la
      // precarga de abajo no vuelve a gastar datos: solo lee de disco.
      this.cargaProgreso = 5;

      const subnivelId = Number(this.route.snapshot.paramMap.get('subnivelId'));

      const { user } = await this.supabaseService.getUsuarioLocal();
      if (!user) { this.router.navigate(['/auth/login']); return; }
      this.userId = user.id;
      this.cargaProgreso = 10;

      const subnivel = await this.contenidoService.getSubnivelPorId(subnivelId);
      if (!subnivel) { this.fase = 'error'; this.errorMsg = 'Esta lección no existe.'; return; }
      this.subnivel = subnivel;
      this.cargaProgreso = 20;
      this.cargaMensaje = 'Cargando nivel…';

      // El pool de palabras del quiz se trae acá, en paralelo con lo demás,
      // en vez de en serie justo antes de arrancar las flashcards.
      const [nivel, senas, stats, pool, perfilRes] = await Promise.all([
        this.contenidoService.getNivelPorId(subnivel.nivel_id),
        this.contenidoService.getSenas(subnivelId),
        this.contenidoService.getMisStats(this.userId),
        this.contenidoService.getPoolDePalabras(),
        this.supabaseService.getProfile(this.userId),
      ]);

      if (!nivel) { this.fase = 'error'; this.errorMsg = 'No se encontró la categoría de esta lección.'; return; }
      if (!senas.length) { this.fase = 'error'; this.errorMsg = 'Esta lección todavía no tiene señas cargadas.'; return; }

      this.nivel = nivel;
      this.senas = senas;
      this.vidas = stats.vidas ?? 5;
      this.minutosParaVida = this.contenidoService.minutosParaProximaVida(stats);

      // Se guarda ANTES de terminar la lección: así, al terminar, sabemos si
      // esta fue la primera práctica del día (la que activa/sube la racha)
      // sin tener que volver a comparar fechas después de actualizar stats.
      this.practicoAntesHoy = stats.ultima_fecha_practica === this.contenidoService.fechaHoy();
      this.congeladoresAlEntrar = stats.racha_congeladores ?? 0;
      this.primerNombre = (perfilRes.data?.full_name ?? '').trim().split(/\s+/)[0] || '';
      this.cargaProgreso = 35;
      this.cargaMensaje = '¿Estás preparado?';

      // Precargar los GIFs/recursos del subnivel actual en segundo plano.
      // Suele ser la etapa más lenta y variable, así que se reparte el 35%-90%
      // de la barra proporcional a cuántos recursos van descargados. El
      // mensaje se mantiene simple y cercano, sin exponer detalles técnicos.
      const urlsMedia = senas.map(s => s.video_url).filter((u): u is string => !!u);
      if (urlsMedia.length > 0) {
        await this.imageCacheService.precargarSubnivel(urlsMedia, (completados, total) => {
          this.cargaProgreso = 35 + Math.round((completados / total) * 55);
          this.cargaMensaje = this.cargaProgreso < 65 ? '¿Estás preparado?' : 'Ya casi estamos…';
        });
      } else {
        this.cargaProgreso = 90;
      }

      const pares: Par[] = senas.map((s, i) => ({ palabra: s.palabra, senaId: s.id, seed: this.nivel.id * 10 + i, videoUrl: s.video_url }));
      this.rondas = this.armarRondas(pares);
      this.cargarRonda(0);
      this.cargaMensaje = '¡Ya casi! Últimos detalles…';
      this.preguntas = this.construirPreguntas(pool);
      this.cargaProgreso = 100;

      // Mapa palabra -> ícono de concepto para mostrarlo junto al texto en
      // emparejar y en las opciones del quiz (las de la lección actual
      // pisan al pool por si acaso, ya que son la fuente más al día).
      this.mapaIconos = new Map(pool.map(p => [p.palabra, p.icono]));
      for (const s of senas) {
        if (s.icono) this.mapaIconos.set(s.palabra, s.icono);
      }

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
    this.imageCacheService.liberarMemoriaRAM();
  }

  private mezclar<T>(arr: T[]): T[] {
    return arr.sort(() => 0.5 - Math.random());
  }

  // Sin esto, cada cambio de ronda recrea (y redecodifica el GIF de) los 4 tiles.
  trackPar = (_: number, p: Par) => p.senaId;

  private construirPreguntas(pool: { palabra: string; icono: string | null }[]): Pregunta[] {
    const palabras = pool.map(p => p.palabra);
    return this.senas.map((s, i) => {
      const distractores = this.mezclar(palabras.filter(w => w !== s.palabra)).slice(0, 3);
      const opciones = this.mezclar([...distractores, s.palabra]);
      return { palabra: s.palabra, senaId: s.id, opciones, seed: i, videoUrl: s.video_url };
    });
  }

  /** Ícono de concepto (emoji) para una palabra, si tiene uno cargado.
   * Se usa en emparejar y en las opciones del quiz para que alguien cuya
   * primera lengua es LSCh (y no el español) pueda reconocer el significado
   * por el dibujo, no solo por el texto escrito. */
  iconoDe(palabra: string): string | null {
    return this.mapaIconos.get(palabra) ?? null;
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

  escucharPalabra() {
    this.ttsService.hablarSiHabilitado(this.userId, this.senas[this.flashIndex].palabra);
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
    // Se lee la palabra al tocarla: es texto que ya está visible en
    // pantalla, así que no revela nada, solo refuerza la pronunciación.
    // (A propósito NO se hace lo mismo en elegirMano: ahí leer la palabra
    // asociada a la seña sería literalmente dar la respuesta del ejercicio.)
    this.ttsService.hablarSiHabilitado(this.userId, p);
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

  get totalRondas(): number {
    return this.rondas.length;
  }

  get hayMasRondas(): boolean {
    return this.rondaActual < this.rondas.length - 1;
  }

  private armarRondas(pares: Par[]): Par[][] {
    const mezclados = this.mezclar([...pares]);
    const rondas: Par[][] = [];
    for (let i = 0; i < mezclados.length; i += this.TAMANO_RONDA) {
      rondas.push(mezclados.slice(i, i + this.TAMANO_RONDA));
    }
    return rondas;
  }

  private cargarRonda(indice: number) {
    this.rondaActual = indice;
    const grupo = this.rondas[indice];
    this.manos = this.mezclar([...grupo]);
    this.palabrasMezcladas = this.mezclar([...grupo]);
    this.emparejados = [];
    this.selMano = null;
    this.selPalabra = null;
    this.matchMal = false;
  }

  siguienteRondaOQuiz() {
    if (this.hayMasRondas) {
      this.cargarRonda(this.rondaActual + 1);
    } else {
      this.fase = 'quiz';
    }
  }

  // ---------- Quiz ----------
  async elegirOpcion(opt: string) {
    if (this.estado) return;
    this.seleccionada = opt;
    // Se lee la opción tocada: es texto ya visible, no da pistas de cuál
    // es la correcta (todas las opciones se leen igual si las tocas).
    this.ttsService.hablarSiHabilitado(this.userId, opt);
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
    this.contenidoService.otorgarLogroPorCodigo(this.userId, 'practica_camara').catch(console.error);
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
      const statsFinal = await this.contenidoService.actualizarStatsTrasLeccion(this.userId, xpFinal);
      const { nivelRecienCompletado } = await this.contenidoService.avanzarNivelSiCorresponde(this.userId, this.nivel.id);

      if (nivelRecienCompletado) {
        this.mensajeNivel = MENSAJES_NIVEL[Math.floor(Math.random() * MENSAJES_NIVEL.length)];
        this.hayNivelParaCelebrar = true;
      }

      // Si ya se había practicado hoy antes de entrar a esta lección, la
      // racha no cambió — no tiene sentido repetir la celebración por cada
      // lección adicional del mismo día, solo por la primera.
      if (!this.practicoAntesHoy) {
        this.racha = statsFinal.racha_actual ?? 0;
        this.congeladorGanadoHoy = (statsFinal.racha_congeladores ?? 0) > this.congeladoresAlEntrar;
        this.mensajeRacha = MENSAJES_RACHA[Math.floor(Math.random() * MENSAJES_RACHA.length)];
        const historial = await this.contenidoService.obtenerHistorialRacha(this.userId, 6);
        this.semanaCalendario = this.construirSemana(historial);
        this.hayRachaParaCelebrar = true;
      }
    } catch (e) {
      console.error('No se pudo guardar el progreso', e);
    }
    this.fase = 'complete';
  }

  /** Últimos 7 días (6 + hoy) para la tira de calendario de la pantalla de
   * racha activada. Misma lógica que el calendario mensual del Perfil, pero
   * agregando la letra corta del día para mostrarla arriba de cada círculo. */
  private construirSemana(historial: RachaHistorialDia[]): DiaRachaVista[] {
    const DIAS_CORTOS = ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S']; // índice = Date.getDay()
    const mapa = new Map(historial.map(h => [h.fecha, h.estado]));
    const hoy = this.contenidoService.fechaHoy();
    const dias: DiaRachaVista[] = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = this.contenidoService.sumarDias(hoy, -i);
      const esHoy = fecha === hoy;
      const estado = mapa.get(fecha) ?? (esHoy ? 'hoy' : 'sin-datos');
      const [anio, mes, dia] = fecha.split('-').map(Number);
      const diaSemana = new Date(anio, mes - 1, dia, 12).getDay();
      dias.push({ fecha, numero: dia, estado, esHoy, etiquetaDia: DIAS_CORTOS[diaSemana] });
    }
    return dias;
  }

  /** Botón "Continuar" de la pantalla de resultados: encadena las
   * celebraciones que apliquen antes de salir — primero nivel (si se
   * completó uno entero), después racha (si se activó hoy). */
  continuarLeccion() {
    if (this.hayNivelParaCelebrar) {
      this.fase = 'nivel';
    } else if (this.hayRachaParaCelebrar) {
      this.fase = 'racha';
    } else {
      this.salir();
    }
  }

  /** Botón "Continuar" de la pantalla de nivel completado. */
  continuarDesdeNivel() {
    if (this.hayRachaParaCelebrar) {
      this.fase = 'racha';
    } else {
      this.salir();
    }
  }

  // ---------- Salidas ----------
  salir() {
    this.detenerCamara();
    this.imageCacheService.liberarMemoriaRAM();
    this.router.navigate(['/home']);
  }
}