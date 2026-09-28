import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  closeOutline,
  cameraReverseOutline,
  radioButtonOnOutline,
  refreshOutline,
  saveOutline,
  checkmarkCircle,
  alertCircle,
  sparklesOutline,
  playOutline,
} from 'ionicons/icons';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Sena } from '../../data/db-types';
import { SupabaseService } from '../../services/supabase';
import {
  AnclaSesion,
  ModeloReferenciaSena,
  Punto3D,
  ResultadoComparacion,
  VERSION_MODELO_ACTUAL,
  compararFrameEstatico,
  compararSecuenciasDTW,
  normalizarFrame,
} from '../../utils/gesture-math';

addIcons({
  'close-outline': closeOutline,
  'camera-reverse-outline': cameraReverseOutline,
  'radio-button-on-outline': radioButtonOnOutline,
  'refresh-outline': refreshOutline,
  'save-outline': saveOutline,
  'checkmark-circle': checkmarkCircle,
  'alert-circle': alertCircle,
  'sparkles-outline': sparklesOutline,
  'play-outline': playOutline,
});

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

@Component({
  selector: 'app-sena-trainer-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './sena-trainer-modal.component.html',
  styleUrls: ['./sena-trainer-modal.component.scss'],
})
export class SenaTrainerModalComponent implements OnInit, OnDestroy {
  @Input() sena!: Sena;
  @Output() senaActualizada = new EventEmitter<Sena>();

  @ViewChild('video', { static: false }) videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas', { static: false }) canvasRef?: ElementRef<HTMLCanvasElement>;

  // Estados del modelo MediaPipe y cámara
  estadoModelo: 'descargando' | 'listo' | 'error' = 'descargando';
  estadoCamara: 'apagada' | 'iniciando' | 'activa' | 'denegada' = 'apagada';
  mensajeError = '';
  facingMode: 'user' | 'environment' = 'user';

  private stream: MediaStream | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private animationFrameId = 0;
  private lastVideoTime = -1;

  // Configuración de la seña
  tipoSena: 'dinamica' | 'estatica' = 'dinamica';
  manosRequeridas: 1 | 2 = 1;
  totalFramesObjetivo = 30;

  // Estado de grabación
  estadoGrabacion: 'inactivo' | 'cuenta_atras' | 'grabando' | 'grabado' = 'inactivo';
  cuentaAtras = 3;
  private framesGrabados: number[][] = [];
  progresoGrabacion = 0;
  private intervaloCuentaAtras: ReturnType<typeof setInterval> | null = null;
  private timeoutSeguridadGrabacion: ReturnType<typeof setTimeout> | null = null;
  private readonly TIEMPO_MAXIMO_GRABACION_MS = 15000;

  // Cada toma de grabación (y cada sesión de prueba en vivo) se ancla al
  // primer frame con manos válidas, para no perder la trayectoria de la
  // mano entre frames — ver AnclaSesion en gesture-math.ts.
  private readonly anclaGrabacion = new AnclaSesion();
  private readonly anclaPrueba = new AnclaSesion();

  // Detección en vivo
  manosDetectadasCount = 0;
  private ultimoFrameNormalizado: number[] | null = null;

  // Estado de prueba / validación en vivo
  modoPruebaActivo = false;
  resultadoEnVivo: ResultadoComparacion | null = null;
  private bufferPrueba: number[][] = [];
  private readonly TAMANO_BUFFER_PRUEBA = 30;

  // Guardado
  guardando = false;
  modeloExistente: ModeloReferenciaSena | null = null;
  /** true si el modelo guardado en Supabase es de una versión anterior del formato (ver ModeloReferenciaSena). */
  modeloDesactualizado = false;

  constructor(
    private modalCtrl: ModalController,
    private supabaseService: SupabaseService
  ) {}

  async ngOnInit() {
    this.verificarModeloExistente();
    await this.inicializarMediaPipe();
  }

  ngOnDestroy() {
    this.detenerCamara();
    if (this.intervaloCuentaAtras) {
      clearInterval(this.intervaloCuentaAtras);
      this.intervaloCuentaAtras = null;
    }
    if (this.timeoutSeguridadGrabacion) {
      clearTimeout(this.timeoutSeguridadGrabacion);
      this.timeoutSeguridadGrabacion = null;
    }
    if (this.handLandmarker) {
      try {
        this.handLandmarker.close();
      } catch (e) {
        console.warn('Error al cerrar HandLandmarker:', e);
      }
    }
  }

  private verificarModeloExistente() {
    if (this.sena?.landmarks_referencia) {
      try {
        const mod = typeof this.sena.landmarks_referencia === 'string'
          ? JSON.parse(this.sena.landmarks_referencia)
          : this.sena.landmarks_referencia;

        if (mod && mod.frames && Array.isArray(mod.frames)) {
          this.modeloExistente = mod as ModeloReferenciaSena;
          this.tipoSena = this.modeloExistente.tipo || 'dinamica';
          this.manosRequeridas = this.modeloExistente.manosRequeridas || 1;
          this.totalFramesObjetivo = this.modeloExistente.totalFrames || 30;
          this.framesGrabados = this.modeloExistente.frames;
          this.estadoGrabacion = 'grabado';
          // Un modelo grabado con el formato v1 (auto-centrado por frame,
          // sin trayectoria) no es comparable contra capturas en vivo v2 —
          // hay que re-grabarlo, no basta con seguir usándolo.
          this.modeloDesactualizado = (mod.version || 1) < VERSION_MODELO_ACTUAL;
        }
      } catch (e) {
        console.warn('No se pudo parsear el modelo existente:', e);
      }
    }
  }

  // ---------- Inicialización MediaPipe ----------
  async inicializarMediaPipe() {
    this.estadoModelo = 'descargando';
    this.mensajeError = '';

    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.estadoModelo = 'listo';
      await this.iniciarCamara();
    } catch (e: any) {
      console.error('Error al inicializar MediaPipe:', e);
      this.estadoModelo = 'error';
      this.mensajeError =
        e?.message ||
        'No se pudo descargar el modelo de MediaPipe. Revisa tu conexión a internet.';
    }
  }

  // ---------- Cámara ----------
  async iniciarCamara() {
    if (this.estadoModelo !== 'listo') return;
    this.detenerCamara();
    this.estadoCamara = 'iniciando';

    const mediaDevices = navigator.mediaDevices || (navigator as any).webkitGetUserMedia ? {
      getUserMedia: (constraints: MediaStreamConstraints) =>
        new Promise<MediaStream>((resolve, reject) => {
          const getMedia =
            (navigator as any).getUserMedia ||
            (navigator as any).webkitGetUserMedia ||
            (navigator as any).mozGetUserMedia;
          if (getMedia) {
            getMedia.call(navigator, constraints, resolve, reject);
          } else {
            reject(new Error('API de cámara no disponible'));
          }
        }),
    } : null;

    const apiMedia = navigator.mediaDevices || mediaDevices;
    if (!apiMedia?.getUserMedia) {
      this.estadoCamara = 'denegada';
      this.mensajeError = 'La cámara no está disponible en este entorno.';
      return;
    }

    try {
      let stream: MediaStream | null = null;
      try {
        stream = await apiMedia.getUserMedia({
          video: {
            facingMode: this.facingMode,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch {
        stream = await apiMedia.getUserMedia({
          video: { facingMode: this.facingMode },
          audio: false,
        });
      }

      if (!stream) throw new Error('No se pudo abrir el flujo de video.');
      this.stream = stream;
      this.estadoCamara = 'activa';

      setTimeout(async () => {
        const video = this.videoRef?.nativeElement;
        if (video && this.stream) {
          video.srcObject = this.stream;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => {});
          this.iniciarBucle();
        }
      }, 100);
    } catch (e: any) {
      console.error('Error de cámara:', e);
      this.estadoCamara = 'denegada';
      this.mensajeError = 'No se pudo acceder a la cámara. Revisa los permisos.';
    }
  }

  detenerCamara() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.estadoCamara = 'apagada';
  }

  alternarCamara() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.iniciarCamara();
  }

  // ---------- Bucle de Detección ----------
  private iniciarBucle() {
    const render = () => {
      const video = this.videoRef?.nativeElement;
      const canvas = this.canvasRef?.nativeElement;

      if (video && canvas && this.handLandmarker && this.estadoCamara === 'activa') {
        if (video.videoWidth > 0 && !video.paused) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const nowInMs = Date.now();

            if (nowInMs !== this.lastVideoTime) {
              this.lastVideoTime = nowInMs;
              const results = this.handLandmarker.detectForVideo(video, nowInMs);

              this.manosDetectadasCount = results?.landmarks?.length || 0;
              this.dibujarResultados(ctx, canvas.width, canvas.height, results);
              this.procesarFrameDetectado(results);
            }
          }
        }
      }

      if (this.estadoCamara === 'activa') {
        this.animationFrameId = requestAnimationFrame(render);
      }
    };

    this.animationFrameId = requestAnimationFrame(render);
  }

  private dibujarResultados(ctx: CanvasRenderingContext2D, width: number, height: number, results: any) {
    if (!results || !results.landmarks || results.landmarks.length === 0) return;

    for (let h = 0; h < results.landmarks.length; h++) {
      const landmarks = results.landmarks[h];

      // Esqueleto
      ctx.strokeStyle = '#2CA6A4'; // Mint
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const [start, end] of HAND_CONNECTIONS) {
        const p1 = landmarks[start];
        const p2 = landmarks[end];
        ctx.beginPath();
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }

      // Nudillos y Puntas
      for (let i = 0; i < landmarks.length; i++) {
        const pt = landmarks[i];
        const x = pt.x * width;
        const y = pt.y * height;
        ctx.beginPath();
        if ([4, 8, 12, 16, 20].includes(i)) {
          ctx.arc(x, y, 6, 0, 2 * Math.PI);
          ctx.fillStyle = '#F2701A'; // Naranja Signy Fox
        } else {
          ctx.arc(x, y, 4, 0, 2 * Math.PI);
          ctx.fillStyle = '#FFFFFF';
        }
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0A1526';
        ctx.stroke();
      }
    }
  }

  // ---------- Procesamiento y Normalización de Frames ----------
  private procesarFrameDetectado(results: any) {
    if (!results?.landmarks || results.landmarks.length === 0) {
      this.ultimoFrameNormalizado = null;
      // Si las manos salen de cuadro durante la prueba en vivo, reiniciamos
      // el anclaje: cuando vuelvan a aparecer arrancamos una toma nueva en
      // vez de seguir midiendo trayectoria contra un origen ya viejo.
      this.anclaPrueba.reiniciar();
      return;
    }

    const manos: Punto3D[][] = results.landmarks.map((hand: any[]) =>
      hand.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }))
    );

    // Vista previa de forma instantánea (sin trayectoria) — no se usa para
    // decidir coincidencia, solo queda disponible como dato de apoyo.
    this.ultimoFrameNormalizado = normalizarFrame(manos, this.manosRequeridas);

    // Si estamos en plena grabación de la seña: todos los frames de ESTA
    // toma se anclan al mismo punto (AnclaSesion) para conservar hacia
    // dónde se mueve la mano de un frame a otro.
    if (this.estadoGrabacion === 'grabando') {
      const frameAnclado = this.anclaGrabacion.normalizar(manos, this.manosRequeridas);
      if (frameAnclado) {
        this.framesGrabados.push(frameAnclado);
        this.progresoGrabacion = Math.round(
          (this.framesGrabados.length / this.totalFramesObjetivo) * 100
        );

        if (this.framesGrabados.length >= this.totalFramesObjetivo) {
          this.finalizarGrabacion();
        }
      }
      return;
    }

    // Si estamos en modo de prueba en vivo
    if (this.modoPruebaActivo && this.framesGrabados.length > 0) {
      const frameAnclado = this.anclaPrueba.normalizar(manos, this.manosRequeridas);
      if (!frameAnclado) return;

      if (this.tipoSena === 'estatica') {
        // En estática, comparamos el frame actual contra el primer frame grabado
        this.resultadoEnVivo = compararFrameEstatico(
          this.framesGrabados[0],
          frameAnclado,
          75
        );
      } else {
        // En dinámica, alimentamos el buffer circular y ejecutamos DTW
        this.bufferPrueba.push(frameAnclado);
        if (this.bufferPrueba.length > this.TAMANO_BUFFER_PRUEBA) {
          this.bufferPrueba.shift();
        }

        if (this.bufferPrueba.length >= 15) {
          this.resultadoEnVivo = compararSecuenciasDTW(
            this.framesGrabados,
            this.bufferPrueba,
            70
          );
        }
      }
    }
  }

  // ---------- Control de Grabación ----------
  /**
   * Antes: este método exigía que ambas manos YA estuvieran frente a la
   * cámara para siquiera empezar la cuenta atrás — imposible de cumplir en
   * solitario si la seña necesita las 2 manos (no queda ninguna libre para
   * apretar el botón). Ahora la cuenta atrás de 3 segundos ES el momento
   * para acomodarse frente a la cámara; la captura de frames solo empieza
   * cuando `AnclaSesion` detecta manos válidas, y si nunca llegan a
   * aparecer, `TIEMPO_MAXIMO_GRABACION_MS` cancela solo (ver
   * comenzarGrabacionReal) en vez de dejar la grabación colgada para siempre.
   */
  iniciarCuentaAtras() {
    if (this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') return;

    this.modoPruebaActivo = false;
    this.resultadoEnVivo = null;
    this.framesGrabados = [];
    this.progresoGrabacion = 0;
    this.cuentaAtras = 3;
    this.estadoGrabacion = 'cuenta_atras';
    this.anclaGrabacion.reiniciar();

    this.intervaloCuentaAtras = setInterval(() => {
      this.cuentaAtras--;
      if (this.cuentaAtras <= 0) {
        if (this.intervaloCuentaAtras) clearInterval(this.intervaloCuentaAtras);
        this.intervaloCuentaAtras = null;
        this.comenzarGrabacionReal();
      }
    }, 1000);
  }

  private comenzarGrabacionReal() {
    this.estadoGrabacion = 'grabando';
    this.framesGrabados = [];

    // Red de seguridad: si nunca se detectan las manos requeridas (mala
    // iluminación, cámara tapada, etc.) no queremos que la grabación quede
    // pegada indefinidamente esperando el frame 30.
    this.timeoutSeguridadGrabacion = setTimeout(() => {
      if (this.estadoGrabacion === 'grabando') {
        this.cancelarGrabacion(
          'No alcanzamos a detectar bien tus manos durante la grabación. Revisa la iluminación y que entren en el cuadro, y vuelve a intentarlo.'
        );
      }
    }, this.TIEMPO_MAXIMO_GRABACION_MS);
  }

  private finalizarGrabacion() {
    if (this.timeoutSeguridadGrabacion) {
      clearTimeout(this.timeoutSeguridadGrabacion);
      this.timeoutSeguridadGrabacion = null;
    }
    this.estadoGrabacion = 'grabado';
    // Activar modo de prueba inmediatamente para que el admin pueda verificar
    this.activarModoPrueba();
  }

  /**
   * Cancela una cuenta atrás o grabación en curso. Si ya existía un modelo
   * guardado antes de este intento, lo restaura (no perder trabajo previo
   * solo porque una re-grabación falló a mitad de camino).
   */
  cancelarGrabacion(mensaje?: string) {
    if (this.intervaloCuentaAtras) {
      clearInterval(this.intervaloCuentaAtras);
      this.intervaloCuentaAtras = null;
    }
    if (this.timeoutSeguridadGrabacion) {
      clearTimeout(this.timeoutSeguridadGrabacion);
      this.timeoutSeguridadGrabacion = null;
    }
    this.anclaGrabacion.reiniciar();
    this.progresoGrabacion = 0;

    if (this.modeloExistente) {
      this.framesGrabados = this.modeloExistente.frames;
      this.estadoGrabacion = 'grabado';
    } else {
      this.framesGrabados = [];
      this.estadoGrabacion = 'inactivo';
    }

    if (mensaje) alert(mensaje);
  }

  activarModoPrueba() {
    this.modoPruebaActivo = true;
    this.bufferPrueba = [];
    this.resultadoEnVivo = null;
    this.anclaPrueba.reiniciar();
  }

  // ---------- Guardar en Supabase ----------
  async guardarModelo() {
    if (this.framesGrabados.length === 0) return;
    this.guardando = true;

    try {
      const modelo: ModeloReferenciaSena = {
        version: VERSION_MODELO_ACTUAL,
        palabra: this.sena.palabra,
        tipo: this.tipoSena,
        manosRequeridas: this.manosRequeridas,
        totalFrames: this.framesGrabados.length,
        fpsObjetivo: 30,
        frames: this.framesGrabados,
        umbralRecomendado: this.tipoSena === 'dinamica' ? 70 : 75,
      };

      const { error } = await this.supabaseService.actualizarSena(this.sena.id, {
        landmarks_referencia: modelo,
      });

      if (error) throw error;

      this.sena.landmarks_referencia = modelo;
      this.modeloExistente = modelo;
      this.modeloDesactualizado = false;
      this.senaActualizada.emit(this.sena);

      await this.cerrar();
    } catch (e: any) {
      console.error('Error al guardar modelo de seña:', e);
      alert('Error al guardar en Supabase: ' + (e?.message || 'Error desconocido'));
    } finally {
      this.guardando = false;
    }
  }

  async cerrar() {
    this.detenerCamara();
    await this.modalCtrl.dismiss(this.sena);
  }
}
