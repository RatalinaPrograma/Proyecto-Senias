import { Directive, ElementRef, Input, OnChanges } from '@angular/core';
import { ImageCacheService } from '../services/image-cache';

/** Reemplazo de [src] para imágenes y videos remotos estáticos. */
@Directive({
  selector: 'img[appCachedSrc], video[appCachedSrc]',
  standalone: true,
})
export class CachedSrcDirective implements OnChanges {
  @Input() appCachedSrc: string | null | undefined = '';

  constructor(private el: ElementRef<HTMLImageElement | HTMLVideoElement>, private cache: ImageCacheService) {}

  async ngOnChanges() {
    if (!this.appCachedSrc) {
      this.el.nativeElement.src = '';
      return;
    }
    this.el.nativeElement.src = await this.cache.resolve(this.appCachedSrc);
  }
}
