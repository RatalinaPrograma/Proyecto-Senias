import { Injectable } from '@angular/core';

const MEDIA_CACHE_NAME = 'signy-media-v1';

/**
 * Gestiona el almacenamiento en caché de imágenes, GIFs/WebP y video de
 * señas en el WebView/Navegador.
 *
 * Arquitectura híbrida (caché permanente): `signy-media-v1` vive en el disco
 * del celular y NUNCA se purga desde acá. Íconos de interfaz y señas de
 * lecciones se descargan una sola vez en la vida del usuario y quedan
 * guardados para siempre — volver a entrar a un subnivel ya visto no vuelve
 * a gastar datos ni egress de Supabase Storage. Antes había un caché
 * temporal por subnivel que se borraba al salir de cada lección, obligando
 * a re-descargar el mismo contenido una y otra vez; eso es justo lo que
 * este esquema evita.
 *
 * Lo único que se libera al salir de una lección es la RAM (los Object URLs
 * creados en memoria vía `liberarMemoriaRAM()`); el archivo en disco queda
 * intacto.
 */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private memoryUrls = new Map<string, string>();
  private blobUrls = new Set<string>();

  /**
   * Precarga en segundo plano todos los recursos multimedia (GIFs/WebP/MP4)
   * del subnivel actual. Si un recurso ya está en disco (visto en una sesión
   * anterior), se lee directo de ahí sin pedirlo de nuevo a Supabase.
   * `onProgress`, si se entrega, se llama cada vez que un recurso termina
   * (con éxito o con error) para poder mostrar una barra de carga real.
   */
  async precargarSubnivel(urls: string[], onProgress?: (completados: number, total: number) => void): Promise<void> {
    if (!('caches' in window) || !urls || !urls.length) return;

    const total = urls.length;
    let completados = 0;

    try {
      const cache = await caches.open(MEDIA_CACHE_NAME);
      await Promise.all(
        urls.map(async (url) => {
          if (!url) { completados++; onProgress?.(completados, total); return; }

          try {
            let response = await cache.match(url);
            if (!response) {
              // Primera vez que se ve esta seña: se descarga y queda en
              // disco de forma permanente, no se vuelve a pedir nunca más.
              await cache.add(url);
              response = await cache.match(url);
            }

            if (response) {
              const blob = await response.blob();
              const blobUrl = URL.createObjectURL(blob);
              this.blobUrls.add(blobUrl);
              this.memoryUrls.set(url, blobUrl);
            }
          } catch (err) {
            console.warn('ImageCache: No se pudo precargar URL:', url, err);
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
  }

  /**
   * Resuelve una URL obteniéndola desde la memoria o la caché permanente de
   * disco, con fallback a la red directa solo la primera vez que se ve.
   */
  async resolve(url: string): Promise<string> {
    if (!url || !('caches' in window)) return url;

    // 1. Memoria rápida (0ms si ya está resuelta en esta sesión)
    if (this.memoryUrls.has(url)) {
      return this.memoryUrls.get(url)!;
    }

    try {
      // 2. Caché permanente en disco (cubre esta y cualquier sesión anterior)
      const cache = await caches.open(MEDIA_CACHE_NAME);
      let response = await cache.match(url);
      if (!response) {
        await cache.add(url);
        response = await cache.match(url);
      }

      if (response) {
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
