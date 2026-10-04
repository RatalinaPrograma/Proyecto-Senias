import { Injectable } from '@angular/core';

const STATIC_CACHE_NAME = 'signy-static-v1';
const MEDIA_PERMANENT_CACHE_NAME = 'signy-media-permanent-v1';

/**
 * Gestiona el almacenamiento permanente de assets en CacheStorage.
 * Ya no usamos ZIP: se descarga cada MP4/imagen y se guarda nativamente en el disco.
 */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private staticMemoryUrls = new Map<string, string>();
  private activeLessonMemoryUrls = new Map<string, string>();
  private activeLessonBlobUrls = new Set<string>();

  // Mantenido por compatibilidad con home.page.ts (ya no chequea el pack maestro)
  estaPackInstalado(): boolean {
    return true; 
  }

  // Mantenido por compatibilidad con home.page.ts. Ya no hace nada.
  async instalarPaqueteMaestro(
    zipUrl: string,
    baseUrlSupabase: string,
    onProgreso?: (porcentaje: number, texto: string) => void
  ): Promise<boolean> {
    return true;
  }

  /**
   * Precarga dinámica y local:
   * Revisa si cada URL está en CacheStorage. Si no, la descarga y guarda.
   * Luego la pasa a memoria RAM como un ObjectURL rápido para que no haya parpadeos.
   */
  async precargarSubnivel(urls: string[], onProgress?: (completados: number, total: number) => void): Promise<void> {
    if (!('caches' in window) || !urls || !urls.length) return;

    const total = urls.length;
    let completados = 0;

    try {
      const mediaCache = await caches.open(MEDIA_PERMANENT_CACHE_NAME);
      
      // Descargamos en lotes o paralelamente
      await Promise.all(
        urls.map(async (url) => {
          if (!url) {
            completados++;
            onProgress?.(completados, total);
            return;
          }

          try {
            // Si ya está en RAM activa de la lección, saltar
            if (this.activeLessonMemoryUrls.has(url)) return;

            let fileBlob: Blob | null = null;
            
            // Buscar en disco permanente
            let cacheRes = await mediaCache.match(url);
            if (!cacheRes) {
              // Descargar de la red y guardar permanentemente
              await mediaCache.add(url);
              cacheRes = await mediaCache.match(url);
            }
            if (cacheRes) {
              fileBlob = await cacheRes.blob();
            }

            // Guardar en memoria RAM activa
            if (fileBlob) {
              const blobUrl = URL.createObjectURL(fileBlob);
              this.activeLessonBlobUrls.add(blobUrl);
              this.activeLessonMemoryUrls.set(url, blobUrl);
            }
          } catch (err) {
            console.warn('ImageCache: No se pudo precargar recurso dinámico:', url, err);
          } finally {
            completados++;
            onProgress?.(completados, total);
          }
        })
      );
    } catch (e) {
      console.warn('ImageCache: Error durante la precarga del subnivel:', e);
    }
  }

  /**
   * Libera la memoria RAM del teléfono al salir de la lección.
   * Los MP4 se quedan en el disco local permanentemente.
   */
  liberarMemoriaRAM(): void {
    for (const blobUrl of this.activeLessonBlobUrls) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }
    this.activeLessonBlobUrls.clear();
    this.activeLessonMemoryUrls.clear();
  }

  async limpiarCacheSubnivel(): Promise<void> {
    this.liberarMemoriaRAM();
  }

  async resolve(url: string): Promise<string> {
    if (!url || !('caches' in window)) return url;

    // 1. Memoria rápida activa (0ms)
    if (this.activeLessonMemoryUrls.has(url)) {
      return this.activeLessonMemoryUrls.get(url)!;
    }
    if (this.staticMemoryUrls.has(url)) {
      return this.staticMemoryUrls.get(url)!;
    }
    
    // 2. Caché estática o permanente
    try {
      const staticCache = await caches.open(STATIC_CACHE_NAME);
      let staticResponse = await staticCache.match(url);
      
      if (!staticResponse) {
        const mediaCache = await caches.open(MEDIA_PERMANENT_CACHE_NAME);
        staticResponse = await mediaCache.match(url);
      }

      if (!staticResponse) {
        // Fallback: descargar directo
        await staticCache.add(url);
        staticResponse = await staticCache.match(url);
      }

      if (staticResponse) {
        const blob = await staticResponse.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.staticMemoryUrls.set(url, blobUrl);
        return blobUrl;
      }
    } catch {}

    return url;
  }

  async invalidarRecurso(url: string): Promise<void> {
    if (!url || !('caches' in window)) return;
    try {
      const mediaCache = await caches.open(MEDIA_PERMANENT_CACHE_NAME);
      await mediaCache.delete(url);
      this.activeLessonMemoryUrls.delete(url);
      
      const staticCache = await caches.open(STATIC_CACHE_NAME);
      await staticCache.delete(url);
      this.staticMemoryUrls.delete(url);
    } catch (e) {
      console.warn('ImageCache: Error al invalidar recurso:', url, e);
    }
  }
}
