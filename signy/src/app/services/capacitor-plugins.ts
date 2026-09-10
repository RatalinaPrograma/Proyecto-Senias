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
