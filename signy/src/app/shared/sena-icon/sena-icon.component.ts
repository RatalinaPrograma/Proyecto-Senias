import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sena-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 64 72" fill="none">
      <defs>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" [attr.stop-color]="color" />
          <stop offset="1" [attr.stop-color]="dark" />
        </linearGradient>
      </defs>

      <!-- sombra suave debajo de la mano -->
      <ellipse cx="32" cy="66" rx="20" ry="4" fill="rgba(0,0,0,0.15)" />

      <!-- palma -->
      <path
        d="M18 42 C18 30 20 24 22 24 C24 24 25 28 25 34 L25 24 C25 19 27 16 29 16 C31 16 32 20 32 25 L32 22 C32 17 34 14 36 14 C38 14 39 18 39 23 L39 26 C39 21 41 19 43 19 C45 19 46 23 46 28 L46 44 C46 56 40 64 32 64 C22 64 18 54 18 42 Z"
        [attr.fill]="'url(#' + gradId + ')'"
        [attr.stroke]="dark"
        stroke-width="1.6"
        stroke-linejoin="round"
      />

      <!-- pulgar -->
      <path
        d="M18 42 C13 40 9 36 8 32 C7 29 8 26 10 25 C12 24 15 26 17 30 L21 38"
        [attr.fill]="'url(#' + gradId + ')'"
        [attr.stroke]="dark"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- dedos doblados (según el seed, dan variedad entre señas) -->
      <ng-container *ngFor="let d of dedosDoblados">
        <circle [attr.cx]="d.x" [attr.cy]="d.y" r="2.4" fill="rgba(0,0,0,0.18)" />
      </ng-container>

      <!-- línea de la palma, detalle -->
      <path d="M24 46 Q32 50 40 46" [attr.stroke]="dark" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.4" />
    </svg>
  `,
})
export class SenaIconComponent {
  @Input() seed = 0;
  @Input() size = 40;
  @Input() color = '#F2701A';
  @Input() dark = '#C6560E';

  get gradId(): string {
    return `sena-grad-${this.seed}-${Math.round(this.size)}`;
  }

  /** Puntos decorativos que varían según la palabra (seed), para que cada
   * ícono se sienta distinto sin pretender ser una seña lingüísticamente
   * exacta — eso requiere contenido real filmado, no generado por código. */
  get dedosDoblados() {
    const posiciones = [
      { x: 27, y: 22 }, { x: 34, y: 19 }, { x: 41, y: 24 }, { x: 22, y: 30 },
    ];
    return posiciones.filter((_, i) => ((this.seed >> i) & 1) === 0);
  }
}
