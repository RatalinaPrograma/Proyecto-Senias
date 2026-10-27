import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CachedSrcDirective } from '../shared/cached-src.directive';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService, ArchivoBucket } from '../services/supabase';
import { BotonAtrasService } from '../services/boton-atras';
import { Nivel, Subnivel, Sena } from '../data/db-types';
import { addIcons } from 'ionicons';
import { esVideoMp4 } from '../shared/media-utils';
import {
  arrowBack,
  add,
  createOutline,
  trashOutline,
  saveOutline,
  closeOutline,
  cloudUploadOutline,
  linkOutline,
  chevronForward,
  imageOutline,
  layersOutline,
  alertCircleOutline,
  sparklesOutline,
  videocamOutline,
  hardwareChipOutline,
  folderOpenOutline,
  refreshOutline,
  checkmarkCircle,
  searchOutline,
  filmOutline,
  statsChartOutline,
} from 'ionicons/icons';

addIcons({
  'arrow-back': arrowBack,
  add,
  'create-outline': createOutline,
  'trash-outline': trashOutline,
  'save-outline': saveOutline,
  'close-outline': closeOutline,
  'cloud-upload-outline': cloudUploadOutline,
  'link-outline': linkOutline,
  'chevron-forward': chevronForward,
  'image-outline': imageOutline,
  'layers-outline': layersOutline,
  'alert-circle-outline': alertCircleOutline,
  'sparkles-outline': sparklesOutline,
  'videocam-outline': videocamOutline,
  'hardware-chip-outline': hardwareChipOutline,
  'folder-open-outline': folderOpenOutline,
  'refresh-outline': refreshOutline,
  'checkmark-circle': checkmarkCircle,
  'search-outline': searchOutline,
  'film-outline': filmOutline,
  'stats-chart-outline': statsChartOutline,
});

const TIPOS_MEDIA_PERMITIDOS = ['image/gif', 'image/webp', 'image/png', 'image/jpeg', 'video/mp4', 'video/webm', 'video/quicktime'];
const TAMANO_MAX_ARCHIVO = 25 * 1024 * 1024; // 25 MB

const SUGERENCIAS_ICONO = [
  '👋', '🤝', '❤️', '😊', '😢', '😡',
  '👨‍👩‍👧', '👶', '🏠',
  '🐶', '🐱', '🐦', '🐟',
  '🍎', '🍞', '🥛', '💧',
  '🔴', '🔵', '🟢', '🟡',
  '☀️', '🌙', '⭐', '🌳',
  '🚗', '🚌', '✈️',
  '📚', '✏️', '🏫',
];

type Vista = 'niveles' | 'subniveles' | 'senas';
type ModoMedia = 'bucket' | 'subir' | 'url';
type FiltroBucket = 'todos' | 'disponibles' | 'mp4';

const COLOR_DEFECTO = '#2CA6A4';
const COLOR_OSCURO_DEFECTO = '#1F7E7C';

@Component({
  selector: 'app-admin-vocabulario',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, CachedSrcDirective],
  templateUrl: './admin-vocabulario.page.html',
  styleUrls: ['./admin-vocabulario.page.scss'],
})
export class AdminVocabularioPage implements OnInit {
  vista: Vista = 'niveles';
  nivelActivo: Nivel | null = null;
  subnivelActivo: Subnivel | null = null;

  cargando = true;
  error: string | null = null;

  niveles: Nivel[] = [];
  subniveles: Subnivel[] = [];
  senas: Sena[] = [];

  private subnivelesPorNivel = new Map<number, Subnivel[]>();
  private senasPorSubnivel = new Map<number, Sena[]>();

  buscarSena = '';
  senasFiltradas: Sena[] = [];

  // ---- formulario de nivel ----
  formNivelAbierto = false;
  editandoNivelId: number | null = null;
  formNivel: Partial<Nivel> = {};

  // ---- formulario de subnivel ----
  formSubnivelAbierto = false;
  editandoSubnivelId: number | null = null;
  formSubnivel: Partial<Subnivel> = {};

  // ---- formulario de seña ----
  formSenaAbierto = false;
  editandoSenaId: number | null = null;
  formSena: Partial<Sena> = {};
  modoMedia: ModoMedia = 'bucket';
  archivoSeleccionado: File | null = null;
  archivosSubidaMultiple: File[] = [];
  subiendoArchivo = false;
  progresoSubida = '';
  sugerenciasIcono = SUGERENCIAS_ICONO;

  // ---- Explorador visual del Bucket ----
  archivosBucket: ArchivoBucket[] = [];
  archivosBucketFiltrados: ArchivoBucket[] = [];
  cargandoBucket = false;
  buscarArchivoBucket = '';
  filtroBucket: FiltroBucket = 'todos';
  private mapaUrlASena = new Map<string, Sena>();

  guardando = false;
  errorForm: string | null = null;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router,
    private modalCtrl: ModalController
  ) {}

  irAAIStudio() {
    this.router.navigate(['/admin/ai-studio']);
  }

  irADashboard() {
    this.router.navigate(['/admin/dashboard']);
  }

  async ngOnInit() {
    await this.cargarTodo();
  }

  async cargarTodo() {
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
      this.reindexar();
      this.filtrarSenas();
      this.filtrarArchivosBucket();
    } catch (e: any) {
      this.error = e?.message ?? 'No se pudo cargar el vocabulario.';
    } finally {
      this.cargando = false;
    }
  }

  private reindexar() {
    this.subnivelesPorNivel.clear();
    for (const s of this.subniveles) {
      const arr = this.subnivelesPorNivel.get(s.nivel_id);
      if (arr) arr.push(s); else this.subnivelesPorNivel.set(s.nivel_id, [s]);
    }
    this.senasPorSubnivel.clear();
    this.mapaUrlASena.clear();
    for (const s of this.senas) {
      const arr = this.senasPorSubnivel.get(s.subnivel_id);
      if (arr) arr.push(s); else this.senasPorSubnivel.set(s.subnivel_id, [s]);
      if (s.video_url) {
        this.mapaUrlASena.set(s.video_url.trim(), s);
      }
    }
  }

  filtrarSenas() {
    const base = this.subnivelActivo ? this.senasDe(this.subnivelActivo.id) : [];
    const q = this.buscarSena.trim().toLowerCase();
    this.senasFiltradas = q ? base.filter(s => s.palabra.toLowerCase().includes(q)) : base;
  }

  trackById = (_: number, item: { id: number }) => item.id;
  trackByUrl = (_: number, item: ArchivoBucket) => item.url;

  // ==================== NAVEGACIÓN (breadcrumb) ====================
  volver() {
    if (this.vista === 'senas') {
      this.volverASubniveles();
    } else if (this.vista === 'subniveles') {
      this.volverANiveles();
    } else {
      this.router.navigate(['/home']);
    }
  }

  private readonly atras = inject(BotonAtrasService).paraPantalla(() => this.alPresionarAtras());

  ionViewWillEnter() {
    this.atras.activar();
  }

  ionViewWillLeave() {
    this.atras.desactivar();
  }

  alPresionarAtras(): boolean {
    if (this.guardando) return true;
    if (this.formNivelAbierto || this.formSubnivelAbierto || this.formSenaAbierto) {
      this.cancelarFormulario();
      return true;
    }
    if (this.vista !== 'niveles') {
      this.volver();
      return true;
    }
    return false;
  }

  abrirNivel(n: Nivel) {
    this.nivelActivo = n;
    this.vista = 'subniveles';
    this.cerrarFormularios();
  }

  abrirSubnivel(s: Subnivel) {
    this.subnivelActivo = s;
    this.vista = 'senas';
    this.buscarSena = '';
    this.filtrarSenas();
    this.cerrarFormularios();
  }

  volverANiveles() {
    this.vista = 'niveles';
    this.nivelActivo = null;
    this.subnivelActivo = null;
    this.cerrarFormularios();
  }

  volverASubniveles() {
    this.vista = 'subniveles';
    this.subnivelActivo = null;
    this.cerrarFormularios();
  }

  subnivelesDe(nivelId: number): Subnivel[] {
    return this.subnivelesPorNivel.get(nivelId) ?? [];
  }

  senasDe(subnivelId: number): Sena[] {
    return this.senasPorSubnivel.get(subnivelId) ?? [];
  }

  nombreCompletoSubnivel(sub: Subnivel): string {
    const niv = this.niveles.find(n => n.id === sub.nivel_id);
    return niv ? `Nivel ${niv.numero_nivel} (${niv.nombre}) · ${sub.numero_subnivel}. ${sub.nombre}` : `${sub.numero_subnivel}. ${sub.nombre}`;
  }

  get subnivelesDelNivelActivo(): Subnivel[] {
    if (!this.nivelActivo) return [];
    return this.subnivelesDe(this.nivelActivo.id);
  }

  private cerrarFormularios() {
    this.formNivelAbierto = false;
    this.formSubnivelAbierto = false;
    this.formSenaAbierto = false;
    this.editandoNivelId = null;
    this.editandoSubnivelId = null;
    this.editandoSenaId = null;
    this.errorForm = null;
  }

  cancelarFormulario() {
    this.cerrarFormularios();
  }

  // ==================== NIVELES ====================
  abrirNuevoNivel() {
    this.formNivel = {
      numero_nivel: this.niveles.length + 1,
      color: COLOR_DEFECTO,
      color_oscuro: COLOR_OSCURO_DEFECTO,
    };
    this.editandoNivelId = null;
    this.formNivelAbierto = true;
    this.errorForm = null;
  }

  editarNivel(n: Nivel, evento: Event) {
    evento.stopPropagation();
    this.formNivel = { ...n, color: n.color || COLOR_DEFECTO, color_oscuro: n.color_oscuro || COLOR_OSCURO_DEFECTO };
    this.editandoNivelId = n.id;
    this.formNivelAbierto = true;
    this.errorForm = null;
  }

  async guardarNivel() {
    if (!this.formNivel.nombre?.trim() || this.formNivel.numero_nivel == null) {
      this.errorForm = 'Nombre y número de nivel son obligatorios.';
      return;
    }

    const duplicado = this.niveles.some(
      n => n.numero_nivel === this.formNivel.numero_nivel && n.id !== this.editandoNivelId
    );
    if (duplicado) {
      this.errorForm = `Ya existe un nivel con el número ${this.formNivel.numero_nivel}. El orden en que se desbloquean los niveles depende de este número, así que no puede repetirse.`;
      return;
    }

    this.guardando = true;
    this.errorForm = null;

    const datos = {
      numero_nivel: this.formNivel.numero_nivel!,
      nombre: this.formNivel.nombre!.trim(),
      descripcion: this.formNivel.descripcion?.trim() || null,
      dificultad: this.formNivel.dificultad?.trim() || null,
      etiqueta: this.formNivel.etiqueta?.trim() || null,
      color: this.formNivel.color?.trim() || null,
      color_oscuro: this.formNivel.color_oscuro?.trim() || null,
      icono: this.formNivel.icono?.trim() || null,
    };

    const { error } = this.editandoNivelId
      ? await this.supabaseService.actualizarNivel(this.editandoNivelId, datos)
      : await this.supabaseService.crearNivel(datos);

    this.guardando = false;
    if (error) {
      this.errorForm = error.message ?? 'No se pudo guardar el nivel.';
      return;
    }
    this.cerrarFormularios();
    await this.cargarTodo();
  }

  async eliminarNivel(n: Nivel, evento: Event) {
    evento.stopPropagation();
    const tieneSubniveles = this.subnivelesDe(n.id).length > 0;
    if (tieneSubniveles) {
      alert('Este nivel tiene subniveles adentro. Elimina o mueve esos subniveles primero.');
      return;
    }
    if (!confirm(`¿Eliminar el nivel "${n.nombre}"? Esta acción no se puede deshacer.`)) return;

    const { error } = await this.supabaseService.eliminarNivel(n.id);
    if (error) {
      alert(error.message ?? 'No se pudo eliminar el nivel.');
      return;
    }
    await this.cargarTodo();
  }

  // ==================== SUBNIVELES ====================
  abrirNuevoSubnivel() {
    if (!this.nivelActivo) return;
    const existentes = this.subnivelesDelNivelActivo;
    this.formSubnivel = {
      nivel_id: this.nivelActivo.id,
      numero_subnivel: existentes.length + 1,
    };
    this.editandoSubnivelId = null;
    this.formSubnivelAbierto = true;
    this.errorForm = null;
  }

  editarSubnivel(s: Subnivel, evento: Event) {
    evento.stopPropagation();
    this.formSubnivel = { ...s };
    this.editandoSubnivelId = s.id;
    this.formSubnivelAbierto = true;
    this.errorForm = null;
  }

  async guardarSubnivel() {
    if (!this.formSubnivel.nombre?.trim() || !this.formSubnivel.nivel_id || this.formSubnivel.numero_subnivel == null) {
      this.errorForm = 'Nombre y número de subnivel son obligatorios.';
      return;
    }

    const duplicado = this.subniveles.some(
      s =>
        s.nivel_id === this.formSubnivel.nivel_id &&
        s.numero_subnivel === this.formSubnivel.numero_subnivel &&
        s.id !== this.editandoSubnivelId
    );
    if (duplicado) {
      this.errorForm = `Ya existe un subnivel con el número ${this.formSubnivel.numero_subnivel} acá adentro. Elige otro número.`;
      return;
    }

    this.guardando = true;
    this.errorForm = null;

    const datos = {
      nivel_id: this.formSubnivel.nivel_id!,
      numero_subnivel: this.formSubnivel.numero_subnivel!,
      nombre: this.formSubnivel.nombre!.trim(),
      tipo: this.formSubnivel.tipo?.trim() || null,
      pagina_quiz_local: this.formSubnivel.pagina_quiz_local?.trim() || null,
      descripcion: this.formSubnivel.descripcion?.trim() || null,
    };

    const { error } = this.editandoSubnivelId
      ? await this.supabaseService.actualizarSubnivel(this.editandoSubnivelId, datos)
      : await this.supabaseService.crearSubnivel(datos);

    this.guardando = false;
    if (error) {
      this.errorForm = error.message ?? 'No se pudo guardar el subnivel.';
      return;
    }
    this.cerrarFormularios();
    await this.cargarTodo();
  }

  async eliminarSubnivel(s: Subnivel, evento: Event) {
    evento.stopPropagation();
    const tieneSenas = this.senasDe(s.id).length > 0;
    if (tieneSenas) {
      alert('Este subnivel tiene señas adentro. Elimina o mueve esas señas primero.');
      return;
    }
    if (!confirm(`¿Eliminar el subnivel "${s.nombre}"? Esta acción no se puede deshacer.`)) return;

    const { error } = await this.supabaseService.eliminarSubnivel(s.id);
    if (error) {
      alert(error.message ?? 'No se pudo eliminar el subnivel.');
      return;
    }
    await this.cargarTodo();
  }

  // ==================== SEÑAS & EXPLORADOR DE BUCKET ====================
  abrirNuevaSena() {
    if (!this.subnivelActivo) return;
    this.formSena = { subnivel_id: this.subnivelActivo.id };
    this.editandoSenaId = null;
    this.modoMedia = 'bucket';
    this.archivoSeleccionado = null;
    this.archivosSubidaMultiple = [];
    this.formSenaAbierto = true;
    this.errorForm = null;
    void this.asegurarArchivosBucket();
  }

  editarSena(s: Sena) {
    this.formSena = { ...s };
    this.editandoSenaId = s.id;
    this.modoMedia = 'bucket';
    this.archivoSeleccionado = null;
    this.archivosSubidaMultiple = [];
    this.formSenaAbierto = true;
    this.errorForm = null;
    void this.asegurarArchivosBucket();
  }

  cambiarModoMedia(modo: ModoMedia) {
    this.modoMedia = modo;
    if (modo === 'bucket') {
      void this.asegurarArchivosBucket();
    }
  }

  async asegurarArchivosBucket(forzarRecarga = false) {
    if (this.archivosBucket.length > 0 && !forzarRecarga) {
      this.filtrarArchivosBucket();
      return;
    }
    await this.cargarArchivosBucket();
  }

  async cargarArchivosBucket() {
    this.cargandoBucket = true;
    try {
      // Detectar buckets utilizados en URLs actuales por si hay varios buckets configurados
      const bucketsEnUso = new Set<string>(['senas-media']);
      for (const s of this.senas) {
        if (!s.video_url) continue;
        const m = s.video_url.match(/\/storage\/v1\/object\/public\/([^/]+)\//);
        if (m && m[1]) bucketsEnUso.add(m[1]);
      }

      const desdeStorage = await this.supabaseService.listarArchivosBucket(Array.from(bucketsEnUso));
      const mapaUnico = new Map<string, ArchivoBucket>();
      for (const arch of desdeStorage) {
        mapaUnico.set(arch.url, arch);
      }

      // Respaldo: incluir también las URLs que ya estén en `senas` por si alguna política RLS oculta `list()`
      for (const s of this.senas) {
        const url = s.video_url?.trim();
        if (!url || mapaUnico.has(url)) continue;
        const partesUrl = url.split('/');
        const nombreArchivo = decodeURIComponent(partesUrl[partesUrl.length - 1] || `${s.palabra}.mp4`);
        const mBucket = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        mapaUnico.set(url, {
          nombre: nombreArchivo,
          ruta: mBucket ? mBucket[2] : nombreArchivo,
          bucket: mBucket ? mBucket[1] : 'externo',
          url,
          tamanoBytes: 0,
          esVideo: esVideoMp4(url),
          createdAt: null,
        });
      }

      this.archivosBucket = Array.from(mapaUnico.values()).sort((a, b) => {
        if (a.esVideo !== b.esVideo) return a.esVideo ? -1 : 1;
        return a.nombre.localeCompare(b.nombre, 'es', { numeric: true });
      });
      this.filtrarArchivosBucket();
    } catch (e) {
      console.warn('Error al listar bucket:', e);
    } finally {
      this.cargandoBucket = false;
    }
  }

  filtrarArchivosBucket() {
    const q = this.buscarArchivoBucket.trim().toLowerCase();
    this.archivosBucketFiltrados = this.archivosBucket.filter((arch) => {
      if (this.filtroBucket === 'mp4' && !arch.esVideo) return false;
      if (this.filtroBucket === 'disponibles') {
        const asignada = this.senaQueUsaUrl(arch.url);
        if (asignada && asignada.id !== this.editandoSenaId) return false;
      }
      if (!q) return true;
      const asignada = this.senaQueUsaUrl(arch.url);
      return (
        arch.nombre.toLowerCase().includes(q) ||
        arch.ruta.toLowerCase().includes(q) ||
        (asignada?.palabra.toLowerCase().includes(q) ?? false)
      );
    });
  }

  cambiarFiltroBucket(f: FiltroBucket) {
    this.filtroBucket = f;
    this.filtrarArchivosBucket();
  }

  senaQueUsaUrl(url: string): Sena | undefined {
    return this.mapaUrlASena.get(url.trim());
  }

  get cantidadDisponiblesBucket(): number {
    return this.archivosBucket.filter((a) => {
      const s = this.senaQueUsaUrl(a.url);
      return !s || s.id === this.editandoSenaId;
    }).length;
  }

  seleccionarArchivoBucket(arch: ArchivoBucket) {
    this.formSena.video_url = arch.url;
    this.errorForm = null;
  }

  /** Sugiere un nombre de palabra limpio a partir del nombre del archivo .mp4 */
  sugerirPalabraDesdeArchivo(nombreArchivo: string): string {
    const sinExt = nombreArchivo.replace(/\.[^.]+$/, '');
    // Quitar sufijos de timestamp tipo "-17283912" o "-m2k9f1"
    const sinTimestamp = sinExt.replace(/-[a-z0-9]{6,}$/i, '').replace(/^\d{10,}-/, '');
    const limpio = sinTimestamp.replace(/[_-]+/g, ' ').trim();
    if (!limpio) return '';
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
  }

  usarNombreDeArchivoSeleccionado() {
    if (!this.formSena.video_url) return;
    const partes = this.formSena.video_url.split('/');
    const ultimo = decodeURIComponent(partes[partes.length - 1] || '');
    const sugerencia = this.sugerirPalabraDesdeArchivo(ultimo);
    if (sugerencia) {
      this.formSena.palabra = sugerencia;
    }
  }

  formatearTamano(bytes: number): string {
    if (!bytes || bytes <= 0) return 'MP4';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  onArchivoSeleccionado(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.errorForm = null;

    if (!files.length) {
      this.archivoSeleccionado = null;
      this.archivosSubidaMultiple = [];
      return;
    }

    for (const file of files) {
      if (!TIPOS_MEDIA_PERMITIDOS.includes(file.type) && !/\.(mp4|webm|mov|gif|webp|png|jpg|jpeg)$/i.test(file.name)) {
        this.errorForm = `El archivo "${file.name}" no tiene un formato permitido. Usa MP4, WebM, GIF, WebP, PNG o JPG.`;
        input.value = '';
        this.archivoSeleccionado = null;
        this.archivosSubidaMultiple = [];
        return;
      }
      if (file.size > TAMANO_MAX_ARCHIVO) {
        this.errorForm = `El archivo "${file.name}" pesa más de 25 MB — comprímelo antes de subirlo.`;
        input.value = '';
        this.archivoSeleccionado = null;
        this.archivosSubidaMultiple = [];
        return;
      }
    }

    this.archivoSeleccionado = files[0];
    this.archivosSubidaMultiple = files;
  }

  /** Sube uno o varios archivos directamente al bucket y los deja listos en el explorador */
  async subirArchivosAlBucketAhora() {
    if (!this.archivosSubidaMultiple.length || this.subiendoArchivo) return;
    this.subiendoArchivo = true;
    this.errorForm = null;

    try {
      let ultimaUrl: string | null = null;
      for (let i = 0; i < this.archivosSubidaMultiple.length; i++) {
        const f = this.archivosSubidaMultiple[i];
        this.progresoSubida = `Subiendo ${i + 1}/${this.archivosSubidaMultiple.length}: ${f.name}…`;
        const { data, error } = await this.supabaseService.uploadSenaMedia(f);
        if (error) throw error;
        if (data) ultimaUrl = data;
      }

      if (ultimaUrl) {
        this.formSena.video_url = ultimaUrl;
      }
      this.archivoSeleccionado = null;
      this.archivosSubidaMultiple = [];
      await this.cargarArchivosBucket();
      this.modoMedia = 'bucket';
    } catch (e: any) {
      this.errorForm = e?.message ?? 'Error al subir archivo(s) al bucket.';
    } finally {
      this.subiendoArchivo = false;
      this.progresoSubida = '';
    }
  }

  elegirIcono(emoji: string) {
    this.formSena.icono = emoji;
  }

  esVideoMp4(url: string | null | undefined): boolean {
    return esVideoMp4(url);
  }

  async guardarSena() {
    if (!this.formSena.palabra?.trim() || !this.formSena.subnivel_id) {
      this.errorForm = 'La palabra y el subnivel son obligatorios.';
      return;
    }
    if (this.modoMedia === 'subir' && !this.archivoSeleccionado && !this.formSena.video_url) {
      this.errorForm = 'Selecciona un archivo para subir o elige un MP4 desde el explorador del bucket.';
      return;
    }

    const palabraNormalizada = this.formSena.palabra.trim().toLowerCase();
    const duplicada = this.senas.some(
      s =>
        s.subnivel_id === this.formSena.subnivel_id &&
        s.palabra.trim().toLowerCase() === palabraNormalizada &&
        s.id !== this.editandoSenaId
    );
    if (duplicada) {
      this.errorForm = `"${this.formSena.palabra.trim()}" ya existe en este subnivel.`;
      return;
    }

    this.guardando = true;
    this.errorForm = null;

    let videoUrl = this.formSena.video_url?.trim() || null;

    if (this.modoMedia === 'subir' && this.archivoSeleccionado) {
      this.subiendoArchivo = true;
      const { data, error: errorSubida } = await this.supabaseService.uploadSenaMedia(this.archivoSeleccionado);
      this.subiendoArchivo = false;

      if (errorSubida) {
        this.guardando = false;
        this.errorForm = errorSubida.message ?? 'No se pudo subir el archivo.';
        return;
      }
      videoUrl = data;
    }

    const datos = {
      subnivel_id: Number(this.formSena.subnivel_id),
      palabra: this.formSena.palabra!.trim(),
      descripcion: this.formSena.descripcion?.trim() || null,
      icono: this.formSena.icono?.trim() || null,
      video_url: videoUrl,
    };

    const { error } = this.editandoSenaId
      ? await this.supabaseService.actualizarSena(this.editandoSenaId, datos)
      : await this.supabaseService.crearSena(datos);

    this.guardando = false;
    if (error) {
      this.errorForm = error.message ?? 'No se pudo guardar la seña.';
      return;
    }

    this.cerrarFormularios();
    await this.cargarTodo();
  }

  async eliminarSena(s: Sena) {
    const muestras = await this.muestrasDeSena(s.id);
    const aviso = muestras > 0
      ? `\n\n⚠️ También se borrarán sus ${muestras} muestra(s) grabadas para entrenar el modelo.`
      : '';
    if (!confirm(`¿Eliminar la seña "${s.palabra}"? Esta acción no se puede deshacer.${aviso}`)) return;

    const { error } = await this.supabaseService.eliminarSena(s.id);
    if (error) {
      alert(error.message ?? 'No se pudo eliminar la seña.');
      return;
    }
    await this.cargarTodo();
  }

  private async muestrasDeSena(senaId: number): Promise<number> {
    try {
      return (await this.supabaseService.contarMuestrasPorSena()).get(senaId) ?? 0;
    } catch {
      return 0;
    }
  }
}
