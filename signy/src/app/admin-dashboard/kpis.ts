/**
 * Tipos y cálculos del dashboard de KPIs (panel de admin).
 *
 * Los datos vienen ya agregados de la función `admin_kpis` de Supabase
 * (supabase/migrations/20261027120000_dashboard_kpis.sql): esta parte solo
 * da formato, calcula variaciones y arma lo que necesitan los gráficos.
 */

export interface ConteoIntentos {
  intentos: number;
  correctos?: number;
  aprobados?: number;
  personas?: number;
}

export interface ResumenKpis {
  usuarios_total: number;
  usuarios_nuevos: number;
  usuarios_nuevos_prev: number;
  activos_hoy: number;
  activos_7d: number;
  activos_30d: number;
  activos_periodo: number;
  activos_periodo_prev: number;
  lecciones_total: number;
  lecciones_periodo: number;
  lecciones_periodo_prev: number;
  nivel1_completado: number;
  xp_total: number;
  con_racha: number;
  racha_promedio: number | null;
  racha_maxima: number;
  logros_periodo: number;
  seguimientos: number;
  quiz: ConteoIntentos;
  quiz_prev: ConteoIntentos;
  camara: ConteoIntentos;
  camara_prev: ConteoIntentos;
}

export interface DiaSerie {
  dia: string;
  nuevos: number;
  activos: number;
  lecciones: number;
  ejercicios: number;
}

export interface EtapaEmbudo {
  etapa: string;
  usuarios: number;
}

export interface SubnivelKpi {
  id: number;
  numero: number;
  nombre: string;
  con_contenido: boolean;
  completaron: number;
}

export interface NivelKpi {
  id: number;
  numero: number;
  nombre: string;
  color: string | null;
  completaron: number;
  subniveles: SubnivelKpi[];
}

export interface CohorteKpi {
  semana: string;
  usuarios: number;
  /** % activos en la semana 0..7 desde el registro; null si esa semana todavía no llega. */
  semanas: (number | null)[];
}

export interface RetencionDia {
  elegibles: number;
  volvieron: number;
}

export interface RetencionKpis {
  cohortes: CohorteKpi[];
  d1: RetencionDia;
  d7: RetencionDia;
  d30: RetencionDia;
}

export interface CeldaHabito {
  /** 1 = lunes … 7 = domingo */
  dow: number;
  hora: number;
  n: number;
}

export interface SenaKpi {
  id: number;
  palabra: string;
  nivel: number | null;
  quiz_intentos: number;
  quiz_correctos: number;
  cam_intentos: number;
  cam_aprobados: number;
}

export interface RangoRacha {
  rango: string;
  usuarios: number;
}

export interface UsuarioTop {
  nombre: string;
  xp: number;
  racha: number;
  max_racha: number;
  lecciones: number;
  ultima_actividad: string | null;
}

export interface Kpis {
  generado: string;
  hoy: string;
  desde: string;
  dias: number;
  excluye_admins: boolean;
  resumen: ResumenKpis;
  serie: DiaSerie[];
  embudo: EtapaEmbudo[];
  niveles: NivelKpi[];
  retencion: RetencionKpis;
  habitos: CeldaHabito[];
  senas: SenaKpi[];
  rachas: RangoRacha[];
  top: UsuarioTop[];
  dataset: { muestras: number; muestras_periodo: number; senas: number; personas: number };
  contenido: { niveles: number; subniveles: number; subniveles_con_contenido: number; senas: number; senas_con_video: number };
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

const ENTERO = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const UNA_DECIMAL = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

/** 1284 → "1.284"; desde 10.000, abreviado ("12,9 mil", "1,2 M"). */
export function numero(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${UNA_DECIMAL.format(n / 1e6)} M`;
  if (abs >= 1e4) return `${UNA_DECIMAL.format(n / 1e3)} mil`;
  return ENTERO.format(n);
}

/** Porcentaje con una decimal si es chico: 0,4 % · 12 % · 100 %. */
export function porcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  const decimales = Math.abs(valor) < 10 && valor % 1 !== 0 ? 1 : 0;
  return `${valor.toFixed(decimales).replace('.', ',')} %`;
}

/** parte / total en %, o null si no hay total (evita "NaN %"). */
export function tasa(parte: number | null | undefined, total: number | null | undefined): number | null {
  if (!total || parte === null || parte === undefined) return null;
  return (100 * parte) / total;
}

export interface Variacion {
  /** Texto con signo: "+12 %", "−3 %", "nuevo", "=". */
  texto: string;
  /** Si la variación es buena, mala o neutra (para el color + ícono). */
  tono: 'bueno' | 'malo' | 'neutro';
  /** ↑ ↓ o = (para no depender solo del color). */
  flecha: '↑' | '↓' | '=';
}

/** Variación del período contra el anterior. `subirEsBueno` = false para métricas donde bajar es mejor. */
export function variacion(actual: number | null | undefined, anterior: number | null | undefined, subirEsBueno = true): Variacion | null {
  if (actual === null || actual === undefined || anterior === null || anterior === undefined) return null;
  if (anterior === 0) {
    if (actual === 0) return { texto: '=', tono: 'neutro', flecha: '=' };
    return { texto: 'nuevo', tono: subirEsBueno ? 'bueno' : 'malo', flecha: '↑' };
  }
  const cambio = ((actual - anterior) / anterior) * 100;
  if (Math.abs(cambio) < 0.5) return { texto: '=', tono: 'neutro', flecha: '=' };
  const sube = cambio > 0;
  return {
    texto: `${sube ? '+' : '−'}${Math.abs(cambio) >= 10 ? Math.round(Math.abs(cambio)) : Math.abs(cambio).toFixed(1).replace('.', ',')} %`,
    tono: sube === subirEsBueno ? 'bueno' : 'malo',
    flecha: sube ? '↑' : '↓',
  };
}

/** Variación en puntos porcentuales (para tasas: aciertos, aprobación). */
export function variacionPuntos(actual: number | null, anterior: number | null): Variacion | null {
  if (actual === null || anterior === null) return null;
  const diff = actual - anterior;
  if (Math.abs(diff) < 0.5) return { texto: '=', tono: 'neutro', flecha: '=' };
  return {
    texto: `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0).replace('.', ',')} pts`,
    tono: diff > 0 ? 'bueno' : 'malo',
    flecha: diff > 0 ? '↑' : '↓',
  };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** "2026-10-26" → "26 oct" (sin pasar por Date, para no correrse un día por zona horaria). */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}

/** "2026-10-26" → "lun 26 oct". */
export function fechaConDia(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = lunes
  return `${DIAS[dow]} ${d} ${MESES[m - 1]}`;
}

export const NOMBRES_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ---------------------------------------------------------------------------
// Cálculos para la vista
// ---------------------------------------------------------------------------

export interface EtapaConConversion extends EtapaEmbudo {
  /** % respecto de la primera etapa. */
  pctTotal: number | null;
  /** % respecto de la etapa anterior (cuántos pasaron de la anterior a esta). */
  pctPaso: number | null;
}

export function embudoConConversion(embudo: EtapaEmbudo[]): EtapaConConversion[] {
  const base = embudo[0]?.usuarios ?? 0;
  return embudo.map((e, i) => ({
    ...e,
    pctTotal: tasa(e.usuarios, base),
    pctPaso: i === 0 ? null : tasa(e.usuarios, embudo[i - 1].usuarios),
  }));
}

export interface CaidaEmbudo {
  etapa: EtapaConConversion;
  /** Personas que llegaron a la etapa anterior pero no a esta. */
  perdidos: number;
}

/**
 * La etapa del embudo donde más personas se quedan en el camino (la mayor
 * pérdida en número de personas respecto de la etapa anterior). Se cuenta en
 * personas y no en %, porque las últimas etapas siempre tienen % bajos
 * aunque casi nadie haya llegado a intentarlas todavía.
 */
export function mayorCaida(embudo: EtapaConConversion[]): CaidaEmbudo | null {
  let peor: CaidaEmbudo | null = null;
  embudo.forEach((e, i) => {
    if (i === 0) return;
    const perdidos = embudo[i - 1].usuarios - e.usuarios;
    if (perdidos > 0 && (!peor || perdidos > peor.perdidos)) peor = { etapa: e, perdidos };
  });
  return peor;
}

/** Matriz 7×24 (lunes..domingo × 0..23 h) con la cantidad de ejercicios. */
export function matrizHabitos(celdas: CeldaHabito[]): number[][] {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const c of celdas) {
    if (c.dow >= 1 && c.dow <= 7 && c.hora >= 0 && c.hora < 24) m[c.dow - 1][c.hora] += c.n;
  }
  return m;
}

/** El momento con más práctica: "Martes a las 21:00". */
export function horaPico(celdas: CeldaHabito[]): string | null {
  const mejor = celdas.reduce<CeldaHabito | null>((a, c) => (!a || c.n > a.n ? c : a), null);
  return mejor && mejor.n > 0 ? `${NOMBRES_DIAS[mejor.dow - 1]} a las ${String(mejor.hora).padStart(2, '0')}:00` : null;
}

/** Usuarios activos hoy / en 30 días: qué tan seguido vuelven (DAU/MAU). */
export function adherencia(r: ResumenKpis): number | null {
  return tasa(r.activos_hoy, r.activos_30d);
}

/** Texto plano con los KPIs principales, para pegar en un informe o WhatsApp. */
export function resumenTexto(k: Kpis): string {
  const r = k.resumen;
  const periodo = `${fechaCorta(k.desde)} – ${fechaCorta(k.hoy)} (${k.dias} días)`;
  const lineas = [
    `Signy · KPIs ${periodo}${k.excluye_admins ? ', sin cuentas del equipo' : ''}`,
    `• Usuarios registrados: ${numero(r.usuarios_total)} (${numero(r.usuarios_nuevos)} nuevos en el período)`,
    `• Activos en el período: ${numero(r.activos_periodo)} · hoy ${numero(r.activos_hoy)} · 7 días ${numero(r.activos_7d)} · 30 días ${numero(r.activos_30d)}`,
    `• Terminaron el nivel 1: ${numero(r.nivel1_completado)} (${porcentaje(tasa(r.nivel1_completado, r.usuarios_total))} de los registrados)`,
    `• Lecciones completadas en el período: ${numero(r.lecciones_periodo)} (total ${numero(r.lecciones_total)})`,
    `• Aciertos en el quiz: ${porcentaje(tasa(r.quiz.correctos ?? 0, r.quiz.intentos))} de ${numero(r.quiz.intentos)} respuestas`,
    `• Práctica con cámara: ${numero(r.camara.intentos)} intentos, ${porcentaje(tasa(r.camara.aprobados ?? 0, r.camara.intentos))} aprobados`,
    `• Retención: volvieron al día siguiente ${porcentaje(tasa(k.retencion.d1.volvieron, k.retencion.d1.elegibles))}` +
      `, en su 2ª semana ${porcentaje(tasa(k.retencion.d7.volvieron, k.retencion.d7.elegibles))}`,
    `• Con racha activa: ${numero(r.con_racha)} usuarios (racha máxima ${numero(r.racha_maxima)} días)`,
  ];
  const embudo = embudoConConversion(k.embudo);
  if (embudo.length && embudo[0].usuarios) {
    lineas.push(`• Embudo (registrados en el período): ${embudo.map((e) => `${e.etapa} ${numero(e.usuarios)}`).join(' → ')}`);
  }
  return lineas.join('\n');
}

/** CSV de la serie diaria (separador ";" para que Excel en español lo abra en columnas). */
export function serieCsv(serie: DiaSerie[]): string {
  const filas = serie.map((d) => [d.dia, d.activos, d.nuevos, d.lecciones, d.ejercicios].join(';'));
  return ['fecha;usuarios_activos;usuarios_nuevos;lecciones_completadas;ejercicios', ...filas].join('\n');
}

/** Valores "redondos" para el eje Y: 0, 5, 10, 15… hasta cubrir `max`. */
export function ticksEje(max: number, cantidad = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const crudo = max / cantidad;
  const potencia = Math.pow(10, Math.floor(Math.log10(crudo)));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= crudo) ?? 10 * potencia;
  const ticks: number[] = [];
  for (let v = 0; v < max + paso * 0.001; v += paso) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + paso);
  return ticks;
}

/**
 * Frases cortas con lo más importante del período, para leer de un vistazo
 * (y para contar en una presentación). Solo incluye las que tienen datos.
 */
export function destacados(k: Kpis): string[] {
  const r = k.resumen;
  const frases: string[] = [];

  if (r.usuarios_total) {
    frases.push(
      `${numero(r.nivel1_completado)} de ${numero(r.usuarios_total)} usuarios ` +
        `(${porcentaje(tasa(r.nivel1_completado, r.usuarios_total))}) ya terminaron el nivel 1.`,
    );
  }

  if (k.dias && k.resumen.activos_periodo_prev) {
    const v = variacion(r.activos_periodo, r.activos_periodo_prev);
    if (v && v.flecha !== '=') {
      frases.push(
        `Los usuarios activos ${v.flecha === '↑' ? 'subieron' : 'bajaron'} ${v.texto.replace(/^[+−]/, '')} ` +
          `respecto de los ${k.dias} días anteriores.`,
      );
    }
  }

  const caida = mayorCaida(embudoConConversion(k.embudo));
  if (caida) {
    frases.push(
      `La mayor fuga del embudo está antes de «${caida.etapa.etapa}»: ${numero(caida.perdidos)} ` +
        `${caida.perdidos === 1 ? 'persona no llega' : 'personas no llegan'} (pasa el ${porcentaje(caida.etapa.pctPaso)}).`,
    );
  }

  const d1 = tasa(k.retencion.d1.volvieron, k.retencion.d1.elegibles);
  if (d1 !== null) frases.push(`El ${porcentaje(d1)} de los usuarios nuevos vuelve al día siguiente.`);

  const pico = horaPico(k.habitos);
  if (pico) frases.push(`El momento con más práctica es el ${pico.charAt(0).toLowerCase() + pico.slice(1)}.`);

  // Con pocos intentos el % no dice mucho: solo se cuentan señas con 5 o más.
  const camara = k.senas.filter((s) => s.cam_intentos >= 5);
  if (camara.length >= 2) {
    const dificil = camara.reduce((a, s) => (s.cam_aprobados / s.cam_intentos < a.cam_aprobados / a.cam_intentos ? s : a));
    frases.push(
      `La seña más difícil con la cámara es «${dificil.palabra}»: ` +
        `${porcentaje(tasa(dificil.cam_aprobados, dificil.cam_intentos))} aprobadas en ${numero(dificil.cam_intentos)} intentos.`,
    );
  }
  const quiz = k.senas.filter((s) => s.quiz_intentos >= 5);
  if (quiz.length >= 2) {
    const dificil = quiz.reduce((a, s) => (s.quiz_correctos / s.quiz_intentos < a.quiz_correctos / a.quiz_intentos ? s : a));
    frases.push(`En el quiz, la que más se confunde es «${dificil.palabra}» (${porcentaje(tasa(dificil.quiz_correctos, dificil.quiz_intentos))} de aciertos).`);
  }

  return frases;
}

/** Explica en palabras simples por qué no cargó el dashboard (y qué hacer). */
export function mensajeError(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string };
  const msg = String(err.message ?? '');
  if (err.code === 'PGRST202' || (/admin_kpis/.test(msg) && /(find|exist|encontr)/i.test(msg))) {
    return 'Falta instalar el dashboard en Supabase: corre la migración supabase/migrations/20261027120000_dashboard_kpis.sql en el SQL Editor y vuelve a intentar.';
  }
  if (err.code === '42501') return 'Tu cuenta no es administradora, así que no puede ver el dashboard.';
  if (/failed to fetch|network|load failed/i.test(msg)) return 'No hay conexión con Supabase. Revisa el internet y vuelve a intentar.';
  return `No se pudieron cargar los KPIs${msg ? ': ' + msg : '.'}`;
}
