import { Injectable } from '@angular/core';
import { Sena } from '../data/db-types';
import { ClasificadorSenas, Prediccion } from './clasificador';
import { aIsotropico } from './geometria';
import { seguirManos } from './seguimiento';
import { CapturaCruda } from './tipos';

/** Ruta del modelo que genera `ml/entrenar.py` (va dentro de la app, funciona sin internet). */
export const RUTA_MODELO_CLASIFICADOR = 'assets/modelos/clasificador-senas.json';

export type FuenteEvaluacion = 'clasificador' | 'deteccion';

export interface EvaluacionSena {
  similitudPct: number;
  aprobado: boolean;
  /** Qué decidió el resultado: el clasificador entrenado, o solo detección de manos. */
  fuente: FuenteEvaluacion;
  espejo: boolean;
  /** No se vieron las manos lo suficiente para evaluar. */
  sinManos: boolean;
  clasificador?: { probabilidad: number; mejores: Prediccion[] };
}

/** Frames con manos que pide el modo "solo detección" (señas aún sin entrenar). */
const FRAMES_DETECCION = 8;

/** Cantidad de frames en que se ven las manos requeridas. */
function framesConManos(captura: CapturaCruda, manosRequeridas: 1 | 2): number {
  return seguirManos(aIsotropico(captura)).filter((p) => (manosRequeridas === 2 ? p[0] && p[1] : p[0] || p[1])).length;
}

/**
 * Punto único para decidir si una persona hizo bien una seña: usa el
 * clasificador entrenado (`ml/entrenar.py`) si existe y conoce la seña: si
 * no, solo verifica que se vieron las manos (seña todavía sin entrenar).
 */
@Injectable({ providedIn: 'root' })
export class ReconocedorSenasService {
  private cargaClasificador: Promise<ClasificadorSenas | null> | null = null;

  /** El clasificador entrenado, o null si todavía no se ha entrenado ninguno. */
  clasificador(): Promise<ClasificadorSenas | null> {
    if (!this.cargaClasificador) {
      this.cargaClasificador = fetch(RUTA_MODELO_CLASIFICADOR)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => (json ? ClasificadorSenas.desdeJson(json) : null))
        .catch((e) => {
          console.warn('Clasificador de señas no disponible:', e?.message ?? e);
          return null;
        });
    }
    return this.cargaClasificador;
  }

  async evaluar(sena: Sena, captura: CapturaCruda): Promise<EvaluacionSena> {
    const clf = await this.clasificador();
    if (clf?.conoce(sena.id)) {
      const mejores = clf.predecir(captura);
      const propia = mejores.find((p) => p.senaId === sena.id);
      const clasificador = { probabilidad: propia?.probabilidad ?? 0, mejores: mejores.slice(0, 3) };
      const aprobado = mejores[0]?.senaId === sena.id && mejores[0].probabilidad >= clf.umbralSugerido;
      return {
        similitudPct: Math.round(clasificador.probabilidad * 100),
        aprobado,
        fuente: 'clasificador',
        espejo: false,
        sinManos: !mejores.length,
        clasificador,
      };
    }

    // Seña aún sin entrenar: solo se verifica que se vieron las manos.
    const vistas = framesConManos(captura, 1);
    const aprobado = vistas >= FRAMES_DETECCION;
    return { similitudPct: aprobado ? 80 : 20, aprobado, fuente: 'deteccion', espejo: false, sinManos: !aprobado };
  }
}
