import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController, NavController, Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Subscription } from 'rxjs';
import { AppAdapter } from './capacitor-plugins';

/**
 * Lo que hace una pantalla con el botón atrás antes que la navegación normal:
 * cerrar un panel, retroceder un paso, pedir confirmación… Devuelve `true` si
 * ya lo resolvió y `false` para que siga el comportamiento normal (volver).
 */
export type ManejadorAtras = () => boolean | Promise<boolean>;

/** Manejador de una pantalla, listo para activarlo y desactivarlo con su ciclo de vida. */
export interface ManejoAtrasPantalla {
  /** En `ionViewWillEnter`. */
  activar(): void;
  /** En `ionViewWillLeave` (y en `ngOnDestroy` si la pantalla lo tiene). */
  desactivar(): void;
}

/**
 * Prioridad en la cola de Ionic: por debajo de los overlays (100: alertas,
 * modales, action sheets de los ion-select) y del menú (99), que se cierran
 * primero con el botón atrás, y por encima de la navegación por defecto de
 * Ionic (0), que este servicio reemplaza.
 */
export const PRIORIDAD_BOTON_ATRAS = 10;

/**
 * Pantallas raíz: atrás minimiza la app, como en cualquier app de Android.
 * Desde /home tampoco se vuelve a /auth/login aunque esté abajo en la pila
 * (el guard de invitado rebotaría de nuevo a /home).
 */
export const RUTAS_RAIZ = ['/home', '/auth/login', '/onboarding'];

/** A dónde volver si no hay pantalla anterior en la pila (por ejemplo, tras un guard que redirigió). */
const PADRES: readonly [RegExp, string][] = [
  [/^\/(friends|settings)$/, '/profile'],
  [/^\/auth\/(register|recuperar)$/, '/auth/login'],
];

/**
 * Botón atrás del teléfono (y gesto de volver de Android).
 *
 *   1. Si hay una alerta, modal o selector abierto, Ionic lo cierra (prioridad 100).
 *   2. Si la pantalla visible (o un modal) registró un manejador, decide ella
 *      (p. ej. la lección pregunta "¿Salir de la lección?").
 *   3. Con un modal abierto que no se cierra con atrás, no se navega por debajo.
 *   4. En una pantalla raíz, minimiza la app.
 *   5. Si no, vuelve a la pantalla anterior; y si no hay, a la pantalla "padre".
 *
 * Las pantallas registran su manejador en `ionViewWillEnter` y lo quitan en
 * `ionViewWillLeave`: así solo responde la que está a la vista, aunque las
 * anteriores sigan vivas en la pila de Ionic.
 *
 *   private readonly atras = inject(BotonAtrasService).paraPantalla(() => this.alPresionarAtras());
 *   ionViewWillEnter() { this.atras.activar(); }
 *   ionViewWillLeave() { this.atras.desactivar(); }
 */
@Injectable({ providedIn: 'root' })
export class BotonAtrasService {
  private readonly platform = inject(Platform);
  private readonly router = inject(Router);
  private readonly app = inject(AppAdapter);
  // NavController y ModalController se piden recién al usarlos: así crear el
  // servicio no arrastra la maquinaria de navegación de Ionic (ni al arrancar ni en pruebas).
  private readonly injector = inject(Injector);

  private suscripcion: Subscription | null = null;
  private readonly manejadores: ManejadorAtras[] = [];

  /** Se llama una vez al arrancar la app (AppComponent). */
  iniciar(): void {
    if (this.suscripcion) return;
    this.suscripcion = this.platform.backButton.subscribeWithPriority(PRIORIDAD_BOTON_ATRAS, () => this.alPresionar());
    if (Capacitor.isNativePlatform()) {
      this.app.tomarControlBotonAtras().catch((e) => console.warn('No se pudo tomar el control del botón atrás:', e));
    }
  }

  /** Registra el manejador de la pantalla visible. Devuelve la función para quitarlo. */
  registrar(manejador: ManejadorAtras): () => void {
    this.manejadores.push(manejador);
    return () => {
      const i = this.manejadores.lastIndexOf(manejador);
      if (i >= 0) this.manejadores.splice(i, 1);
    };
  }

  /** Atajo para pantallas: el mismo manejador, activable y desactivable sin duplicarse. */
  paraPantalla(manejador: ManejadorAtras): ManejoAtrasPantalla {
    let quitar: (() => void) | null = null;
    return {
      activar: () => {
        quitar?.();
        quitar = this.registrar(manejador);
      },
      desactivar: () => {
        quitar?.();
        quitar = null;
      },
    };
  }

  /** Lo que pasa al presionar atrás (público para las pruebas). */
  async alPresionar(): Promise<void> {
    const manejador = this.manejadores[this.manejadores.length - 1];
    if (manejador) {
      try {
        if (await manejador()) return;
      } catch (e) {
        console.error('Error en el manejador del botón atrás:', e);
      }
    }
    // Un modal abierto con backdropDismiss: false no lo cierra Ionic: nunca
    // navegar por debajo de él (quedaría flotando sobre otra pantalla).
    if (await this.hayModalAbierto()) return;
    await this.volver();
  }

  /** Navegación normal hacia atrás, sin pasar por el manejador de la pantalla. */
  async volver(): Promise<void> {
    const ruta = this.rutaActual();
    if (RUTAS_RAIZ.includes(ruta)) {
      await this.minimizar();
      return;
    }
    const navCtrl = this.injector.get(NavController);
    if (await navCtrl.pop()) return;
    await navCtrl.navigateBack(this.padreDe(ruta));
  }

  private async hayModalAbierto(): Promise<boolean> {
    try {
      return !!(await this.injector.get(ModalController).getTop());
    } catch {
      return false;
    }
  }

  private rutaActual(): string {
    return this.router.url.split(/[?#]/)[0] || '/';
  }

  private padreDe(ruta: string): string {
    return PADRES.find(([patron]) => patron.test(ruta))?.[1] ?? '/home';
  }

  private async minimizar(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await this.app.minimizar();
    } catch (e) {
      console.warn('No se pudo minimizar la app:', e);
    }
  }
}
