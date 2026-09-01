import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCacheService } from '../../services/image-cache';
import { esVideoMp4 } from '../media-utils';

/**
 * Vista previa de una seña "congelada" en su primer frame hasta que el tile
 * pasa a [activo]=true -- ahí recién se anima/reproduce.
 *
 * Para GIF: se dibuja el frame a un <canvas> (que no anima) porque un GIF
 * puesto en <img> no se puede pausar con CSS/JS una vez cargado, el
 * navegador lo anima solo. Para video (mp4) no hace falta ese truco: un
 * <video> sí se puede pausar/reproducir directamente, así que solo se
 * controla con .play()/.pause() según [activo].
 *
 * Por qué congelar por defecto: si varios tiles de un grid de emparejar
 * muestran su seña animada a la vez, se ve como un solo bloque de
 * movimiento confuso. Mostrando solo un frame fijo por defecto, y animando
 * únicamente el tile que el usuario seleccionó, se resuelve sin tener que
 * inventar un botón de "play" aparte -- el tap que ya se usa para elegir la
 * seña cumple ese rol.
 */
@Component({
  selector: 'app-gif-tile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="esVideo; else gifTpl">
      <video #video class="gif-tile-img" muted playsinline preload="metadata"></video>
    </ng-container>
    <ng-template #gifTpl>
      <canvas #lienzo class="gif-tile-canvas"></canvas>
      <img #imagen class="gif-tile-img" [class.oculto]="!activo" alt="" />
    </ng-template>
  `,
  styles: [`
    :host { position: relative; display: block; width: 100%; height: 100%; }
    canvas, img, video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    .oculto { visibility: hidden; }
  `],
})
export class GifTileComponent implements OnChanges, AfterViewInit {
  @Input() url: string | null | undefined;
  @Input() activo = false;

  @ViewChild('lienzo') private lienzoRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('imagen') private imagenRef?: ElementRef<HTMLImageElement>;
  @ViewChild('video') private videoRef?: ElementRef<HTMLVideoElement>;

  esVideo = false;
  private urlResuelta = '';
  private vistaLista = false;

  constructor(private cache: ImageCacheService) {}

  async ngOnChanges(cambios: SimpleChanges) {
    if (cambios['url']) {
      this.esVideo = esVideoMp4(this.url);
    }
    if (cambios['url'] && this.url) {
      this.urlResuelta = await this.cache.resolve(this.url);
      this.aplicarUrlResuelta();
    }
    this.actualizarReproduccion();
  }

  ngAfterViewInit() {
    this.vistaLista = true;
    this.aplicarUrlResuelta();
    this.actualizarReproduccion();
  }

  private aplicarUrlResuelta() {
    if (!this.urlResuelta || !this.vistaLista) return;
    if (this.esVideo) {
      if (this.videoRef) this.videoRef.nativeElement.src = this.urlResuelta;
    } else {
      this.dibujarFrameCongelado();
    }
  }

  private dibujarFrameCongelado() {
    if (!this.lienzoRef) return;
    const previa = new Image();
    previa.onload = () => {
      const canvas = this.lienzoRef!.nativeElement;
      // El tile se ve a ~80-160px: dibujar el frame a resolución completa
      // gasta decode y memoria de más en gama media sin ganancia visible.
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
    if (!this.vistaLista) return;

    if (this.esVideo) {
      const video = this.videoRef?.nativeElement;
      if (!video) return;
      if (this.activo) {
        video.currentTime = 0;
        video.loop = true;
        video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
      return;
    }

    if (!this.imagenRef) return;
    if (this.activo && this.urlResuelta) {
      this.imagenRef.nativeElement.src = this.urlResuelta;
    } else {
      this.imagenRef.nativeElement.src = '';
    }
  }
}
