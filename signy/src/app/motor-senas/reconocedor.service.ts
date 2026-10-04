import { Injectable } from '@angular/core';
import { Sena } from '../data/db-types';
import { ClasificadorSenas, Prediccion } from './clasificador';
import { evaluarCaptura, framesConManos } from './comparacion';
import { CapturaCruda, ModeloReferenciaSena, ResultadoEvaluacion } from './tipos';

/** Ruta del modelo que genera `ml/entrenar.py` (va dentro de la app, funciona sin internet). */
export const RUTA_MODELO_CLASIFICADOR = 'assets/modelos/clasificador-senas.json';

export type FuenteEvaluacion = 'referencia' | 'clasificador' | 'deteccion';

export interface EvaluacionSena {
  similitudPct: number;
  aprobado: boolean;
  /** Qué decidió el resultado: el modelo de referencia (DTW), el clasificador entrenado, o solo detección de manos. */
  fuente: FuenteEvaluacion;
  espejo: boolean;
  /** No se vieron las manos lo suficiente para evaluar. */
  sinManos: boolean;
  referencia?: ResultadoEvaluacion;
  clasificador?: { probabilidad: number; mejores: Prediccion[] };
}

/** Frames con manos que pide el modo "solo detección" (señas aún sin calibrar). */
const FRAMES_DETECCION = 8;

export function modeloDeSena(sena: Pick<Sena, 'landmarks_referencia'> | null | undefined): ModeloReferenciaSena | null {
  const crudo = sena?.landmarks_referencia;
  if (!crudo) return null;
  try {
    const m = (typeof crudo === 'string' ? JSON.parse(crudo) : crudo) as ModeloReferenciaSena;
    return m && Array.isArray(m.frames) && m.frames.length && (m.version ?? 1) >= 2 ? m : null;
  } catch {
    return null;
  }
}

/**
 * Punto único para decidir si una persona hizo bien una seña.
 *
 * Combina dos motores:
 *  - Modelo de referencia (DTW contra la grabación del admin): funciona con
 *    UNA grabación por seña.
 *  - Clasificador entrenado (`ml/entrenar.py`): aprende de muchas
 *    grabaciones y personas; se usa si existe el archivo del modelo y conoce
 *    la seña.
 * Se aprueba si cualquiera de los dos reconoce la seña con confianza. En
 * una app para aprender, rechazar una seña bien hecha frustra más que
 * aceptar una casi correcta.
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
    const modelo = modeloDeSena(sena);
    const referencia = modelo ? evaluarCaptura(modelo, captura) : undefined;

    const clf = await this.clasificador();
    let clasificador: EvaluacionSena['clasificador'];
    let aprobadoPorClasificador = false;
    if (clf?.conoce(sena.id)) {
      const mejores = clf.predecir(captura);
      const propia = mejores.find((p) => p.senaId === sena.id);
      clasificador = { probabilidad: propia?.probabilidad ?? 0, mejores: mejores.slice(0, 3) };
      aprobadoPorClasificador = mejores[0]?.senaId === sena.id && mejores[0].probabilidad >= clf.umbralSugerido;
    }

    if (referencia || clasificador) {
      const pctClasificador = Math.round((clasificador?.probabilidad ?? 0) * 100);
      const usarClasificador = aprobadoPorClasificador && !referencia?.esCoincidente;
      const sinManos = (!referencia || !!referencia.motivo) && !clasificador?.mejores.length;
      return {
        similitudPct: usarClasificador || !referencia ? pctClasificador : referencia.similitudPct,
        aprobado: !!referencia?.esCoincidente || aprobadoPorClasificador,
        fuente: usarClasificador || !referencia ? 'clasificador' : 'referencia',
        espejo: !usarClasificador && !!referencia?.espejo,
        sinManos,
        referencia,
        clasificador,
      };
    }

    // Seña aún sin calibrar ni entrenar: solo se verifica que se vieron las manos.
    const vistas = framesConManos(captura, 1);
    const aprobado = vistas >= FRAMES_DETECCION;
    return { similitudPct: aprobado ? 80 : 20, aprobado, fuente: 'deteccion', espejo: false, sinManos: !aprobado };
  }
}
