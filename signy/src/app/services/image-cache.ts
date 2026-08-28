import { Injectable } from '@angular/core';

const STATIC_CACHE_NAME = 'signy-static-v1';
const SUBNIVEL_CACHE_NAME = 'signy-subnivel-media';

/**
 * Gestiona el almacenamiento en caché de imágenes y GIFs en el WebView/Navegador.
 * - `signy-static-v1`: Recursos permanentes de la interfaz (mascota, íconos UI).
 * - `signy-subnivel-media`: GIFs y videos de las señas de la lección actual,
 *   precargados al iniciar el subnivel y eliminados al salir/completar para no
 *   acumular almacenamiento ni consumir memoria excesiva.
 */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private staticMemoryUrls = new Map<string, string>();
  private subnivelMemoryUrls = new Map<string, string>();
  private subnivelBlobUrls = new Set<string>();

  /**
   * Precarga en segundo plano todos los recursos multimedia (GIFs/videos)
   * del subnivel actual y los deja listos en memoria y en la caché temporal.
   */
  async precargarSubnivel(urls: string[]): Promise<void> {
    if (!('caches' in window) || !urls || !urls.length) return;

    try {
      const cache = await caches.open(SUBNIVEL_CACHE_NAME);
      await Promise.all(
        urls.map(async (url) => {
          if (!url) return;

          try {
            let response = await cache.match(url);
            if (!response) {
              await cache.add(url);
              response = await cache.match(url);
            }

            if (response) {
              const blob = await response.blob();
              const blobUrl = URL.createObjectURL(blob);
              this.subnivelBlobUrls.add(blobUrl);
              this.subnivelMemoryUrls.set(url, blobUrl);
            }
          } catch (err) {
            console.warn('ImageCache: No se pudo precargar URL:', url, err);
          }
        })
      );
    } catch (e) {
      console.warn('ImageCache: Error durante la precarga del subnivel:', e);
    }
  }

  /**
   * Elimina toda la caché temporal de la lección actual y libera los Object URLs
   * de memoria (RAM) generados durante la lección.
   */
  async limpiarCacheSubnivel(): Promise<void> {
    // 1. Revocar los URLs de blobs en memoria para liberar RAM
    for (const blobUrl of this.subnivelBlobUrls) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }
    this.subnivelBlobUrls.clear();
    this.subnivelMemoryUrls.clear();

    // 2. Eliminar el almacén de caché del subnivel del almacenamiento físico
    if ('caches' in window) {
      try {
        await caches.delete(SUBNIVEL_CACHE_NAME);
      } catch (e) {
        console.warn('ImageCache: Error al purgar caché de subnivel:', e);
      }
    }
  }

  /**
   * Resuelve una URL obteniéndola desde la memoria, la caché de subnivel o
   * la caché estática, con fallback a la red directa.
   */
  async resolve(url: string): Promise<string> {
    if (!url || !('caches' in window)) return url;

    // 1. Memoria rápida (0ms si ya está precargada)
    if (this.subnivelMemoryUrls.has(url)) {
      return this.subnivelMemoryUrls.get(url)!;
    }
    if (this.staticMemoryUrls.has(url)) {
      return this.staticMemoryUrls.get(url)!;
    }

    try {
      // 2. Revisar si está en la caché de subnivel
      const subnivelCache = await caches.open(SUBNIVEL_CACHE_NAME);
      let response = await subnivelCache.match(url);
      if (response) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.subnivelBlobUrls.add(blobUrl);
        this.subnivelMemoryUrls.set(url, blobUrl);
        return blobUrl;
      }

      // 3. Revisar / almacenar en la caché estática fija
      const staticCache = await caches.open(STATIC_CACHE_NAME);
      response = await staticCache.match(url);
      if (!response) {
        await staticCache.add(url);
        response = await staticCache.match(url);
      }

      if (response) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.staticMemoryUrls.set(url, blobUrl);
        return blobUrl;
      }

      return url;
    } catch {
      return url; // En caso de CORS o problemas de red, usa la URL directa
    }
  }
}
