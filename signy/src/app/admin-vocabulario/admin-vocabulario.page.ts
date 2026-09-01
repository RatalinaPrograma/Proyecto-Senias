import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { Nivel, Subnivel, Sena } from '../data/db-types';
import { addIcons } from 'ionicons';
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
  archiveOutline,
  checkmarkCircle,
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
  'archive-outline': archiveOutline,
  'checkmark-circle': checkmarkCircle,
});

type Vista = 'niveles' | 'subniveles' | 'senas';
type ModoMedia = 'url' | 'subir';

const COLOR_DEFECTO = '#2CA6A4';
const COLOR_OSCURO_DEFECTO = '#1F7E7C';

@Component({
  selector: 'app-admin-vocabulario',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './admin-vocabulario.page.html',
  styleUrls: ['./admin-vocabulario.page.scss'],
})
export class AdminVocabularioPage implements OnInit {
  // La pantalla se navega como carpetas: Niveles -> (entras a uno) ->
  // Subniveles -> (entras a uno) -> Señas. Así el admin nunca tiene que
  // adivinar "¿dónde estoy? ¿qué le pertenece a qué?" — se ve solo.
  vista: Vista = 'niveles';
  nivelActivo: Nivel | null = null;
  subnivelActivo: Subnivel | null = null;

  cargando = true;
  error: string | null = null;

  niveles: Nivel[] = [];
  subniveles: Subnivel[] = [];
  senas: Sena[] = [];

  // Índices por padre: se arman una vez al cargar en vez de filtrar el array
  // entero en cada llamada desde el template (que corría por cada ciclo de CD).
  private subnivelesPorNivel = new Map<number, Subnivel[]>();
  private senasPorSubnivel = new Map<number, Sena[]>();

  buscarSena = '';
  // Lista ya filtrada por el buscador; se recalcula al cargar, al entrar a un
  // subnivel y al escribir — no en cada render.
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
  modoMedia: ModoMedia = 'url';
  archivoSeleccionado: File | null = null;
  subiendoArchivo = false;

  guardando = false;
  errorForm: string | null = null;

  // ---- empaquetador en la nube (Edge Function) ----
  generandoPack = false;
  mensajePack = '';

  async generarPaqueteEnNube() {
    this.generandoPack = true;
    this.mensajePack = 'Empaquetando señas en la nube de Supabase…';
    try {
      const { data, error } = await this.supabaseService.generarPaqueteMaestro();
      if (error) {
        throw error;
      }
      this.mensajePack = `¡Paquete generado con éxito! (${data?.archivosEmpaquetados || 0} señas, ${data?.tamanoMB || ''})`;
      setTimeout(() => { this.mensajePack = ''; }, 6000);
    } catch (e: any) {
      console.error('Error al generar paquete:', e);
      this.mensajePack = `Error: ${e?.message || 'No se pudo generar el paquete'}`;
      setTimeout(() => { this.mensajePack = ''; }, 7000);
    } finally {
      this.generandoPack = false;
    }
  }

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

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
    for (const s of this.senas) {
      const arr = this.senasPorSubnivel.get(s.subnivel_id);
      if (arr) arr.push(s); else this.senasPorSubnivel.set(s.subnivel_id, [s]);
    }
  }

  filtrarSenas() {
    const base = this.subnivelActivo ? this.senasDe(this.subnivelActivo.id) : [];
    const q = this.buscarSena.trim().toLowerCase();
    this.senasFiltradas = q ? base.filter(s => s.palabra.toLowerCase().includes(q)) : base;
  }

  trackById = (_: number, item: { id: number }) => item.id;

  // ==================== NAVEGACIÓN (breadcrumb) ====================
  // La flechita de "volver" del topbar retrocede un escalón a la vez,
  // igual que en el resto de la app — nunca saca de la pantalla de golpe
  // si estás adentro de un nivel o subnivel.
  volver() {
    if (this.vista === 'senas') {
      this.volverASubniveles();
    } else if (this.vista === 'subniveles') {
      this.volverANiveles();
    } else {
      this.router.navigate(['/home']);
    }
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

  // ==================== helpers de conteo / filtrado ====================
  // Lookups O(1) sobre los índices; devuelven la MISMA referencia de array
  // entre llamadas, así que son seguros de usar en el template.
  subnivelesDe(nivelId: number): Subnivel[] {
    return this.subnivelesPorNivel.get(nivelId) ?? [];
  }

  senasDe(subnivelId: number): Sena[] {
    return this.senasPorSubnivel.get(subnivelId) ?? [];
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

  // ==================== SEÑAS ====================
  abrirNuevaSena() {
    if (!this.subnivelActivo) return;
    this.formSena = { subnivel_id: this.subnivelActivo.id };
    this.editandoSenaId = null;
    this.modoMedia = 'url';
    this.archivoSeleccionado = null;
    this.formSenaAbierto = true;
    this.errorForm = null;
  }

  editarSena(s: Sena) {
    this.formSena = { ...s };
    this.editandoSenaId = s.id;
    this.modoMedia = 'url';
    this.archivoSeleccionado = null;
    this.formSenaAbierto = true;
    this.errorForm = null;
  }

  onArchivoSeleccionado(evento: Event) {
    const input = evento.target as HTMLInputElement;
    this.archivoSeleccionado = input.files?.[0] ?? null;
  }

  async guardarSena() {
    if (!this.formSena.palabra?.trim() || !this.formSena.subnivel_id) {
      this.errorForm = 'La palabra es obligatoria.';
      return;
    }
    if (this.modoMedia === 'subir' && !this.archivoSeleccionado && !this.formSena.video_url) {
      this.errorForm = 'Selecciona un archivo para subir.';
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
      this.errorForm = `"${this.formSena.palabra.trim()}" ya existe acá.`;
      return;
    }

    this.guardando = true;
    this.errorForm = null;

    const urlAnterior = this.editandoSenaId
      ? this.senas.find(s => s.id === this.editandoSenaId)?.video_url ?? null
      : null;

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
      subnivel_id: this.formSena.subnivel_id!,
      palabra: this.formSena.palabra!.trim(),
      descripcion: this.formSena.descripcion?.trim() || null,
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

    if (urlAnterior && urlAnterior !== videoUrl) {
      this.supabaseService.eliminarSenaMediaSiEsPropia(urlAnterior);
    }

    this.cerrarFormularios();
    await this.cargarTodo();
  }

  async eliminarSena(s: Sena) {
    if (!confirm(`¿Eliminar la seña "${s.palabra}"? Esta acción no se puede deshacer.`)) return;

    const { error } = await this.supabaseService.eliminarSena(s.id);
    if (error) {
      alert(error.message ?? 'No se pudo eliminar la seña.');
      return;
    }
    if (s.video_url) {
      this.supabaseService.eliminarSenaMediaSiEsPropia(s.video_url);
    }
    await this.cargarTodo();
  }
}
