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

  // ---- precarga total en segundo plano ----
  // Guardas a nivel de servicio (no de componente): Home y Onboarding
  // pueden llamar a precargarTodo() sin coordinarse entre ellos y nunca se
  // dispara dos veces en paralelo ni se repite si ya terminó en esta sesión.
  private precargaTotalEnCurso = false;
  private precargaTotalCompleta = false;

  /**
   * Deja `url` guardado en disco, y si ya estaba, revisa que siga siendo
   * la versión vigente. La revisión es barata: un `HEAD` (sin bajar el
   * archivo completo) comparando ETag/Last-Modified/tamaño contra lo que
   * ya está guardado. Solo si cambió de verdad se vuelve a descargar el
   * contenido completo, reemplazando lo viejo.
   *
   * Esto es lo que resuelve el caso real que encontramos: antes, si se
   * corregía o reemplazaba un archivo en Supabase con el mismo nombre
   * (misma URL), el teléfono seguía mostrando la versión vieja para
   * siempre porque nunca volvía a preguntar. Ahora sí se entera, la
   * próxima vez que haya red.
   *
   * Si no hay conexión (modo avión, sin señal), el `HEAD` simplemente
   * falla y se sigue usando lo que ya está en disco sin quejarse -- eso es
   * justo lo que hace que la app funcione offline.
   */
  private async actualizarSiCambio(url: string, cache: Cache): Promise<void> {
    const enDisco = await cache.match(url);

    if (!enDisco) {
      await cache.add(url);
      return;
    }

    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!head.ok) return; // no se pudo confirmar por ahora: se deja lo que ya hay

      if (this.firmaDeRespuesta(head) !== this.firmaDeRespuesta(enDisco)) {
        await cache.add(url); // cambió de verdad: se vuelve a bajar completo y reemplaza
      }
    } catch {
      // sin conexión o falló el HEAD: se sigue usando lo que ya está en disco
    }
  }

  private firmaDeRespuesta(r: Response): string {
    return r.headers.get('etag') ?? r.headers.get('last-modified') ?? r.headers.get('content-length') ?? '';
  }

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
            await this.actualizarSiCambio(url, cache);
            const response = await cache.match(url);

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
   * Deja instalado en disco TODO el vocabulario (no solo el subnivel
   * actual), para que la app funcione sin conexión aunque el usuario nunca
   * haya visitado una lección. Es deliberadamente NO bloqueante: se llama
   * en segundo plano (sin `await` desde quien la invoca) apenas el usuario
   * entra a Home.
   *
   * Todo local, sin infraestructura en la nube: cada archivo se descarga
   * individual (con `concurrencia` descargas en paralelo como máximo) y
   * queda guardado para siempre en la misma caché permanente de
   * `precargarSubnivel()`. Si ya estaba guardado, se revisa que siga
   * vigente (ver `actualizarSiCambio`) en vez de confiar ciegamente para
   * siempre; así una seña nueva o corregida se cachea sola, sin que nadie
   * tenga que regenerar nada ni subir versión de la app.
   */
  async precargarTodo(
    urls: string[],
    onProgress?: (completados: number, total: number) => void,
    concurrencia = 4
  ): Promise<void> {
    if (!('caches' in window) || this.precargaTotalEnCurso || this.precargaTotalCompleta) return;

    const unicas = Array.from(new Set((urls || []).filter((u): u is string => !!u)));
    if (!unicas.length) return;

    this.precargaTotalEnCurso = true;
    const total = unicas.length;
    let completados = 0;
    let indice = 0;

    try {
      const cache = await caches.open(MEDIA_CACHE_NAME);

      const trabajador = async () => {
        while (indice < unicas.length) {
          const url = unicas[indice++];
          try {
            await this.actualizarSiCambio(url, cache);
          } catch (err) {
            console.warn('ImageCache: No se pudo precargar en segundo plano:', url, err);
          } finally {
            completados++;
            onProgress?.(completados, total);
          }
        }
      };

      const trabajadores = Array.from({ length: Math.min(concurrencia, unicas.length) }, () => trabajador());
      await Promise.all(trabajadores);
      this.precargaTotalCompleta = true;
    } catch (e) {
      console.warn('ImageCache: Error durante la precarga total en segundo plano:', e);
    } finally {
      this.precargaTotalEnCurso = false;
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
