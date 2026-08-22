import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';
import { Profile, UserStats } from '../data/db-types';
import { addIcons } from 'ionicons';
import { close, flame, star, people, settingsOutline, personAddOutline, paw, logOutOutline } from 'ionicons/icons';

addIcons({
  close,
  flame,
  star,
  people,
  'settings-outline': settingsOutline,
  'person-add-outline': personAddOutline,
  paw,
  'log-out-outline': logOutOutline,
});

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage implements OnInit {
  cargando = true;
  perfil: Profile | null = null;
  stats: UserStats | null = null;
  seguidores = 0;
  seguidos = 0;
  userId = '';

  constructor(
    private supabaseService: SupabaseService,
    private contenidoService: ContenidoService,
    private router: Router
  ) {}

  async ngOnInit() {
    const { data: userData } = await this.supabaseService.getUser();
    if (!userData?.user) { this.router.navigate(['/auth/login']); return; }
    this.userId = userData.user.id;

    const nombreFallback = userData.user.user_metadata?.['full_name'] ?? 'Usuario Signy';

    const [perfil, stats, seguidores, seguidos] = await Promise.all([
      this.supabaseService.getOCrearProfile(this.userId, nombreFallback),
      this.contenidoService.getMisStats(this.userId),
      this.supabaseService.contarSeguidores(this.userId),
      this.supabaseService.contarSeguidos(this.userId),
    ]);

    this.perfil = perfil;
    this.stats = stats;
    this.seguidores = seguidores;
    this.seguidos = seguidos;
    this.cargando = false;
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
    await this.supabaseService.signOut();
    this.router.navigate(['/auth/login']);
  }

  volver() {
    this.router.navigate(['/home']);
  }
}
