import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
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
  downloadOutline,
} from 'ionicons/icons';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../services/supabase';
import { BotonAtrasService } from '../services/boton-atras';
import { Nivel, Subnivel, Sena } from '../data/db-types';
import { SenaTrainerModalComponent } from '../shared/sena-trainer-modal/sena-trainer-modal.component';
import {
  ControlFramesVideo,
  GrabadorCaptura,
  MediaPipeManosService,
  Prediccion,
  ReconocedorSenasService,
  construirDatasetExportable,
  dibujarManos,
  evaluarCaptura,
  modeloDeSena,
} from '../motor-senas';

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
  'download-outline': downloadOutline,
});

const ESTILO_LAB = { linea: '#00e5ff', punta: '#0051ff', nudillo: '#ffffff', borde: '#030b17', brillo: '#00e5ff' };
/** El reconocimiento en vivo se recalcula ~5 veces por segundo, no en cada frame. */
const INTERVALO_EVALUACION_LAB_MS = 200;
/** Sin manos durante este tiempo, se descarta lo acumulado (empieza otra "toma"). */
const PAUSA_REINICIO_LAB_MS = 700;

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
  private readonly labControl = new ControlFramesVideo();
  /** Últimos 3 s de captura cruda: se compara contra señas de 1 y de 2 manos por igual. */
  private readonly labBuffer = new GrabadorCaptura(3000);
  private labUltimaEvaluacion = 0;
  private labUltimaMano = 0;

  prediccionesEnVivo: PrediccionEnVivo[] = [];
  mejorPrediccion: PrediccionEnVivo | null = null;
  /** Top 3 del clasificador entrenado (vacío si todavía no hay modelo entrenado). */
  prediccionesClasificador: Prediccion[] = [];
  hayClasificador = false;
  manosEnLaboratorio = 0;

  // Dataset de entrenamiento
  muestrasPorSena: Map<number, number> | null = null;
  totalMuestras = 0;
  exportando = false;
  progresoExportacion = '';

  constructor(
    private supabaseService: SupabaseService,
    private modalCtrl: ModalController,
    private router: Router,
    private mediaPipe: MediaPipeManosService,
    private reconocedor: ReconocedorSenasService
  ) {}

  async ngOnInit() {
    await this.cargarDatos();
  }

  ngOnDestroy() {
    // El HandLandmarker es compartido (MediaPipeManosService): no se cierra acá.
    this.detenerAnimacionGrafo();
    this.detenerLaboratorioReconocimiento();
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
      this.cargarConteoMuestras();

      setTimeout(() => {
        this.inicializarGrafoRed();
      }, 100);
    } catch (e: any) {
      this.error = e?.message || 'Error al conectar con la base de datos de Signy.';
    } finally {
      this.cargando = false;
    }
  }

  private async cargarConteoMuestras() {
    try {
      this.muestrasPorSena = await this.supabaseService.contarMuestrasPorSena();
      this.totalMuestras = Array.from(this.muestrasPorSena.values()).reduce((a, b) => a + b, 0);
    } catch {
      this.muestrasPorSena = null; // tabla aún no creada (migración pendiente) o sin conexión
    }
  }

  muestrasDe(senaId: number): number {
    return this.muestrasPorSena?.get(senaId) ?? 0;
  }

  /**
   * Descarga el dataset (todas las muestras crudas) en el formato que lee
   * `ml/entrenar.py`. Los ids de usuario se reemplazan por p1, p2, …
   */
  async exportarDataset() {
    if (this.exportando) return;
    if (Capacitor.isNativePlatform()) {
      // El WebView de Android no descarga archivos generados en el navegador.
      alert(
        'Desde la app del celular no se puede descargar el archivo. Para entrenar, en el computador corre:\n\n' +
          'python ml/entrenar.py --supabase --email <tu correo de admin>\n\n' +
          'o abre AI Studio en el navegador del computador y usa este botón.'
      );
      return;
    }
    this.exportando = true;
    this.progresoExportacion = 'Descargando muestras…';
    try {
      const muestras = await this.supabaseService.listarMuestrasSena((n) => (this.progresoExportacion = `${n} muestras descargadas…`));
      if (!muestras.length) {
        alert('Todavía no hay muestras en el dataset. Graba algunas desde el entrenador de cada seña ("Al dataset").');
        return;
      }
      const dataset = construirDatasetExportable(this.senas, muestras);
      const blob = new Blob([JSON.stringify(dataset)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const hoy = new Date();
      const fecha = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
      a.href = url;
      a.download = `signy-dataset-${fecha}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      alert('No se pudo exportar el dataset: ' + (e?.message || 'error desconocido'));
    } finally {
      this.exportando = false;
      this.progresoExportacion = '';
    }
  }

  recalcularMetricas() {
    this.totalSenas = this.senas.length;
    this.calibradasCount = this.senas.filter((s) => !!modeloDeSena(s)).length;
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

      const esCalibrada = !!modeloDeSena(s);
      const coincideEstado =
        this.filtroEstado === 'todas' ||
        (this.filtroEstado === 'calibradas' && esCalibrada) ||
        (this.filtroEstado === 'pendientes' && !esCalibrada);

      const coincideSubnivel =
        this.filtroSubnivelId === 'todos' || s.subnivel_id === this.filtroSubnivelId;

      return coincideBusqueda && coincideEstado && coincideSubnivel;
    });
  }

  estaCalibrada(sena: Sena): boolean {
    return !!modeloDeSena(sena);
  }

  umbralDe(sena: Sena): number {
    const m = modeloDeSena(sena);
    return m?.umbralRecomendado ?? (m?.tipo === 'estatica' ? 75 : 70);
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

      const estaCalibrada = !!modeloDeSena(sena);

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
    this.labBuffer.reiniciar();
    this.prediccionesEnVivo = [];
    this.prediccionesClasificador = [];
    this.mejorPrediccion = null;

    try {
      this.labHandLandmarker = await this.mediaPipe.obtener();
      this.hayClasificador = !!(await this.reconocedor.clasificador());

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.labFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.labFacingMode }, audio: false });
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
    this.labBuffer.reiniciar();
  }

  alternarCamaraLab() {
    this.labFacingMode = this.labFacingMode === 'user' ? 'environment' : 'user';
    this.detenerLaboratorioReconocimiento();
    this.iniciarLaboratorioReconocimiento();
  }

  private bucleReconocimientoReal() {
    this.labControl.reiniciar();
    const loop = () => {
      const video = this.labVideoRef?.nativeElement;
      const canvas = this.labCanvasRef?.nativeElement;

      if (video && canvas && this.labHandLandmarker && this.labEstado === 'activo' && video.videoWidth > 0 && !video.paused && this.labControl.esFrameNuevo(video)) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        const marca = this.labControl.marcaDeTiempo();
        try {
          const results = this.labHandLandmarker.detectForVideo(video, marca);
          this.manosEnLaboratorio = results?.landmarks?.length || 0;

          if (this.manosEnLaboratorio > 0) {
            this.labUltimaMano = marca;
            if (ctx) dibujarManos(ctx, canvas.width, canvas.height, results.landmarks, ESTILO_LAB);
          } else if (marca - this.labUltimaMano > PAUSA_REINICIO_LAB_MS && this.labBuffer.totalFrames) {
            // Las manos salieron de cuadro: termina la "toma" actual.
            this.labBuffer.reiniciar();
            this.prediccionesEnVivo = [];
            this.prediccionesClasificador = [];
            this.mejorPrediccion = null;
          }

          if (this.manosEnLaboratorio > 0 || this.labBuffer.totalFrames) {
            this.labBuffer.agregar(results, marca, video.videoWidth, video.videoHeight);
          }
          if (marca - this.labUltimaEvaluacion >= INTERVALO_EVALUACION_LAB_MS && this.labBuffer.framesConManos(1) >= 8) {
            this.labUltimaEvaluacion = marca;
            this.evaluarBufferContraModelo();
          }
        } catch (e) {
          console.warn('MediaPipe no pudo procesar el frame:', e);
        }
      }

      if (this.labEstado === 'activo') {
        this.labRafId = requestAnimationFrame(loop);
      }
    };

    this.labRafId = requestAnimationFrame(loop);
  }

  /**
   * Compara los últimos 3 s de cámara contra TODAS las señas con modelo de
   * referencia (y, si existe, con el clasificador entrenado).
   */
  private async evaluarBufferContraModelo() {
    const captura = this.labBuffer.captura();
    const ranking: PrediccionEnVivo[] = [];

    for (const sena of this.senas) {
      const modelo = modeloDeSena(sena);
      if (!modelo) continue;
      const r = evaluarCaptura(modelo, captura);
      if (r.motivo) continue;
      ranking.push({ palabra: sena.palabra, similitud: r.similitudPct, esCoincidente: r.esCoincidente, tipo: modelo.tipo, senaRef: sena });
    }

    ranking.sort((a, b) => b.similitud - a.similitud);
    this.prediccionesEnVivo = ranking.slice(0, 4);
    this.mejorPrediccion = this.prediccionesEnVivo[0] ?? null;

    const clf = await this.reconocedor.clasificador();
    this.prediccionesClasificador = clf ? clf.predecir(captura).slice(0, 3) : [];
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
        this.cargarConteoMuestras();
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

  // ---- botón atrás del teléfono ----
  private readonly atras = inject(BotonAtrasService).paraPantalla(() => this.alPresionarAtras());

  ionViewWillEnter() {
    this.atras.activar();
  }

  ionViewWillLeave() {
    this.atras.desactivar();
  }

  /** Atrás cierra primero el modal de nueva seña o la ficha de la seña elegida en el grafo. */
  alPresionarAtras(): boolean {
    if (this.modalCrearAbierto) {
      if (!this.guardandoNueva) this.cerrarModalCrear();
      return true;
    }
    if (this.senaSeleccionada) {
      this.senaSeleccionada = null;
      return true;
    }
    return false;
  }

  volver() {
    this.router.navigate(['/home']);
  }

  irAVocabulario() {
    this.router.navigate(['/admin/vocabulario']);
  }
}
