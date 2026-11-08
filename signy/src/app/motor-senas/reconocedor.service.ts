import { Injectable } from '@angular/core';
import { Sena } from '../data/db-types';
import { ClasificadorSenas, Prediccion } from './clasificador';
import { aIsotropico } from './geometria';
import { Retroalimentacion, medirIntento, retroalimentar } from './retroalimentacion';
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

/**
 * Palabras que en LSCh se dicen con la misma seña (por ejemplo, "Hola" y "Chao"
 * se hacen igual). El clasificador no puede distinguirlas, así que al practicar
 * una de ellas también cuenta como correcta la otra.
 */
const SENAS_EQUIVALENTES: string[][] = [['hola', 'chao']];

/** Palabra en minúsculas y sin tildes, para comparar. */
function clavePalabra(palabra: string): string {
  return palabra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/**
 * Junta en una sola predicción, la de la seña pedida, las señas que se hacen
 * igual que ella (sumando sus probabilidades). Las demás quedan como están.
 */
export function unirEquivalentes(mejores: Prediccion[], sena: Pick<Sena, 'id' | 'palabra'>): Prediccion[] {
  const grupo = SENAS_EQUIVALENTES.find((g) => g.includes(clavePalabra(sena.palabra)));
  if (!grupo) return mejores;
  const esEquivalente = (p: Prediccion) => p.senaId === sena.id || grupo.includes(clavePalabra(p.palabra));
  const equivalentes = mejores.filter(esEquivalente);
  if (!equivalentes.length) return mejores;
  const probabilidad = equivalentes.reduce((suma, p) => suma + p.probabilidad, 0);
  return [{ senaId: sena.id, palabra: sena.palabra, probabilidad }, ...mejores.filter((p) => !esEquivalente(p))]
    .sort((a, b) => b.probabilidad - a.probabilidad);
}

/**
 * Seguridad mínima del clasificador para aprobar una seña en la lección (75 %). El umbral que
 * calcula `ml/entrenar.py` (`umbralSugerido`, cerca de 95 %) sirve para medir el modelo, pero en
 * la práctica rechazaba señas bien hechas.
 */
export const UMBRAL_APROBACION = 0.75;

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
      const mejores = unirEquivalentes(clf.predecir(captura), sena);
      const propia = mejores.find((p) => p.senaId === sena.id);
      const clasificador = { probabilidad: propia?.probabilidad ?? 0, mejores: mejores.slice(0, 3) };
      const aprobado = mejores[0]?.senaId === sena.id && mejores[0].probabilidad >= UMBRAL_APROBACION;
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

  /**
   * Qué decirle al alumno sobre su intento (ver retroalimentacion.ts): en vez de
   * "intenta de nuevo", qué cambiar para lograrlo la próxima vez.
   */
  async explicar(sena: Sena, captura: CapturaCruda, evaluacion: EvaluacionSena): Promise<Retroalimentacion> {
    const clf = evaluacion.fuente === 'clasificador' ? await this.clasificador() : null;
    return retroalimentar({
      senaId: sena.id,
      palabra: sena.palabra,
      aprobado: evaluacion.aprobado,
      sinModelo: evaluacion.fuente === 'deteccion',
      medidas: evaluacion.sinManos ? null : medirIntento(captura),
      perfil: clf?.perfil(sena.id),
      mejores: evaluacion.clasificador?.mejores,
      umbral: UMBRAL_APROBACION,
    });
  }
}
