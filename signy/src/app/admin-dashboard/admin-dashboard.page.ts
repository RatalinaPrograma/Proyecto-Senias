import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  arrowBack,
  bulbOutline,
  copyOutline,
  downloadOutline,
  flame,
  gridOutline,
  hardwareChipOutline,
  layersOutline,
  listOutline,
  refreshOutline,
  searchOutline,
  statsChartOutline,
  trophyOutline,
} from 'ionicons/icons';
import { SupabaseService } from '../services/supabase';
import { ReconocedorSenasService } from '../motor-senas';
import { BarrasComponent, ItemBarra } from './graficos/barras.component';
import { GraficoLineaComponent, PuntoSerie } from './graficos/grafico-linea.component';
import { MapaCalorComponent } from './graficos/mapa-calor.component';
import { SparklineComponent } from './graficos/sparkline.component';
import {
  DiaSerie,
  Kpis,
  NOMBRES_DIAS,
  Variacion,
  destacados,
  embudoConConversion,
  fechaConDia,
  fechaCorta,
  horaPico,
  matrizHabitos,
  mayorCaida,
  mensajeError,
  numero,
  porcentaje,
  resumenTexto,
  serieCsv,
  tasa,
  variacion,
  variacionPuntos,
} from './kpis';

type MetricaSerie = 'activos' | 'nuevos' | 'registrados' | 'lecciones' | 'ejercicios';
type OrdenSenas = 'palabra' | 'quiz' | 'camara' | 'intentos';

interface Tarjeta {
  id: string;
  titulo: string;
  valor: string;
  detalle: string;
  /** Qué mide, para el tooltip del título. */
  ayuda: string;
  variacion: Variacion | null;
  /** Mini tendencia diaria del período. */
  serie?: number[];
  /** Barra de 0 a 100 (para porcentajes). */
  medidor?: number | null;
  destacada?: boolean;
}

interface FilaSena {
  id: number;
  palabra: string;
  nivel: number | null;
  quizPct: number | null;
  quizN: number;
  camPct: number | null;
  camN: number;
  intentos: number;
}

interface VistaNivel {
  id: number;
  nombre: string;
  numero: number;
  color: string | null;
  completaron: number;
  pct: number | null;
  subniveles: ItemBarra[];
}

/** Con menos intentos que esto, el % de una seña se muestra como "pocos datos". */
const MIN_INTENTOS_CONFIABLE = 5;

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, GraficoLineaComponent, MapaCalorComponent, BarrasComponent, SparklineComponent],
})
export class AdminDashboardPage implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly reconocedor = inject(ReconocedorSenasService);
  private readonly router = inject(Router);

  readonly numero = numero;
  readonly porcentaje = porcentaje;
  readonly fechaCorta = fechaCorta;
  readonly fechaConDia = fechaConDia;
  readonly MIN_INTENTOS_CONFIABLE = MIN_INTENTOS_CONFIABLE;

  readonly periodos = [
    { dias: 7, texto: '7 días' },
    { dias: 30, texto: '30 días' },
    { dias: 90, texto: '90 días' },
    { dias: 0, texto: 'Todo' },
  ];
  readonly metricas: { id: MetricaSerie; texto: string; nombre: string }[] = [
    { id: 'activos', texto: 'Activos', nombre: 'Usuarios activos' },
    { id: 'nuevos', texto: 'Nuevos', nombre: 'Usuarios nuevos' },
    { id: 'registrados', texto: 'Registrados', nombre: 'Usuarios registrados (total)' },
    { id: 'lecciones', texto: 'Lecciones', nombre: 'Lecciones completadas' },
    { id: 'ejercicios', texto: 'Ejercicios', nombre: 'Ejercicios hechos' },
  ];

  // ---- filtros ----
  dias = 30;
  excluirAdmins = true;
  metrica: MetricaSerie = 'activos';
  verTabla = false;
  busquedaSena = '';
  ordenSenas: OrdenSenas = 'intentos';
  ordenAsc = false;

  // ---- estado ----
  cargando = true;
  actualizando = false;
  error = '';
  kpis: Kpis | null = null;
  actualizado: Date | null = null;
  /** Mensaje corto abajo de la pantalla ("Resumen copiado"). */
  aviso = '';
  private pedido = 0;
  private temporizadorAviso?: ReturnType<typeof setTimeout>;

  // ---- lo que se dibuja ----
  tarjetas: Tarjeta[] = [];
  frases: string[] = [];
  puntosSerie: PuntoSerie[] = [];
  resumenSerie: { etiqueta: string; valor: string }[] = [];
  filasTabla: DiaSerie[] = [];
  embudo: ItemBarra[] = [];
  caidaEmbudo: { etapa: string; perdidos: number } | null = null;
  registradosPeriodo = 0;
  niveles: VistaNivel[] = [];
  retencion: { id: string; titulo: string; valor: string; detalle: string; ayuda: string }[] = [];
  cohortesFilas: string[] = [];
  cohortesValores: (number | null)[][] = [];
  readonly cohortesColumnas = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
  readonly habitosFilas = DIAS_CORTOS;
  readonly habitosColumnas = Array.from({ length: 24 }, (_, h) => `${h}h`);
  habitosValores: number[][] = [];
  pico: string | null = null;
  senas: FilaSena[] = [];
  senasVisibles: FilaSena[] = [];
  rachas: ItemBarra[] = [];
  modelo: {
    exactitud: number | null;
    personasNuevas: number | null;
    umbral: number;
    senas: number;
    muestras: number | null;
    creado: string | null;
  } | null = null;

  readonly describirCohorte = (fila: string, columna: string, valor: string) =>
    `${fila}: ${valor} siguió practicando en la semana ${columna.slice(1)} desde que se registró`;
  readonly describirHabito = (fila: string, columna: string, valor: string) => {
    const dia = NOMBRES_DIAS[DIAS_CORTOS.indexOf(fila)] ?? fila;
    const h = parseInt(columna, 10);
    return `${dia} de ${h}:00 a ${h}:59 · ${valor} ejercicios`;
  };

  constructor() {
    addIcons({
      alertCircleOutline,
      arrowBack,
      bulbOutline,
      copyOutline,
      downloadOutline,
      flame,
      gridOutline,
      hardwareChipOutline,
      layersOutline,
      listOutline,
      refreshOutline,
      searchOutline,
      statsChartOutline,
      trophyOutline,
    });
  }

  ngOnInit() {
    this.cargar();
    this.cargarModelo();
  }

  ngOnDestroy() {
    clearTimeout(this.temporizadorAviso);
  }

  get textoPeriodo(): string {
    if (!this.kpis) return '';
    return `${fechaCorta(this.kpis.desde)} – ${fechaCorta(this.kpis.hoy)}`;
  }

  /** "vs. los 30 días anteriores" (con "Todo" no hay período anterior). */
  get textoComparacion(): string {
    return this.kpis && this.dias ? `vs. los ${this.kpis.dias} días anteriores` : '';
  }

  get nombreMetrica(): string {
    return this.metricas.find((m) => m.id === this.metrica)?.nombre ?? '';
  }

  // ---------------------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------------------

  async cargar() {
    const pedido = ++this.pedido;
    this.cargando = !this.kpis;
    this.actualizando = !!this.kpis;
    this.error = '';
    try {
      const { data, error } = await this.supabase.adminKpis(this.dias, this.excluirAdmins);
      if (pedido !== this.pedido) return; // ya se pidió otro filtro: este resultado quedó viejo
      if (error) throw error;
      if (!data) throw new Error('La función no devolvió datos.');
      this.aplicar(data as Kpis);
    } catch (e) {
      if (pedido === this.pedido) this.error = mensajeError(e);
    } finally {
      if (pedido === this.pedido) {
        this.cargando = false;
        this.actualizando = false;
      }
    }
  }

  cambiarPeriodo(dias: number) {
    if (dias === this.dias) return;
    this.dias = dias;
    this.cargar();
  }

  cambiarExcluirAdmins(valor: boolean) {
    this.excluirAdmins = valor;
    this.cargar();
  }

  cambiarMetrica(m: MetricaSerie) {
    this.metrica = m;
    this.armarSerie();
  }

  /** El modelo de IA que trae la app (no viene de Supabase): sus métricas del último entrenamiento. */
  private async cargarModelo() {
    const clf = await this.reconocedor.clasificador();
    if (!clf) return;
    const m = (clf.modelo.metricas ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    this.modelo = {
      exactitud: num(m['exactitud']),
      personasNuevas: num(m['exactitudPersonasNuevas']),
      umbral: clf.umbralSugerido,
      // La clase 0 es "ninguna seña", no cuenta como seña reconocida.
      senas: clf.modelo.clases.filter((c) => c.senaId > 0).length,
      muestras: (num(m['muestrasEntrenamiento']) ?? 0) + (num(m['muestrasPrueba']) ?? 0) || null,
      creado: clf.modelo.creado ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Armar la vista a partir de los KPIs
  // ---------------------------------------------------------------------------

  private aplicar(k: Kpis) {
    this.kpis = k;
    this.actualizado = new Date();
    this.armarTarjetas(k);
    this.frases = destacados(k);
    this.armarSerie();
    this.armarEmbudo(k);
    this.armarNiveles(k);
    this.armarRetencion(k);
    this.habitosValores = matrizHabitos(k.habitos);
    this.pico = horaPico(k.habitos);
    this.armarSenas(k);
    const totalRachas = k.rachas.reduce((a, r) => a + r.usuarios, 0);
    this.rachas = k.rachas.map((r) => ({
      etiqueta: r.rango,
      valor: r.usuarios,
      texto: `${numero(r.usuarios)} · ${porcentaje(tasa(r.usuarios, totalRachas))}`,
    }));
  }

  private armarTarjetas(k: Kpis) {
    const r = k.resumen;
    const conPrevio = this.dias !== 0;
    const v = (actual: number, anterior: number) => (conPrevio ? variacion(actual, anterior) : null);
    const quizPct = tasa(r.quiz.correctos ?? 0, r.quiz.intentos);
    const quizPrev = tasa(r.quiz_prev.correctos ?? 0, r.quiz_prev.intentos);
    const camPct = tasa(r.camara.aprobados ?? 0, r.camara.intentos);
    const camPrev = tasa(r.camara_prev.aprobados ?? 0, r.camara_prev.intentos);
    const ejercicios = r.quiz.intentos + r.camara.intentos;
    const ejerciciosPrev = r.quiz_prev.intentos + r.camara_prev.intentos;
    const nivel1Pct = tasa(r.nivel1_completado, r.usuarios_total);

    this.tarjetas = [
      {
        id: 'usuarios',
        titulo: 'Usuarios registrados',
        valor: numero(r.usuarios_total),
        detalle: `${numero(r.usuarios_nuevos)} nuevos en el período`,
        ayuda: 'Cuentas creadas en Signy desde el inicio. La variación compara los usuarios nuevos con el período anterior.',
        variacion: v(r.usuarios_nuevos, r.usuarios_nuevos_prev),
        serie: this.acumulado(k),
      },
      {
        id: 'activos',
        titulo: 'Usuarios activos',
        valor: numero(r.activos_periodo),
        detalle: `Hoy ${numero(r.activos_hoy)} · 7 días ${numero(r.activos_7d)} · 30 días ${numero(r.activos_30d)}`,
        ayuda: 'Personas que practicaron al menos un día del período: hicieron un ejercicio, completaron una lección o sumaron a su racha.',
        variacion: v(r.activos_periodo, r.activos_periodo_prev),
        serie: k.serie.map((d) => d.activos),
      },
      {
        id: 'nivel1',
        titulo: 'Terminaron el nivel 1',
        valor: numero(r.nivel1_completado),
        detalle: `${porcentaje(nivel1Pct)} de los registrados`,
        ayuda: 'Usuarios que completaron todas las lecciones (con contenido) del nivel 1, desde el inicio.',
        variacion: null,
        medidor: nivel1Pct,
        destacada: true,
      },
      {
        id: 'lecciones',
        titulo: 'Lecciones completadas',
        valor: numero(r.lecciones_periodo),
        detalle: `${numero(r.lecciones_total)} desde el inicio`,
        ayuda: 'Subniveles terminados en el período (cada usuario cuenta una vez por lección).',
        variacion: v(r.lecciones_periodo, r.lecciones_periodo_prev),
        serie: k.serie.map((d) => d.lecciones),
      },
      {
        id: 'ejercicios',
        titulo: 'Ejercicios hechos',
        valor: numero(ejercicios),
        detalle: `${numero(r.quiz.intentos)} de quiz · ${numero(r.camara.intentos)} con cámara`,
        ayuda: 'Respuestas del quiz más intentos de práctica con la cámara en el período.',
        variacion: v(ejercicios, ejerciciosPrev),
        serie: k.serie.map((d) => d.ejercicios),
      },
      {
        id: 'quiz',
        titulo: 'Aciertos en el quiz',
        valor: porcentaje(quizPct),
        detalle: `${numero(r.quiz.correctos ?? 0)} de ${numero(r.quiz.intentos)} respuestas`,
        ayuda: 'Porcentaje de respuestas correctas en los ejercicios de elegir la seña.',
        variacion: conPrevio ? variacionPuntos(quizPct, quizPrev) : null,
        medidor: quizPct,
      },
      {
        id: 'camara',
        titulo: 'Aprobadas con cámara',
        valor: porcentaje(camPct),
        detalle: `${numero(r.camara.intentos)} intentos de ${numero(r.camara.personas ?? 0)} personas`,
        ayuda: 'Intentos de hacer la seña frente a la cámara que el modelo de IA aprobó.',
        variacion: conPrevio ? variacionPuntos(camPct, camPrev) : null,
        medidor: camPct,
      },
      {
        id: 'racha',
        titulo: 'Con racha activa',
        valor: numero(r.con_racha),
        detalle: `${porcentaje(tasa(r.con_racha, r.usuarios_total))} de los usuarios · récord ${numero(r.racha_maxima)} días`,
        ayuda: 'Usuarios que practicaron hoy o ayer y mantienen su racha de días seguidos. La barra es el % de todos los usuarios.',
        variacion: null,
        medidor: tasa(r.con_racha, r.usuarios_total),
      },
    ];
  }

  /** Usuarios registrados acumulados día a día dentro del período. */
  private acumulado(k: Kpis): number[] {
    const nuevosPeriodo = k.serie.reduce((a, d) => a + d.nuevos, 0);
    let total = Math.max(0, k.resumen.usuarios_total - nuevosPeriodo);
    return k.serie.map((d) => (total += d.nuevos));
  }

  private armarSerie() {
    const k = this.kpis;
    if (!k) return;
    const valores = this.metrica === 'registrados' ? this.acumulado(k) : k.serie.map((d) => d[this.metrica as Exclude<MetricaSerie, 'registrados'>]);
    this.puntosSerie = k.serie.map((d, i) => ({ x: d.dia, y: valores[i] }));
    this.filasTabla = [...k.serie].reverse();

    if (!valores.length) {
      this.resumenSerie = [];
      return;
    }
    const iMejor = valores.reduce((m, v, i) => (v > valores[m] ? i : m), 0);
    const suma = valores.reduce((a, v) => a + v, 0);
    const mejor = { etiqueta: 'Mejor día', valor: `${numero(valores[iMejor])} · ${fechaConDia(k.serie[iMejor].dia)}` };
    const promedio = { etiqueta: 'Promedio por día', valor: (suma / valores.length).toFixed(1).replace('.', ',') };

    if (this.metrica === 'registrados') {
      // Es un total acumulado: importa dónde terminó y cuánto creció, no la suma de los días.
      const fin = valores[valores.length - 1];
      const inicio = valores[0] - k.serie[0].nuevos;
      this.resumenSerie = [
        { etiqueta: 'Al cierre del período', valor: numero(fin) },
        { etiqueta: 'Crecimiento', valor: `+${numero(fin - inicio)}${inicio ? ' · ' + porcentaje(tasa(fin - inicio, inicio)) : ''}` },
      ];
    } else if (this.metrica === 'activos') {
      // Sumar los activos de cada día contaría dos veces a quien vino dos días: se usa el total de personas distintas.
      this.resumenSerie = [{ etiqueta: 'Personas distintas', valor: numero(k.resumen.activos_periodo) }, promedio, mejor];
    } else {
      this.resumenSerie = [{ etiqueta: 'Total del período', valor: numero(suma) }, promedio, mejor];
    }
  }

  private armarEmbudo(k: Kpis) {
    const etapas = embudoConConversion(k.embudo);
    const caida = mayorCaida(etapas);
    this.registradosPeriodo = etapas[0]?.usuarios ?? 0;
    this.caidaEmbudo = caida ? { etapa: caida.etapa.etapa, perdidos: caida.perdidos } : null;
    this.embudo = etapas.map((e, i) => ({
      etiqueta: e.etapa,
      valor: e.usuarios,
      texto: i === 0 ? numero(e.usuarios) : `${numero(e.usuarios)} · ${porcentaje(e.pctTotal)}`,
      detalle: i === 0 ? 'Punto de partida' : `${porcentaje(e.pctPaso)} de la etapa anterior`,
      destacada: !!caida && e.etapa === caida.etapa.etapa,
    }));
  }

  private armarNiveles(k: Kpis) {
    const base = this.registradosPeriodo;
    this.niveles = k.niveles.map((n) => ({
      id: n.id,
      nombre: n.nombre,
      numero: n.numero,
      color: n.color,
      completaron: n.completaron,
      pct: tasa(n.completaron, base),
      subniveles: n.subniveles.map((s) => ({
        etiqueta: `${s.numero}. ${s.nombre}`,
        valor: s.completaron,
        texto: `${numero(s.completaron)} · ${porcentaje(tasa(s.completaron, base))}`,
        detalle: s.con_contenido ? undefined : 'Sin contenido todavía',
      })),
    }));
  }

  private armarRetencion(k: Kpis) {
    const tile = (id: string, titulo: string, d: { elegibles: number; volvieron: number }, espera: string, ayuda: string) => ({
      id,
      titulo,
      valor: porcentaje(tasa(d.volvieron, d.elegibles)),
      detalle: d.elegibles ? `${numero(d.volvieron)} de ${numero(d.elegibles)} usuarios` : `Aún nadie lleva ${espera}`,
      ayuda,
    });
    this.retencion = [
      tile('d1', 'Al día siguiente', k.retencion.d1, '1 día', 'De los que se registraron en el período, cuántos volvieron a practicar el día después de registrarse.'),
      tile('d7', 'En su 2ª semana', k.retencion.d7, '7 días', 'Cuántos practicaron entre el día 7 y el 13 después de registrarse.'),
      tile('d30', 'Al mes', k.retencion.d30, '28 días', 'Cuántos practicaron entre el día 28 y el 34 después de registrarse.'),
    ];
    this.cohortesFilas = k.retencion.cohortes.map((c) => `${fechaCorta(c.semana)} (${numero(c.usuarios)})`);
    this.cohortesValores = k.retencion.cohortes.map((c) => c.semanas);
  }

  private armarSenas(k: Kpis) {
    this.senas = k.senas.map((s) => ({
      id: s.id,
      palabra: s.palabra,
      nivel: s.nivel,
      quizPct: tasa(s.quiz_correctos, s.quiz_intentos),
      quizN: s.quiz_intentos,
      camPct: tasa(s.cam_aprobados, s.cam_intentos),
      camN: s.cam_intentos,
      intentos: s.quiz_intentos + s.cam_intentos,
    }));
    this.filtrarSenas();
  }

  // ---------------------------------------------------------------------------
  // Tabla de señas
  // ---------------------------------------------------------------------------

  ordenarSenas(campo: OrdenSenas) {
    if (this.ordenSenas === campo) this.ordenAsc = !this.ordenAsc;
    else {
      this.ordenSenas = campo;
      // Nombre de la A a la Z; números de mayor a menor (los % de menor a mayor: primero las difíciles).
      this.ordenAsc = campo === 'palabra' || campo === 'quiz' || campo === 'camara';
    }
    this.filtrarSenas();
  }

  ordenAria(campo: OrdenSenas): 'ascending' | 'descending' | 'none' {
    return this.ordenSenas === campo ? (this.ordenAsc ? 'ascending' : 'descending') : 'none';
  }

  filtrarSenas() {
    const q = normalizar(this.busquedaSena);
    const valor = (s: FilaSena): number | string => {
      switch (this.ordenSenas) {
        case 'palabra': return normalizar(s.palabra);
        case 'quiz': return s.quizPct ?? -1;
        case 'camara': return s.camPct ?? -1;
        default: return s.intentos;
      }
    };
    const dir = this.ordenAsc ? 1 : -1;
    this.senasVisibles = this.senas
      .filter((s) => !q || normalizar(s.palabra).includes(q))
      .sort((a, b) => {
        const va = valor(a);
        const vb = valor(b);
        // Las que no tienen datos siempre al final, ordene como ordene.
        if (va === -1 && vb !== -1) return 1;
        if (vb === -1 && va !== -1) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.palabra.localeCompare(b.palabra, 'es');
      });
  }

  // ---------------------------------------------------------------------------
  // Exportar
  // ---------------------------------------------------------------------------

  async copiarResumen() {
    if (!this.kpis) return;
    const texto = resumenTexto(this.kpis);
    try {
      await navigator.clipboard.writeText(texto);
      this.mostrarAviso('Resumen copiado: pégalo en el informe o en WhatsApp.');
    } catch {
      // Sin permiso para el portapapeles (o navegador antiguo): que lo copie a mano.
      window.prompt('Copia el resumen:', texto);
    }
  }

  descargarCsv() {
    if (!this.kpis) return;
    if (Capacitor.isNativePlatform()) {
      this.mostrarAviso('La descarga funciona desde el navegador del computador. En el celular usa "Copiar resumen".');
      return;
    }
    // BOM para que Excel lea bien los acentos.
    const blob = new Blob(['\ufeff' + serieCsv(this.kpis.serie)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signy-kpis-${this.kpis.desde}-a-${this.kpis.hoy}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private mostrarAviso(texto: string) {
    this.aviso = texto;
    clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => (this.aviso = ''), 3000);
  }

  // ---------------------------------------------------------------------------
  // Navegación
  // ---------------------------------------------------------------------------

  volver() {
    this.router.navigate(['/home']);
  }

  irAVocabulario() {
    this.router.navigate(['/admin/vocabulario']);
  }

  irAAIStudio() {
    this.router.navigate(['/admin/ai-studio']);
  }

  trackPorId(_: number, item: { id: string | number }) {
    return item.id;
  }
}

/** Minúsculas y sin tildes, para buscar "dia" y encontrar "Día". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
