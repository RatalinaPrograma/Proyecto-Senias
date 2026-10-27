import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { fechaConDia, fechaCorta, numero, ticksEje } from '../kpis';

export interface PuntoSerie {
  /** Fecha ISO (YYYY-MM-DD). */
  x: string;
  y: number;
}

const MARGEN = { izq: 44, der: 20, arr: 16, aba: 30 };

/**
 * Serie de tiempo de UNA métrica (línea + área tenue). Una línea vertical
 * sigue al puntero (o a las flechas del teclado) y el tooltip muestra el
 * valor de ese día. Se dibuja en píxeles reales (mide su ancho) para que
 * la línea y el texto no se deformen.
 */
@Component({
  selector: 'app-grafico-linea',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="contenedor" [style.height.px]="alto">
      <svg
        [attr.width]="ancho"
        [attr.height]="alto"
        role="img"
        [attr.aria-label]="descripcion"
        tabindex="0"
        (keydown)="alTeclado($event)"
        (focus)="alEnfocar()"
        (blur)="indice = null">
        <g class="grilla">
          <ng-container *ngFor="let t of ticks">
            <line [attr.x1]="MARGEN.izq" [attr.x2]="ancho - MARGEN.der" [attr.y1]="escalaY(t)" [attr.y2]="escalaY(t)"></line>
            <text class="tick-y" [attr.x]="MARGEN.izq - 8" [attr.y]="escalaY(t) + 4">{{ numero(t) }}</text>
          </ng-container>
        </g>
        <g class="eje-x">
          <text *ngFor="let i of indicesEtiquetas" [attr.x]="escalaX(i)" [attr.y]="alto - 8"
            [attr.text-anchor]="i === 0 ? 'start' : i === datos.length - 1 ? 'end' : 'middle'">{{ fechaCorta(datos[i].x) }}</text>
        </g>
        <path class="area" [attr.d]="pathArea"></path>
        <path class="linea" [attr.d]="pathLinea"></path>
        <ng-container *ngIf="datos.length">
          <circle class="punto-final" [attr.cx]="escalaX(datos.length - 1)" [attr.cy]="escalaY(datos[datos.length - 1].y)" r="4"></circle>
          <text class="etiqueta-final" *ngIf="indice === null"
            [attr.x]="escalaX(datos.length - 1) - 8" [attr.y]="escalaY(datos[datos.length - 1].y) - 10" text-anchor="end">
            {{ numero(datos[datos.length - 1].y) }}
          </text>
        </ng-container>
        <ng-container *ngIf="indice !== null && datos[indice]">
          <line class="cursor" [attr.x1]="escalaX(indice)" [attr.x2]="escalaX(indice)" [attr.y1]="MARGEN.arr" [attr.y2]="alto - MARGEN.aba"></line>
          <circle class="punto" [attr.cx]="escalaX(indice)" [attr.cy]="escalaY(datos[indice].y)" r="5"></circle>
        </ng-container>
        <rect class="captura" [attr.x]="MARGEN.izq" [attr.y]="0" [attr.width]="anchoPlot" [attr.height]="alto"
          (pointermove)="alMover($event)" (pointerdown)="alMover($event)" (pointerleave)="indice = null"></rect>
      </svg>
      <div class="tooltip" *ngIf="indice !== null && datos[indice]" [style.left.px]="posTooltip" role="status">
        <strong>{{ numero(datos[indice].y) }}</strong>
        <span class="serie"><i></i>{{ nombre }}</span>
        <span class="fecha">{{ fechaConDia(datos[indice].x) }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .contenedor { position: relative; width: 100%; }
    svg { display: block; outline: none; touch-action: pan-y; }
    svg:focus-visible { outline: 2px solid var(--viz-foco, #F2701A); outline-offset: 2px; border-radius: 8px; }
    .grilla line { stroke: var(--viz-grilla, #2A4166); stroke-width: 1; }
    .tick-y { fill: var(--viz-texto-2, #93A3C4); font-size: 11px; text-anchor: end; font-variant-numeric: tabular-nums; }
    .eje-x text { fill: var(--viz-texto-2, #93A3C4); font-size: 11px; }
    .area { fill: var(--viz-serie, #F2701A); opacity: 0.12; }
    .linea { fill: none; stroke: var(--viz-serie, #F2701A); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .punto-final, .punto { fill: var(--viz-serie, #F2701A); stroke: var(--viz-superficie, #1B2E4E); stroke-width: 2; }
    .etiqueta-final { fill: var(--viz-texto, #F7F5F0); font-size: 12px; font-weight: 700; }
    .cursor { stroke: var(--viz-texto-2, #93A3C4); stroke-width: 1; }
    .captura { fill: transparent; cursor: crosshair; }
    .tooltip {
      position: absolute; top: 6px; transform: translateX(-50%); pointer-events: none;
      background: var(--viz-tooltip, #0A1526); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
      padding: 6px 10px; display: flex; flex-direction: column; gap: 1px; min-width: 110px; z-index: 2;
      box-shadow: 0 8px 20px rgba(0,0,0,0.35);
    }
    .tooltip strong { color: var(--viz-texto, #F7F5F0); font-size: 16px; }
    .tooltip .serie { color: var(--viz-texto-2, #93A3C4); font-size: 11.5px; display: flex; align-items: center; gap: 6px; }
    .tooltip .serie i { display: inline-block; width: 12px; height: 2px; background: var(--viz-serie, #F2701A); border-radius: 1px; }
    .tooltip .fecha { color: var(--viz-texto-2, #93A3C4); font-size: 11.5px; }
  `],
})
export class GraficoLineaComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() datos: PuntoSerie[] = [];
  @Input() nombre = '';
  @Input() alto = 240;

  readonly MARGEN = MARGEN;
  readonly numero = numero;
  readonly fechaCorta = fechaCorta;
  readonly fechaConDia = fechaConDia;

  ancho = 600;
  indice: number | null = null;
  ticks: number[] = [0, 1];
  pathLinea = '';
  pathArea = '';
  indicesEtiquetas: number[] = [];

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private observador?: ResizeObserver;
  private temporizador?: ReturnType<typeof setTimeout>;

  get anchoPlot(): number {
    return Math.max(10, this.ancho - MARGEN.izq - MARGEN.der);
  }

  get descripcion(): string {
    if (!this.datos.length) return `${this.nombre}: sin datos`;
    const ultimo = this.datos[this.datos.length - 1];
    const max = Math.max(...this.datos.map((d) => d.y));
    return `${this.nombre} por día, del ${fechaCorta(this.datos[0].x)} al ${fechaCorta(ultimo.x)}. ` +
      `Último día: ${numero(ultimo.y)}; máximo: ${numero(max)}. Usa las flechas para recorrer los días.`;
  }

  get posTooltip(): number {
    if (this.indice === null) return 0;
    return Math.min(Math.max(this.escalaX(this.indice), 64), this.ancho - 64);
  }

  ngOnChanges() {
    this.recalcular();
  }

  ngAfterViewInit() {
    const medir = () => {
      const w = Math.round(this.host.nativeElement.getBoundingClientRect().width);
      if (w > 0 && w !== this.ancho) {
        this.zone.run(() => {
          this.ancho = w;
          this.recalcular();
        });
      }
    };
    // Se mide fuera del ciclo de detección de cambios (el ResizeObserver avisa
    // apenas el elemento tiene tamaño, y de nuevo cada vez que cambia).
    if (typeof ResizeObserver !== 'undefined') {
      this.observador = new ResizeObserver(medir);
      this.observador.observe(this.host.nativeElement);
    } else {
      this.temporizador = setTimeout(medir);
    }
  }

  ngOnDestroy() {
    this.observador?.disconnect();
    clearTimeout(this.temporizador);
  }

  escalaX(i: number): number {
    const n = Math.max(1, this.datos.length - 1);
    return MARGEN.izq + (i / n) * this.anchoPlot;
  }

  escalaY(v: number): number {
    const max = this.ticks[this.ticks.length - 1] || 1;
    return MARGEN.arr + (1 - v / max) * (this.alto - MARGEN.arr - MARGEN.aba);
  }

  alMover(ev: PointerEvent) {
    const svg = (ev.currentTarget as SVGElement).ownerSVGElement ?? (ev.currentTarget as SVGElement);
    const x = ev.clientX - svg.getBoundingClientRect().left;
    const n = this.datos.length - 1;
    if (n < 0) return;
    this.indice = Math.min(n, Math.max(0, Math.round(((x - MARGEN.izq) / this.anchoPlot) * n)));
  }

  alEnfocar() {
    if (this.datos.length) this.indice = this.datos.length - 1;
  }

  alTeclado(ev: KeyboardEvent) {
    if (!this.datos.length) return;
    const actual = this.indice ?? this.datos.length - 1;
    const pasos: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 };
    if (ev.key in pasos) this.indice = Math.min(this.datos.length - 1, Math.max(0, actual + pasos[ev.key]));
    else if (ev.key === 'Home') this.indice = 0;
    else if (ev.key === 'End') this.indice = this.datos.length - 1;
    else return;
    ev.preventDefault();
  }

  private recalcular() {
    const max = Math.max(0, ...this.datos.map((d) => d.y));
    this.ticks = ticksEje(max);
    const puntos = this.datos.map((d, i) => `${this.escalaX(i).toFixed(1)},${this.escalaY(d.y).toFixed(1)}`);
    this.pathLinea = puntos.length ? `M${puntos.join('L')}` : '';
    const base = this.escalaY(0).toFixed(1);
    this.pathArea = puntos.length
      ? `M${this.escalaX(0).toFixed(1)},${base}L${puntos.join('L')}L${this.escalaX(this.datos.length - 1).toFixed(1)},${base}Z`
      : '';
    // Unas 6 fechas en el eje, siempre la primera y la última, sin que se pisen.
    const n = this.datos.length;
    const cuantas = Math.max(2, Math.min(n, Math.floor(this.anchoPlot / 90)));
    const set = new Set<number>();
    for (let k = 0; k < cuantas; k++) set.add(Math.round((k * (n - 1)) / Math.max(1, cuantas - 1)));
    this.indicesEtiquetas = n ? [...set].sort((a, b) => a - b) : [];
    if (this.indice !== null && this.indice >= n) this.indice = null;
  }
}
