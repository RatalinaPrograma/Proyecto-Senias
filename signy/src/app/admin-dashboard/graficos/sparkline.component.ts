import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Mini tendencia para una tarjeta de KPI: línea tenue y el último punto en el color de acento. */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO" preserveAspectRatio="none" aria-hidden="true">
      <path class="linea" [attr.d]="path" vector-effect="non-scaling-stroke"></path>
    </svg>
    <i class="ultimo" *ngIf="valores.length" [style.left.%]="100" [style.top.%]="ultimoY"></i>
  `,
  styles: [`
    :host { display: block; position: relative; height: 28px; width: 100%; }
    svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .linea { fill: none; stroke: var(--viz-texto-2, #93A3C4); stroke-width: 1.5; stroke-linejoin: round; opacity: 0.8; }
    .ultimo {
      position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%;
      background: var(--viz-serie, #F2701A); box-shadow: 0 0 0 2px var(--viz-superficie, #1B2E4E);
    }
  `],
})
export class SparklineComponent implements OnChanges {
  @Input() valores: number[] = [];
  readonly ANCHO = 100;
  readonly ALTO = 28;
  path = '';
  ultimoY = 50;

  ngOnChanges() {
    const v = this.valores;
    if (!v.length) {
      this.path = '';
      return;
    }
    const max = Math.max(...v);
    const min = Math.min(...v);
    const rango = max - min || 1;
    const y = (x: number) => 2 + (1 - (x - min) / rango) * (this.ALTO - 4);
    const paso = v.length > 1 ? this.ANCHO / (v.length - 1) : 0;
    this.path = v.map((x, i) => `${i ? 'L' : 'M'}${(i * paso).toFixed(2)},${y(x).toFixed(2)}`).join('');
    this.ultimoY = (y(v[v.length - 1]) / this.ALTO) * 100;
  }
}
