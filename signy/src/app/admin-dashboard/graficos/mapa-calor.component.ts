import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { numero, porcentaje } from '../kpis';

/** Escala turquesa (Signy): de "casi nada" (se funde con la tarjeta) a "mucho". */
export const ESCALA_CALOR = ['#1F5F66', '#1F8482', '#2CA6A4', '#4CC7C3', '#8BE3DD'];

interface Celda {
  fila: number;
  col: number;
  valor: number | null;
  color: string;
  /** Texto dentro de la celda (solo si cabe y se pidió). */
  texto: string;
  /** Para el tooltip y lectores de pantalla. */
  descripcion: string;
  oscura: boolean;
}

/**
 * Mapa de calor (filas × columnas) con una sola escala de color: más oscuro =
 * menos, más claro = más. Cada celda se puede recorrer con el teclado y muestra
 * su valor en un tooltip; con `conTexto` el valor también va escrito adentro.
 */
@Component({
  selector: 'app-mapa-calor',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tabla" role="grid" [attr.aria-label]="titulo"
      [style.grid-template-columns]="'minmax(' + anchoEtiquetas + 'px, max-content) repeat(' + columnas.length + ', minmax(0, 1fr))'">
      <div class="esquina" role="columnheader"></div>
      <div class="cabecera" role="columnheader" *ngFor="let c of columnas; let j = index">
        <span *ngIf="j % saltoColumnas === 0">{{ c }}</span>
      </div>
      <ng-container *ngFor="let fila of filas; let i = index">
        <div class="etiqueta-fila" role="rowheader">{{ fila }}</div>
        <div
          *ngFor="let celda of celdas[i]"
          class="celda"
          role="gridcell"
          tabindex="0"
          [class.vacia]="celda.valor === null"
          [class.cero]="celda.valor === 0"
          [class.activa]="seleccion === celda"
          [style.background]="celda.color"
          [attr.aria-label]="celda.descripcion"
          (pointerenter)="seleccion = celda"
          (pointerleave)="seleccion = null"
          (focus)="seleccion = celda"
          (blur)="seleccion = null">
          <span *ngIf="celda.texto" [class.sobre-claro]="!celda.oscura">{{ celda.texto }}</span>
        </div>
      </ng-container>
    </div>
    <div class="pie">
      <p class="detalle" role="status">{{ seleccion?.descripcion || ayuda }}</p>
      <div class="leyenda" aria-hidden="true">
        <span>{{ textoMin }}</span>
        <i *ngFor="let c of escala" [style.background]="c"></i>
        <span>{{ textoMax }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tabla { display: grid; gap: 2px; align-items: stretch; }
    .esquina { }
    .cabecera { color: var(--viz-texto-2, #93A3C4); font-size: 10.5px; text-align: center; white-space: nowrap; padding-bottom: 2px; }
    .etiqueta-fila { color: var(--viz-texto-2, #93A3C4); font-size: 11.5px; padding-right: 8px; display: flex; align-items: center; white-space: nowrap; }
    .celda {
      min-height: 26px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: #F7F5F0; outline: none; cursor: default; transition: transform 0.1s;
      font-variant-numeric: tabular-nums; overflow: hidden; white-space: nowrap;
    }
    @media (max-width: 480px) { .celda { font-size: 9.5px; letter-spacing: -0.2px; } }
    .celda.cero { background: rgba(255,255,255,0.04) !important; }
    .celda.vacia { background: repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.05) 4px 6px) !important; }
    .celda.activa, .celda:focus-visible { box-shadow: 0 0 0 2px var(--viz-texto, #F7F5F0); transform: scale(1.04); position: relative; z-index: 1; }
    .celda span.sobre-claro { color: #0A1526; }
    .pie { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
    .detalle { margin: 0; color: var(--viz-texto, #F7F5F0); font-size: 12.5px; min-height: 18px; }
    .leyenda { display: flex; align-items: center; gap: 3px; color: var(--viz-texto-2, #93A3C4); font-size: 11px; }
    .leyenda i { width: 16px; height: 10px; border-radius: 2px; display: inline-block; }
    .leyenda span { margin: 0 4px; }
  `],
})
export class MapaCalorComponent implements OnChanges {
  @Input() filas: string[] = [];
  @Input() columnas: string[] = [];
  @Input() valores: (number | null)[][] = [];
  @Input() formato: 'pct' | 'conteo' = 'conteo';
  /** Escribir el valor dentro de cada celda (solo si hay pocas columnas). */
  @Input() conTexto = false;
  /** Cómo se describe cada celda: recibe fila, columna y valor ya formateado. */
  @Input() describir: (fila: string, columna: string, valor: string) => string = (f, c, v) => `${f}, ${c}: ${v}`;
  @Input() titulo = '';
  @Input() ayuda = 'Pasa el dedo o el mouse por una celda para ver el detalle.';
  @Input() saltoColumnas = 1;
  @Input() anchoEtiquetas = 56;

  readonly escala = ESCALA_CALOR;
  celdas: Celda[][] = [];
  seleccion: Celda | null = null;
  textoMin = '';
  textoMax = '';

  ngOnChanges() {
    const todos = ([] as (number | null)[]).concat(...this.valores).filter((v): v is number => v !== null && Number.isFinite(v));
    const max = this.formato === 'pct' ? 100 : Math.max(1, ...todos);
    this.textoMin = this.formato === 'pct' ? '0 %' : '0';
    this.textoMax = this.formato === 'pct' ? '100 %' : numero(max);
    this.celdas = this.filas.map((fila, i) =>
      this.columnas.map((col, j) => {
        const valor = this.valores[i]?.[j] ?? null;
        const nivel = valor === null || valor <= 0 ? -1 : Math.min(this.escala.length - 1, Math.floor((valor / max) * this.escala.length));
        const texto = valor === null ? '—' : this.formato === 'pct' ? porcentaje(valor) : numero(valor);
        return {
          fila: i,
          col: j,
          valor,
          color: nivel < 0 ? 'transparent' : this.escala[nivel],
          texto: this.conTexto && valor !== null ? (this.formato === 'pct' ? `${Math.round(valor)}%` : numero(valor)) : '',
          descripcion: valor === null ? `${fila}, ${col}: todavía no llega` : this.describir(fila, col, texto),
          // Texto claro solo sobre los dos tonos más oscuros; en los claros, texto oscuro (contraste ≥ 4.5).
          oscura: nivel < 2,
        };
      }),
    );
  }
}
