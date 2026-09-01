import { Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { ImageCacheService } from '../../services/image-cache';

/**
 * Vista previa de una seña. Soporta GIFs e MP4s.
 * - Para MP4: Utiliza la etiqueta nativa <video>, y la pausa/reproduce según esté activa, 
 *   ahorrando mucha batería.
 * - Para GIF: Mantiene un <img> fijo (o se oculta) como antes.
 */
@Component({
  selector: 'app-gif-tile',
  standalone: true,
  template: `
    <!-- Para formato MP4 (Más liviano y controlable) -->
    <video 
      #videoRef 
      class="media-tile" 
      [class.oculto]="!activo && esMp4"
      [src]="esMp4 ? urlResuelta : ''" 
      muted 
      loop 
      playsinline 
      preload="auto">
    </video>

    <!-- Poster estático para MP4 cuando NO está activo -->
    <video 
      class="media-tile" 
      [class.oculto]="activo || !esMp4"
      [src]="esMp4 ? urlResuelta : ''" 
      muted 
      playsinline 
      preload="metadata">
    </video>

    <!-- Para formatos antiguos (GIF, WebP) -->
    <canvas #lienzo class="media-tile" [class.oculto]="activo || esMp4"></canvas>
    <img #imagen class="media-tile" [class.oculto]="!activo || esMp4" alt="" />
  `,
  styles: [`
    :host { position: relative; display: block; width: 100%; height: 100%; }
    .media-tile { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    .oculto { visibility: hidden; }
  `],
})
export class GifTileComponent implements OnChanges {
  @Input() url: string | null | undefined;
  @Input() activo = false;

  @ViewChild('videoRef') private videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('lienzo') private lienzoRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('imagen') private imagenRef!: ElementRef<HTMLImageElement>;

  urlResuelta = '';
  esMp4 = false;

  constructor(private cache: ImageCacheService) {}

  async ngOnChanges(cambios: SimpleChanges) {
    if (cambios['url'] && this.url) {
      this.esMp4 = this.url.toLowerCase().endsWith('.mp4');
      this.urlResuelta = await this.cache.resolve(this.url);
      
      if (!this.esMp4) {
        this.dibujarFrameCongelado();
      }
    }

    this.actualizarReproduccion();
  }

  private dibujarFrameCongelado() {
    if (!this.urlResuelta || !this.lienzoRef) return;
    const previa = new Image();
    previa.onload = () => {
      const canvas = this.lienzoRef.nativeElement;
      const MAX = 200;
      const w = previa.naturalWidth || 100;
      const h = previa.naturalHeight || 100;
      const escala = Math.min(1, MAX / Math.max(w, h));
      canvas.width = Math.round(w * escala);
      canvas.height = Math.round(h * escala);
      canvas.getContext('2d')?.drawImage(previa, 0, 0, canvas.width, canvas.height);
    };
    previa.src = this.urlResuelta;
  }

  private actualizarReproduccion() {
    if (this.esMp4) {
      if (this.videoRef && this.videoRef.nativeElement) {
        if (this.activo) {
          this.videoRef.nativeElement.play().catch(() => {});
        } else {
          this.videoRef.nativeElement.pause();
          this.videoRef.nativeElement.currentTime = 0; // Reiniciar al inicio
        }
      }
    } else {
      if (this.imagenRef && this.imagenRef.nativeElement) {
        if (this.activo && this.urlResuelta) {
          this.imagenRef.nativeElement.src = this.urlResuelta;
        } else {
          this.imagenRef.nativeElement.src = '';
        }
      }
    }
  }
}
