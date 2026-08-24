import { Directive, ElementRef, Input, OnChanges } from '@angular/core';
import { ImageCacheService } from '../services/image-cache';

/** Reemplazo de [src] para imágenes remotas estáticas: usar('appCachedSrc') en vez de [src]. */
@Directive({
  selector: 'img[appCachedSrc]',
  standalone: true,
})
export class CachedSrcDirective implements OnChanges {
  @Input() appCachedSrc: string | null | undefined = '';

  constructor(private el: ElementRef<HTMLImageElement>, private cache: ImageCacheService) {}

  async ngOnChanges() {
    if (!this.appCachedSrc) return;
    this.el.nativeElement.src = await this.cache.resolve(this.appCachedSrc);
  }
}
