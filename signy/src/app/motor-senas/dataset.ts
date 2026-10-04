/**
 * Formato de las muestras del dataset de entrenamiento (tabla
 * `muestras_sena` y archivo que exporta AI Studio para `ml/entrenar.py`).
 *
 * Se guarda la captura CRUDA (lo que entregó MediaPipe + tamaño del video),
 * en formato compacto: cada mano como 63 números planos con 5 decimales.
 * Así cualquier normalización o modelo futuro se puede recalcular sin
 * volver a grabar a nadie.
 */
import { CapturaCruda, Lateralidad, PUNTOS_POR_MANO, VALORES_POR_MANO } from './tipos';

export const FORMATO_DATASET = 'signy-dataset';
export const VERSION_DATASET = 1;

export interface FrameCompacto {
  t: number;
  /** Manos del frame: 63 números [x0,y0,z0,...,x20,y20,z20] cada una. */
  m: number[][];
  /** Lateralidad reportada por MediaPipe (opcional). */
  l?: Lateralidad[];
}

export interface CapturaCompacta {
  ancho: number;
  alto: number;
  frames: FrameCompacto[];
}

export function compactarCaptura(captura: CapturaCruda, decimales = 5): CapturaCompacta {
  const f = 10 ** decimales;
  const r = (v: number) => Math.round(v * f) / f;
  return {
    ancho: captura.ancho,
    alto: captura.alto,
    frames: captura.frames.map((fr) => {
      const frame: FrameCompacto = { t: Math.round(fr.t), m: fr.manos.map((mano) => mano.reduce<number[]>((acc, p) => acc.concat(r(p.x), r(p.y), r(p.z)), [])) };
      if (fr.lateralidad?.some((l) => l)) frame.l = fr.lateralidad;
      return frame;
    }),
  };
}

export function expandirCaptura(compacta: CapturaCompacta): CapturaCruda {
  return {
    ancho: compacta.ancho,
    alto: compacta.alto,
    frames: compacta.frames.map((fr) => ({
      t: fr.t,
      manos: (fr.m || [])
        .filter((plana) => Array.isArray(plana) && plana.length === VALORES_POR_MANO && plana.every((v) => Number.isFinite(v)))
        .map((plana) => Array.from({ length: PUNTOS_POR_MANO }, (_, i) => ({ x: plana[i * 3], y: plana[i * 3 + 1], z: plana[i * 3 + 2] }))),
      lateralidad: fr.l,
    })),
  };
}

/** Fila de la tabla `muestras_sena`. */
export interface MuestraSena {
  id: number;
  sena_id: number;
  autor_id: string | null;
  formato: number;
  tipo: 'estatica' | 'dinamica';
  manos_requeridas: 1 | 2;
  ancho: number;
  alto: number;
  duracion_ms: number;
  total_frames: number;
  captura: CapturaCompacta;
  created_at: string;
}

export interface DatasetExportable {
  formato: typeof FORMATO_DATASET;
  version: typeof VERSION_DATASET;
  exportado: string;
  senas: { id: number; palabra: string; subnivelId: number }[];
  muestras: {
    id: number;
    senaId: number;
    /** Persona anónima (p1, p2, …): sirve para medir el modelo con gente que no vio al entrenar. */
    participante: string;
    tipo: 'estatica' | 'dinamica';
    manosRequeridas: 1 | 2;
    captura: CapturaCompacta;
  }[];
}

/**
 * Arma el archivo que consume `ml/entrenar.py`. Los ids de usuario NO salen
 * del sistema: se reemplazan por p1, p2, … (estables dentro del archivo).
 */
export function construirDatasetExportable(
  senas: { id: number; palabra: string; subnivel_id: number }[],
  muestras: MuestraSena[],
  ahora = new Date()
): DatasetExportable {
  const participantes = new Map<string, string>();
  const anonimo = (autor: string | null) => {
    const clave = autor ?? 'sin-autor';
    if (!participantes.has(clave)) participantes.set(clave, `p${participantes.size + 1}`);
    return participantes.get(clave)!;
  };
  const conMuestras = new Set(muestras.map((m) => m.sena_id));
  return {
    formato: FORMATO_DATASET,
    version: VERSION_DATASET,
    exportado: ahora.toISOString(),
    senas: senas.filter((s) => conMuestras.has(s.id)).map((s) => ({ id: s.id, palabra: s.palabra, subnivelId: s.subnivel_id })),
    muestras: muestras.map((m) => ({
      id: m.id,
      senaId: m.sena_id,
      participante: anonimo(m.autor_id),
      tipo: m.tipo,
      manosRequeridas: m.manos_requeridas,
      captura: m.captura,
    })),
  };
}
