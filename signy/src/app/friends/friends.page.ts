import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { Profile } from '../data/db-types';
import { addIcons } from 'ionicons';
import { arrowBack, search, paw, personAdd, checkmarkCircle } from 'ionicons/icons';

addIcons({
  'arrow-back': arrowBack,
  search,
  paw,
  'person-add': personAdd,
  'checkmark-circle': checkmarkCircle,
});

@Component({
  selector: 'app-friends',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './friends.page.html',
  styleUrls: ['./friends.page.scss'],
})
export class FriendsPage implements OnInit {
  tab: 'buscar' | 'seguidores' | 'seguidos' = 'buscar';
  userId = '';

  query = '';
  resultadosBusqueda: Profile[] = [];
  buscando = false;
  private debounceTimer: any;

  seguidores: Profile[] = [];
  seguidos: Profile[] = [];
  private idsQueSigo = new Set<string>();

  cargandoListas = false;

  constructor(
    private supabaseService: SupabaseService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  async ngOnInit() {
    const { data: userData } = await this.supabaseService.getUser();
    if (!userData?.user) { this.router.navigate(['/auth/login']); return; }
    this.userId = userData.user.id;

    const tabInicial = this.route.snapshot.queryParamMap.get('tab');
    if (tabInicial === 'seguidores' || tabInicial === 'seguidos' || tabInicial === 'buscar') {
      this.tab = tabInicial;
    }

    await this.cargarIdsQueSigo();
    await this.cargarTabActual();
  }

  cambiarTab(t: 'buscar' | 'seguidores' | 'seguidos') {
    this.tab = t;
    this.cargarTabActual();
  }

  private async cargarIdsQueSigo() {
    const ids = await this.supabaseService.idsSeguidos(this.userId);
    this.idsQueSigo = new Set(ids);
  }

  private async cargarTabActual() {
    if (this.tab === 'seguidores') {
      this.cargandoListas = true;
      this.seguidores = await this.supabaseService.listaSeguidores(this.userId);
      this.cargandoListas = false;
    } else if (this.tab === 'seguidos') {
      this.cargandoListas = true;
      this.seguidos = await this.supabaseService.listaSeguidos(this.userId);
      this.cargandoListas = false;
    }
  }

  onBuscarInput() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.ejecutarBusqueda(), 350);
  }

  private async ejecutarBusqueda() {
    if (!this.query.trim()) {
      this.resultadosBusqueda = [];
      return;
    }
    this.buscando = true;
    this.resultadosBusqueda = await this.supabaseService.buscarPersonas(this.query, this.userId);
    this.buscando = false;
  }

  loSigo(id: string): boolean {
    return this.idsQueSigo.has(id);
  }

  async toggleSeguir(persona: Profile) {
    if (this.loSigo(persona.id)) {
      await this.supabaseService.dejarDeSeguir(persona.id);
      this.idsQueSigo.delete(persona.id);
    } else {
      await this.supabaseService.seguir(persona.id);
      this.idsQueSigo.add(persona.id);
    }

    // Si estamos parados en la pestaña "seguidos", refrescamos la lista
    // para que desaparezca de inmediato al dejar de seguir a alguien.
    if (this.tab === 'seguidos') {
      this.seguidos = await this.supabaseService.listaSeguidos(this.userId);
    }
  }

  volver() {
    this.router.navigate(['/profile']);
  }
}
