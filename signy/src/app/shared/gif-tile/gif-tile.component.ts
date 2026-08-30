import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { ImageCacheService } from '../../services/image-cache';

/**
 * Vista previa de un GIF de seña "congelada" en su primer frame (dibujado a
un canvas, que no anima) hasta que el tile pasa a [activo]=true -- ahí
 recién se muestra el <img> real, que sí reproduce el GIF en loop.
 
 * Por qué: un GIF puesto en <img> no se puede pausar con CSS/JS una vez
cargado, el navegador lo anima solo. Si varios tiles de un grid de
emparejar muestran su GIF a la vez, se ve como un solo bloque de
 movimiento confuso. Mostrando solo un frame fijo por defecto, y animando
 únicamente el tile que el usuario seleccionó, se resuelve sin tener que
 inventar un botón de "play" aparte -- el tap que ya se usa para elegir la
 seña cumple ese rol.
 */
@Component({
  selector: 'app-gif-tile',
  standalone: true,
  template: `
    <canvas #lienzo class="gif-tile-canvas"></canvas>
    <img #imagen class="gif-tile-img" [class.oculto]="!activo" alt="" />
  `,
  styles: [`
    :host { position: relative; display: block; width: 100%; height: 100%; }
    canvas, img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    .oculto { visibility: hidden; }
  `],
})
export class GifTileComponent implements OnChanges, AfterViewInit {
  @Input() url: string | null | undefined;
  @Input() activo = false;

  @ViewChild('lienzo') private lienzoRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('imagen') private imagenRef!: ElementRef<HTMLImageElement>;

  private urlResuelta = '';
  private vistaLista = false;

  constructor(private cache: ImageCacheService) {}

  async ngOnChanges(cambios: SimpleChanges) {
    if (cambios['url'] && this.url) {
      this.urlResuelta = await this.cache.resolve(this.url);
      this.dibujarFrameCongelado();
    }
    this.actualizarReproduccion();
  }

  ngAfterViewInit() {
    this.vistaLista = true;
    this.dibujarFrameCongelado();
    this.actualizarReproduccion();
  }

  private dibujarFrameCongelado() {
    if (!this.urlResuelta || !this.vistaLista) return;
    const previa = new Image();
    previa.onload = () => {
      const canvas = this.lienzoRef.nativeElement;
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
    if (this.activo && this.urlResuelta) {
      this.imagenRef.nativeElement.src = this.urlResuelta;
    } else {
      this.imagenRef.nativeElement.src = '';
    }
  }
}
