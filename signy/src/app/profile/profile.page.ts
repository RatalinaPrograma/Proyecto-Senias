import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { NotificationsService } from '../services/notifications';
import { Profile, UserStats, RachaHistorialDia } from '../data/db-types';
import { addIcons } from 'ionicons';
import { close, flame, star, people, settingsOutline, personAddOutline, paw, logOutOutline, snowOutline } from 'ionicons/icons';

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
});

interface DiaCalendario {
  fecha: string;
  numero: number;
  estado: RachaHistorialDia['estado'] | 'hoy' | 'sin-datos';
  esHoy: boolean;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, IonicModule],
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
  diasCalendario: DiaCalendario[] = [];

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

    const [perfil, stats, seguidores, seguidos, historialRacha] = await Promise.all([
      this.supabaseService.getOCrearProfile(this.userId, nombreFallback),
      this.contenidoService.getMisStats(this.userId),
      this.supabaseService.contarSeguidores(this.userId),
      this.supabaseService.contarSeguidos(this.userId),
      this.contenidoService.obtenerHistorialRacha(this.userId, 27),
    ]);

    this.perfil = perfil;
    this.stats = stats;
    this.seguidores = seguidores;
    this.seguidos = seguidos;
    this.diasCalendario = this.construirCalendario(historialRacha);
    this.cargando = false;
  }

  /** Últimos 28 días (27 + hoy) para el calendario de racha del perfil.
   * "Hoy" se muestra aparte porque puede que aún no se haya practicado y no
   * por eso significa que la racha ya se perdió. */
  private construirCalendario(historial: RachaHistorialDia[]): DiaCalendario[] {
    const mapa = new Map(historial.map(h => [h.fecha, h.estado]));
    const hoy = this.contenidoService.fechaHoy();
    const dias: DiaCalendario[] = [];
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