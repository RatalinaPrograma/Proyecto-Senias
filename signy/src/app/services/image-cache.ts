import { Injectable } from '@angular/core';
import { esVideoMp4 } from '../shared/media-utils';

const MEDIA_CACHE_NAME = 'signy-media-v1';
const CONCURRENCIA_PRECARGA = 4;
/** Póster transparente 1x1 para evitar que Android WebView muestre su ícono gris de "Play" mientras prepara el video. */
export const POSTER_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Gestiona el almacenamiento en caché de imágenes, GIFs/WebP y video de
 * señas en el WebView/Navegador.
 *
 * Arquitectura híbrida (caché permanente): `signy-media-v1` vive en el disco
 * del celular y NUNCA se purga desde acá. Íconos de interfaz y señas de
 * lecciones se descargan una sola vez en la vida del usuario y quedan
 * guardados para siempre — volver a entrar a un subnivel ya visto no vuelve
 * a gastar datos ni egress de Supabase Storage.
 *
 * Lo único que se libera al salir de una lección es la RAM (los Object URLs
 * creados en memoria vía `liberarMemoriaRAM()`); el archivo en disco queda
 * intacto.
 */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private memoryUrls = new Map<string, string>();
  private blobUrls = new Set<string>();
  /** Evita descargar dos veces el mismo archivo ni fugar ObjectURLs si dos componentes piden la misma URL en paralelo. */
  private enVuelo = new Map<string, Promise<string>>();

  /**
   * Devuelve el ObjectURL de forma síncrona (0 ms) si ya fue precargado en esta sesión.
   * Evita el parpadeo de 1 frame al montar `<video>` o `<img>` en Flashcards, Match y Quiz.
   */
  getSincrono(url: string | null | undefined): string | null {
    if (!url) return null;
    return this.memoryUrls.get(url) ?? null;
  }

  /**
   * Precarga en segundo plano todos los recursos multimedia (GIFs/WebP/MP4)
   * del subnivel actual y pre-decodifica su primer cuadro antes de terminar la
   * pantalla de carga, para que al entrar a la lección los videos arranquen de
   * inmediato sin parpadeos ni íconos de carga.
   */
  async precargarSubnivel(urls: string[], onProgress?: (completados: number, total: number) => void): Promise<void> {
    if (!('caches' in window) || !urls || !urls.length) return;

    const urlsUnicas = Array.from(new Set(urls.filter(Boolean)));
    const total = urlsUnicas.length;
    if (!total) return;

    let completados = 0;
    let cursor = 0;

    const trabajador = async () => {
      while (cursor < total) {
        const url = urlsUnicas[cursor++];
        try {
          const blobUrl = await this.resolve(url);
          await this.precalentarMedia(url, blobUrl);
        } catch (err) {
          console.warn('ImageCache: No se pudo precargar URL:', url, err);
        } finally {
          completados++;
          onProgress?.(completados, total);
        }
      }
    };

    try {
      const numTrabajadores = Math.min(CONCURRENCIA_PRECARGA, total);
      await Promise.all(Array.from({ length: numTrabajadores }, () => trabajador()));
    } catch (e) {
      console.warn('ImageCache: Error durante la precarga del subnivel:', e);
    }
  }

  /**
   * Pre-decodifica el video o imagen en memoria durante la pantalla de carga
   * para que el decodificador de hardware ya tenga listos los primeros frames.
   */
  private precalentarMedia(urlOriginal: string, blobUrl: string): Promise<void> {
    if (!blobUrl) return Promise.resolve();

    if (esVideoMp4(urlOriginal)) {
      return new Promise<void>((resolve) => {
        const video = document.createElement('video');
        let listo = false;
        const finalizar = () => {
          if (listo) return;
          listo = true;
          video.removeEventListener('loadeddata', finalizar);
          video.removeEventListener('error', finalizar);
          resolve();
        };
        const timer = setTimeout(finalizar, 1800);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.addEventListener('loadeddata', () => {
          clearTimeout(timer);
          finalizar();
        }, { once: true });
        video.addEventListener('error', () => {
          clearTimeout(timer);
          finalizar();
        }, { once: true });
        video.src = blobUrl;
        video.load();
      });
    }

    return new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().catch(() => {}).finally(() => resolve());
        } else {
          resolve();
        }
      };
      img.onerror = () => resolve();
      img.src = blobUrl;
    });
  }

  /**
   * Libera la RAM ocupada por los Object URLs generados en esta lección
   * (revoca los blobs en memoria). El archivo en disco (Cache Storage) NO
   * se toca: sigue ahí para la próxima vez que el usuario entre a este
   * subnivel, sin gastar datos ni Storage de Supabase de nuevo.
   */
  liberarMemoriaRAM(): void {
    for (const blobUrl of this.blobUrls) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }
    this.blobUrls.clear();
    this.memoryUrls.clear();
    this.enVuelo.clear();
  }

  /**
   * Resuelve una URL obteniéndola desde la memoria o la caché permanente de
   * disco, con fallback a la red directa solo la primera vez que se ve.
   */
  async resolve(url: string): Promise<string> {
    if (!url || !('caches' in window)) return url;

    // 1. Memoria rápida (0ms si ya está resuelta en esta sesión)
    const enMemoria = this.memoryUrls.get(url);
    if (enMemoria) return enMemoria;

    // 2. Si ya hay una petición en vuelo para esta misma URL, reutilizarla
    const pendiente = this.enVuelo.get(url);
    if (pendiente) return pendiente;

    const promesa = this.cargarDesdeCacheORed(url).finally(() => {
      this.enVuelo.delete(url);
    });
    this.enVuelo.set(url, promesa);
    return promesa;
  }

  private async cargarDesdeCacheORed(url: string): Promise<string> {
    try {
      const cache = await caches.open(MEDIA_CACHE_NAME);
      let response = await cache.match(url);
      if (!response) {
        // Primera vez que se ve esta seña: se descarga y queda en
        // disco de forma permanente, no se vuelve a pedir nunca más.
        await cache.add(url);
        response = await cache.match(url);
      }

      if (response) {
        const yaEnMemoria = this.memoryUrls.get(url);
        if (yaEnMemoria) return yaEnMemoria;

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.blobUrls.add(blobUrl);
        this.memoryUrls.set(url, blobUrl);
        return blobUrl;
      }

      return url;
    } catch {
      return url; // En caso de CORS o problemas de red, usa la URL directa
    }
  }
}
