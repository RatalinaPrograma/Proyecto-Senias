import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCacheService, POSTER_TRANSPARENTE } from '../../services/image-cache';
import { esVideoMp4 } from '../media-utils';

/**
 * Tile multimedia para la fase de Emparejar ("Match"): muestra la seña
 * "congelada" en su primer frame, con un ícono ▶ que invita a tocarla, hasta
 * que el tile pasa a [activo]=true, y recién ahí se anima/reproduce.
 *
 * Por qué congelar por defecto: si varios tiles muestran su seña animada a la
 * vez, se ve como un solo bloque de movimiento confuso, y en celulares de gama
 * media reproducir 4-7 videos al mismo tiempo satura el decodificador. El tap
 * que ya se usa para elegir la seña cumple el rol de "play".
 *
 * Para video (mp4): un <video> sí se puede pausar, así que solo se controla con
 * .play()/.pause() según [activo] (pausado muestra su primer frame).
 * Para GIF: un GIF en <img> no se puede pausar una vez cargado, así que el
 * primer frame se dibuja en un <canvas> y el <img> solo recibe el src al activarse.
 *
 * Usa la URL ya precargada en memoria si existe (sin parpadeo) y entra con una
 * transición suave (`listo`) cuando el primer frame está decodificado.
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
          muted
          playsinline
          webkit-playsinline
          preload="auto">
        </video>
      </ng-container>
      <ng-template #gifTpl>
        <canvas #lienzo class="gif-tile-media" [class.listo]="listo"></canvas>
        <img #imagen class="gif-tile-media" [class.listo]="listo" [class.oculto]="!activo" alt="" decoding="async" />
      </ng-template>
      <span class="gif-tile-play" *ngIf="!activo" aria-hidden="true"></span>
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
      object-fit: cover;
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
      &.oculto {
        visibility: hidden;
      }
    }
    /* Ícono ▶: deja claro que la seña está en pausa y que se ve al tocarla (no que está rota). */
    .gif-tile-play {
      position: absolute;
      right: 6px;
      bottom: 6px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(10, 21, 38, 0.72);
      box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.85);
      pointer-events: none;
      &::after {
        content: '';
        position: absolute;
        left: 9px;
        top: 6.5px;
        border-style: solid;
        border-width: 5.5px 0 5.5px 9px;
        border-color: transparent transparent transparent #fff;
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

  @ViewChild('lienzo') private lienzoRef?: ElementRef<HTMLCanvasElement>;
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
      this.urlResuelta = '';
      const pedida = this.url;
      if (pedida) {
        const resuelta = this.cache.getSincrono(pedida) ?? (await this.cache.resolve(pedida));
        // Si la URL cambió mientras se resolvía, esta respuesta ya no corresponde.
        if (pedida !== this.url) return;
        this.urlResuelta = resuelta;
        this.aplicarUrlResuelta();
      }
    }
    this.actualizarReproduccion();
  }

  ngAfterViewInit() {
    this.vistaLista = true;
    this.aplicarUrlResuelta();
    this.actualizarReproduccion();
  }

  marcarListo() {
    this.listo = true;
  }

  private aplicarUrlResuelta() {
    if (!this.urlResuelta || !this.vistaLista) return;
    if (this.esVideo) {
      const video = this.videoRef?.nativeElement;
      if (!video) return;
      video.muted = true; // el atributo `muted` puesto por Angular no siempre llega a la propiedad
      if (video.src !== this.urlResuelta) {
        video.src = this.urlResuelta;
        if (!this.activo) this.mostrarPrimerCuadro(video);
      }
      if (video.readyState >= 2) this.listo = true;
    } else {
      this.dibujarFrameCongelado();
    }
  }

  /**
   * Android WebView no dibuja nada en un <video> pausado hasta que se reproduce (aunque tenga
   * preload): el tile se veía vacío, como si estuviera roto. Se reproduce un instante y se
   * pausa en el inicio, así queda a la vista el primer cuadro de la seña.
   */
  private mostrarPrimerCuadro(video: HTMLVideoElement) {
    video.play()
      .then(() => {
        if (this.activo) return;
        video.pause();
        video.currentTime = 0;
      })
      .catch(() => {});
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
      this.listo = true;
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
