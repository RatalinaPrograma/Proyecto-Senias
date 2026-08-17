import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { addIcons } from 'ionicons';
import { flame, star, heart, checkmark, lockClosed, paw, logOutOutline } from 'ionicons/icons';

addIcons({ flame, star, heart, checkmark, 'lock-closed': lockClosed, paw, 'log-out-outline': logOutOutline });

interface Subnivel {
  numero: number;
  nombre: string;
  descripcion: string;
  estado: 'completado' | 'actual' | 'bloqueado';
}

interface Nivel {
  id: number;
  titulo: string;
  etiqueta: string;
  descripcion: string;
  color: string;
  colorOscuro: string;
  icono: string;
  subniveles: Subnivel[];
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit {
  racha = 0;
  xp = 0;
  vidas = 0;
  niveles: Nivel[] = [];
  cargando = true;
  errorCarga = false;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.cargarDatos();
  }

  async cargarDatos() {
    this.cargando = true;
    this.errorCarga = false;

    try {
      const user = await this.supabaseService.getCurrentUser();
      if (!user) {
        this.router.navigate(['/auth/login']);
        return;
      }

      const [{ niveles, progresoNivel, progresoSubnivel }, stats] = await Promise.all([
        this.supabaseService.obtenerUnidadesConProgreso(user.id),
        this.supabaseService.obtenerStats(user.id),
      ]);

      this.racha = stats?.racha_actual ?? 0;
      this.xp = stats?.puntos_experiencia ?? 0;
      this.vidas = stats?.vidas ?? 0;

      const mapaAccesoNivel = new Map(progresoNivel.map((p: any) => [p.nivel_id, p]));
      const mapaCompletadoSub = new Map(progresoSubnivel.map((p: any) => [p.subnivel_id, p.completado]));

      this.niveles = niveles.map((n: any) => {
        const nivelDesbloqueado = mapaAccesoNivel.get(n.id)?.acceso ?? (n.numero_nivel === 1);

        let yaHuboActual = false;

        const subnivelesMapeados: Subnivel[] = (n.subniveles ?? []).map((s: any) => {
          const completado = mapaCompletadoSub.get(s.id) ?? false;
          let estado: Subnivel['estado'];

          if (!nivelDesbloqueado) {
            estado = 'bloqueado';
          } else if (completado) {
            estado = 'completado';
          } else if (!yaHuboActual) {
            estado = 'actual';
            yaHuboActual = true;
          } else {
            estado = 'bloqueado';
          }

          return {
            numero: s.numero_subnivel,
            nombre: s.nombre,
            descripcion: s.descripcion,
            estado,
          };
        });

        return {
          id: n.id,
          titulo: n.nombre,
          etiqueta: n.etiqueta ?? '',
          descripcion: n.descripcion ?? '',
          color: n.color ?? '#D97B3F',
          colorOscuro: n.color_oscuro ?? '#A8562A',
          icono: n.icono ?? 'paw',
          subniveles: subnivelesMapeados,
        };
      });
    } catch (e) {
      console.error('Hombre no poder cargar datos de home', e);
      this.errorCarga = true;
    } finally {
      this.cargando = false;
    }
  }

  get totalSubniveles(): number {
    return this.niveles.reduce((acc, n) => acc + n.subniveles.length, 0);
  }

  get subnivelesCompletados(): number {
    return this.niveles.reduce(
      (acc, n) => acc + n.subniveles.filter(s => s.estado === 'completado').length,
      0
    );
  }

  async cerrarSesion() {
    await this.supabaseService.signOut();
    this.router.navigate(['/auth/login']);
  }
}