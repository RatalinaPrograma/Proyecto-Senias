import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  arrowBack,
  hardwareChipOutline,
  sparklesOutline,
  videocamOutline,
  addOutline,
  searchOutline,
  filterOutline,
  checkmarkCircle,
  alertCircleOutline,
  refreshOutline,
  openOutline,
  flashOutline,
  layersOutline,
  closeOutline,
  cameraReverseOutline,
  playOutline,
  stopOutline,
  flameOutline,
} from 'ionicons/icons';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { SupabaseService } from '../services/supabase';
import { Nivel, Subnivel, Sena } from '../data/db-types';
import { SenaTrainerModalComponent } from '../shared/sena-trainer-modal/sena-trainer-modal.component';
import {
  ModeloReferenciaSena,
  Punto3D,
  compararFrameEstatico,
  compararSecuenciasDTW,
  normalizarFrame,
} from '../utils/gesture-math';

addIcons({
  'arrow-back': arrowBack,
  'hardware-chip-outline': hardwareChipOutline,
  'sparkles-outline': sparklesOutline,
  'videocam-outline': videocamOutline,
  'add-outline': addOutline,
  'search-outline': searchOutline,
  'filter-outline': filterOutline,
  'checkmark-circle': checkmarkCircle,
  'alert-circle-outline': alertCircleOutline,
  'refresh-outline': refreshOutline,
  'open-outline': openOutline,
  'flash-outline': flashOutline,
  'layers-outline': layersOutline,
  'close-outline': closeOutline,
  'camera-reverse-outline': cameraReverseOutline,
  'play-outline': playOutline,
  'stop-outline': stopOutline,
  'flame-outline': flameOutline,
});

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

interface NodoRed {
  id: string;
  tipo: 'core' | 'subnivel' | 'sena';
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radio: number;
  color: string;
  calibrada?: boolean;
  senaRef?: Sena;
  subnivelId?: number;
}

interface ConexionRed {
  origen: NodoRed;
  destino: NodoRed;
  activa: boolean;
  pulso: number;
}

interface ParticulaFondo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radio: number;
  alpha: number;
}

export interface PrediccionEnVivo {
  palabra: string;
  similitud: number;
  esCoincidente: boolean;
  tipo: string;
  senaRef: Sena;
}

@Component({
  selector: 'app-admin-ai-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './admin-ai-studio.page.html',
  styleUrls: ['./admin-ai-studio.page.scss'],
})
export class AdminAiStudioPage implements OnInit, OnDestroy {
  @ViewChild('neuralCanvas', { static: false }) canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('labVideo', { static: false }) labVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('labCanvas', { static: false }) labCanvasRef?: ElementRef<HTMLCanvasElement>;

  cargando = true;
  error: string | null = null;

  niveles: Nivel[] = [];
  subniveles: Subnivel[] = [];
  senas: Sena[] = [];

  // Filtros
  busqueda = '';
  filtroEstado: 'todas' | 'calibradas' | 'pendientes' = 'todas';
  filtroSubnivelId: number | 'todos' = 'todos';

  // Vista activa: 'grafo', 'lista' o 'lab' (Reconocimiento Real)
  vistaModo: 'grafo' | 'lista' | 'lab' = 'grafo';

  // Métricas de IA
  totalSenas = 0;
  calibradasCount = 0;
  pendientesCount = 0;
  porcentajeCalibrado = 0;

  // Nodo seleccionado en el grafo
  senaSeleccionada: Sena | null = null;

  // Modal para agregar nueva seña directamente
  modalCrearAbierto = false;
  nuevaPalabra = '';
  nuevoSubnivelId: number | null = null;
  guardandoNueva = false;

  // Red neuronal canvas
  private animId = 0;
  private nodos: NodoRed[] = [];
  private conexiones: ConexionRed[] = [];
  private particulasFondo: ParticulaFondo[] = [];

  // ================= Laboratorio de Reconocimiento Real =================
  labEstado: 'apagado' | 'cargando' | 'activo' | 'error' = 'apagado';
  labMensajeError = '';
  labFacingMode: 'user' | 'environment' = 'user';
  private labStream: MediaStream | null = null;
  private labHandLandmarker: HandLandmarker | null = null;
  private labRafId = 0;
  private labLastVideoTime = -1;
  private labBuffer: number[][] = [];
  private readonly LAB_BUFFER_MAX = 30;

  prediccionesEnVivo: PrediccionEnVivo[] = [];
  mejorPrediccion: PrediccionEnVivo | null = null;
  manosEnLaboratorio = 0;

  constructor(
    private supabaseService: SupabaseService,
    private modalCtrl: ModalController,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.cargarDatos();
  }

  ngOnDestroy() {
    this.detenerAnimacionGrafo();
    this.detenerLaboratorioReconocimiento();
    if (this.labHandLandmarker) {
      try {
        this.labHandLandmarker.close();
      } catch {}
    }
  }

  @HostListener('window:resize')
  onWindowResize() {
    if (this.vistaModo === 'grafo') {
      this.inicializarGrafoRed();
    }
  }

  cambiarVista(modo: 'grafo' | 'lista' | 'lab') {
    if (this.vistaModo === 'lab' && modo !== 'lab') {
      this.detenerLaboratorioReconocimiento();
    }
    if (this.vistaModo === 'grafo' && modo !== 'grafo') {
      this.detenerAnimacionGrafo();
    }

    this.vistaModo = modo;

    if (modo === 'grafo') {
      setTimeout(() => {
        this.inicializarGrafoRed();
      }, 50);
    } else if (modo === 'lab') {
      setTimeout(() => {
        this.iniciarLaboratorioReconocimiento();
      }, 50);
    }
  }

  async cargarDatos() {
    this.cargando = true;
    this.error = null;

    try {
      const [niveles, subniveles, senas] = await Promise.all([
        this.supabaseService.listarNiveles(),
        this.supabaseService.listarSubniveles(),
        this.supabaseService.listarSenas(),
      ]);

      this.niveles = niveles;
      this.subniveles = subniveles;
      this.senas = senas;

      this.recalcularMetricas();

      setTimeout(() => {
        this.inicializarGrafoRed();
      }, 100);
    } catch (e: any) {
      this.error = e?.message || 'Error al conectar con la base de datos de Signy.';
    } finally {
      this.cargando = false;
    }
  }

  recalcularMetricas() {
    this.totalSenas = this.senas.length;
    this.calibradasCount = this.senas.filter((s) => !!s.landmarks_referencia).length;
    this.pendientesCount = this.totalSenas - this.calibradasCount;
    this.porcentajeCalibrado = this.totalSenas
      ? Math.round((this.calibradasCount / this.totalSenas) * 100)
      : 0;
  }

  get senasFiltradas(): Sena[] {
    return this.senas.filter((s) => {
      const coincideBusqueda =
        !this.busqueda ||
        s.palabra.toLowerCase().includes(this.busqueda.toLowerCase().trim());

      const esCalibrada = !!s.landmarks_referencia;
      const coincideEstado =
        this.filtroEstado === 'todas' ||
        (this.filtroEstado === 'calibradas' && esCalibrada) ||
        (this.filtroEstado === 'pendientes' && !esCalibrada);

      const coincideSubnivel =
        this.filtroSubnivelId === 'todos' || s.subnivel_id === this.filtroSubnivelId;

      return coincideBusqueda && coincideEstado && coincideSubnivel;
    });
  }

  nombreSubnivelDe(subnivelId: number): string {
    const s = this.subniveles.find((x) => x.id === subnivelId);
    return s ? s.nombre : 'General';
  }

  // ================= Grafo de Red Neuronal (PRO) =================
  private inicializarGrafoRed() {
    this.detenerAnimacionGrafo();
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = rect?.width || 360;
    const height = rect?.height || 440;

    canvas.width = width;
    canvas.height = height;

    this.nodos = [];
    this.conexiones = [];

    // Partículas de polvo cósmico en el fondo
    this.particulasFondo = Array.from({ length: 35 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radio: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
    }));

    // 1. Nodo Central: Signy AI Core
    const centroX = width / 2;
    const centroY = height / 2;

    const nodoCore: NodoRed = {
      id: 'core',
      tipo: 'core',
      label: 'SIGNY AI CORE',
      x: centroX,
      y: centroY,
      vx: 0,
      vy: 0,
      radio: 28,
      color: '#00e5ff',
    };
    this.nodos.push(nodoCore);

    // 2. Nodos de Subniveles (anillo intermedio)
    const radioIntermedio = Math.min(width, height) * 0.28;
    const nodosSub: NodoRed[] = [];

    const subnivelesConSenas = this.subniveles.filter((sub) =>
      this.senas.some((s) => s.subnivel_id === sub.id)
    );

    const totalSub = subnivelesConSenas.length || 1;

    subnivelesConSenas.forEach((sub, i) => {
      const angulo = (i / totalSub) * Math.PI * 2;
      const subX = centroX + Math.cos(angulo) * radioIntermedio;
      const subY = centroY + Math.sin(angulo) * radioIntermedio;

      const nSub: NodoRed = {
        id: `sub_${sub.id}`,
        tipo: 'subnivel',
        label: sub.nombre,
        subnivelId: sub.id,
        x: subX,
        y: subY,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        radio: 14,
        color: '#0051ff',
      };

      this.nodos.push(nSub);
      nodosSub.push(nSub);

      this.conexiones.push({
        origen: nodoCore,
        destino: nSub,
        activa: true,
        pulso: Math.random(),
      });
    });

    // 3. Nodos de Señas (anillo exterior con ramas)
    const radioExterior = Math.min(width, height) * 0.44;

    this.senas.forEach((sena, idx) => {
      const padreSub = nodosSub.find((n) => n.subnivelId === sena.subnivel_id) || nodoCore;
      const anguloBase = Math.atan2(padreSub.y - centroY, padreSub.x - centroX);
      const jitter = (idx % 6 - 2.5) * 0.18;
      const angulo = anguloBase + jitter;

      const distRadio = radioExterior + (idx % 2 === 0 ? 14 : -14);
      const senaX = centroX + Math.cos(angulo) * distRadio;
      const senaY = centroY + Math.sin(angulo) * distRadio;

      const estaCalibrada = !!sena.landmarks_referencia;

      const nSena: NodoRed = {
        id: `sena_${sena.id}`,
        tipo: 'sena',
        label: sena.palabra,
        senaRef: sena,
        subnivelId: sena.subnivel_id,
        calibrada: estaCalibrada,
        x: senaX,
        y: senaY,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        radio: estaCalibrada ? 8 : 6,
        color: estaCalibrada ? '#00e5ff' : '#f59e0b',
      };

      this.nodos.push(nSena);

      this.conexiones.push({
        origen: padreSub,
        destino: nSena,
        activa: estaCalibrada,
        pulso: Math.random(),
      });
    });

    this.iniciarAnimacionGrafo();
  }

  private iniciarAnimacionGrafo() {
    this.detenerAnimacionGrafo();

    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let tick = 0;

    const render = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Cuadrícula cyberpunk
      this.dibujarCuadricula(ctx, canvas.width, canvas.height);

      // Partículas de fondo
      for (const p of this.particulasFondo) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radio, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 229, 255, ${p.alpha})`;
        ctx.fill();
      }

      // 1. Conexiones (Sinapsis)
      for (const c of this.conexiones) {
        c.pulso += 0.016;
        if (c.pulso > 1) c.pulso = 0;

        ctx.beginPath();
        ctx.moveTo(c.origen.x, c.origen.y);
        ctx.lineTo(c.destino.x, c.destino.y);

        if (c.activa) {
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.15)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();

        // Pulso eléctrico animado
        const px = c.origen.x + (c.destino.x - c.origen.x) * c.pulso;
        const py = c.origen.y + (c.destino.y - c.origen.y) * c.pulso;

        ctx.beginPath();
        ctx.arc(px, py, c.activa ? 2.5 : 1.5, 0, Math.PI * 2);
        ctx.fillStyle = c.activa ? '#00e5ff' : '#f59e0b';
        ctx.shadowColor = c.activa ? '#00e5ff' : '#f59e0b';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // 2. Nodos
      for (const n of this.nodos) {
        if (n.tipo !== 'core') {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 24 || n.x > canvas.width - 24) n.vx *= -1;
          if (n.y < 24 || n.y > canvas.height - 24) n.vy *= -1;
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radio, 0, Math.PI * 2);

        if (n.tipo === 'core') {
          const corePulse = Math.sin(tick * 0.06) * 3;
          // Anillo orbital exterior
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radio + 8 + corePulse, 0, Math.PI * 2);
          ctx.stroke();

          // Núcleo
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radio, 0, Math.PI * 2);
          ctx.fillStyle = '#0051ff';
          ctx.shadowColor = '#00e5ff';
          ctx.shadowBlur = 18 + corePulse;
          ctx.fill();
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.shadowBlur = 0;

          ctx.font = 'bold 9px monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText('AI CORE', n.x, n.y + 3);
        } else if (n.tipo === 'subnivel') {
          ctx.fillStyle = '#091a38';
          ctx.strokeStyle = '#0051ff';
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
        } else {
          // Seña
          const esSel = this.senaSeleccionada?.id === n.senaRef?.id;
          ctx.fillStyle = n.calibrada ? '#00e5ff' : '#f59e0b';
          if (esSel) {
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 14;
            ctx.arc(n.x, n.y, n.radio + 3, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.shadowBlur = 0;

          // Etiqueta flotante
          ctx.font = '10px Manrope, sans-serif';
          ctx.fillStyle = n.calibrada ? '#a5f3fc' : '#fed7aa';
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y + n.radio + 11);
        }
      }

      this.animId = requestAnimationFrame(render);
    };

    this.animId = requestAnimationFrame(render);
  }

  private detenerAnimacionGrafo() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = 0;
    }
  }

  private dibujarCuadricula(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.04)';
    ctx.lineWidth = 1;
    const paso = 32;

    for (let x = 0; x < width; x += paso) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += paso) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  onCanvasClick(event: MouseEvent | TouchEvent) {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in event && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if ('clientX' in event) {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    const nodoTocado = this.nodos.find((n) => {
      if (n.tipo !== 'sena') return false;
      const dx = n.x - clickX;
      const dy = n.y - clickY;
      return Math.sqrt(dx * dx + dy * dy) <= n.radio + 14;
    });

    if (nodoTocado && nodoTocado.senaRef) {
      this.senaSeleccionada = nodoTocado.senaRef;
    }
  }

  // ================= Laboratorio de Reconocimiento Real =================
  async iniciarLaboratorioReconocimiento() {
    this.labEstado = 'cargando';
    this.labMensajeError = '';
    this.labBuffer = [];
    this.prediccionesEnVivo = [];
    this.mejorPrediccion = null;

    try {
      if (!this.labHandLandmarker) {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        this.labHandLandmarker = await HandLandmarker.createFromOptions(vision, {
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
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.labFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.labFacingMode },
          audio: false,
        });
      }

      this.labStream = stream;
      this.labEstado = 'activo';

      setTimeout(async () => {
        const video = this.labVideoRef?.nativeElement;
        if (video && this.labStream) {
          video.srcObject = this.labStream;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => {});
          this.bucleReconocimientoReal();
        }
      }, 100);
    } catch (e: any) {
      console.error('Error al inicializar laboratorio:', e);
      this.labEstado = 'error';
      this.labMensajeError = e?.message || 'No se pudo acceder a la cámara para el laboratorio.';
    }
  }

  detenerLaboratorioReconocimiento() {
    if (this.labRafId) {
      cancelAnimationFrame(this.labRafId);
      this.labRafId = 0;
    }
    if (this.labStream) {
      this.labStream.getTracks().forEach((t) => t.stop());
      this.labStream = null;
    }
    this.labEstado = 'apagado';
    this.manosEnLaboratorio = 0;
    this.labBuffer = [];
  }

  alternarCamaraLab() {
    this.labFacingMode = this.labFacingMode === 'user' ? 'environment' : 'user';
    this.detenerLaboratorioReconocimiento();
    this.iniciarLaboratorioReconocimiento();
  }

  private bucleReconocimientoReal() {
    const loop = () => {
      const video = this.labVideoRef?.nativeElement;
      const canvas = this.labCanvasRef?.nativeElement;

      if (video && canvas && this.labEstado === 'activo' && video.videoWidth > 0 && !video.paused) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (this.labHandLandmarker) {
            const nowInMs = Date.now();
            if (nowInMs !== this.labLastVideoTime) {
              this.labLastVideoTime = nowInMs;
              const results = this.labHandLandmarker.detectForVideo(video, nowInMs);

              this.manosEnLaboratorio = results?.landmarks?.length || 0;

              if (results?.landmarks && results.landmarks.length > 0) {
                // Dibujar esqueleto estilo neon en vivo
                this.dibujarEsqueletoLab(ctx, canvas.width, canvas.height, results.landmarks);

                // Normalizar frame para comparación con el modelo
                const manos: Punto3D[][] = results.landmarks.map((hand: any[]) =>
                  hand.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }))
                );

                const frameNorm = normalizarFrame(manos, 1);
                if (frameNorm) {
                  this.labBuffer.push(frameNorm);
                  if (this.labBuffer.length > this.LAB_BUFFER_MAX) {
                    this.labBuffer.shift();
                  }

                  // Evaluar el buffer en tiempo real contra todo nuestro catálogo entrenado
                  if (this.labBuffer.length >= 12) {
                    this.evaluarBufferContraModelo();
                  }
                }
              } else {
                // Si no hay manos, decaer predicción
                if (this.labBuffer.length > 0) {
                  this.labBuffer.shift();
                }
              }
            }
          }
        }
      }

      if (this.labEstado === 'activo') {
        this.labRafId = requestAnimationFrame(loop);
      }
    };

    this.labRafId = requestAnimationFrame(loop);
  }

  private dibujarEsqueletoLab(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    allLandmarks: any[]
  ) {
    for (const landmarks of allLandmarks) {
      ctx.strokeStyle = '#00e5ff';
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

      for (let i = 0; i < landmarks.length; i++) {
        const pt = landmarks[i];
        const x = pt.x * width;
        const y = pt.y * height;
        ctx.beginPath();
        if ([4, 8, 12, 16, 20].includes(i)) {
          ctx.arc(x, y, 6, 0, 2 * Math.PI);
          ctx.fillStyle = '#0051ff';
          ctx.shadowColor = '#00e5ff';
          ctx.shadowBlur = 8;
        } else {
          ctx.arc(x, y, 4, 0, 2 * Math.PI);
          ctx.fillStyle = '#ffffff';
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#030b17';
        ctx.stroke();
      }
    }
  }

  /**
   * Compara el buffer deslizante de la cámara en tiempo real contra
   * TODAS las señas calibradas en nuestro modelo de Supabase con DTW.
   */
  private evaluarBufferContraModelo() {
    const senasCalibradas = this.senas.filter((s) => !!s.landmarks_referencia);
    if (!senasCalibradas.length || !this.labBuffer.length) return;

    const ranking: PrediccionEnVivo[] = [];

    const frameActual = this.labBuffer[this.labBuffer.length - 1];

    for (const sena of senasCalibradas) {
      try {
        const mod: ModeloReferenciaSena =
          typeof sena.landmarks_referencia === 'string'
            ? JSON.parse(sena.landmarks_referencia)
            : sena.landmarks_referencia;

        if (!mod || !mod.frames || !mod.frames.length) continue;

        let similitud = 0;
        let esCoincidente = false;

        if (mod.tipo === 'estatica') {
          const res = compararFrameEstatico(mod.frames[0], frameActual, mod.umbralRecomendado || 75);
          similitud = res.similitudPct;
          esCoincidente = res.esCoincidente;
        } else {
          // Dinámica (DTW contra el buffer)
          const res = compararSecuenciasDTW(mod.frames, this.labBuffer, mod.umbralRecomendado || 70);
          similitud = res.similitudPct;
          esCoincidente = res.esCoincidente;
        }

        ranking.push({
          palabra: sena.palabra,
          similitud,
          esCoincidente,
          tipo: mod.tipo || 'dinamica',
          senaRef: sena,
        });
      } catch (e) {
        // Ignorar seña corrupta
      }
    }

    // Ordenar de mayor a menor coincidencia
    ranking.sort((a, b) => b.similitud - a.similitud);

    this.prediccionesEnVivo = ranking.slice(0, 4);
    if (this.prediccionesEnVivo.length > 0) {
      this.mejorPrediccion = this.prediccionesEnVivo[0];
    }
  }

  // ================= Calibrar / Entrenar Seña =================
  async calibrarSena(sena: Sena) {
    const modal = await this.modalCtrl.create({
      component: SenaTrainerModalComponent,
      componentProps: {
        sena: { ...sena },
      },
      backdropDismiss: false,
    });

    await modal.present();

    const { data: senaActualizada } = await modal.onWillDismiss();
    if (senaActualizada) {
      const idx = this.senas.findIndex((s) => s.id === senaActualizada.id);
      if (idx !== -1) {
        this.senas[idx] = {
          ...this.senas[idx],
          landmarks_referencia: senaActualizada.landmarks_referencia,
        };
        this.recalcularMetricas();
        this.inicializarGrafoRed();
        if (this.senaSeleccionada?.id === senaActualizada.id) {
          this.senaSeleccionada = this.senas[idx];
        }
      }
    }
  }

  // ================= Crear Nueva Seña y Conectar =================
  abrirModalCrear() {
    this.nuevaPalabra = '';
    this.nuevoSubnivelId = this.subniveles.length ? this.subniveles[0].id : null;
    this.modalCrearAbierto = true;
  }

  cerrarModalCrear() {
    this.modalCrearAbierto = false;
  }

  async guardarYCalibrarNueva() {
    if (!this.nuevaPalabra.trim() || !this.nuevoSubnivelId) return;

    this.guardandoNueva = true;
    try {
      const { data: nuevaSena, error } = await this.supabaseService.crearSena({
        palabra: this.nuevaPalabra.trim(),
        subnivel_id: this.nuevoSubnivelId,
        video_url: null,
        icono: '✨',
        descripcion: 'Creada desde Signy AI Studio',
      });

      if (error) throw error;

      this.senas.push(nuevaSena);
      this.recalcularMetricas();
      this.inicializarGrafoRed();
      this.cerrarModalCrear();

      await this.calibrarSena(nuevaSena);
    } catch (e: any) {
      alert('Error al crear la seña: ' + (e?.message || 'Error desconocido'));
    } finally {
      this.guardandoNueva = false;
    }
  }

  volver() {
    this.router.navigate(['/home']);
  }

  irAVocabulario() {
    this.router.navigate(['/admin/vocabulario']);
  }
}
