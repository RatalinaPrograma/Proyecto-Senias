import { Injectable } from '@angular/core';
import { PreferencesAdapter } from './capacitor-plugins';

const CLAVE_ANIMAR_TODAS = 'signy.emparejar.animarTodas';

/**
 * Preferencias de reproducción de las señas, guardadas en ESTE dispositivo
 * (no en la cuenta): dependen de qué tan potente es el celular.
 *
 * `animarTodas`: en el emparejar, todas las señas se reproducen a la vez
 * (por defecto). Si el celular se pone lento, se desactiva en Ajustes y solo
 * se anima la seña que se toca (las demás quedan en su primer cuadro con ▶).
 */
@Injectable({ providedIn: 'root' })
export class PreferenciasVideoService {
  private animarTodasCache: boolean | null = null;

  constructor(private preferences: PreferencesAdapter) {}

  async animarTodas(): Promise<boolean> {
    if (this.animarTodasCache !== null) return this.animarTodasCache;
    try {
      const { value } = await this.preferences.get({ key: CLAVE_ANIMAR_TODAS });
      this.animarTodasCache = value !== 'false';
    } catch {
      this.animarTodasCache = true; // sin almacenamiento disponible: el comportamiento por defecto
    }
    return this.animarTodasCache;
  }

  async setAnimarTodas(valor: boolean): Promise<void> {
    this.animarTodasCache = valor;
    try {
      await this.preferences.set({ key: CLAVE_ANIMAR_TODAS, value: String(valor) });
    } catch (e) {
      console.warn('No se pudo guardar la preferencia de animación:', e);
    }
  }
}
