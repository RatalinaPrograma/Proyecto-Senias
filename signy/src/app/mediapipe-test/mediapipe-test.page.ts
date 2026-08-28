import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { arrowBack, cameraReverse, videocam, refresh, eye, eyeOff, analytics, checkmarkCircle } from 'ionicons/icons';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

addIcons({
  'arrow-back': arrowBack,
  'camera-reverse': cameraReverse,
  videocam,
  refresh,
  eye,
  'eye-off': eyeOff,
  analytics,
  'checkmark-circle': checkmarkCircle,
});

interface DeteccionInfo {
  mano: string;
  confianza: number;
  gesto: string;
}

const HAND_CONNECTIONS: [number, number][] = [
  // Pulgar
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Índice
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Medio
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Anular
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Meñique
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

@Component({
  selector: 'app-mediapipe-test',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './mediapipe-test.page.html',
  styleUrls: ['./mediapipe-test.page.scss'],
})
export class MediapipeTestPage implements OnInit, OnDestroy {
  @ViewChild('video', { static: false }) videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas', { static: false }) canvasRef?: ElementRef<HTMLCanvasElement>;

  // Estados de la app
  estadoModelo: 'descargando' | 'listo' | 'error' = 'descargando';
  estadoCamara: 'apagada' | 'iniciando' | 'activa' | 'denegada' = 'apagada';
  mensajeError = '';

  // Configuración de cámara
  facingMode: 'user' | 'environment' = 'user';
  private stream: MediaStream | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private animationFrameId = 0;
  private lastVideoTime = -1;

  // Métricas y diagnósticos en tiempo real
  fps = 0;
  latenciaMs = 0;
  private framesCount = 0;
  private lastFpsUpdate = performance.now();
  manosDetectadas: DeteccionInfo[] = [];

  // Opciones de visualización
  mostrarEsqueleto = true;
  mostrarPuntos = true;
  mostrarEtiquetas = true;

  constructor(private router: Router) {}

  async ngOnInit() {
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

  // ---------- Inicialización del Modelo ----------
  async inicializarMediaPipe() {
    this.estadoModelo = 'descargando';
    this.mensajeError = '';

    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.estadoModelo = 'listo';
      // Iniciar cámara automáticamente una vez cargado el modelo
      await this.iniciarCamara();
    } catch (e: any) {
      console.error('Error al inicializar MediaPipe:', e);
      this.estadoModelo = 'error';
      this.mensajeError = e?.message || 'No se pudo descargar el modelo de MediaPipe. Revisa tu conexión a internet.';
    }
  }

  // ---------- Control de Cámara ----------
  async iniciarCamara() {
    if (this.estadoModelo !== 'listo') return;
    this.detenerCamara();
    this.estadoCamara = 'iniciando';
    this.mensajeError = '';

    // Validar si el entorno soporta getUserMedia (requiere Secure Context: localhost o https)
    const mediaDevices = navigator.mediaDevices || (navigator as any).webkitGetUserMedia ? {
      getUserMedia: (constraints: MediaStreamConstraints) => new Promise<MediaStream>((resolve, reject) => {
        const getMedia = (navigator as any).getUserMedia || (navigator as any).webkitGetUserMedia || (navigator as any).mozGetUserMedia;
        if (getMedia) {
          getMedia.call(navigator, constraints, resolve, reject);
        } else {
          reject(new Error('API de cámara no disponible en este navegador o contexto'));
        }
      })
    } : null;

    const apiMedia = navigator.mediaDevices || mediaDevices;

    if (!apiMedia || !apiMedia.getUserMedia) {
      this.estadoCamara = 'denegada';
      this.mensajeError = 'La cámara está deshabilitada por seguridad al usar HTTP con IP externa (--external). Para usar la cámara, compila la app localmente (ionic cap run android sin -l) o usa USB con adb reverse.';
      return;
    }

    try {
      let stream: MediaStream | null = null;

      // Nivel 1: Resolución ideal 640x480 con facingMode
      try {
        stream = await apiMedia.getUserMedia({
          video: {
            facingMode: this.facingMode,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (e1) {
        console.warn('Fallback 1: No se pudo con resolución ideal, intentando solo facingMode:', e1);
        try {
          // Nivel 2: Solo facingMode
          stream = await apiMedia.getUserMedia({
            video: { facingMode: this.facingMode },
            audio: false,
          });
        } catch (e2) {
          console.warn('Fallback 2: No se pudo con facingMode, intentando video genérico:', e2);
          // Nivel 3: Cualquier cámara disponible
          stream = await apiMedia.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      if (!stream) {
        throw new Error('No se pudo obtener el flujo de video de la cámara.');
      }

      this.stream = stream;
      this.estadoCamara = 'activa';

      setTimeout(async () => {
        const video = this.videoRef?.nativeElement;
        if (video && this.stream) {
          video.srcObject = this.stream;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.setAttribute('muted', 'true');
          video.muted = true;
          try {
            await video.play();
          } catch (playErr) {
            console.warn('Error al iniciar reproducción de video:', playErr);
          }
          this.iniciarBucleDeteccion();
        }
      }, 100);
    } catch (e: any) {
      console.error('Error al acceder a la cámara:', e);
      this.estadoCamara = 'denegada';
      this.mensajeError = e?.message || e?.name || 'No se pudo acceder a la cámara del dispositivo. Concede los permisos en los ajustes.';
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
    this.manosDetectadas = [];
    this.fps = 0;
  }

  alternarCamara() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.iniciarCamara();
  }

  // ---------- Bucle de Detección y Renderizado en Canvas ----------
  private iniciarBucleDeteccion() {
    const render = () => {
      const video = this.videoRef?.nativeElement;
      const canvas = this.canvasRef?.nativeElement;

      if (video && canvas && this.handLandmarker && this.estadoCamara === 'activa') {
        if (video.videoWidth > 0 && !video.paused) {
          // Ajustar resolución del canvas al video real
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const startTime = performance.now();
            const nowInMs = Date.now();

            if (nowInMs !== this.lastVideoTime) {
              this.lastVideoTime = nowInMs;
              const results = this.handLandmarker.detectForVideo(video, nowInMs);
              this.latenciaMs = Math.round(performance.now() - startTime);

              // Procesar resultados
              this.actualizarMetricas();
              this.dibujarResultados(ctx, canvas.width, canvas.height, results);
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

  private actualizarMetricas() {
    this.framesCount++;
    const ahora = performance.now();
    if (ahora - this.lastFpsUpdate >= 1000) {
      this.fps = this.framesCount;
      this.framesCount = 0;
      this.lastFpsUpdate = ahora;
    }
  }

  private dibujarResultados(ctx: CanvasRenderingContext2D, width: number, height: number, results: any) {
    if (!results || !results.landmarks || results.landmarks.length === 0) {
      this.manosDetectadas = [];
      return;
    }

    const infoList: DeteccionInfo[] = [];

    for (let h = 0; h < results.landmarks.length; h++) {
      const landmarks = results.landmarks[h];
      const handedness = results.handednesses?.[h]?.[0];
      const nombreMano = handedness ? (handedness.categoryName === 'Left' ? 'Izquierda' : 'Derecha') : `Mano ${h + 1}`;
      const score = handedness ? Math.round(handedness.score * 100) : 100;
      const gesto = this.clasificarGesto(landmarks);

      infoList.push({
        mano: nombreMano,
        confianza: score,
        gesto,
      });

      // 1. Dibujar conexiones (Esqueleto)
      if (this.mostrarEsqueleto) {
        ctx.strokeStyle = '#2CA6A4'; // Mint Signy
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
      }

      // 2. Dibujar puntos articulares (Landmarks)
      if (this.mostrarPuntos) {
        for (let i = 0; i < landmarks.length; i++) {
          const pt = landmarks[i];
          const x = pt.x * width;
          const y = pt.y * height;

          ctx.beginPath();
          // Puntas de los dedos (4, 8, 12, 16, 20) en naranja Signy Fox
          if ([4, 8, 12, 16, 20].includes(i)) {
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#F2701A';
          } else {
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#F7F5F0';
          }
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#0A1526';
          ctx.stroke();
        }
      }

      // 3. Etiqueta flotante sobre la muñeca (punto 0)
      if (this.mostrarEtiquetas) {
        const muneca = landmarks[0];
        const labelX = muneca.x * width;
        const labelY = Math.min(height - 10, muneca.y * height + 24);

        ctx.font = 'bold 13px Manrope, sans-serif';
        ctx.fillStyle = 'rgba(10, 21, 38, 0.85)';
        const texto = `${nombreMano} (${score}%) — ${gesto}`;
        const textWidth = ctx.measureText(texto).width;

        ctx.fillRect(labelX - textWidth / 2 - 6, labelY - 14, textWidth + 12, 20);
        ctx.fillStyle = '#F2701A';
        ctx.fillText(texto, labelX - textWidth / 2, labelY);
      }
    }

    this.manosDetectadas = infoList;
  }

  // Heurística rápida para pruebas de gestos con los 21 puntos
  private clasificarGesto(lm: any[]): string {
    if (!lm || lm.length < 21) return '—';

    // Detección de dedos levantados comparando la punta (TIP) con la articulación PIP
    const pulgarArriba = lm[4].y < lm[3].y && lm[4].y < lm[2].y;
    const indiceExtendido = lm[8].y < lm[6].y;
    const medioExtendido = lm[12].y < lm[10].y;
    const anularExtendido = lm[16].y < lm[14].y;
    const meniqueExtendido = lm[20].y < lm[18].y;

    const dedosLevantados = [indiceExtendido, medioExtendido, anularExtendido, meniqueExtendido].filter(Boolean).length;

    // Distancia entre punta del pulgar y punta del índice (Pinza / OK)
    const dx = lm[4].x - lm[8].x;
    const dy = lm[4].y - lm[8].y;
    const distPinza = Math.sqrt(dx * dx + dy * dy);

    if (distPinza < 0.05 && medioExtendido && anularExtendido && meniqueExtendido) {
      return 'OK / Pinza 👌';
    }

    if (dedosLevantados === 4 && pulgarArriba) {
      return 'Mano Abierta 🖐️';
    }

    if (dedosLevantados === 0 && !pulgarArriba) {
      return 'Puño Cerrado ✊';
    }

    if (indiceExtendido && medioExtendido && !anularExtendido && !meniqueExtendido) {
      return 'Paz / Victoria ✌️';
    }

    if (indiceExtendido && !medioExtendido && !anularExtendido && !meniqueExtendido) {
      return 'Apuntando ☝️';
    }

    if (pulgarArriba && dedosLevantados === 0) {
      return 'Pulgar Arriba 👍';
    }

    return `${dedosLevantados} dedos extendidos`;
  }

  volver() {
    this.detenerCamara();
    this.router.navigate(['/home']);
  }
}
