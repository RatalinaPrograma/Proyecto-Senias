import { Component, ElementRef, HostListener, Input, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  closeOutline,
  cameraReverseOutline,
  radioButtonOnOutline,
  refreshOutline,
  alertCircle,
  sparklesOutline,
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
  LARGO_MAXIMO_PARTICIPANTE,
  MediaPipeManosService,
  cambioDeManos,
  compactarCaptura,
  dibujarManos,
  limpiarParticipante,
  sincronizarTamanoCanvas,
} from '../../motor-senas';

addIcons({
  'close-outline': closeOutline,
  'camera-reverse-outline': cameraReverseOutline,
  'radio-button-on-outline': radioButtonOnOutline,
  'refresh-outline': refreshOutline,
  'alert-circle': alertCircle,
  'sparkles-outline': sparklesOutline,
  'layers-outline': layersOutline,
  'arrow-undo-outline': arrowUndoOutline,
});

/** Duración de la grabación de una seña estática: alcanza para sostener la pose. */
const DURACION_ESTATICA_MS = 1500;
/** Dónde se recuerda quién está grabando, para no escribirlo en cada seña. */
const CLAVE_PARTICIPANTE = 'signy.dataset.participante';
/**
 * Si entre dos frames de una grabación pasa más que esto, la cámara se
 * interrumpió (se cambió de cámara, se apagó la pantalla, la app pasó a
 * segundo plano): esa toma tendría un hueco y no sirve para entrenar. Un
 * celular lento procesa ~3-5 frames por segundo, muy por debajo de este límite.
 */
const HUECO_MAXIMO_MS = 1000;
/** Frames mínimos con las manos requeridas para que una grabación sirva (si no, la cámara las perdió). */
const FRAMES_MINIMOS_GRABACION = 5;

@Component({
  selector: 'app-sena-trainer-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './sena-trainer-modal.component.html',
  styleUrls: ['./sena-trainer-modal.component.scss'],
})
export class SenaTrainerModalComponent implements OnInit, OnDestroy {
  @Input() sena!: Sena;

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
  private readonly controlFrames = new ControlFramesVideo(45); // ~22 FPS máx para evitar saturación en móvil
  private readonly ngZone = inject(NgZone);

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
  /**
   * La última grabación cambió de cantidad de manos a mitad de camino (p. ej.
   * empieza con 1 y pasa a 2): ni la referencia rápida ni el tramo grabado
   * "Al dataset" la representan del todo bien. Ver {@link cambioDeManos}.
   */
  avisoSenaCompuesta: 1 | 2 | null = null;

  // Detección en vivo
  manosDetectadasCount = 0;
  /** Llevamos un rato viendo una cantidad de manos distinta a `manosRequeridas` mientras se espera para grabar. */
  avisoManosDistintas = false;
  private esperaManosDesde: number | null = null;
  /** Cuánto esperar viendo manos "de más/de menos" antes de avisar (evita avisos por un parpadeo de 1 frame). */
  private readonly ESPERA_AVISO_MANOS_MS = 600;

  // Dataset de entrenamiento
  /**
   * Apodo o iniciales de quien hace la seña frente a la cámara. Vacío = la
   * cuenta con que se entró. Sirve para que `ml/entrenar.py` mida el modelo
   * con personas que no vio al entrenar, aunque todas se graben con la misma
   * cuenta admin. Se recuerda entre señas y sesiones (en este dispositivo).
   */
  participante = '';
  readonly largoMaximoParticipante = LARGO_MAXIMO_PARTICIPANTE;
  muestrasEnDataset: number | null = null;
  guardandoMuestra = false;
  borrandoMuestra = false;
  /** Quién estaba frente a la cámara cuando empezó la grabación pendiente de guardar. */
  private participanteCaptura: string | null = null;
  private ultimaMarcaGrabacion = 0;
  /** Mantiene la pantalla encendida mientras la cámara está activa (una ráfaga dura ~40 s sin tocar nada). */
  private bloqueoPantalla: { release(): Promise<void>; addEventListener?: (t: string, f: () => void) => void } | null = null;
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
    this.participante = this.leerParticipanteGuardado();
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

  /**
   * Si la app pasa a segundo plano o se bloquea la pantalla a mitad de una
   * cuenta atrás o grabación, se cancela esa toma: si no, se guardaba (en
   * ráfaga, sola) una muestra con un hueco de tiempo. Al volver, se vuelve a
   * pedir que la pantalla no se apague.
   */
  @HostListener('document:visibilitychange')
  alCambiarVisibilidad() {
    if (document.hidden) {
      if (this.enRafaga || this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') {
        this.cancelarGrabacion();
        this.mensajeDataset = 'La grabación se detuvo porque la app quedó en segundo plano. Esa toma no se guardó: vuelve a grabarla.';
      }
    } else if (this.estadoCamara === 'activa') {
      void this.mantenerPantallaEncendida();
    }
  }

  private async mantenerPantallaEncendida() {
    try {
      const wakeLock = (navigator as any).wakeLock;
      if (!wakeLock || this.bloqueoPantalla) return;
      const bloqueo = await wakeLock.request('screen');
      this.bloqueoPantalla = bloqueo;
      bloqueo.addEventListener?.('release', () => {
        if (this.bloqueoPantalla === bloqueo) this.bloqueoPantalla = null;
      });
    } catch {
      // No soportado o denegado: la pantalla se apaga según el ajuste del celular.
    }
  }

  private liberarPantalla() {
    this.bloqueoPantalla?.release().catch(() => {});
    this.bloqueoPantalla = null;
  }

  get enRafaga(): boolean {
    return this.rafagaTotal > 0;
  }

  get puedeAgregarAlDataset(): boolean {
    return this.estadoGrabacion === 'grabado' && !!this.capturaReciente && !this.muestraRecienGuardada;
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
          video: {
            facingMode: this.facingMode,
            width: { ideal: 480, max: 640 },
            height: { ideal: 360, max: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facingMode }, audio: false });
      }
      this.stream = stream;
      this.estadoCamara = 'activa';
      void this.mantenerPantallaEncendida();

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
    this.liberarPantalla();
    this.estadoCamara = 'apagada';
  }

  alternarCamara() {
    // Cambiar de cámara a mitad de una toma la dejaría con un hueco (y mezclando dos cámaras).
    if (this.enRafaga || this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') return;
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.iniciarCamara();
  }

  // ---------- Bucle de detección ----------
  private iniciarBucle() {
    this.controlFrames.reiniciar();
    this.ngZone.runOutsideAngular(() => {
      const render = () => {
        const video = this.videoRef?.nativeElement;
        const canvas = this.canvasRef?.nativeElement;
        const ahora = performance.now();

        if (
          video &&
          canvas &&
          this.handLandmarker &&
          this.estadoCamara === 'activa' &&
          video.videoWidth > 0 &&
          !video.paused &&
          this.controlFrames.esFrameNuevo(video, ahora)
        ) {
          sincronizarTamanoCanvas(canvas, video.videoWidth, video.videoHeight);
          const ctx = canvas.getContext('2d');
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          const marca = this.controlFrames.marcaDeTiempo(ahora);
          try {
            const results = this.handLandmarker.detectForVideo(video, marca);
            const detectadas = results?.landmarks?.length || 0;
            if (detectadas !== this.manosDetectadasCount) {
              this.ngZone.run(() => {
                this.manosDetectadasCount = detectadas;
              });
            }
            if (ctx && results?.landmarks?.length) dibujarManos(ctx, canvas.width, canvas.height, results.landmarks);
            if (this.estadoGrabacion === 'grabando') {
              this.ngZone.run(() => {
                this.procesarFrame(results, marca, video.videoWidth, video.videoHeight);
              });
            }
          } catch (e) {
            console.warn('MediaPipe no pudo procesar el frame:', e);
          }
        }

        if (this.estadoCamara === 'activa') {
          this.animationFrameId = requestAnimationFrame(render);
        }
      };
      this.animationFrameId = requestAnimationFrame(render);
    });
  }

  private procesarFrame(results: any, marca: number, ancho: number, alto: number) {
    if (this.estadoGrabacion === 'grabando') {
      // La grabación arranca de verdad cuando se ven las manos requeridas.
      if (this.inicioGrabacion === null) {
        if (this.manosDetectadasCount < this.manosRequeridas) {
          // Se ve una cantidad de manos distinta (no 0) y no es lo configurado: puede ser
          // que esta seña empiece con menos manos de las que se eligió arriba.
          if (this.manosDetectadasCount > 0) {
            if (this.esperaManosDesde === null) this.esperaManosDesde = marca;
            this.avisoManosDistintas = marca - this.esperaManosDesde > this.ESPERA_AVISO_MANOS_MS;
          } else {
            this.esperaManosDesde = null;
            this.avisoManosDistintas = false;
          }
          return;
        }
        this.esperaManosDesde = null;
        this.avisoManosDistintas = false;
        this.inicioGrabacion = marca;
        this.esperandoManos = false;
        // La muestra es de quien está frente a la cámara AHORA, aunque después
        // se escriba el nombre de la siguiente persona antes de apretar "Al dataset".
        this.participanteCaptura = limpiarParticipante(this.participante);
      } else if (marca - this.ultimaMarcaGrabacion > HUECO_MAXIMO_MS) {
        this.cancelarGrabacion();
        this.mensajeDataset = 'La cámara se interrumpió durante la grabación. Esa toma no se guardó: vuelve a grabarla.';
        return;
      }
      this.ultimaMarcaGrabacion = marca;
      this.grabador.agregar(results, marca, ancho, alto);
      const duracion = this.tipoSena === 'estatica' ? DURACION_ESTATICA_MS : this.duracionDinamicaMs;
      const transcurrido = marca - this.inicioGrabacion;
      this.progresoGrabacion = Math.min(100, Math.round((transcurrido / duracion) * 100));
      if (transcurrido >= duracion) this.finalizarGrabacion();
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
    this.esperaManosDesde = null;
    this.avisoManosDistintas = false;
    this.avisoSenaCompuesta = null;
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
    if (this.grabador.framesConManos(this.manosRequeridas) < FRAMES_MINIMOS_GRABACION) {
      this.cancelarGrabacion('La cámara perdió tus manos durante la grabación. Vuelve a intentarlo con mejor luz.');
      return;
    }
    this.capturaReciente = captura;
    this.avisoSenaCompuesta = cambioDeManos(captura);
    this.muestraRecienGuardada = false;
    this.estadoGrabacion = 'grabado';
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

  /** Cancela una cuenta atrás o grabación en curso sin perder la grabación anterior (si había una). */
  cancelarGrabacion(mensaje?: string) {
    this.limpiarTemporizadores();
    this.terminarRafaga();
    this.progresoGrabacion = 0;
    this.esperandoManos = false;
    this.inicioGrabacion = null;
    this.estadoGrabacion = this.capturaReciente ? 'grabado' : 'inactivo';
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

  // ---------- Dataset de entrenamiento ----------
  private leerParticipanteGuardado(): string {
    try {
      return localStorage.getItem(CLAVE_PARTICIPANTE) ?? '';
    } catch {
      return ''; // almacenamiento bloqueado: se escribe cada vez
    }
  }

  /** Se llama al editar el campo "Persona": lo recuerda para las próximas señas. */
  recordarParticipante() {
    const limpio = limpiarParticipante(this.participante);
    try {
      if (limpio) localStorage.setItem(CLAVE_PARTICIPANTE, limpio);
      else localStorage.removeItem(CLAVE_PARTICIPANTE);
    } catch {
      // sin almacenamiento: no pasa nada, solo no se recuerda
    }
  }

  /**
   * Guarda la última grabación (cruda) como muestra para entrenar el
   * clasificador. Conviene grabar 10–20 por seña, ojalá con varias personas.
   */
  async agregarAlDataset(): Promise<boolean> {
    const captura = this.capturaReciente;
    if (!captura || this.guardandoMuestra) return false;
    this.guardandoMuestra = true;
    this.mensajeDataset = '';
    const participante = this.participanteCaptura;
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
        // Solo se manda si hay apodo: sin apodo funciona aunque falte la migración nueva.
        ...(participante ? { participante } : {}),
      });
      if (error) throw error;
      this.idMuestraReciente = data?.id ?? null;
      this.muestraRecienGuardada = true;
      if (this.muestrasEnDataset === null) {
        // No se pudo contar al abrir (red caída): se cuenta de nuevo en vez de mostrar "1 en total".
        await this.cargarConteoDataset();
      } else {
        this.muestrasEnDataset++;
      }
      const total = this.muestrasEnDataset === null ? '' : ` (${this.muestrasEnDataset} en total)`;
      this.mensajeDataset = `Muestra${participante ? ` de ${participante}` : ''} guardada${total}. Graba otra para seguir sumando.`;
      return true;
    } catch (e: any) {
      const mensaje: string = e?.message ?? '';
      const faltaColumna = e?.code === 'PGRST204'; // columna "participante" inexistente
      const faltaTabla = e?.code === '42P01' || e?.code === 'PGRST205' || /muestras_sena/.test(mensaje);
      this.mensajeDataset = faltaColumna
        ? 'Falta aplicar en Supabase la migración 20261013120000_participante_muestras_sena.sql (o deja vacío el campo "Persona").'
        : faltaTabla
          ? 'Falta aplicar en Supabase la migración 20261004120000_dataset_muestras_sena.sql.'
          : 'No se pudo guardar la muestra: ' + (mensaje || 'error desconocido');
      return false;
    } finally {
      this.guardandoMuestra = false;
    }
  }

  /** Borra la muestra que se acaba de agregar (por si la grabación salió mal). */
  async deshacerUltimaMuestra() {
    const id = this.idMuestraReciente;
    if (id === null || this.borrandoMuestra) return; // un doble toque no borra (ni descuenta) dos veces
    this.borrandoMuestra = true;
    try {
      const { error } = await this.supabaseService.eliminarMuestraSena(id);
      if (error) {
        this.mensajeDataset = 'No se pudo borrar la muestra: ' + error.message;
        return;
      }
      if (this.muestrasEnDataset !== null) this.muestrasEnDataset = Math.max(0, this.muestrasEnDataset - 1);
      // Con la red lenta, en una ráfaga pudo guardarse otra muestra mientras se borraba esta:
      // esa nueva sigue siendo la "reciente" y no se vuelve a ofrecer "Al dataset".
      if (this.idMuestraReciente === id) {
        this.idMuestraReciente = null;
        this.muestraRecienGuardada = false;
      }
      this.mensajeDataset = 'Se borró la muestra.';
    } finally {
      this.borrandoMuestra = false;
    }
  }

  /** La X: no cierra mientras se guarda o borra (el conteo del catálogo quedaba desactualizado). */
  async cerrar() {
    if (this.guardandoMuestra || this.borrandoMuestra) return;
    await this.cerrarModal();
  }

  private async cerrarModal() {
    this.detenerCamara();
    await this.modalCtrl.dismiss(this.sena);
  }

  /**
   * Atrás corta primero una cuenta atrás, grabación o ráfaga en curso; si no
   * hay nada en curso, cierra el modal (como la X). Mientras se guarda, espera.
   */
  alPresionarAtras(): boolean {
    if (this.guardandoMuestra || this.borrandoMuestra) return true;
    if (this.enRafaga || this.estadoGrabacion === 'cuenta_atras' || this.estadoGrabacion === 'grabando') {
      this.cancelarGrabacion();
      return true;
    }
    void this.cerrar();
    return true;
  }
}
