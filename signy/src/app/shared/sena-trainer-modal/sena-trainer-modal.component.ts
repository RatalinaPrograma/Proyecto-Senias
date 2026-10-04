import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild, inject } from '@angular/core';
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
  layersOutline,
  arrowUndoOutline,
} from 'ionicons/icons';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { Sena } from '../../data/db-types';
import { SupabaseService } from '../../services/supabase';
import { BotonAtrasService } from '../../services/boton-atras';
import {
  CapturaCruda,
  ControlFramesVideo,
  GrabadorCaptura,
  MediaPipeManosService,
  ModeloReferenciaSena,
  ResultadoEvaluacion,
  VERSION_MOTOR,
  compactarCaptura,
  construirModeloReferencia,
  dibujarManos,
  evaluarCaptura,
  modeloDeSena,
} from '../../motor-senas';

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
  'layers-outline': layersOutline,
  'arrow-undo-outline': arrowUndoOutline,
});

/** Duración de la grabación de una seña estática: alcanza para sostener la pose. */
const DURACION_ESTATICA_MS = 1500;
/** Cada cuánto se recalcula la prueba en vivo (no hace falta en cada frame). */
const INTERVALO_PRUEBA_MS = 200;

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
  private readonly controlFrames = new ControlFramesVideo();

  // Configuración de la seña
  tipoSena: 'dinamica' | 'estatica' = 'dinamica';
  manosRequeridas: 1 | 2 = 1;
  /** Duración de la grabación de una seña dinámica (el sobrante quieto se recorta solo). */
  duracionDinamicaMs = 3000;
  readonly duracionesDinamica = [2000, 3000, 4000];

  // Estado de grabación
  estadoGrabacion: 'inactivo' | 'cuenta_atras' | 'grabando' | 'grabado' = 'inactivo';
  cuentaAtras = 3;
  progresoGrabacion = 0;
  /** true mientras se graba pero todavía no aparecen las manos requeridas. */
  esperandoManos = false;
  private intervaloCuentaAtras: ReturnType<typeof setInterval> | null = null;
  private timeoutSeguridadGrabacion: ReturnType<typeof setTimeout> | null = null;
  private readonly TIEMPO_MAXIMO_ESPERA_MS = 15000;
  private readonly grabador = new GrabadorCaptura();
  private inicioGrabacion: number | null = null;
  /** Captura cruda de la última grabación (lo que se guarda en el dataset). */
  private capturaReciente: CapturaCruda | null = null;
  /** Modelo construido con la última grabación, todavía sin guardar. */
  modeloNuevo: ModeloReferenciaSena | null = null;

  // Detección en vivo
  manosDetectadasCount = 0;

  // Prueba / validación en vivo
  modoPruebaActivo = false;
  resultadoEnVivo: ResultadoEvaluacion | null = null;
  private readonly bufferPrueba = new GrabadorCaptura(3000);
  private ultimaPrueba = 0;

  // Guardado
  guardando = false;
  modeloExistente: ModeloReferenciaSena | null = null;
  /** true si el modelo guardado en Supabase es de una versión anterior del formato. */
  modeloDesactualizado = false;

  // Dataset de entrenamiento
  muestrasEnDataset: number | null = null;
  guardandoMuestra = false;
  mensajeDataset = '';
  muestraRecienGuardada = false;
  private idMuestraReciente: number | null = null;

  /**
   * Modo ráfaga: graba varias muestras seguidas y cada una se guarda sola en
   * el dataset, con una cuenta atrás entre una y otra para volver a la
   * posición inicial. Sirve para juntar 10–20 muestras por seña rápido.
   */
  readonly tamanoRafaga = 5;
  rafagaTotal = 0;
  rafagaHechas = 0;
  private timeoutRafaga: ReturnType<typeof setTimeout> | null = null;

  /** Botón atrás del teléfono mientras el modal está abierto (se abre con backdropDismiss: false). */
  private readonly atras = inject(BotonAtrasService).paraPantalla(() => this.alPresionarAtras());

  constructor(
    private modalCtrl: ModalController,
    private supabaseService: SupabaseService,
    private mediaPipe: MediaPipeManosService
  ) {}

  async ngOnInit() {
    this.atras.activar();
    this.verificarModeloExistente();
    this.cargarConteoDataset();
    await this.inicializarMediaPipe();
  }

  ngOnDestroy() {
    this.atras.desactivar();
    // El HandLandmarker es compartido (MediaPipeManosService): no se cierra acá.
    this.detenerCamara();
    this.limpiarTemporizadores();
    this.terminarRafaga();
  }

  get enRafaga(): boolean {
    return this.rafagaTotal > 0;
  }

  get modeloVigente(): ModeloReferenciaSena | null {
    return this.modeloNuevo ?? this.modeloExistente;
  }

  get puedeAgregarAlDataset(): boolean {
    return this.estadoGrabacion === 'grabado' && !!this.capturaReciente && !this.muestraRecienGuardada;
  }

  private verificarModeloExistente() {
    const crudo = this.sena?.landmarks_referencia as { version?: number } | null;
    const mod = modeloDeSena(this.sena);
    if (mod) {
      this.modeloExistente = mod;
      this.tipoSena = mod.tipo || 'dinamica';
      this.manosRequeridas = mod.manosRequeridas || 1;
      this.estadoGrabacion = 'grabado';
      this.modeloDesactualizado = (mod.version ?? 1) < VERSION_MOTOR;
    } else if (crudo) {
      // v1 u otro formato que ya no se puede comparar.
      this.modeloDesactualizado = true;
    }
  }

  private async cargarConteoDataset() {
    try {
      this.muestrasEnDataset = (await this.supabaseService.contarMuestrasPorSena()).get(this.sena.id) ?? 0;
    } catch {
      this.muestrasEnDataset = null; // migración sin aplicar o sin conexión: el botón igual avisa al intentar
    }
  }

  // ---------- Inicialización MediaPipe ----------
  async inicializarMediaPipe() {
    this.estadoModelo = 'descargando';
    this.mensajeError = '';
    try {
      this.handLandmarker = await this.mediaPipe.obtener();
      this.estadoModelo = 'listo';
      await this.iniciarCamara();
    } catch (e: any) {
      console.error('Error al inicializar MediaPipe:', e);
      this.estadoModelo = 'error';
      this.mensajeError = e?.message || 'No se pudo descargar el modelo de MediaPipe. Revisa tu conexión a internet.';
    }
  }

  // ---------- Cámara ----------
  async iniciarCamara() {
    if (this.estadoModelo !== 'listo') return;
    this.detenerCamara();
    this.estadoCamara = 'iniciando';

    if (!navigator.mediaDevices?.getUserMedia) {
      this.estadoCamara = 'denegada';
      this.mensajeError = 'La cámara no está disponible en este entorno (se necesita HTTPS o localhost).';
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facingMode }, audio: false });
      }
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

  // ---------- Bucle de detección ----------
  private iniciarBucle() {
    this.controlFrames.reiniciar();
    const render = () => {
      const video = this.videoRef?.nativeElement;
      const canvas = this.canvasRef?.nativeElement;

      if (video && canvas && this.handLandmarker && this.estadoCamara === 'activa' && video.videoWidth > 0 && !video.paused && this.controlFrames.esFrameNuevo(video)) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        const marca = this.controlFrames.marcaDeTiempo();
        try {
          const results = this.handLandmarker.detectForVideo(video, marca);
          this.manosDetectadasCount = results?.landmarks?.length || 0;
          if (ctx && results?.landmarks?.length) dibujarManos(ctx, canvas.width, canvas.height, results.landmarks);
          this.procesarFrame(results, marca, video.videoWidth, video.videoHeight);
        } catch (e) {
          console.warn('MediaPipe no pudo procesar el frame:', e);
        }
      }

      if (this.estadoCamara === 'activa') {
        this.animationFrameId = requestAnimationFrame(render);
      }
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  private procesarFrame(results: any, marca: number, ancho: number, alto: number) {
    if (this.estadoGrabacion === 'grabando') {
      // La grabación arranca de verdad cuando se ven las manos requeridas.
      if (this.inicioGrabacion === null) {
        if (this.manosDetectadasCount < this.manosRequeridas) return;
        this.inicioGrabacion = marca;
        this.esperandoManos = false;
      }
      this.grabador.agregar(results, marca, ancho, alto);
      const duracion = this.tipoSena === 'estatica' ? DURACION_ESTATICA_MS : this.duracionDinamicaMs;
      const transcurrido = marca - this.inicioGrabacion;
      this.progresoGrabacion = Math.min(100, Math.round((transcurrido / duracion) * 100));
      if (transcurrido >= duracion) this.finalizarGrabacion();
      return;
    }

    if (this.modoPruebaActivo && this.modeloVigente) {
      this.bufferPrueba.agregar(results, marca, ancho, alto);
      if (marca - this.ultimaPrueba >= INTERVALO_PRUEBA_MS) {
        this.ultimaPrueba = marca;
        const r = evaluarCaptura(this.modeloVigente, this.bufferPrueba.captura());
        this.resultadoEnVivo = r.motivo ? null : r;
      }
    }
  }

  // ---------- Control de grabación ----------
  /**
   * La cuenta atrás de 3 s es el momento para acomodarse frente a la
   * cámara (con 2 manos no queda ninguna libre para apretar el botón). La
   * grabación empieza sola cuando se detectan las manos; si nunca
   * aparecen, se cancela a los 15 s en vez de quedar colgada.
   */
  iniciarCuentaAtras() {
    if (this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') return;

    this.modoPruebaActivo = false;
    this.resultadoEnVivo = null;
    this.progresoGrabacion = 0;
    this.cuentaAtras = 3;
    this.mensajeDataset = '';
    this.estadoGrabacion = 'cuenta_atras';

    this.intervaloCuentaAtras = setInterval(() => {
      this.cuentaAtras--;
      if (this.cuentaAtras <= 0) {
        this.limpiarTemporizadores();
        this.comenzarGrabacionReal();
      }
    }, 1000);
  }

  private comenzarGrabacionReal() {
    this.grabador.reiniciar();
    this.inicioGrabacion = null;
    this.esperandoManos = true;
    this.estadoGrabacion = 'grabando';
    this.timeoutSeguridadGrabacion = setTimeout(() => {
      if (this.estadoGrabacion === 'grabando' && this.inicioGrabacion === null) {
        this.cancelarGrabacion(
          'No alcanzamos a detectar bien tus manos. Revisa la iluminación y que entren en el cuadro, y vuelve a intentarlo.'
        );
      }
    }, this.TIEMPO_MAXIMO_ESPERA_MS);
  }

  private finalizarGrabacion() {
    this.limpiarTemporizadores();
    const captura = this.grabador.captura();
    const modelo = construirModeloReferencia(captura, {
      palabra: this.sena.palabra,
      tipo: this.tipoSena,
      manosRequeridas: this.manosRequeridas,
    });
    if (!modelo) {
      this.cancelarGrabacion('La cámara perdió tus manos durante la grabación. Vuelve a intentarlo con mejor luz.');
      return;
    }
    this.capturaReciente = captura;
    this.modeloNuevo = modelo;
    this.muestraRecienGuardada = false;
    this.estadoGrabacion = 'grabado';
    this.activarModoPrueba();
    if (this.enRafaga) this.continuarRafaga();
  }

  // ---------- Ráfaga de muestras para el dataset ----------
  iniciarRafaga() {
    if (this.estadoCamara !== 'activa' || this.enRafaga) return;
    if (this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') return;
    this.rafagaTotal = this.tamanoRafaga;
    this.rafagaHechas = 0;
    this.iniciarCuentaAtras();
  }

  private async continuarRafaga() {
    const guardada = await this.agregarAlDataset();
    if (!guardada) {
      this.terminarRafaga(); // mensajeDataset ya explica qué falló
      return;
    }
    this.rafagaHechas++;
    if (this.rafagaHechas >= this.rafagaTotal) {
      this.mensajeDataset = `Ráfaga lista: ${this.rafagaHechas} muestras guardadas (${this.muestrasEnDataset} en total).`;
      this.terminarRafaga();
      return;
    }
    this.mensajeDataset = `Muestra ${this.rafagaHechas} de ${this.rafagaTotal} guardada. Vuelve a la posición inicial…`;
    this.timeoutRafaga = setTimeout(() => {
      this.timeoutRafaga = null;
      if (this.enRafaga) this.iniciarCuentaAtras();
    }, 1200);
  }

  terminarRafaga() {
    if (this.timeoutRafaga) {
      clearTimeout(this.timeoutRafaga);
      this.timeoutRafaga = null;
    }
    this.rafagaTotal = 0;
    this.rafagaHechas = 0;
  }

  /** Cancela una cuenta atrás o grabación en curso sin perder el modelo que ya había. */
  cancelarGrabacion(mensaje?: string) {
    this.limpiarTemporizadores();
    this.terminarRafaga();
    this.progresoGrabacion = 0;
    this.esperandoManos = false;
    this.inicioGrabacion = null;
    this.estadoGrabacion = this.modeloVigente ? 'grabado' : 'inactivo';
    if (mensaje) alert(mensaje);
  }

  private limpiarTemporizadores() {
    if (this.intervaloCuentaAtras) {
      clearInterval(this.intervaloCuentaAtras);
      this.intervaloCuentaAtras = null;
    }
    if (this.timeoutSeguridadGrabacion) {
      clearTimeout(this.timeoutSeguridadGrabacion);
      this.timeoutSeguridadGrabacion = null;
    }
  }

  activarModoPrueba() {
    this.modoPruebaActivo = true;
    this.bufferPrueba.reiniciar();
    this.resultadoEnVivo = null;
    this.ultimaPrueba = 0;
  }

  // ---------- Guardar referencia ----------
  async guardarModelo() {
    const modelo = this.modeloNuevo;
    if (!modelo) return;
    this.guardando = true;
    try {
      const { error } = await this.supabaseService.actualizarSena(this.sena.id, { landmarks_referencia: modelo });
      if (error) throw error;

      this.sena.landmarks_referencia = modelo;
      this.modeloExistente = modelo;
      this.modeloNuevo = null;
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

  // ---------- Dataset de entrenamiento ----------
  /**
   * Guarda la última grabación (cruda) como muestra para entrenar el
   * clasificador. Conviene grabar 10–20 por seña, ojalá con varias personas.
   */
  async agregarAlDataset(): Promise<boolean> {
    const captura = this.capturaReciente;
    if (!captura || this.guardandoMuestra) return false;
    this.guardandoMuestra = true;
    this.mensajeDataset = '';
    try {
      const { data, error } = await this.supabaseService.agregarMuestraSena({
        sena_id: this.sena.id,
        tipo: this.tipoSena,
        manos_requeridas: this.manosRequeridas,
        ancho: captura.ancho,
        alto: captura.alto,
        duracion_ms: Math.round(captura.frames.length ? captura.frames[captura.frames.length - 1].t : 0),
        total_frames: captura.frames.length,
        captura: compactarCaptura(captura),
      });
      if (error) throw error;
      this.idMuestraReciente = data?.id ?? null;
      this.muestraRecienGuardada = true;
      this.muestrasEnDataset = (this.muestrasEnDataset ?? 0) + 1;
      this.mensajeDataset = `Muestra guardada (${this.muestrasEnDataset} en total). Graba otra para seguir sumando.`;
      return true;
    } catch (e: any) {
      const faltaTabla = e?.code === '42P01' || e?.code === 'PGRST205' || /muestras_sena/.test(e?.message ?? '');
      this.mensajeDataset = faltaTabla
        ? 'Falta aplicar en Supabase la migración 20261004120000_dataset_muestras_sena.sql.'
        : 'No se pudo guardar la muestra: ' + (e?.message || 'error desconocido');
      return false;
    } finally {
      this.guardandoMuestra = false;
    }
  }

  /** Borra la muestra que se acaba de agregar (por si la grabación salió mal). */
  async deshacerUltimaMuestra() {
    if (this.idMuestraReciente === null) return;
    const { error } = await this.supabaseService.eliminarMuestraSena(this.idMuestraReciente);
    if (error) {
      this.mensajeDataset = 'No se pudo borrar la muestra: ' + error.message;
      return;
    }
    this.idMuestraReciente = null;
    this.muestrasEnDataset = Math.max(0, (this.muestrasEnDataset ?? 1) - 1);
    this.muestraRecienGuardada = false;
    this.mensajeDataset = 'Se borró la muestra.';
  }

  async cerrar() {
    this.detenerCamara();
    await this.modalCtrl.dismiss(this.sena);
  }

  /**
   * Atrás corta primero una cuenta atrás, grabación o ráfaga en curso; si no
   * hay nada en curso, cierra el modal (como la X). Mientras se guarda, espera.
   */
  alPresionarAtras(): boolean {
    if (this.guardando || this.guardandoMuestra) return true;
    if (this.enRafaga || this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') {
      this.cancelarGrabacion();
      return true;
    }
    void this.cerrar();
    return true;
  }
}
