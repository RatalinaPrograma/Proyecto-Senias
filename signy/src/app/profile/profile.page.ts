import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { NotificationsService } from '../services/notifications';
import { Profile, UserStats, RachaHistorialDia, Logro } from '../data/db-types';
import { RachaCalendarComponent, DiaRachaVista } from '../shared/racha-calendar/racha-calendar.component';
import { CachedSrcDirective } from '../shared/cached-src.directive';
import { addIcons } from 'ionicons';
import { close, flame, star, people, settingsOutline, personAddOutline, paw, logOutOutline, snowOutline, lockClosed } from 'ionicons/icons';

addIcons({
  close,
  flame,
  star,
  people,
  'settings-outline': settingsOutline,
  'person-add-outline': personAddOutline,
  paw,
  'log-out-outline': logOutOutline,
  'snow-outline': snowOutline,
  'lock-closed': lockClosed,
});

interface LogroVista extends Logro {
  desbloqueado: boolean;
}

interface FalloVista {
  palabra: string;
  icono: string | null;
  cantidad_fallos: number;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, IonicModule, RachaCalendarComponent, CachedSrcDirective],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage {
  cargando = true;
  perfil: Profile | null = null;
  stats: UserStats | null = null;
  seguidores = 0;
  seguidos = 0;
  userId = '';
  diasCalendario: DiaRachaVista[] = [];
  logros: LogroVista[] = [];
  fallos: FalloVista[] = [];

  constructor(
    private supabaseService: SupabaseService,
    private contenidoService: ContenidoService,
    private notificationsService: NotificationsService,
    private router: Router
  ) {}

  // Ionic mantiene esta página viva en memoria con <ion-router-outlet> (para
  // las animaciones de navegación), así que ngOnInit solo corre la primera
  // vez. Sin esto, si volvías a Perfil después de hacer una lección, seguías
  // viendo la racha/calendario/stats de la visita anterior.
  async ionViewWillEnter() {
    const { data: userData } = await this.supabaseService.getUser();
    if (!userData?.user) { this.router.navigate(['/auth/login']); return; }
    this.userId = userData.user.id;

    const nombreFallback = userData.user.user_metadata?.['full_name'] ?? 'Usuario Signy';

    const [perfil, stats, seguidores, seguidos, historialRacha, logros, misLogrosIds, fallos] = await Promise.all([
      this.supabaseService.getOCrearProfile(this.userId, nombreFallback),
      this.contenidoService.getMisStats(this.userId),
      this.supabaseService.contarSeguidores(this.userId),
      this.supabaseService.contarSeguidos(this.userId),
      this.contenidoService.obtenerHistorialRacha(this.userId, 27),
      this.contenidoService.getLogros(),
      this.contenidoService.getMisLogrosIds(this.userId),
      this.contenidoService.getMisFallos(this.userId, 5),
    ]);

    this.perfil = perfil;
    this.stats = stats;
    this.seguidores = seguidores;
    this.seguidos = seguidos;
    this.diasCalendario = this.construirCalendario(historialRacha);
    // Desbloqueados primero, y dentro de cada grupo en el mismo orden que
    // llegan de la base — así lo que ya ganaste queda siempre más visible
    // que lo que falta, sin necesidad de que el admin las ordene a mano.
    this.logros = logros
      .map(l => ({ ...l, desbloqueado: misLogrosIds.has(l.id) }))
      .sort((a, b) => Number(b.desbloqueado) - Number(a.desbloqueado));
    this.fallos = fallos;
    this.cargando = false;
  }

  /** Últimos 28 días (27 + hoy) para el calendario de racha del perfil.
   * "Hoy" se muestra aparte porque puede que aún no se haya practicado y no
   * por eso significa que la racha ya se perdió. */
  private construirCalendario(historial: RachaHistorialDia[]): DiaRachaVista[] {
    const mapa = new Map(historial.map(h => [h.fecha, h.estado]));
    const hoy = this.contenidoService.fechaHoy();
    const dias: DiaRachaVista[] = [];
    for (let i = 27; i >= 0; i--) {
      const fecha = this.contenidoService.sumarDias(hoy, -i);
      const esHoy = fecha === hoy;
      const estado = mapa.get(fecha) ?? (esHoy ? 'hoy' : 'sin-datos');
      dias.push({ fecha, numero: Number(fecha.slice(8, 10)), estado, esHoy });
    }
    return dias;
  }

  irABuscarAmigos() {
    this.router.navigate(['/friends'], { queryParams: { tab: 'buscar' } });
  }

  irASeguidores() {
    this.router.navigate(['/friends'], { queryParams: { tab: 'seguidores' } });
  }

  irASeguidos() {
    this.router.navigate(['/friends'], { queryParams: { tab: 'seguidos' } });
  }

  irAConfiguracion() {
    this.router.navigate(['/settings']);
  }

  async cerrarSesion() {
    await this.notificationsService.cancelarTodo();
    await this.supabaseService.signOut();
    this.router.navigate(['/auth/login']);
  }

  volver() {
    this.router.navigate(['/home']);
  }
}