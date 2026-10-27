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
  bodyOutline,
  playCircleOutline,
  pauseCircleOutline,
  colorPaletteOutline,
  eyeOutline,
  eyeOffOutline,
  pawOutline,
  optionsOutline,
  happyOutline,
  statsChartOutline,
} from 'ionicons/icons';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from '../services/supabase';
import { BotonAtrasService } from '../services/boton-atras';
import { Nivel, Subnivel, Sena } from '../data/db-types';
import { SenaTrainerModalComponent } from '../shared/sena-trainer-modal/sena-trainer-modal.component';
import {
  CapturaCruda,
  ControlFramesVideo,
  GrabadorCaptura,
  MediaPipeManosService,
  Prediccion,
  ReconocedorSenasService,
  RenderizadorAvatar2D,
  TemaAvatar,
  ConfiguracionAvatar,
  CONFIG_AVATAR_PREDETERMINADA,
  construirDatasetExportable,
  dibujarManos,
  sincronizarTamanoCanvas,
} from '../motor-senas';
import { expandirCaptura } from '../motor-senas/dataset';
import { generarCaptura } from '../motor-senas/testing/manos-sinteticas';

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
  'body-outline': bodyOutline,
  'play-circle-outline': playCircleOutline,
  'pause-circle-outline': pauseCircleOutline,
  'color-palette-outline': colorPaletteOutline,
  'eye-outline': eyeOutline,
  'eye-off-outline': eyeOffOutline,
  'paw-outline': pawOutline,
  'options-outline': optionsOutline,
  'happy-outline': happyOutline,
  'stats-chart-outline': statsChartOutline,
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

  // Avatar 2D View
  @ViewChild('avatarCanvas', { static: false }) avatarCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('avatarVideo', { static: false }) avatarVideoRef?: ElementRef<HTMLVideoElement>;

  cargando = true;
  error: string | null = null;

  niveles: Nivel[] = [];
  subniveles: Subnivel[] = [];
  senas: Sena[] = [];

  // Filtros
  busqueda = '';
  filtroEstado: 'todas' | 'calibradas' | 'pendientes' = 'todas';
  filtroSubnivelId: number | 'todos' = 'todos';

  // Vista activa: 'lista' (catálogo), 'lab' (reconocimiento en vivo) o 'avatar' (Avatar 2D Plano)
  vistaModo: 'lista' | 'lab' | 'avatar' = 'lista';

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

  // ================= MÓDULO AVATAR 2D PLANO (CINTURA HACIA ARRIBA) =================
  readonly renderizadorAvatar = new RenderizadorAvatar2D();
  avatarConfig: ConfiguracionAvatar = { ...CONFIG_AVATAR_PREDETERMINADA };
  avatarFuente: 'camara' | 'dataset' | 'sintetica' = 'sintetica';
  avatarSinteticaActual: 'hola' | 'si' | 'l' | 'separar' = 'hola';
  avatarSenaIdSeleccionada: number | null = null;
  avatarMuestraCaptura: CapturaCruda | null = null;
  avatarCargandoMuestra = false;
  avatarMostrarVideoFondo = false;
  avatarPausado = false;
  avatarFPS = 0;
  avatarMensaje = '';

  private avatarRafId = 0;
  private avatarStream: MediaStream | null = null;
  private avatarInicioPlayback = 0;
  private avatarFramesRenderizados = 0;
  private avatarUltimoCalculoFPS = 0;
  private readonly avatarControl = new ControlFramesVideo(30);

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
    this.detenerLaboratorioReconocimiento();
    this.detenerAvatar();
  }

  private async cargarClasificadorConocidos() {
    const clf = await this.reconocedor.clasificador();
    this.clasificadorConocidos = new Set(clf?.clases.map((c) => c.senaId) ?? []);
  }

  cambiarVista(modo: 'lista' | 'lab' | 'avatar') {
    if (this.vistaModo === 'lab' && modo !== 'lab') {
      this.detenerLaboratorioReconocimiento();
    }
    if (this.vistaModo === 'avatar' && modo !== 'avatar') {
      this.detenerAvatar();
    }

    this.vistaModo = modo;

    if (modo === 'lab') {
      setTimeout(() => this.iniciarLaboratorioReconocimiento(), 50);
    } else if (modo === 'avatar') {
      setTimeout(() => this.iniciarModuloAvatar(), 50);
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

  // ================= MÓDULO AVATAR 2D PLANO (CINTURA HACIA ARRIBA) =================
  async iniciarModuloAvatar() {
    this.renderizadorAvatar.actualizarConfig(this.avatarConfig);
    this.avatarInicioPlayback = performance.now();
    this.avatarFramesRenderizados = 0;
    this.avatarUltimoCalculoFPS = performance.now();

    if (this.avatarFuente === 'camara') {
      await this.iniciarCamaraAvatar();
    } else if (this.avatarFuente === 'dataset') {
      if (!this.avatarSenaIdSeleccionada) {
        const candidata = this.senas.find((s) => this.muestrasDe(s.id) > 0) || this.senas[0];
        if (candidata) {
          this.avatarSenaIdSeleccionada = candidata.id;
        }
      }
      if (this.avatarSenaIdSeleccionada) {
        await this.cargarMuestraParaAvatar(this.avatarSenaIdSeleccionada);
      }
    }

    this.bucleAvatar();
  }

  detenerAvatar() {
    if (this.avatarRafId) {
      cancelAnimationFrame(this.avatarRafId);
      this.avatarRafId = 0;
    }
    if (this.avatarStream) {
      this.avatarStream.getTracks().forEach((t) => t.stop());
      this.avatarStream = null;
    }
    this.renderizadorAvatar.reiniciar();
  }

  cambiarTemaAvatar(nuevoTema: TemaAvatar) {
    this.avatarConfig.tema = nuevoTema;
    this.renderizadorAvatar.actualizarConfig({ tema: nuevoTema });
  }

  actualizarAjustesAvatar() {
    this.renderizadorAvatar.actualizarConfig(this.avatarConfig);
  }

  async cambiarFuenteAvatar(fuente: 'camara' | 'dataset' | 'sintetica') {
    this.avatarFuente = fuente;
    this.detenerAvatar();
    await this.iniciarModuloAvatar();
  }

  alternarPausaAvatar() {
    this.avatarPausado = !this.avatarPausado;
    if (!this.avatarPausado) {
      this.avatarInicioPlayback = performance.now();
    }
  }

  async seleccionarSenaDatasetAvatar(valor: number | Sena | null) {
    const id = typeof valor === 'object' && valor !== null ? valor.id : Number(valor);
    if (!id || !Number.isFinite(id)) return;
    this.avatarSenaIdSeleccionada = id;
    await this.cargarMuestraParaAvatar(id);
  }

  private async cargarMuestraParaAvatar(senaId: number) {
    const idNum = Number(senaId);
    if (!idNum || !Number.isFinite(idNum)) {
      this.avatarMuestraCaptura = null;
      this.avatarMensaje = 'Selecciona una seña válida de la lista.';
      return;
    }

    this.avatarCargandoMuestra = true;
    this.avatarMensaje = 'Cargando muestra del dataset…';
    try {
      const { data, error } = await this.supabaseService.supabase
        .from('muestras_sena')
        .select('*')
        .eq('sena_id', idNum)
        .order('id', { ascending: false })
        .limit(5);

      if (error) throw error;
      const filas = (data ?? []).filter((f: any) => f && f.captura);
      if (filas.length > 0) {
        const expandidas = filas.map((f: any) => expandirCaptura(f.captura));
        // Preferir la muestra con mayor cantidad de cuadros con manos detectadas
        expandidas.sort(
          (a, b) =>
            b.frames.filter((fr) => fr.manos && fr.manos.length > 0).length -
            a.frames.filter((fr) => fr.manos && fr.manos.length > 0).length
        );
        this.avatarMuestraCaptura = expandidas[0];
        this.avatarInicioPlayback = performance.now();
        this.avatarMensaje = `Reproduciendo muestra real (${this.avatarMuestraCaptura.frames.length} cuadros grabados)`;
      } else {
        this.avatarMuestraCaptura = null;
        this.avatarMensaje = 'Esta seña no tiene muestras grabadas todavía.';
      }
    } catch (e: any) {
      this.avatarMensaje = 'Error al cargar muestra: ' + (e?.message || 'Error de conexión');
    } finally {
      this.avatarCargandoMuestra = false;
    }
  }

  private async iniciarCamaraAvatar() {
    try {
      this.labHandLandmarker = await this.mediaPipe.obtener();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480, max: 640 }, height: { ideal: 360, max: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      this.avatarStream = stream;

      setTimeout(async () => {
        const video = this.avatarVideoRef?.nativeElement;
        if (video && this.avatarStream) {
          video.srcObject = this.avatarStream;
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => {});
        }
      }, 100);
    } catch (e) {
      console.warn('Error al iniciar cámara de avatar:', e);
    }
  }

  private bucleAvatar() {
    this.ngZone.runOutsideAngular(() => {
      const render = () => {
        if (this.vistaModo !== 'avatar') return;

        const canvas = this.avatarCanvasRef?.nativeElement;
        const ahora = performance.now();

        // Cálculo de FPS
        this.avatarFramesRenderizados++;
        if (ahora - this.avatarUltimoCalculoFPS >= 500) {
          const fps = Math.round((this.avatarFramesRenderizados * 1000) / (ahora - this.avatarUltimoCalculoFPS));
          this.ngZone.run(() => {
            this.avatarFPS = fps;
          });
          this.avatarFramesRenderizados = 0;
          this.avatarUltimoCalculoFPS = ahora;
        }

        if (canvas) {
          const ancho = canvas.clientWidth || 400;
          const alto = canvas.clientHeight || 400;
          sincronizarTamanoCanvas(canvas, ancho, alto);

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, ancho, alto);

            let manosARenderizar: { x: number; y: number; z?: number }[][] = [];

            if (this.avatarFuente === 'camara') {
              const video = this.avatarVideoRef?.nativeElement;
              if (video && this.labHandLandmarker && video.videoWidth > 0 && !video.paused) {
                const results = this.labHandLandmarker.detectForVideo(video, ahora);
                // Espejar X en cámara frontal para que el personaje actúe como espejo frente al usuario
                manosARenderizar = (results?.landmarks || []).map((mano) =>
                  mano.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }))
                );
              }
            } else if (this.avatarFuente === 'dataset' && this.avatarMuestraCaptura) {
              manosARenderizar = this.obtenerFrameMuestra(this.avatarMuestraCaptura, ahora);
            } else if (this.avatarFuente === 'sintetica') {
              manosARenderizar = this.obtenerFrameSintetico(this.avatarSinteticaActual, ahora);
            }

            this.renderizadorAvatar.renderizar(ctx, ancho, alto, manosARenderizar);
          }
        }

        this.avatarRafId = requestAnimationFrame(render);
      };

      this.avatarRafId = requestAnimationFrame(render);
    });
  }

  /** Interpola cíclicamente los cuadros grabados de la muestra seleccionada a 60 FPS */
  private obtenerFrameMuestra(captura: CapturaCruda, ahora: number): { x: number; y: number; z?: number }[][] {
    // Filtrar cuadros que tengan al menos una mano para evitar parpadeos vacíos al inicio/fin de la grabación
    const framesConManos = captura.frames.filter((f) => f.manos && f.manos.length > 0);
    const frames = framesConManos.length > 0 ? framesConManos : captura.frames;
    if (!frames.length) return [];

    const tInicio = frames[0].t || 0;
    const duracionTotal = Math.max(200, (frames[frames.length - 1].t || 1000) - tInicio);
    const tiempoRelativo = ((ahora - this.avatarInicioPlayback) % (duracionTotal + 550)) + tInicio;

    if (tiempoRelativo > tInicio + duracionTotal) {
      return (frames[frames.length - 1].manos || []) as any;
    }

    let idxA = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].t <= tiempoRelativo) idxA = i;
      else break;
    }

    const frameA = frames[idxA];
    const frameB = frames[Math.min(frames.length - 1, idxA + 1)];

    // Si ambos cuadros consecutivos tienen el mismo número de manos, interpolar linealmente entre ellos
    if (frameA !== frameB && frameB.t > frameA.t && frameA.manos.length === frameB.manos.length) {
      const f = Math.max(0, Math.min(1, (tiempoRelativo - frameA.t) / (frameB.t - frameA.t)));
      return frameA.manos.map((manoA, idxMano) => {
        const manoB = frameB.manos[idxMano];
        if (!manoB || manoB.length !== manoA.length) return manoA;
        return manoA.map((pA, i) => ({
          x: pA.x + (manoB[i].x - pA.x) * f,
          y: pA.y + (manoB[i].y - pA.y) * f,
          z: (pA.z ?? 0) + ((manoB[i].z ?? 0) - (pA.z ?? 0)) * f,
        }));
      });
    }

    return (frameA.manos || []) as any;
  }

  /** Genera animación cíclica a partir del modelo cinemático sintético */
  private obtenerFrameSintetico(tipo: 'hola' | 'si' | 'l' | 'separar', ahora: number): { x: number; y: number; z?: number }[][] {
    const captura = generarCaptura(tipo.toUpperCase() as any, { semilla: 7 });
    return this.obtenerFrameMuestra(captura, ahora);
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

  irADashboard() {
    this.router.navigate(['/admin/dashboard']);
  }
}
