import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { NivelConEstado, SubnivelConEstado, UserStats } from '../data/db-types';
import { addIcons } from 'ionicons';
import { flame, star, heart, checkmark, lockClosed, paw, logOutOutline, refresh } from 'ionicons/icons';

addIcons({ flame, star, heart, checkmark, 'lock-closed': lockClosed, paw, 'log-out-outline': logOutOutline, refresh });

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage {
  cargando = true;
  error = '';

  niveles: NivelConEstado[] = [];
  stats: UserStats | null = null;
  avatarUrl: string | null = null;

  constructor(
    private supabaseService: SupabaseService,
    private contenidoService: ContenidoService,
    private router: Router
  ) {}

  // Se recalcula cada vez que vuelves a Home (ej. después de terminar una lección)
  async ionViewWillEnter() {
    await this.cargarTodo();
  }

  async cargarTodo() {
    this.cargando = true;
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
    } catch (e: any) {
      this.error = 'No se pudo cargar tu progreso. Revisa tu conexión.';
      console.error(e);
    } finally {
      this.cargando = false;
    }
  }

  get racha(): number { return this.stats?.racha_actual ?? 0; }
  get xp(): number { return this.stats?.puntos_experiencia ?? 0; }
  get vidas(): number { return this.stats?.vidas ?? 5; }

  get totalSubniveles(): number {
    return this.niveles.reduce((acc, n) => acc + n.subniveles.length, 0);
  }

  get subnivelesCompletados(): number {
    return this.niveles.reduce(
      (acc, n) => acc + n.subniveles.filter(s => s.estado === 'completado').length,
      0
    );
  }

  abrirLeccion(subnivel: SubnivelConEstado) {
    if (subnivel.estado === 'bloqueado') return;
    this.router.navigate(['/lesson', subnivel.id]);
  }

  irAPerfil() {
    this.router.navigate(['/profile']);
  }

  async cerrarSesion() {
    await this.supabaseService.signOut();
    this.router.navigate(['/auth/login']);
  }
}
