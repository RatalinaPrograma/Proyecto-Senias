import { Injectable } from '@angular/core';

const CACHE_NAME = 'signy-images-v1';

/** Cachea imágenes remotas (íconos, gifs de señas) en el Cache Storage del WebView
 * para que solo se descarguen una vez, aunque el bucket de origen mande no-cache. */
@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  async resolve(url: string): Promise<string> {
    if (!url || !('caches' in window)) return url;
    try {
      const cache = await caches.open(CACHE_NAME);
      let response = await cache.match(url);
      if (!response) {
        await cache.add(url);
        response = await cache.match(url);
      }
      const blob = await response!.blob();
      return URL.createObjectURL(blob);
    } catch {
      return url; // ponytail: sin caché disponible (CORS, navegador viejo), cae a la red directa
    }
  }
}
