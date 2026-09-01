import { Injectable } from '@angular/core';

const STATIC_CACHE_NAME = 'signy-static-v1';
const MEDIA_PERMANENT_CACHE_NAME = 'signy-media-permanent-v1';
const MASTER_PACK_STORAGE_KEY = 'signy_master_pack_version';
const CURRENT_PACK_VERSION = '1.1';

/**
 * Gestiona el almacenamiento y ciclo de vida de recursos multimedia (WebP, GIF, MP4, imágenes).
 * - Arquitectura Híbrida Inteligente con Paquete Maestro:
 *   1. Paquete Maestro Único (.zip): Descarga 1 sola vez en la vida de la app todo el catálogo
 *      de señas en formato WebP comprimido (8-10 MB total) y lo descomprime en el CacheStorage local.
 *   2. Almacenamiento Permanente en Disco: Cada seña se sirve en 0ms y con 0 peticiones de red.
 *   3. Memoria RAM: Se liberan los Object URLs al salir de la lección para evitar sobrecalentamiento.
 */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private staticMemoryUrls = new Map<string, string>();
  private activeLessonMemoryUrls = new Map<string, string>();
  private activeLessonBlobUrls = new Set<string>();

  /**
   * Verifica si el paquete maestro de señas ya está instalado en el dispositivo.
   */
  estaPackInstalado(): boolean {
    try {
      return localStorage.getItem(MASTER_PACK_STORAGE_KEY) === CURRENT_PACK_VERSION;
    } catch {
      return false;
    }
  }

  /**
   * Descarga el paquete maestro comprimido (.zip) desde Supabase en una sola petición
   * y guarda el archivo .zip INTACTO en el almacenamiento permanente del teléfono (CacheStorage).
   * No lo descomprime todavía (Lazy Unzip).
   */
  async instalarPaqueteMaestro(
    zipUrl: string,
    baseUrlSupabase: string,
    onProgreso?: (porcentaje: number, texto: string) => void
  ): Promise<boolean> {
    if (this.estaPackInstalado()) {
      onProgreso?.(100, 'Vocabulario listo');
      return true;
    }

    try {
      onProgreso?.(10, 'Iniciando descarga de vocabulario…');

      let response = await fetch(zipUrl);
      
      // Si el ZIP aún no existe en Supabase (404), pedirle a la Edge Function que lo genere
      if (response.status === 404) {
        onProgreso?.(15, 'Generando paquete maestro en la nube…');
        try {
          const { environment } = await import('../../environments/environment');
          const fnUrl = 'https://bjxcdhtigbsbibcltnup.supabase.co/functions/v1/generate-master-pack';
          const genRes = await fetch(fnUrl, { 
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${environment.supabase.key}`
            }
          });
          if (genRes.ok) {
            onProgreso?.(30, 'Descargando paquete maestro…');
            response = await fetch(zipUrl);
          }
        } catch (genErr) {
          console.warn('ImageCache: No se pudo auto-generar el paquete en la nube:', genErr);
        }
      }

      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status} al descargar el paquete maestro.`);
      }

      onProgreso?.(60, 'Guardando paquete en el disco…');
      
      // Guardar el ZIP entero tal cual en CacheStorage
      const mediaCache = await caches.open(MEDIA_PERMANENT_CACHE_NAME);
      await mediaCache.put('/master_pack.zip', response.clone());

      try {
        localStorage.setItem(MASTER_PACK_STORAGE_KEY, CURRENT_PACK_VERSION);
      } catch {}

      onProgreso?.(100, '¡Curso instalado y listo para usar sin internet!');
      return true;
    } catch (e) {
      console.warn('ImageCache: No se pudo instalar el paquete maestro:', e);
      return false;
    }
  }

  /**
   * Descompresión dinámica (Lazy Unzip): 
   * Abre el ZIP almacenado en disco y extrae a memoria RAM SOLO los archivos que 
   * necesita la lección actual, a 0ms de red.
   */
  async precargarSubnivel(urls: string[], onProgress?: (completados: number, total: number) => void): Promise<void> {
    if (!('caches' in window) || !urls || !urls.length) return;

    const total = urls.length;
    let completados = 0;
    
    let zipInstance: any = null;

    try {
      // 1. Intentar cargar el ZIP maestro desde el disco local
      const mediaCache = await caches.open(MEDIA_PERMANENT_CACHE_NAME);
      const zipResponse = await mediaCache.match('/master_pack.zip');
      
      if (zipResponse) {
        // Carga dinámica de JSZip y lectura del índice del ZIP
        const jszipModule = await import('jszip');
        const JSZip = (jszipModule as any).default || jszipModule;
        const zipBlob = await zipResponse.blob();
        zipInstance = await JSZip.loadAsync(zipBlob);
      }
      
      await Promise.all(
        urls.map(async (url) => {
          if (!url) {
            completados++;
            onProgress?.(completados, total);
            return;
          }

          try {
            // Si ya está en memoria activa de la lección, no hacer nada
            if (this.activeLessonMemoryUrls.has(url)) return;

            let fileBlob: Blob | null = null;
            
            // Si tenemos el ZIP cargado, extraer el archivo dinámicamente
            if (zipInstance) {
              const nombreLimpio = url.split('/').pop() || url;
              const fileInZip = zipInstance.file(nombreLimpio);
              if (fileInZip) {
                fileBlob = await fileInZip.async('blob');
              }
            }
            
            // Fallback por si la seña es muy nueva y no estaba en el ZIP (descarga normal)
            if (!fileBlob) {
              let cacheRes = await mediaCache.match(url);
              if (!cacheRes) {
                await mediaCache.add(url);
                cacheRes = await mediaCache.match(url);
              }
              if (cacheRes) fileBlob = await cacheRes.blob();
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
      console.warn('ImageCache: Error durante la precarga/extracción del subnivel:', e);
    }
  }

  /**
   * Libera la memoria RAM del teléfono revocando todos los Object URLs creados
   * durante la lección activa.
   * IMPORTANTE: Los archivos se conservan intactos en el disco dentro del ZIP.
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

  /**
   * Alias de compatibilidad hacia atrás para lecciones existentes.
   */
  async limpiarCacheSubnivel(): Promise<void> {
    this.liberarMemoriaRAM();
  }

  /**
   * Resuelve una URL obteniéndola desde la memoria RAM, sin bloquear la red.
   */
  async resolve(url: string): Promise<string> {
    if (!url || !('caches' in window)) return url;

    // 1. Memoria rápida activa (0ms)
    if (this.activeLessonMemoryUrls.has(url)) {
      return this.activeLessonMemoryUrls.get(url)!;
    }
    if (this.staticMemoryUrls.has(url)) {
      return this.staticMemoryUrls.get(url)!;
    }
    
    // 2. Revisar en la caché estática de interfaz fija
    try {
      const staticCache = await caches.open(STATIC_CACHE_NAME);
      let staticResponse = await staticCache.match(url);
      if (!staticResponse) {
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

  /**
   * Permite forzar la actualización de un recurso si el administrador sube una
   * nueva versión de una seña con el mismo nombre.
   */
  async invalidarRecurso(url: string): Promise<void> {
    if (!url || !('caches' in window)) return;
    try {
      const mediaCache = await caches.open(MEDIA_PERMANENT_CACHE_NAME);
      await mediaCache.delete(url);
      this.activeLessonMemoryUrls.delete(url);
    } catch (e) {
      console.warn('ImageCache: Error al invalidar recurso:', url, e);
    }
  }
}
