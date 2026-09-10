import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SpeechSynthesisVoice } from '@capacitor-community/text-to-speech';
import { SupabaseService } from './supabase';
import { TextToSpeechAdapter } from './capacitor-plugins';

/**
 * Servicio de texto a voz (accesibilidad).
 *
 * Usa el plugin nativo `@capacitor-community/text-to-speech` 
 */
@Injectable({ providedIn: 'root' })
export class TtsService {
  private cacheHabilitado = new Map<string, boolean>();
  private cacheVoz = new Map<string, string | null>();
  private cacheVoces: SpeechSynthesisVoice[] | null = null;

  constructor(
    private supabaseService: SupabaseService,
    private textToSpeech: TextToSpeechAdapter
  ) {}

  
  disponible(): boolean {
    return Capacitor.isNativePlatform() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
  }

  // ========== PREFERENCIA: ¿ACTIVADO? ==========
  async estaHabilitado(userId: string): Promise<boolean> {
    if (this.cacheHabilitado.has(userId)) {
      return this.cacheHabilitado.get(userId)!;
    }
    const { data: perfil } = await this.supabaseService.getProfile(userId);
    // Si la columna aún es null (perfiles anteriores a este cambio), se
    // trata como activado, igual que el default de la base de datos.
    const habilitado = perfil?.tts_habilitado ?? true;
    this.cacheHabilitado.set(userId, habilitado);
    return habilitado;
  }

  async establecerHabilitado(userId: string, valor: boolean) {
    this.cacheHabilitado.set(userId, valor);
    return this.supabaseService.upsertProfile({ id: userId, tts_habilitado: valor });
  }

  // ========== PREFERENCIA: ¿QUÉ VOZ? ==========
  /**
   * Nombre (`SpeechSynthesisVoice.name`) de la voz elegida por el usuario,
   * o `null` si quiere la voz predeterminada del sistema.
   */
  async obtenerVozPreferida(userId: string): Promise<string | null> {
    if (this.cacheVoz.has(userId)) {
      return this.cacheVoz.get(userId)!;
    }
    const { data: perfil } = await this.supabaseService.getProfile(userId);
    const voz = perfil?.tts_voz ?? null;
    this.cacheVoz.set(userId, voz);
    return voz;
  }

  async establecerVoz(userId: string, nombreVoz: string | null) {
    this.cacheVoz.set(userId, nombreVoz);
    return this.supabaseService.upsertProfile({ id: userId, tts_voz: nombreVoz });
  }

  /**
   * Lista las voces que el dispositivo tiene instaladas, con las voces en
   * español primero (para que sean las más fáciles de encontrar en el
   * selector de Configuración).
   
   */
  async listarVoces(): Promise<SpeechSynthesisVoice[]> {
    if (this.cacheVoces && this.cacheVoces.length) return this.cacheVoces;

    let voices = await this.obtenerVocesCrudas();

    if (!voices.length && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      voices = await this.esperarVocesAsincronas();
    }

    const enEspanol = voices.filter(v => v.lang?.toLowerCase().startsWith('es'));
    const resto = voices.filter(v => !v.lang?.toLowerCase().startsWith('es'));
    this.cacheVoces = [...enEspanol, ...resto];
    return this.cacheVoces;
  }

  private async obtenerVocesCrudas(): Promise<SpeechSynthesisVoice[]> {
    try {
      const { voices } = await this.textToSpeech.getSupportedVoices();
      return voices;
    } catch {
      return [];
    }
  }

  /** Espera el evento `voiceschanged` (máx. 1.5s) y reintenta una vez. */
  private esperarVocesAsincronas(): Promise<SpeechSynthesisVoice[]> {
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      let resuelto = false;

      const terminar = async () => {
        if (resuelto) return;
        resuelto = true;
        synth.removeEventListener('voiceschanged', terminar);
        resolve(await this.obtenerVocesCrudas());
      };

      synth.addEventListener('voiceschanged', terminar);
      setTimeout(terminar, 1500); 
    });
  }

  // ========== HABLAR ==========
  /**
   * Lee un texto en voz alta sin importar la preferencia de "activado"
   * guardada. Pensado para el botón "Probar" en Configuración, donde el
   * usuario quiere escuchar la voz elegida antes de confirmar el cambio.
   *
   * @param nombreVoz nombre exacto de `SpeechSynthesisVoice.name`, o
   *   `null`/`undefined` para dejar que el sistema use su voz por defecto.
   */
  async hablar(texto: string, nombreVoz?: string | null) {
    if (!texto) return;

    let indiceVoz: number | undefined;
    if (nombreVoz) {
      const voces = await this.listarVoces();
      const indice = voces.findIndex(v => v.name === nombreVoz);
      if (indice >= 0) indiceVoz = indice;
    }

    try {
      await this.textToSpeech.speak({
        text: texto,
        lang: 'es-CL',
        rate: 0.95,
        voice: indiceVoz,
      });
    } catch {
      
    }
  }

  /**
   * Lee un texto solo si el usuario tiene la preferencia activada, usando
   * la voz que haya elegido (o la del sistema si no eligió ninguna). 
   */
  async hablarSiHabilitado(userId: string, texto: string) {
    const habilitado = await this.estaHabilitado(userId);
    if (!habilitado) return;

    const voz = await this.obtenerVozPreferida(userId);
    await this.hablar(texto, voz);
  }
}