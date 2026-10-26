/**
 * Retroalimentación concreta para el alumno después de intentar una seña con
 * la cámara: en vez de "intenta de nuevo", qué cambiar ("fue muy rápido",
 * "junta un poco tus manos", "estira el índice", "acércate a la cámara").
 *
 * Tres fuentes, de más a menos importante:
 *  1. Cómo se grabó el intento (se vio la mano, distancia, bordes, si empezó
 *     tarde o se cortó): si esto falla, lo demás no se puede juzgar.
 *  2. Comparación con el PERFIL de la seña: cómo la hacen las personas del
 *     dataset (velocidad, amplitud, una o dos manos, distancia entre manos,
 *     forma de la mano). Lo calcula `ml/signy_ml/perfil.py` al entrenar.
 *  3. Lo que vio el clasificador (si se pareció más a otra seña).
 *
 * IMPORTANTE: `medirIntento` usa las MISMAS fórmulas que `medir` en
 * `ml/signy_ml/perfil.py` (prueba de paridad en retroalimentacion.spec.ts).
 */
import { manoEnReposo, Prediccion } from './clasificador';
import { aIsotropico, distancia, mediana, tamanoMano } from './geometria';
import { PRESENCIA_MINIMA, resumirPistas, seguirManos } from './seguimiento';
import { CapturaCruda, Mano, MUNECA, Punto3D } from './tipos';

const VENTANA_SUAVIZADO = 3;
const HUECO_MAX_MS = 300;
/** Tamaños de mano por segundo: más lento que esto es temblor, no movimiento (como calidad.py). */
const VELOCIDAD_MINIMA = 0.8;
const QUIETA = 0.3;
const MIN_FRAMES = 3;
const PUNTAS = [8, 12, 16, 20];
const PULGAR = 4;
const MCP_INDICE = 5;
const DEDOS = ['pulgar', 'índice', 'medio', 'anular', 'meñique'];

/** [mediana, dispersión robusta] de una medida entre las muestras de la seña. */
export type Rango = [number, number];

/** Cómo se hace una seña según el dataset (ver `perfiles` en ml/signy_ml/perfil.py). */
export interface PerfilSena {
  n: number;
  recorrido: Rango | null;
  duracionMs: Rango | null;
  dosManos: Rango | null;
  distanciaManos: Rango | null;
  /** [pulgar, índice, medio, anular, meñique]. */
  extension: (Rango | null)[] | null;
}

export interface MedidasIntento {
  /** Mismas medidas que el perfil (ver `medir` en perfil.py). */
  recorrido: number;
  duracionMs: number | null;
  dosManos: number;
  distanciaManos: number | null;
  extension: number[] | null;
  /** Solo para la app (cómo se grabó): */
  /** Fracción de los frames en que se vio alguna mano que hace la seña. */
  visibles: number;
  /** Tamaño típico de la mano en alturas de imagen (lejos de la cámara = chico). */
  tamano: number;
  /** Fracción de los frames con manos en que alguna quedó pegada al borde de la imagen. */
  borde: number;
  /** En qué parte de la grabación apareció la mano por primera vez (0 = al inicio, 1 = al final). */
  inicio: number;
  /** Mayor tiempo sin ver la mano entre su primera y su última aparición. */
  huecoMs: number;
  /** La mano seguía moviéndose cuando se acabó la grabación. */
  cortada: boolean;
}

/** Promedio móvil centrado (los bordes usan lo disponible). Igual que `_suavizar` en perfil.py. */
function suavizar(puntos: Punto3D[]): Punto3D[] {
  const medio = VENTANA_SUAVIZADO >> 1;
  return puntos.map((_, i) => {
    const ventana = puntos.slice(Math.max(0, i - medio), i + medio + 1);
    const n = ventana.length;
    return {
      x: ventana.reduce((s, p) => s + p.x, 0) / n,
      y: ventana.reduce((s, p) => s + p.y, 0) / n,
      z: ventana.reduce((s, p) => s + p.z, 0) / n,
    };
  });
}

function centroide(mano: Mano): Punto3D {
  const n = mano.length;
  return {
    x: mano.reduce((s, p) => s + p.x, 0) / n,
    y: mano.reduce((s, p) => s + p.y, 0) / n,
    z: mano.reduce((s, p) => s + p.z, 0) / n,
  };
}

/** [pulgar, índice, medio, anular, meñique] en tamaños de mano (ver `_extension` en perfil.py). */
function extensionDedos(mano: Mano): number[] {
  const t = tamanoMano(mano) || 1;
  return [distancia(mano[PULGAR], mano[MCP_INDICE]) / t, ...PUNTAS.map((p) => distancia(mano[p], mano[MUNECA]) / t)];
}

/** Medidas de un intento, o null si no se vio ninguna mano de forma estable. */
export function medirIntento(captura: CapturaCruda): MedidasIntento | null {
  const iso = aIsotropico(captura, true);
  const pistas = seguirManos(iso);
  let activas = resumirPistas(pistas)
    .filter((r) => r.presencia >= PRESENCIA_MINIMA)
    .sort((a, b) => a.xMedia - b.xMedia);
  const reposo = manoEnReposo(pistas, activas);
  activas = activas.filter((r) => r.indice !== reposo);
  if (!activas.length) return null;
  const indices = activas.map((r) => r.indice);
  const tiempos = iso.map((f) => f.t);
  const tamanos: number[] = [];
  pistas.forEach((p) => indices.forEach((i) => { const m = p[i]; if (m) tamanos.push(tamanoMano(m)); }));
  const tamano = mediana(tamanos) || 1;

  const eventos: [number, number][] = [];
  const camino = new Map<number, number>();
  const centroides = new Map<number, Map<number, Punto3D>>();
  for (const i of indices) {
    const presentes = pistas.map((p, k) => (p[i] ? k : -1)).filter((k) => k >= 0);
    const c = suavizar(presentes.map((k) => centroide(pistas[k][i]!)));
    centroides.set(i, new Map(presentes.map((k, j) => [k, c[j]])));
    let suma = 0;
    for (let j = 1; j < presentes.length; j++) {
      const dt = tiempos[presentes[j]] - tiempos[presentes[j - 1]];
      if (dt > HUECO_MAX_MS) continue;
      const d = distancia(c[j], c[j - 1]);
      if ((d / tamano / Math.max(dt, 1)) * 1000 < VELOCIDAD_MINIMA) continue;
      eventos.push([tiempos[presentes[j]], d]);
      suma += d;
    }
    camino.set(i, suma);
  }
  eventos.sort((a, b) => a[0] - b[0]);
  const total = eventos.reduce((s, e) => s + e[1], 0);
  const recorrido = total / tamano;

  let duracionMs: number | null = null;
  let desde = -Infinity;
  let hasta = Infinity;
  if (recorrido >= QUIETA) {
    let acumulado = 0;
    let t10: number | null = null;
    let t90: number | null = null;
    for (const [t, d] of eventos) {
      acumulado += d;
      if (t10 === null && acumulado >= 0.1 * total) t10 = t;
      if (t90 === null && acumulado >= 0.9 * total) t90 = t;
    }
    desde = t10!;
    hasta = t90!;
    duracionMs = hasta - desde;
  }

  const conAlguna = pistas.filter((p) => indices.some((i) => p[i])).length;
  const ambas = indices.length === 2 ? pistas.map((p, k) => (p[0] && p[1] ? k : -1)).filter((k) => k >= 0) : [];
  let distanciaManos: number | null = null;
  if (ambas.length >= MIN_FRAMES) {
    const c0 = centroides.get(indices[0])!;
    const c1 = centroides.get(indices[1])!;
    distanciaManos = mediana(ambas.map((k) => distancia(c0.get(k)!, c1.get(k)!))) / tamano;
  }

  // Mano principal: la que más se movió (si empatan, la primera de izquierda a derecha).
  let principal = indices[0];
  for (const i of indices) if ((camino.get(i) ?? 0) > (camino.get(principal) ?? 0)) principal = i;
  const formas = pistas
    .map((p, k) => (p[principal] && tiempos[k] >= desde && tiempos[k] <= hasta ? extensionDedos(p[principal]!) : null))
    .filter((f): f is number[] => !!f);
  const extension = formas.length >= MIN_FRAMES ? [0, 1, 2, 3, 4].map((d) => mediana(formas.map((f) => f[d]))) : null;

  // ---- Cómo se grabó ----
  const conMano = pistas.map((p, k) => (indices.some((i) => p[i]) ? k : -1)).filter((k) => k >= 0);
  const t0 = tiempos[0];
  const largo = Math.max(1, tiempos[tiempos.length - 1] - t0);
  let huecoMs = 0;
  for (let j = 1; j < conMano.length; j++) huecoMs = Math.max(huecoMs, tiempos[conMano[j]] - tiempos[conMano[j - 1]]);
  const k = captura.alto > 0 ? captura.ancho / captura.alto : 1;
  const enBorde = conMano.filter((f) => indices.some((i) => {
    const m = pistas[f][i];
    return !!m && m.some((p) => p.x / k < 0.02 || p.x / k > 0.98 || p.y < 0.02 || p.y > 0.98);
  })).length;
  // "Cortada": la mano seguía a la vista al terminar la grabación y el movimiento no había
  // terminado (el 90 % del recorrido llegó justo al final). Bajar la mano al terminar la saca
  // del cuadro, así que una seña completa no queda marcada.
  const tFin = conMano.length ? tiempos[conMano[conMano.length - 1]] : t0;
  const cortada = duracionMs !== null && tFin >= t0 + largo - 150 && tFin - hasta < 200;

  return {
    recorrido,
    duracionMs,
    dosManos: conAlguna ? ambas.length / conAlguna : 0,
    distanciaManos,
    extension,
    visibles: conMano.length / Math.max(1, pistas.length),
    tamano,
    borde: conMano.length ? enBorde / conMano.length : 0,
    inicio: conMano.length ? (tiempos[conMano[0]] - t0) / largo : 1,
    huecoMs,
    cortada,
  };
}

// ---------------------------------------------------------------------------

export interface Pista {
  /** Identificador estable (pruebas, estadísticas). */
  codigo: string;
  texto: string;
}

export interface Retroalimentacion {
  titulo: string;
  pistas: Pista[];
  /** La seña con la que más se confundió el intento, si fue otra. */
  parecidaA?: { palabra: string; probabilidad: number };
}

export interface DatosRetroalimentacion {
  senaId: number;
  palabra: string;
  aprobado: boolean;
  /** true si la seña todavía no está entrenada (solo se verificó que se vieran las manos). */
  sinModelo: boolean;
  medidas: MedidasIntento | null;
  perfil?: PerfilSena | null;
  mejores?: Prediccion[];
  umbral?: number;
}

/** Máximo de pistas que se muestran: más que esto no se alcanza a corregir en el siguiente intento. */
const MAX_PISTAS = 3;
/** Un perfil con menos muestras no es confiable para comparar. */
const MIN_MUESTRAS_PERFIL = 3;

function segundos(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Problemas de cómo se grabó el intento: si los hay, van primero. */
function pistasDeGrabacion(m: MedidasIntento): Pista[] {
  const pistas: Pista[] = [];
  if (m.tamano < 0.07) {
    pistas.push({ codigo: 'lejos', texto: 'Estás un poco lejos: acércate a la cámara para que tu mano se vea más grande.' });
  } else if (m.tamano > 0.35) {
    pistas.push({ codigo: 'cerca', texto: 'Estás muy cerca: aléjate un poco para que entre toda la mano y su movimiento.' });
  }
  if (m.borde > 0.35) {
    pistas.push({ codigo: 'borde', texto: 'Tu mano se sale por el borde de la imagen: aléjate un poco o haz la seña más al centro.' });
  }
  if (m.inicio > 0.45) {
    pistas.push({ codigo: 'tarde', texto: 'Empezaste tarde: haz la seña apenas termine la cuenta regresiva (tienes casi 3 segundos).' });
  } else if (m.cortada) {
    pistas.push({ codigo: 'cortada', texto: 'Se acabó el tiempo antes de que terminaras: empieza apenas termine la cuenta y hazla a un ritmo normal.' });
  }
  if (m.huecoMs > 400) {
    pistas.push({ codigo: 'perdida', texto: 'Te perdí de vista por un momento a mitad de la seña: muévete un poco más lento y busca buena luz de frente.' });
  }
  return pistas;
}

/** Diferencias con cómo se hace la seña normalmente, ordenadas de más a menos importante. */
function pistasDePerfil(m: MedidasIntento, p: PerfilSena): Pista[] {
  const pistas: Pista[] = [];

  // Una o dos manos.
  if (p.dosManos && p.dosManos[0] >= 0.5 && m.dosManos < 0.25) {
    pistas.push({ codigo: 'dos-manos', texto: 'Esta seña se hace con las dos manos: que se vean ambas en la imagen.' });
  } else if (p.dosManos && p.dosManos[0] <= 0.15 && m.dosManos >= 0.5) {
    pistas.push({ codigo: 'una-mano', texto: 'Esta seña se hace con una sola mano: deja la otra abajo, quieta.' });
  }

  // Distancia entre las manos (solo si se vieron las dos).
  if (p.distanciaManos && m.distanciaManos !== null) {
    const [med, dis] = p.distanciaManos;
    const tolerancia = Math.max(0.6, 2 * dis);
    if (m.distanciaManos - med > tolerancia && m.distanciaManos > med * 1.4) {
      pistas.push({ codigo: 'juntar', texto: 'Junta un poco más tus manos: en esta seña van más cerca una de la otra.' });
    } else if (med - m.distanciaManos > tolerancia && m.distanciaManos < med * 0.7) {
      pistas.push({ codigo: 'separar', texto: 'Separa un poco más tus manos: en esta seña van más alejadas una de la otra.' });
    }
  }

  // Forma de la mano: el dedo que más se aleja de lo normal (o la mano entera si son varios).
  if (p.extension && m.extension) {
    const desvios = m.extension.map((v, d) => {
      const r = p.extension![d];
      if (!r) return 0;
      const tolerancia = Math.max(d === 0 ? 0.2 : 0.25, 2.5 * r[1]);
      return (v - r[0]) / tolerancia;
    });
    const doblados = desvios.slice(1).filter((z) => z < -1).length;
    const estirados = desvios.slice(1).filter((z) => z > 1).length;
    if (doblados >= 3) {
      pistas.push({ codigo: 'abrir-mano', texto: 'Abre más la mano: en esta seña los dedos van más estirados.' });
    } else if (estirados >= 3) {
      pistas.push({ codigo: 'cerrar-mano', texto: 'Cierra más la mano: en esta seña los dedos van más doblados.' });
    } else {
      let peor = -1;
      desvios.forEach((z, d) => { if (Math.abs(z) > 1 && (peor < 0 || Math.abs(z) > Math.abs(desvios[peor]))) peor = d; });
      if (peor === 0) {
        pistas.push(desvios[0] < 0
          ? { codigo: 'pulgar-separar', texto: 'Separa más el pulgar del resto de la mano.' }
          : { codigo: 'pulgar-juntar', texto: 'Junta más el pulgar a la mano.' });
      } else if (peor > 0) {
        pistas.push(desvios[peor] < 0
          ? { codigo: `estirar-${DEDOS[peor]}`, texto: `Estira más el dedo ${DEDOS[peor]}.` }
          : { codigo: `doblar-${DEDOS[peor]}`, texto: `Dobla más el dedo ${DEDOS[peor]}.` });
      }
    }
  }

  // Velocidad y amplitud: solo en señas que de verdad llevan movimiento (en una seña quieta, el
  // "recorrido" es puro temblor). Si fue muy rápido, no se dice además que fue corto: lo rápido
  // achata el movimiento y la causa a corregir es la velocidad.
  const conMovimiento = !!p.recorrido && p.recorrido[0] >= 1;
  let rapido = false;
  if (conMovimiento && p.duracionMs && m.duracionMs !== null) {
    const med = p.duracionMs[0];
    if (m.duracionMs < 0.6 * med && med - m.duracionMs > 250) {
      rapido = true;
      pistas.push({ codigo: 'rapido', texto: `Lo hiciste muy rápido (${segundos(m.duracionMs)}; normalmente toma unos ${segundos(med)}): hazla más pausada.` });
    } else if (m.duracionMs > 1.8 * med && m.duracionMs - med > 400) {
      pistas.push({ codigo: 'lento', texto: `Fue más lento de lo habitual (${segundos(m.duracionMs)}; normalmente unos ${segundos(med)}): hazla con un ritmo más fluido.` });
    }
  }
  if (p.recorrido) {
    const med = p.recorrido[0];
    if (conMovimiento && m.recorrido < 0.4) {
      pistas.push({ codigo: 'sin-movimiento', texto: 'Casi no te moviste: esta seña lleva movimiento. Mira el video y haz el recorrido completo.' });
    } else if (conMovimiento && !rapido && m.recorrido < 0.45 * med) {
      pistas.push({ codigo: 'corto', texto: 'El movimiento fue muy corto: hazlo más amplio, como en el video.' });
    } else if (conMovimiento && m.recorrido > 2.2 * med) {
      pistas.push({ codigo: 'amplio', texto: 'El movimiento fue más grande de lo necesario: hazlo más contenido.' });
    } else if (med < 1 && m.recorrido > Math.max(2, 3 * med)) {
      pistas.push({ codigo: 'quieta', texto: 'Esta seña va quieta: deja la mano firme en la posición, sin moverla.' });
    }
  }
  return pistas;
}

/** Arma el mensaje para el alumno a partir de lo que se midió y lo que vio el clasificador. */
export function retroalimentar(d: DatosRetroalimentacion): Retroalimentacion {
  const m = d.medidas;
  if (!m || m.visibles < 0.15) {
    return {
      titulo: 'No logramos ver bien tus manos',
      pistas: [
        { codigo: 'no-visible', texto: 'Ponte frente a la cámara, que se vea tu mano en la imagen durante toda la seña.' },
        { codigo: 'luz', texto: 'Busca buena luz de frente: si la luz viene de atrás (una ventana), la mano se ve oscura.' },
      ],
    };
  }

  const grabacion = pistasDeGrabacion(m);
  if (d.sinModelo) {
    return {
      titulo: '¡Buena práctica de manos!',
      pistas: [
        ...grabacion,
        { codigo: 'sin-modelo', texto: 'Esta seña todavía no está entrenada: no pude revisar si quedó bien hecha, solo que se vieron tus manos.' },
      ].slice(0, MAX_PISTAS),
    };
  }

  const perfil = d.perfil && d.perfil.n >= MIN_MUESTRAS_PERFIL ? pistasDePerfil(m, d.perfil) : [];
  const mejores = d.mejores ?? [];
  const primera = mejores[0];
  const propia = mejores.find((p) => p.senaId === d.senaId);
  const otra = primera && primera.senaId !== d.senaId && primera.senaId !== 0 && primera.probabilidad >= 0.4 ? primera : undefined;

  if (d.aprobado) {
    // Aprobada: solo se sugiere algo si hay una diferencia clara (no se llena de "peros").
    return {
      titulo: '¡Excelente! Seña reconocida.',
      pistas: [...grabacion, ...perfil].slice(0, 1).map((p) => ({ ...p, texto: `Para que salga aún mejor: ${p.texto.charAt(0).toLowerCase()}${p.texto.slice(1)}` })),
    };
  }

  const pistas = [...grabacion, ...perfil];
  if (otra) {
    pistas.push({ codigo: 'otra-sena', texto: `Se pareció más a «${otra.palabra}»: mira el video otra vez y fíjate en qué cambia entre las dos.` });
  } else if (primera?.senaId === 0) {
    pistas.push({ codigo: 'ninguna', texto: 'No reconocí una seña clara: haz el movimiento completo, de principio a fin, como en el video.' });
  }
  if (!pistas.length) {
    pistas.push({ codigo: 'general', texto: 'Mira el video otra vez fijándote en la forma de la mano, dónde empieza y dónde termina el movimiento.' });
  }

  const casi = !!propia && propia.senaId === primera?.senaId && propia.probabilidad >= (d.umbral ?? 0.6) * 0.6;
  return {
    titulo: otra ? `Casi: se pareció más a «${otra.palabra}»` : casi ? '¡Casi lo logras!' : 'Todavía no, ¡pero vamos de nuevo!',
    pistas: pistas.slice(0, MAX_PISTAS),
    parecidaA: otra ? { palabra: otra.palabra, probabilidad: otra.probabilidad } : undefined,
  };
}
