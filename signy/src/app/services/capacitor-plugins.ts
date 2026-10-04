import { Injectable } from '@angular/core';
import { PermissionState } from '@capacitor/core';
import {
  LocalNotifications,
  ScheduleOptions,
  CancelOptions,
  Channel,
} from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { TextToSpeech, TTSOptions, SpeechSynthesisVoice } from '@capacitor-community/text-to-speech';
import { App } from '@capacitor/app';

@Injectable({ providedIn: 'root' })
export class AppAdapter {
  /**
   * Avisa a Android que el botón atrás lo maneja la app. Sin ningún listener,
   * el plugin retrocede el historial del WebView o no hace nada, y sin el
   * plugin instalado Android cierra la app directamente.
   */
  tomarControlBotonAtras(): Promise<unknown> {
    return App.addListener('backButton', () => {
      // La navegación la decide BotonAtrasService (vía el evento de Ionic).
    });
  }
  /** Manda la app al fondo sin cerrarla (lo mismo que hace Android en una pantalla raíz). */
  minimizar(): Promise<void> {
    return App.minimizeApp();
  }
}

@Injectable({ providedIn: 'root' })
export class PreferencesAdapter {
  get(options: { key: string }) {
    return Preferences.get(options);
  }
  set(options: { key: string; value: string }) {
    return Preferences.set(options);
  }
}

@Injectable({ providedIn: 'root' })
export class LocalNotificationsAdapter {
  checkPermissions(): Promise<{ display: PermissionState }> {
    return LocalNotifications.checkPermissions();
  }
  requestPermissions(): Promise<{ display: PermissionState }> {
    return LocalNotifications.requestPermissions();
  }
  createChannel(channel: Channel) {
    return LocalNotifications.createChannel(channel);
  }
  schedule(options: ScheduleOptions) {
    return LocalNotifications.schedule(options);
  }
  cancel(options: CancelOptions) {
    return LocalNotifications.cancel(options);
  }
}

@Injectable({ providedIn: 'root' })
export class TextToSpeechAdapter {
  getSupportedVoices(): Promise<{ voices: SpeechSynthesisVoice[] }> {
    return TextToSpeech.getSupportedVoices();
  }
  speak(options: TTSOptions) {
    return TextToSpeech.speak(options);
  }
}
