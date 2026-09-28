import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { TtsService } from './tts';
import { SupabaseService } from './supabase';
import { TextToSpeechAdapter } from './capacitor-plugins';
import { perfilDePrueba } from '../../testing/supabase-mock';

describe('TtsService', () => {
  let service: TtsService;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let ttsSpy: jasmine.SpyObj<TextToSpeechAdapter>;

  beforeEach(() => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['getProfile', 'upsertProfile']);
    ttsSpy = jasmine.createSpyObj('TextToSpeechAdapter', ['getSupportedVoices', 'speak']);
    ttsSpy.speak.and.resolveTo();
    ttsSpy.getSupportedVoices.and.resolveTo({ voices: [] });

    TestBed.configureTestingModule({
      providers: [
        TtsService,
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: TextToSpeechAdapter, useValue: ttsSpy },
      ],
    });
    service = TestBed.inject(TtsService);
  });

  describe('disponible()', () => {
    it('es true si Capacitor.isNativePlatform() lo dice, sin importar el navegador', () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      expect(service.disponible()).toBeTrue();
    });

    it('es true en un navegador con speechSynthesis (como Chrome, donde corre este test)', () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
      expect(service.disponible()).toBeTrue();
    });
  });

  describe('estaHabilitado', () => {
    it('trata tts_habilitado null como activado (default de la base de datos)', async () => {
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ tts_habilitado: null }), error: null });

      expect(await service.estaHabilitado('user-1')).toBeTrue();
    });

    it('respeta tts_habilitado: false', async () => {
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ tts_habilitado: false }), error: null });

      expect(await service.estaHabilitado('user-1')).toBeFalse();
    });

    it('cachea el resultado: la segunda llamada no vuelve a consultar el perfil', async () => {
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ tts_habilitado: false }), error: null });

      await service.estaHabilitado('user-1');
      await service.estaHabilitado('user-1');

      expect(supabaseSpy.getProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe('establecerHabilitado', () => {
    it('actualiza la caché de inmediato y persiste en el perfil', async () => {
      supabaseSpy.upsertProfile.and.resolveTo({ data: null, error: null } as any);

      await service.establecerHabilitado('user-1', false);

      expect(supabaseSpy.upsertProfile).toHaveBeenCalledWith({ id: 'user-1', tts_habilitado: false });
      expect(await service.estaHabilitado('user-1')).toBeFalse();
      expect(supabaseSpy.getProfile).not.toHaveBeenCalled(); // ya estaba en caché
    });
  });

  describe('obtenerVozPreferida / establecerVoz', () => {
    it('null si el usuario nunca eligió una voz', async () => {
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ tts_voz: null }), error: null });
      expect(await service.obtenerVozPreferida('user-1')).toBeNull();
    });

    it('establecerVoz actualiza la caché y persiste', async () => {
      supabaseSpy.upsertProfile.and.resolveTo({ data: null, error: null } as any);

      await service.establecerVoz('user-1', 'Voz Chile');

      expect(supabaseSpy.upsertProfile).toHaveBeenCalledWith({ id: 'user-1', tts_voz: 'Voz Chile' });
      expect(await service.obtenerVozPreferida('user-1')).toBe('Voz Chile');
    });
  });

  describe('listarVoces', () => {
    it('pone las voces en español primero, sin importar el orden original', async () => {
      ttsSpy.getSupportedVoices.and.resolveTo({
        voices: [
          { name: 'English US', lang: 'en-US' } as any,
          { name: 'Español Chile', lang: 'es-CL' } as any,
          { name: 'English UK', lang: 'en-GB' } as any,
        ],
      });

      const voces = await service.listarVoces();

      expect(voces.map(v => v.name)).toEqual(['Español Chile', 'English US', 'English UK']);
    });

    it('cachea el resultado: una segunda llamada no vuelve a pedir las voces', async () => {
      ttsSpy.getSupportedVoices.and.resolveTo({ voices: [{ name: 'Voz', lang: 'es-CL' } as any] });

      await service.listarVoces();
      await service.listarVoces();

      expect(ttsSpy.getSupportedVoices).toHaveBeenCalledTimes(1);
    });

    it('si el plugin nativo falla, devuelve una lista vacía en vez de romper', async () => {
      ttsSpy.getSupportedVoices.and.rejectWith(new Error('no soportado'));
      // Evita esperar el timeout real de 1.5s de esperarVocesAsincronas():
      // dispara "voiceschanged" casi de inmediato en vez de esperarlo.
      spyOn(window.speechSynthesis, 'addEventListener').and.callFake((_evento: string, cb: any) => {
        Promise.resolve().then(cb);
      });

      const voces = await service.listarVoces();

      expect(voces).toEqual([]);
    });
  });

  describe('hablar', () => {
    it('no llama al plugin si el texto está vacío', async () => {
      await service.hablar('');
      expect(ttsSpy.speak).not.toHaveBeenCalled();
    });

    it('habla sin índice de voz si no se pide una voz específica', async () => {
      await service.hablar('hola');
      expect(ttsSpy.speak).toHaveBeenCalledWith(jasmine.objectContaining({ text: 'hola', voice: undefined }));
    });

    it('resuelve el índice correcto cuando la voz pedida existe en la lista', async () => {
      ttsSpy.getSupportedVoices.and.resolveTo({
        voices: [{ name: 'A', lang: 'es' } as any, { name: 'B', lang: 'es' } as any],
      });

      await service.hablar('hola', 'B');

      expect(ttsSpy.speak).toHaveBeenCalledWith(jasmine.objectContaining({ voice: 1 }));
    });

    it('no revienta si el plugin de voz falla', async () => {
      ttsSpy.speak.and.rejectWith(new Error('boom'));
      await expectAsync(service.hablar('hola')).toBeResolved();
    });
  });

  describe('hablarSiHabilitado', () => {
    it('no habla si el usuario tiene el TTS desactivado', async () => {
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ tts_habilitado: false }), error: null });

      await service.hablarSiHabilitado('user-1', 'hola');

      expect(ttsSpy.speak).not.toHaveBeenCalled();
    });

    it('habla con la voz preferida si está habilitado', async () => {
      supabaseSpy.getProfile.and.resolveTo({ data: perfilDePrueba({ tts_habilitado: true, tts_voz: null }), error: null });

      await service.hablarSiHabilitado('user-1', 'hola');

      expect(ttsSpy.speak).toHaveBeenCalledWith(jasmine.objectContaining({ text: 'hola' }));
    });
  });
});
