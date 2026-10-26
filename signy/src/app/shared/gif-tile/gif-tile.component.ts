import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCacheService, POSTER_TRANSPARENTE } from '../../services/image-cache';
import { esVideoMp4 } from '../media-utils';

/**
 * Tile multimedia para la fase de Emparejar ("Match").
 *
 * Reproduce todas las señas de la ronda en bucle continuo acelerado por GPU
 * (decodificador de hardware para `.mp4` o `<img>` directo para `.gif`),
 * con una transición suave de entrada (`listo`) que camufla cualquier
 * instante de inicialización del decodificador en Android.
 */
@Component({
  selector: 'app-gif-tile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="gif-tile-frame" [class.cargando]="!listo">
      <ng-container *ngIf="esVideo; else gifTpl">
        <video
          #video
          class="gif-tile-media"
          [class.listo]="listo"
          [attr.poster]="posterTransparente"
          (loadeddata)="marcarListo()"
          (playing)="marcarListo()"
          autoplay
          loop
          muted
          playsinline
          webkit-playsinline
          preload="auto">
        </video>
      </ng-container>
      <ng-template #gifTpl>
        <img
          #imagen
          class="gif-tile-media"
          [class.listo]="listo"
          (load)="marcarListo()"
          alt=""
          decoding="async" />
      </ng-template>
    </div>
  `,
  styles: [`
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
    }
    .gif-tile-frame {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 10px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.04);
      &.cargando {
        animation: tile-pulse 1.2s ease-in-out infinite;
      }
    }
    .gif-tile-media {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0;
      transform: scale(0.94) translateZ(0);
      transition: opacity 0.28s ease-out, transform 0.28s ease-out;
      will-change: transform, opacity;
      backface-visibility: hidden;
      pointer-events: none;
      &.listo {
        opacity: 1;
        transform: scale(1) translateZ(0);
      }
    }
    @keyframes tile-pulse {
      0%, 100% { background: rgba(255, 255, 255, 0.03); }
      50% { background: rgba(255, 255, 255, 0.09); }
    }
  `],
})
export class GifTileComponent implements OnChanges, AfterViewInit {
  @Input() url: string | null | undefined;
  @Input() activo = false;

  @ViewChild('imagen') private imagenRef?: ElementRef<HTMLImageElement>;
  @ViewChild('video') private videoRef?: ElementRef<HTMLVideoElement>;

  readonly posterTransparente = POSTER_TRANSPARENTE;
  esVideo = false;
  listo = false;
  private urlResuelta = '';
  private vistaLista = false;

  constructor(private cache: ImageCacheService) {}

  async ngOnChanges(cambios: SimpleChanges) {
    if (cambios['url']) {
      this.esVideo = esVideoMp4(this.url);
      this.listo = false;
      if (this.url) {
        const sincrona = this.cache.getSincrono(this.url);
        if (sincrona) {
          this.urlResuelta = sincrona;
          this.aplicarUrlResuelta();
        } else {
          this.urlResuelta = await this.cache.resolve(this.url);
          this.aplicarUrlResuelta();
        }
      }
    }
  }

  ngAfterViewInit() {
    this.vistaLista = true;
    this.aplicarUrlResuelta();
  }

  marcarListo() {
    this.listo = true;
  }

  private aplicarUrlResuelta() {
    if (!this.urlResuelta || !this.vistaLista) return;

    if (this.esVideo) {
      const video = this.videoRef?.nativeElement;
      if (!video) return;
      if (video.src !== this.urlResuelta) {
        video.src = this.urlResuelta;
      }
      if (video.readyState >= 2) {
        this.listo = true;
      }
      video.muted = true;
      video.loop = true;
      video.play().catch(() => {});
    } else {
      const img = this.imagenRef?.nativeElement;
      if (img && img.src !== this.urlResuelta) {
        img.src = this.urlResuelta;
      }
      if (img?.complete && img.naturalWidth > 0) {
        this.listo = true;
      }
    }
  }
}
