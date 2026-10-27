import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { numero } from '../kpis';

export interface ItemBarra {
  etiqueta: string;
  valor: number;
  /** Texto del valor (por defecto, el número). */
  texto?: string;
  /** Línea secundaria bajo la etiqueta (p. ej. "45 % del paso anterior"). */
  detalle?: string;
  /** Resaltar esta barra (el resto queda en el color normal). */
  destacada?: boolean;
}

/**
 * Barras horizontales de UNA serie: etiqueta a la izquierda, barra delgada que
 * crece desde la misma línea base, y el valor escrito en la punta (nunca
 * recortado: va afuera de la barra).
 */
@Component({
  selector: 'app-barras',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ul class="lista" [class.con-destacada]="hayDestacada" [attr.aria-label]="titulo">
      <li *ngFor="let it of items; let i = index" class="fila" [class.destacada]="it.destacada" tabindex="0"
        [attr.aria-label]="it.etiqueta + ': ' + (it.texto ?? numero(it.valor)) + (it.detalle ? '. ' + it.detalle : '')">
        <div class="etiqueta" [style.width.px]="anchoEtiqueta">
          <span class="nombre">{{ it.etiqueta }}</span>
          <span class="detalle" *ngIf="it.detalle">{{ it.detalle }}</span>
        </div>
        <div class="pista">
          <div class="barra" [style.width.%]="anchos[i]"></div>
          <span class="valor">{{ it.texto ?? numero(it.valor) }}</span>
        </div>
      </li>
    </ul>
  `,
  styles: [`
    :host { display: block; }
    .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .fila { display: flex; align-items: center; gap: 12px; border-radius: 8px; outline: none; padding: 2px 4px; margin: 0 -4px; }
    .fila:hover, .fila:focus-visible { background: rgba(255,255,255,0.04); }
    .fila:focus-visible { box-shadow: 0 0 0 2px var(--viz-foco, #F2701A); }
    .etiqueta { flex-shrink: 0; display: flex; flex-direction: column; min-width: 0; }
    .nombre { color: var(--viz-texto, #F7F5F0); font-size: 13px; font-weight: 600; line-height: 1.25; }
    .detalle { color: var(--viz-texto-2, #93A3C4); font-size: 11.5px; line-height: 1.3; }
    .pista { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .barra {
      height: 14px; min-width: 2px; border-radius: 0 4px 4px 0; background: var(--viz-serie, #F2701A);
      transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    }
    /* Si hay una barra resaltada, el resto baja a un naranjo más apagado (sigue sobre 3:1 contra la tarjeta). */
    .con-destacada .fila:not(.destacada) .barra { background: var(--viz-serie-suave, #C6560E); }
    .valor { color: var(--viz-texto, #F7F5F0); font-size: 13px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  `],
})
export class BarrasComponent implements OnChanges {
  @Input() items: ItemBarra[] = [];
  @Input() max: number | null = null;
  @Input() anchoEtiqueta = 150;
  @Input() titulo = '';

  readonly numero = numero;
  anchos: number[] = [];
  hayDestacada = false;

  ngOnChanges() {
    const max = this.max ?? Math.max(1, ...this.items.map((i) => i.valor));
    // La barra ocupa a lo más ~80 % del ancho: el resto queda para el valor en la punta.
    this.anchos = this.items.map((i) => (max > 0 ? Math.max(0, (i.valor / max) * 80) : 0));
    this.hayDestacada = this.items.some((i) => i.destacada);
  }
}
