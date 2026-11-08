import { Directive, ElementRef, Input, OnChanges, OnDestroy } from '@angular/core';
import { ImageCacheService, POSTER_TRANSPARENTE } from '../services/image-cache';

/** Reemplazo de [src] para imágenes o videos remotos: usar [appCachedSrc] en
 * vez de [src], tanto en <img> como en <video>. Aplica además una transición
 * suave de entrada (`media-lista`) cuando el primer cuadro ya está decodificado. */
@Directive({
  selector: 'img[appCachedSrc], video[appCachedSrc]',
  standalone: true,
})
export class CachedSrcDirective implements OnChanges, OnDestroy {
  @Input() appCachedSrc: string | null | undefined = '';

  private readonly alCargar = () => {
    this.el.nativeElement.classList.add('media-lista');
  };

  constructor(private el: ElementRef<HTMLImageElement | HTMLVideoElement>, private cache: ImageCacheService) {
    const elem = this.el.nativeElement;
    elem.classList.add('media-animada');
    if (elem.tagName === 'VIDEO') {
      const video = elem as HTMLVideoElement;
      if (!video.getAttribute('poster')) {
        video.setAttribute('poster', POSTER_TRANSPARENTE);
      }
      video.preload = 'auto';
      video.muted = true; // el atributo `muted` puesto por Angular no siempre llega a la propiedad (autoplay)
      video.addEventListener('loadeddata', this.alCargar);
      video.addEventListener('playing', this.alCargar);
    } else {
      elem.addEventListener('load', this.alCargar);
    }
  }

  async ngOnChanges() {
    const pedida = this.appCachedSrc;
    if (!pedida) return;
    const elem = this.el.nativeElement;
    elem.classList.remove('media-lista');

    // 1. Si ya está en memoria (precargado al iniciar la lección), se asigna de forma síncrona (0 ms)
    const sincrono = this.cache.getSincrono(pedida);
    if (sincrono) {
      this.asignarSrc(elem, sincrono);
      return;
    }

    // 2. Si aún no estaba en memoria, se resuelve desde Cache Storage o red. Si mientras tanto
    // la URL cambió (p. ej. el quiz pasó a la siguiente pregunta), esta respuesta ya no
    // corresponde: sin esto, un video lento podía terminar mostrándose en la pregunta siguiente.
    const resuelta = await this.cache.resolve(pedida);
    if (pedida !== this.appCachedSrc) return;
    this.asignarSrc(elem, resuelta);
  }

  ngOnDestroy() {
    const elem = this.el.nativeElement;
    elem.removeEventListener('loadeddata', this.alCargar);
    elem.removeEventListener('playing', this.alCargar);
    elem.removeEventListener('load', this.alCargar);
  }

  private asignarSrc(elem: HTMLImageElement | HTMLVideoElement, src: string) {
    if (elem.src !== src) {
      elem.src = src;
    }
    if (elem.tagName === 'VIDEO') {
      const video = elem as HTMLVideoElement;
      if (video.readyState >= 2) {
        elem.classList.add('media-lista');
      }
      if (video.autoplay) {
        video.play().catch(() => {});
      }
    } else {
      const img = elem as HTMLImageElement;
      if (img.complete && img.naturalWidth > 0) {
        elem.classList.add('media-lista');
      }
    }
  }
}
