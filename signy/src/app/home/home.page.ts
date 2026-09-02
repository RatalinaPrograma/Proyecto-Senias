import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { ImageCacheService } from '../services/image-cache';
import { NotificationsService } from '../services/notifications';
import { NivelConEstado, SubnivelConEstado, UserStats } from '../data/db-types';
import { CachedSrcDirective } from '../shared/cached-src.directive';
import { addIcons } from 'ionicons';
import { flame, star, heart, checkmark, lockClosed, paw, logOutOutline, refresh, construct, videocam, arrowForward, hourglassOutline } from 'ionicons/icons';

addIcons({ flame, star, heart, checkmark, 'lock-closed': lockClosed, paw, 'log-out-outline': logOutOutline, refresh, construct, videocam, 'arrow-forward': arrowForward, 'hourglass-outline': hourglassOutline });

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IonicModule, CachedSrcDirective],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage {
  cargando = true;
  error = '';

  niveles: NivelConEstado[] = [];
  stats: UserStats | null = null;
  avatarUrl: string | null = null;
  esAdmin = false;

  // Se calculan una vez por carga en vez de en cada ciclo de change detection.
  totalSubniveles = 0;
  subnivelesCompletados = 0;

  private ultimaCarga = 0;

  // ---- precarga total en segundo plano (dejar la app usable sin conexión) ----
  // No bloquea nada: es solo una barrita chica y opcional en el HUD.
  // Si el usuario abre una lección mientras esto corre, la lección se
  // precarga igual como siempre (precargarSubnivel de toda la vida).
  precargandoVocabulario = false;
  progresoVocabulario = 0;

  constructor(
    private supabaseService: SupabaseService,
    private contenidoService: ContenidoService,
    private imageCacheService: ImageCacheService,
    private notificationsService: NotificationsService,
    private router: Router
  ) {}

  // Se recalcula cada vez que vuelves a Home (ej. después de terminar una lección).
  // El throttle corto solo mata los rebotes de navegación (abrir perfil y volver
  // al toque) que disparaban una recarga completa de 7 queries.
  async ionViewWillEnter() {
    if (this.niveles.length && Date.now() - this.ultimaCarga < 2000) return;
    await this.cargarTodo();
  }

  async cargarTodo() {
    // Solo mostrar el spinner de pantalla completa si aún no hay nada que mostrar;
    // en las recargas (volver de una lección) se actualiza en silencio.
    if (!this.niveles.length) this.cargando = true;
    this.error = '';
    try {
      // getUsuarioLocal() lee la sesión guardada en el disco del teléfono,
      // sin ir a la red -- getUser() (lo que había antes acá) siempre
      // revalida contra el servidor y por eso fallaba apenas no había
      // conexión, dejando Home en blanco (0/0 lecciones) sin explicar por
      // qué. Los guards ya usaban este mismo método; a Home se le había
      // quedado pendiente.
      const { user } = await this.supabaseService.getUsuarioLocal();
      if (!user) return;

      const [niveles, stats, { data: perfil }] = await Promise.all([
        this.contenidoService.obtenerMapaDeAprendizaje(user.id),
        this.contenidoService.getMisStats(user.id),
        this.supabaseService.getProfile(user.id),
      ]);
      this.niveles = niveles;
      this.stats = stats;
      this.avatarUrl = perfil?.avatar_url ?? null;
      this.esAdmin = perfil?.es_admin ?? false;
      this.totalSubniveles = niveles.reduce((acc, n) => acc + n.subniveles.length, 0);
      this.subnivelesCompletados = niveles.reduce(
        (acc, n) => acc + n.subniveles.filter(s => s.estado === 'completado').length,
        0
      );
      this.ultimaCarga = Date.now();

      // No se espera esta llamada: si el permiso está "prompt" puede mostrar
      // el diálogo del sistema, y no queremos retrasar el resto de la carga
      // de Home por eso.
      this.notificationsService
        .sincronizar(stats.vidas ?? 0, this.contenidoService.minutosParaProximaVida(stats), stats.racha_actual ?? 0)
        .catch(() => {});

      // Se dispara sin "await" a propósito: corre en segundo plano y no
      // debe retrasar ni bloquear la pantalla de Home para nada.
      this.iniciarPrecargaVocabularioEnSegundoPlano();
    } catch (e: any) {
      this.error = 'No se pudo cargar tu progreso. Revisa tu conexión.';
      console.error(e);
    } finally {
      this.cargando = false;
    }
  }

  /** Deja instalado en disco todo el vocabulario disponible para que la
   * app funcione sin conexión, sin bloquear la navegación. El servicio ya
   * se encarga de no repetirse si esto ya corrió antes en la sesión. */
  private async iniciarPrecargaVocabularioEnSegundoPlano() {
    try {
      const urls = await this.contenidoService.getTodosLosVideoUrls();
      if (!urls.length) return;

      this.precargandoVocabulario = true;
      await this.imageCacheService.precargarTodo(urls, (completados, total) => {
        this.progresoVocabulario = Math.round((completados / total) * 100);
      });
    } catch (e) {
      console.warn('No se pudo precargar el vocabulario en segundo plano:', e);
    } finally {
      this.precargandoVocabulario = false;
    }
  }

  trackNivel = (_: number, n: NivelConEstado) => n.id;
  trackSub = (_: number, s: SubnivelConEstado) => s.id;

  get racha(): number { return this.stats?.racha_actual ?? 0; }
  get xp(): number { return this.stats?.puntos_experiencia ?? 0; }
  get vidas(): number { return this.stats?.vidas ?? 5; }

  abrirLeccion(subnivel: SubnivelConEstado) {
    if (subnivel.estado === 'bloqueado' || subnivel.estado === 'proximamente') return;
    this.router.navigate(['/lesson', subnivel.id]);
  }

  irAPerfil() {
    this.router.navigate(['/profile']);
  }

  irAAdmin() {
    this.router.navigate(['/admin/vocabulario']);
  }

  irALabMediaPipe() {
    this.router.navigate(['/mediapipe-test']);
  }

  async cerrarSesion() {
    try {
      // cancelarTodo() es local (no necesita red), así que va antes y
      // fuera del try de signOut() -- si falla igual queremos intentar
      // cerrar sesión.
      await this.notificationsService.cancelarTodo();
    } catch (e) {
      console.warn('No se pudieron cancelar las notificaciones locales:', e);
    }

    try {
      await this.supabaseService.signOut();
      this.router.navigate(['/auth/login']);
    } catch (e) {
      // Sin conexión, signOut() no puede avisarle al servidor que invalide
      // la sesión. Se deja todo como estaba (sigues conectado) en vez de
      // dejar el error sin manejar -- eso era lo que se veía como "Failed
      // to fetch".
      console.warn('No se pudo cerrar sesión (probablemente sin conexión):', e);
      alert('No se pudo cerrar sesión sin conexión a internet. Vuelve a intentarlo cuando tengas internet.');
    }
  }
}
