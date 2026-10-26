import {
  Component,
  ElementRef,
  NgZone,
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
  checkmarkCircle,
  alertCircleOutline,
  refreshOutline,
  flashOutline,
  layersOutline,
  closeOutline,
  cameraReverseOutline,
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
  sincronizarTamanoCanvas,
} from '../motor-senas';

addIcons({
  'arrow-back': arrowBack,
  'hardware-chip-outline': hardwareChipOutline,
  'sparkles-outline': sparklesOutline,
  'videocam-outline': videocamOutline,
  'add-outline': addOutline,
  'search-outline': searchOutline,
  'checkmark-circle': checkmarkCircle,
  'alert-circle-outline': alertCircleOutline,
  'refresh-outline': refreshOutline,
  'flash-outline': flashOutline,
  'layers-outline': layersOutline,
  'close-outline': closeOutline,
  'camera-reverse-outline': cameraReverseOutline,
  'download-outline': downloadOutline,
});

const ESTILO_LAB = { linea: '#2CA6A4', punta: '#F2701A', nudillo: '#ffffff', borde: '#0A1526', brillo: '#F2701A' };
/** El reconocimiento en vivo se recalcula ~5 veces por segundo, no en cada frame. */
const INTERVALO_EVALUACION_LAB_MS = 200;
/** Sin manos durante este tiempo, se descarta lo acumulado (empieza otra "toma"). */
const PAUSA_REINICIO_LAB_MS = 700;

export interface PrediccionEnVivo {
  palabra: string;
  similitud: number;
  esCoincidente: boolean;
}

@Component({
  selector: 'app-admin-ai-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './admin-ai-studio.page.html',
  styleUrls: ['./admin-ai-studio.page.scss'],
})
export class AdminAiStudioPage implements OnInit, OnDestroy {
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

  // Vista activa: 'lista' (catálogo) o 'lab' (reconocimiento en vivo)
  vistaModo: 'lista' | 'lab' = 'lista';

  // Métricas de IA
  totalSenas = 0;
  calibradasCount = 0;
  pendientesCount = 0;
  porcentajeCalibrado = 0;

  // Modal para agregar nueva seña directamente
  modalCrearAbierto = false;
  nuevaPalabra = '';
  nuevoSubnivelId: number | null = null;
  guardandoNueva = false;

  /** Ids de seña que el clasificador entrenado ya conoce (define "calibrada"). */
  private clasificadorConocidos = new Set<number>();

  // ================= Laboratorio de Reconocimiento Real =================
  labEstado: 'apagado' | 'cargando' | 'activo' | 'error' = 'apagado';
  labMensajeError = '';
  labFacingMode: 'user' | 'environment' = 'user';
  private labStream: MediaStream | null = null;
  private labHandLandmarker: HandLandmarker | null = null;
  private labRafId = 0;
  private readonly labControl = new ControlFramesVideo(45); // ~22 FPS máx
  /** Últimos 3 s de captura cruda: se compara contra señas de 1 y de 2 manos por igual. */
  private readonly labBuffer = new GrabadorCaptura(3000);
  private labUltimaEvaluacion = 0;
  private labUltimaMano = 0;
  private readonly ngZone = inject(NgZone);

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
    await this.cargarClasificadorConocidos();
    await this.cargarDatos();
  }

  ngOnDestroy() {
    // El HandLandmarker es compartido (MediaPipeManosService): no se cierra acá.
    this.detenerLaboratorioReconocimiento();
  }

  private async cargarClasificadorConocidos() {
    const clf = await this.reconocedor.clasificador();
    this.clasificadorConocidos = new Set(clf?.clases.map((c) => c.senaId) ?? []);
  }

  cambiarVista(modo: 'lista' | 'lab') {
    if (this.vistaModo === 'lab' && modo !== 'lab') {
      this.detenerLaboratorioReconocimiento();
    }
    this.vistaModo = modo;
    if (modo === 'lab') {
      setTimeout(() => this.iniciarLaboratorioReconocimiento(), 50);
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
      // Señas recién pedidas: si alguien creó una seña y le grabó muestras con
      // esta página ya abierta, la lista vieja dejaba el archivo inválido.
      const senas = await this.supabaseService.listarSenas();
      const dataset = construirDatasetExportable(senas, muestras);
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
    this.calibradasCount = this.senas.filter((s) => this.estaCalibrada(s)).length;
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

      const esCalibrada = this.estaCalibrada(s);
      const coincideEstado =
        this.filtroEstado === 'todas' ||
        (this.filtroEstado === 'calibradas' && esCalibrada) ||
        (this.filtroEstado === 'pendientes' && !esCalibrada);

      const coincideSubnivel =
        this.filtroSubnivelId === 'todos' || s.subnivel_id === this.filtroSubnivelId;

      return coincideBusqueda && coincideEstado && coincideSubnivel;
    });
  }

  /** "Calibrada" = el clasificador entrenado (ml/entrenar.py) ya conoce esta seña. */
  estaCalibrada(sena: Sena): boolean {
    return this.clasificadorConocidos.has(sena.id);
  }

  nombreSubnivelDe(subnivelId: number): string {
    const s = this.subniveles.find((x) => x.id === subnivelId);
    return s ? s.nombre : 'General';
  }

  // ================= Laboratorio de Reconocimiento Real =================
  async iniciarLaboratorioReconocimiento() {
    this.labEstado = 'cargando';
    this.labMensajeError = '';
    this.labBuffer.reiniciar();
    this.prediccionesClasificador = [];
    this.mejorPrediccion = null;

    try {
      this.labHandLandmarker = await this.mediaPipe.obtener();
      this.hayClasificador = !!(await this.reconocedor.clasificador());

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: this.labFacingMode,
            width: { ideal: 480, max: 640 },
            height: { ideal: 360, max: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
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
    this.ngZone.runOutsideAngular(() => {
      const loop = () => {
        const video = this.labVideoRef?.nativeElement;
        const canvas = this.labCanvasRef?.nativeElement;
        const ahora = performance.now();

        if (
          video &&
          canvas &&
          this.labHandLandmarker &&
          this.labEstado === 'activo' &&
          video.videoWidth > 0 &&
          !video.paused &&
          this.labControl.esFrameNuevo(video, ahora)
        ) {
          sincronizarTamanoCanvas(canvas, video.videoWidth, video.videoHeight);
          const ctx = canvas.getContext('2d');
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          const marca = this.labControl.marcaDeTiempo(ahora);
          try {
            const results = this.labHandLandmarker.detectForVideo(video, marca);
            const detectadas = results?.landmarks?.length || 0;
            if (detectadas !== this.manosEnLaboratorio) {
              this.ngZone.run(() => {
                this.manosEnLaboratorio = detectadas;
              });
            }

            if (detectadas > 0) {
              this.labUltimaMano = marca;
              if (ctx) dibujarManos(ctx, canvas.width, canvas.height, results.landmarks, ESTILO_LAB);
            } else if (marca - this.labUltimaMano > PAUSA_REINICIO_LAB_MS && this.labBuffer.totalFrames) {
              // Las manos salieron de cuadro: termina la "toma" actual.
              this.labBuffer.reiniciar();
              this.ngZone.run(() => {
                this.prediccionesClasificador = [];
                this.mejorPrediccion = null;
              });
            }

            if (detectadas > 0 || this.labBuffer.totalFrames) {
              this.labBuffer.agregar(results, marca, video.videoWidth, video.videoHeight);
            }
            if (marca - this.labUltimaEvaluacion >= INTERVALO_EVALUACION_LAB_MS && this.labBuffer.framesConManos(1) >= 8) {
              this.labUltimaEvaluacion = marca;
              void this.evaluarBufferEnVivo();
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
    });
  }

  /** Compara los últimos 3 s de cámara contra el clasificador entrenado. */
  private async evaluarBufferEnVivo() {
    const captura = this.labBuffer.captura();
    const clf = await this.reconocedor.clasificador();
    const predicciones = clf ? clf.predecir(captura).slice(0, 3) : [];
    const top = predicciones[0];
    this.ngZone.run(() => {
      this.prediccionesClasificador = predicciones;
      this.mejorPrediccion = top
        ? { palabra: top.palabra, similitud: Math.round(top.probabilidad * 100), esCoincidente: top.probabilidad >= (clf?.umbralSugerido ?? 0.6) }
        : null;
    });
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
    await modal.onWillDismiss();
    this.cargarConteoMuestras();
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

  /** Atrás cierra primero el modal de nueva seña, si está abierto. */
  alPresionarAtras(): boolean {
    if (this.modalCrearAbierto) {
      if (!this.guardandoNueva) this.cerrarModalCrear();
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
