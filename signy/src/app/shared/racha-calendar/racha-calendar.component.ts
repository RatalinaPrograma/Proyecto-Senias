import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { flame, snowOutline, close } from 'ionicons/icons';

addIcons({ flame, 'snow-outline': snowOutline, close });

/** 'hoy' y 'sin-datos' son estados de vista (no existen en la tabla
 * racha_historial): 'hoy' es un día sin fila todavía porque puede que no se
 * haya practicado aún, y 'sin-datos' es un día fuera de rango (antes de que
 * existiera la cuenta, o futuro). */
export type EstadoDiaCalendario = 'practicado' | 'congelado' | 'perdido' | 'hoy' | 'sin-datos';

export interface DiaRachaVista {
  fecha: string;
  numero: number;
  estado: EstadoDiaCalendario;
  esHoy: boolean;
  /** Solo se usa en variante="semana": letra corta del día (L, Ma, Mi...). */
  etiquetaDia?: string;
}

/**
 * Calendario de racha reutilizable en dos formatos:
 * - variante="mes": grilla de 28 días (Perfil).
 * - variante="semana": tira de 7 días con la letra del día arriba
 *   (pantalla de racha activada al terminar una lección).
 *
 * Es puramente visual: recibe los días ya calculados y solo se encarga de
 * dibujarlos, para no duplicar la lógica de fechas/estado que ya vive en
 * ContenidoService y en cada página.
 */
@Component({
  selector: 'app-racha-calendar',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ng-container *ngIf="variante === 'mes'">
      <div class="rc-mes">
        <div
          *ngFor="let d of dias; let i = index"
          class="rc-day"
          [ngClass]="'rc-estado-' + d.estado"
          [class.rc-hoy]="d.esHoy"
          [style.animation-delay]="retraso(i)"
          [title]="d.fecha">
          <ion-icon *ngIf="d.estado === 'practicado'" name="flame"></ion-icon>
          <ion-icon *ngIf="d.estado === 'congelado'" name="snow-outline"></ion-icon>
          <ion-icon *ngIf="d.estado === 'perdido'" name="close"></ion-icon>
          <span class="rc-num" *ngIf="d.estado === 'hoy' || d.estado === 'sin-datos'">{{ d.numero }}</span>
        </div>
      </div>
    </ng-container>

    <ng-container *ngIf="variante === 'semana'">
      <div class="rc-semana-wrap" [class.rc-perfecta]="semanaPerfecta">
        <div class="rc-semana">
          <div *ngFor="let d of dias; let i = index" class="rc-week-item" [style.animation-delay]="retraso(i)">
            <span class="rc-week-label" [class.rc-week-label-hoy]="d.esHoy">{{ d.etiquetaDia }}</span>
            <div class="rc-week-badge" [ngClass]="'rc-estado-' + d.estado" [class.rc-hoy]="d.esHoy">
              <ion-icon *ngIf="d.estado === 'practicado'" name="flame"></ion-icon>
              <ion-icon *ngIf="d.estado === 'congelado'" name="snow-outline"></ion-icon>
              <span *ngIf="d.estado === 'perdido' || d.estado === 'hoy' || d.estado === 'sin-datos'" class="rc-week-dot"></span>
            </div>
          </div>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    :host { display: block; width: 100%; }

    /* ---------- Variante mes (grilla de 28 días) ---------- */
    .rc-mes {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 7px;
    }

    .rc-day {
      position: relative;
      aspect-ratio: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      font-family: 'Manrope', sans-serif;
      font-weight: 800;
      font-size: 11px;
      color: var(--signy-muted);
      background: var(--signy-ink-deep);
      opacity: 0.001;
      animation: rc-pop-in 0.4s ease-out forwards;

      ion-icon { font-size: 15px; }
    }

    .rc-estado-practicado {
      background: linear-gradient(160deg, var(--signy-fox-light), var(--signy-fox));
      color: #4A2100;
      box-shadow: 0 3px 0 var(--signy-fox-deep);
    }

    .rc-estado-congelado {
      background: linear-gradient(160deg, #5CD1CE, var(--signy-mint));
      color: #06322F;
      box-shadow: 0 3px 0 var(--signy-mint-deep);
    }

    .rc-estado-perdido {
      background: rgba(225, 79, 61, 0.4);
      color: rgba(255, 255, 255, 0.75);
    }

    .rc-estado-hoy {
      background: var(--signy-card-hover);
      color: var(--signy-fox);
      border: 2px solid var(--signy-fox);
    }

    .rc-estado-sin-datos {
      background: transparent;
      color: var(--signy-muted);
      opacity: 0.35;
    }

    .rc-day.rc-hoy {
      animation: rc-pop-in 0.4s ease-out forwards, rc-glow-ring 1.8s ease-in-out infinite 0.4s;
    }

    @keyframes rc-glow-ring {
      0%, 100% { box-shadow: 0 0 0 0 rgba(242, 112, 26, 0.5); }
      50% { box-shadow: 0 0 0 5px rgba(242, 112, 26, 0); }
    }

    /* ---------- Variante semana (tira de 7 días) ---------- */
    .rc-semana-wrap {
      border-radius: 20px;
      padding: 14px 10px;
      transition: box-shadow 0.3s ease;
    }

    .rc-semana-wrap.rc-perfecta {
      background: rgba(255, 210, 74, 0.08);
      box-shadow: 0 0 0 2px rgba(255, 210, 74, 0.55);
      animation: rc-perfecta-glow 2.4s ease-in-out infinite;
    }

    @keyframes rc-perfecta-glow {
      0%, 100% { box-shadow: 0 0 0 2px rgba(255, 210, 74, 0.5); }
      50% { box-shadow: 0 0 0 4px rgba(255, 210, 74, 0.85); }
    }

    .rc-semana {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }

    .rc-week-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      flex: 1;
      opacity: 0.001;
      animation: rc-pop-in 0.4s ease-out forwards;
    }

    .rc-week-label {
      font-family: 'Manrope', sans-serif;
      font-weight: 700;
      font-size: 11px;
      color: var(--signy-muted);
      text-transform: uppercase;
    }

    .rc-week-label-hoy {
      color: var(--signy-fox);
      font-weight: 800;
    }

    .rc-week-badge {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--signy-ink-deep);

      ion-icon { font-size: 19px; }
    }

    .rc-week-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.5;
    }

    .rc-week-badge.rc-estado-practicado {
      background: linear-gradient(160deg, var(--signy-fox-light), var(--signy-fox));
      color: #4A2100;
      box-shadow: 0 3px 0 var(--signy-fox-deep);
    }

    .rc-week-badge.rc-estado-congelado {
      background: linear-gradient(160deg, #5CD1CE, var(--signy-mint));
      color: #06322F;
      box-shadow: 0 3px 0 var(--signy-mint-deep);
    }

    .rc-week-badge.rc-estado-perdido {
      background: rgba(225, 79, 61, 0.35);
      color: rgba(255, 255, 255, 0.7);
    }

    .rc-week-badge.rc-estado-hoy {
      background: transparent;
      border: 2px dashed var(--signy-fox);
      color: var(--signy-fox);
    }

    .rc-week-badge.rc-estado-sin-datos {
      background: transparent;
      border: 2px solid var(--signy-locked);
      color: var(--signy-muted);
      opacity: 0.5;
    }

    @keyframes rc-pop-in {
      from { opacity: 0; transform: scale(0.55) translateY(4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .rc-day, .rc-week-item, .rc-day.rc-hoy, .rc-semana-wrap.rc-perfecta {
        animation: none !important;
        opacity: 1 !important;
      }
    }
  `],
})
export class RachaCalendarComponent {
  @Input() dias: DiaRachaVista[] = [];
  @Input() variante: 'mes' | 'semana' = 'mes';

  get semanaPerfecta(): boolean {
    return this.variante === 'semana' && this.dias.length === 7 && this.dias.every(d => d.estado === 'practicado');
  }

  /** Escalona la animación de entrada de cada celda/día para que el
   * calendario se "arme" en cascada en vez de aparecer todo de golpe. */
  retraso(i: number): string {
    return `${Math.min(i * 35, 420)}ms`;
  }
}
