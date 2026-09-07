import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
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

  constructor(
    private supabaseService: SupabaseService,
    private contenidoService: ContenidoService,
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
      const { data: userData } = await this.supabaseService.getUser();
      if (!userData?.user) return;

      const [niveles, stats, { data: perfil }] = await Promise.all([
        this.contenidoService.obtenerMapaDeAprendizaje(userData.user.id),
        this.contenidoService.getMisStats(userData.user.id),
        this.supabaseService.getProfile(userData.user.id),
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
      const yaPracticoHoy = stats.ultima_fecha_practica === this.contenidoService.fechaHoy();
      this.notificationsService
        .sincronizar(stats.vidas ?? 0, this.contenidoService.minutosParaProximaVida(stats), stats.racha_actual ?? 0, yaPracticoHoy)
        .catch(() => {});

      // Si getMisStats acaba de detectar que un congelador cubrió un día
      // saltado (o que la racha se cortó por falta de congeladores), se
      // avisa una sola vez con una notificación — evaluarRachaSiCorresponde
      // ya es idempotente por día, así que esto no se repite en cada carga.
      if (stats.eventoRacha) {
        this.notificationsService.avisarEventoRacha(stats.eventoRacha, stats.racha_actual ?? 0).catch(() => {});
      }
    } catch (e: any) {
      this.error = 'No se pudo cargar tu progreso. Revisa tu conexión.';
      console.error(e);
    } finally {
      this.cargando = false;
    }
  }

  trackNivel = (_: number, n: NivelConEstado) => n.id;
  trackSub = (_: number, s: SubnivelConEstado) => s.id;

  get racha(): number { return this.stats?.racha_actual ?? 0; }
  get xp(): number { return this.stats?.puntos_experiencia ?? 0; }
  get vidas(): number { return this.stats?.vidas ?? 5; }

  /** true si hay una racha activa y todavía no se practicó hoy — para el
   * pulso de aviso en la píldora de racha del Home. Mismo cálculo que ya
   * se usa para las notificaciones de "vas a perder la racha esta noche",
   * solo que acá es un recordatorio silencioso dentro de la propia app. */
  get rachaEnRiesgo(): boolean {
    if (!this.stats || this.racha <= 0) return false;
    return this.stats.ultima_fecha_practica !== this.contenidoService.fechaHoy();
  }

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
    await this.notificationsService.cancelarTodo();
    await this.supabaseService.signOut();
    this.router.navigate(['/auth/login']);
  }
}
