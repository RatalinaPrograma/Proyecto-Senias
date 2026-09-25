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
  ModeloReferenciaSena,
  Punto3D,
  ResultadoComparacion,
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
      return;
    }

    const manos: Punto3D[][] = results.landmarks.map((hand: any[]) =>
      hand.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }))
    );

    const frameNorm = normalizarFrame(manos, this.manosRequeridas);
    if (!frameNorm) return;

    this.ultimoFrameNormalizado = frameNorm;

    // Si estamos en plena grabación de la seña
    if (this.estadoGrabacion === 'grabando') {
      this.framesGrabados.push(frameNorm);
      this.progresoGrabacion = Math.round(
        (this.framesGrabados.length / this.totalFramesObjetivo) * 100
      );

      if (this.framesGrabados.length >= this.totalFramesObjetivo) {
        this.finalizarGrabacion();
      }
    }

    // Si estamos en modo de prueba en vivo
    if (this.modoPruebaActivo && this.framesGrabados.length > 0) {
      if (this.tipoSena === 'estatica') {
        // En estática, comparamos el frame actual contra el primer frame grabado
        this.resultadoEnVivo = compararFrameEstatico(
          this.framesGrabados[0],
          frameNorm,
          75
        );
      } else {
        // En dinámica, alimentamos el buffer circular y ejecutamos DTW
        this.bufferPrueba.push(frameNorm);
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
  iniciarCuentaAtras() {
    if (this.manosDetectadasCount < this.manosRequeridas) {
      alert(`Por favor coloca ${this.manosRequeridas === 1 ? '1 mano' : 'las 2 manos'} frente a la cámara antes de grabar.`);
      return;
    }

    this.modoPruebaActivo = false;
    this.resultadoEnVivo = null;
    this.framesGrabados = [];
    this.progresoGrabacion = 0;
    this.cuentaAtras = 3;
    this.estadoGrabacion = 'cuenta_atras';

    const intervalo = setInterval(() => {
      this.cuentaAtras--;
      if (this.cuentaAtras <= 0) {
        clearInterval(intervalo);
        this.comenzarGrabacionReal();
      }
    }, 1000);
  }

  private comenzarGrabacionReal() {
    this.estadoGrabacion = 'grabando';
    this.framesGrabados = [];
  }

  private finalizarGrabacion() {
    this.estadoGrabacion = 'grabado';
    // Activar modo de prueba inmediatamente para que el admin pueda verificar
    this.activarModoPrueba();
  }

  activarModoPrueba() {
    this.modoPruebaActivo = true;
    this.bufferPrueba = [];
    this.resultadoEnVivo = null;
  }

  // ---------- Guardar en Supabase ----------
  async guardarModelo() {
    if (this.framesGrabados.length === 0) return;
    this.guardando = true;

    try {
      const modelo: ModeloReferenciaSena = {
        version: 1,
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
