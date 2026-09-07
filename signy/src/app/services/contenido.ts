import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase';
import {
  Nivel, Subnivel, Sena, ProgresoNivelUsuario, ProgresoSubnivelUsuario,
  UserStats, PracticaFallo, Logro, NivelConEstado, RachaHistorialDia, EventoRacha
} from '../data/db-types';

@Injectable({ providedIn: 'root' })
export class ContenidoService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.supabase;
  }

  // ---------- Contenido (igual para todos los usuarios) ----------
  async getNiveles(): Promise<Nivel[]> {
    const { data, error } = await this.db.from('niveles').select('*').order('numero_nivel');
    if (error) throw error;
    return data ?? [];
  }

  async getSubniveles(nivelId: number): Promise<Subnivel[]> {
    const { data, error } = await this.db
      .from('subniveles')
      .select('*')
      .eq('nivel_id', nivelId)
      .order('numero_subnivel');
    if (error) throw error;
    return data ?? [];
  }

  /** Todos los subniveles de todos los niveles en una sola consulta (evita
   * el N+1 de llamar getSubniveles por cada nivel al armar el camino). */
  async getSubnivelesTodos(): Promise<Subnivel[]> {
    const { data, error } = await this.db
      .from('subniveles')
      .select('*')
      .order('nivel_id')
      .order('numero_subnivel');
    if (error) throw error;
    return data ?? [];
  }

  /** IDs de subniveles que ya tienen al menos una seña con video_url
   * cargado. Una fila de seña sin video_url (palabra cargada de antemano,
   * pendiente del GIF real) no cuenta como "lista" todavía. */
  async getSubnivelesConContenido(): Promise<Set<number>> {
    const { data, error } = await this.db.from('senas').select('subnivel_id').not('video_url', 'is', null);
    if (error) throw error;
    return new Set((data ?? []).map(r => r.subnivel_id));
  }

  async getSubnivelPorId(subnivelId: number): Promise<Subnivel | null> {
    const { data, error } = await this.db.from('subniveles').select('*').eq('id', subnivelId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getNivelPorId(nivelId: number): Promise<Nivel | null> {
    const { data, error } = await this.db.from('niveles').select('*').eq('id', nivelId).maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Pool de palabras (con su ícono de concepto, si tiene) para armar los
   * distractores del quiz — no solo las de la lección actual. */
  async getPoolDePalabras(limite = 200): Promise<{ palabra: string; icono: string | null }[]> {
    const { data, error } = await this.db.from('senas').select('palabra, icono').limit(limite);
    if (error) throw error;
    return data ?? [];
  }

  async getSenas(subnivelId: number): Promise<Sena[]> {
    const { data, error } = await this.db.from('senas').select('*').eq('subnivel_id', subnivelId);
    if (error) throw error;
    return data ?? [];
  }

  // ---------- Progreso (propio del usuario) ----------
  async getMisProgresosNivel(userId: string): Promise<ProgresoNivelUsuario[]> {
    const { data, error } = await this.db.from('progreso_nivel_usuario').select('*').eq('user_id', userId);
    if (error) throw error;
    return data ?? [];
  }

  async getMisProgresosSubnivel(userId: string): Promise<ProgresoSubnivelUsuario[]> {
    const { data, error } = await this.db.from('progreso_subnivel_usuario').select('*').eq('user_id', userId);
    if (error) throw error;
    return data ?? [];
  }

  /** Junta niveles + subniveles + progreso real del usuario en un solo
   * árbol listo para pintar en Home, con el estado de cada subnivel ya
   * calculado (completado / actual / bloqueado). */
  async obtenerMapaDeAprendizaje(userId: string): Promise<NivelConEstado[]> {
    const [niveles, progresoNiveles, progresoSubniveles, todosLosSubniveles, subnivelesConContenido] = await Promise.all([
      this.getNiveles(),
      this.getMisProgresosNivel(userId),
      this.getMisProgresosSubnivel(userId),
      this.getSubnivelesTodos(),
      this.getSubnivelesConContenido(),
    ]);

    const progresoNivelPorId = new Map(progresoNiveles.map(p => [p.nivel_id, p]));
    const progresoSubnivelPorId = new Map(progresoSubniveles.map(p => [p.subnivel_id, p]));

    const subnivelesPorNivel = new Map<number, Subnivel[]>();
    for (const sub of todosLosSubniveles) {
      const lista = subnivelesPorNivel.get(sub.nivel_id) ?? [];
      lista.push(sub);
      subnivelesPorNivel.set(sub.nivel_id, lista);
    }

    const resultado: NivelConEstado[] = [];

    for (let i = 0; i < niveles.length; i++) {
      const nivel = niveles[i];
      const progNivel = progresoNivelPorId.get(nivel.id);

      // El primer nivel (numero_nivel más bajo) es accesible por defecto
      // aunque todavía no exista una fila de progreso para el usuario.
      const accesible = progNivel?.acceso === true || (i === 0 && !progNivel);
      const completadoNivel = progNivel?.completado === true;

      const subniveles = subnivelesPorNivel.get(nivel.id) ?? [];
      let yaHayActual = false;

      const subnivelesConEstado = subniveles.map((sub) => {
        const progSub = progresoSubnivelPorId.get(sub.id);
        const completado = progSub?.completado === true;

        let estado: 'completado' | 'actual' | 'bloqueado' | 'proximamente';
        if (!subnivelesConContenido.has(sub.id)) {
          // Todavía no tiene señas con video_url: nunca se marca como
          // 'actual' (no invitamos a tocar algo que va a mostrar un error).
          estado = 'proximamente';
        } else if (!accesible) {
          estado = 'bloqueado';
        } else if (completado) {
          estado = 'completado';
        } else if (!yaHayActual) {
          estado = 'actual';
          yaHayActual = true;
        } else {
          estado = 'bloqueado';
        }

        return { ...sub, estado };
      });

      resultado.push({ ...nivel, accesible, completado: completadoNivel, subniveles: subnivelesConEstado });
    }

    return resultado;
  }

  async marcarSubnivelCompletado(userId: string, subnivelId: number, puntaje: number) {
    const { error } = await this.db.from('progreso_subnivel_usuario').upsert(
      {
        user_id: userId,
        subnivel_id: subnivelId,
        completado: true,
        puntaje,
        fecha_completado: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,subnivel_id' }
    );
    if (error) throw error;

    const totalCompletadas = await this.contarLeccionesCompletadas(userId);
    if (totalCompletadas >= 1) this.otorgarLogroPorCodigo(userId, 'primera_leccion').catch(console.error);
    if (totalCompletadas >= 10) this.otorgarLogroPorCodigo(userId, 'diez_lecciones').catch(console.error);
    if (totalCompletadas >= 50) this.otorgarLogroPorCodigo(userId, 'cincuenta_lecciones').catch(console.error);
  }

  /** Cuántas lecciones (subniveles) distintas ha completado el usuario en
   * total, sin importar el nivel — la usan los logros de "10 lecciones",
   * "50 lecciones", etc. */
  async contarLeccionesCompletadas(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from('progreso_subnivel_usuario')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completado', true);
    if (error) throw error;
    return count ?? 0;
  }

  /** Si todos los subniveles de un nivel quedaron completados, marca el
   * nivel como completado y da acceso al siguiente nivel de la lista. */
  async avanzarNivelSiCorresponde(userId: string, nivelId: number) {
    const [niveles, subniveles, progresoSubniveles] = await Promise.all([
      this.getNiveles(),
      this.getSubniveles(nivelId),
      this.getMisProgresosSubnivel(userId),
    ]);

    const completadosPorId = new Set(
      progresoSubniveles.filter(p => p.completado).map(p => p.subnivel_id)
    );
    const todosCompletados = subniveles.every(s => completadosPorId.has(s.id));
    if (!todosCompletados) return;

    await this.db.from('progreso_nivel_usuario').upsert(
      { user_id: userId, nivel_id: nivelId, completado: true, acceso: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,nivel_id' }
    );
    this.otorgarLogroPorCodigo(userId, 'nivel_completado').catch(console.error);

    const idx = niveles.findIndex(n => n.id === nivelId);
    const siguiente = niveles[idx + 1];
    if (siguiente) {
      await this.db.from('progreso_nivel_usuario').upsert(
        { user_id: userId, nivel_id: siguiente.id, acceso: true, completado: false, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,nivel_id' }
      );
    }
  }

  // ---------- Estadísticas (racha, XP, vidas) ----------

  /** Cada cuánto se recupera 1 vida, y el tope máximo de vidas. */
  private static readonly VIDA_REGEN_MS = 4 * 60 * 60 * 1000; // 4 horas
  private static readonly VIDAS_MAX = 5;

  /** Cada cuántos días de racha se gana 1 congelador, y el tope acumulable. */
  private static readonly RACHA_CONGELADORES_CADA = 5;
  private static readonly RACHA_CONGELADORES_MAX = 2;

  async getMisStats(userId: string): Promise<UserStats> {
    const { data, error } = await this.db.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (data) {
      const conVidas = await this.regenerarVidasSiCorresponde(userId, data);
      return this.evaluarRachaSiCorresponde(userId, conVidas);
    }

    // Primera vez del usuario: se crea su fila de estadísticas iniciales
    const inicial: UserStats = {
      user_id: userId,
      racha_actual: 0,
      max_racha: 0,
      ultima_fecha_practica: null,
      puntos_experiencia: 0,
      vidas: 5,
      ultima_vida_perdida: null,
      racha_congeladores: 0,
      racha_evaluada_hasta: null,
      updated_at: new Date().toISOString(),
    };
    const { error: insertError } = await this.db.from('user_stats').insert(inicial);
    if (insertError) throw insertError;
    return inicial;
  }

  /** Devuelve cuántos minutos faltan para la próxima vida (o 0 si ya está al
   * máximo o no aplica). Útil para mostrarlo en la pantalla de "sin vidas". */
  minutosParaProximaVida(stats: UserStats): number {
    if ((stats.vidas ?? 0) >= ContenidoService.VIDAS_MAX || !stats.ultima_vida_perdida) return 0;
    const msTranscurridos = Date.now() - new Date(stats.ultima_vida_perdida).getTime();
    const msFaltantes = ContenidoService.VIDA_REGEN_MS - (msTranscurridos % ContenidoService.VIDA_REGEN_MS);
    return Math.max(0, Math.ceil(msFaltantes / 60000));
  }

  /** Revisa cuánto tiempo pasó desde que se perdió la última vida y
   * devuelve/persiste las vidas que correspondan (1 cada 4 horas, tope 5).
   * Sin esto, "ultima_vida_perdida" quedaba guardada pero nunca se usaba
   * para devolver vidas, así que el usuario se quedaba en 0 para siempre. */
  private async regenerarVidasSiCorresponde(userId: string, stats: UserStats): Promise<UserStats> {
    if ((stats.vidas ?? 0) >= ContenidoService.VIDAS_MAX || !stats.ultima_vida_perdida) {
      return stats;
    }

    const msTranscurridos = Date.now() - new Date(stats.ultima_vida_perdida).getTime();
    const vidasGanadas = Math.floor(msTranscurridos / ContenidoService.VIDA_REGEN_MS);
    if (vidasGanadas <= 0) return stats;

    const vidasFinal = Math.min(ContenidoService.VIDAS_MAX, (stats.vidas ?? 0) + vidasGanadas);
    // Si llegó al tope, se limpia la marca; si no, se conserva el resto del
    // tiempo ya transcurrido para que la siguiente vida siga sumando desde ahí.
    const msRestantes = msTranscurridos % ContenidoService.VIDA_REGEN_MS;
    const nuevaMarca = vidasFinal >= ContenidoService.VIDAS_MAX ? null : new Date(Date.now() - msRestantes).toISOString();

    const actualizado: Partial<UserStats> = {
      vidas: vidasFinal,
      ultima_vida_perdida: nuevaMarca,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.db.from('user_stats').update(actualizado).eq('user_id', userId);
    if (error) throw error;

    return { ...stats, ...actualizado };
  }

  // ---------- Fechas (día calendario LOCAL del dispositivo, no UTC) ----------
  // OJO: nunca usar `new Date().toISOString().slice(0,10)` para "hoy" — eso
  // da la fecha en UTC, y en Chile (UTC-3/-4) pasadas ~20-21h ya muestra el
  // día siguiente. Todo lo de racha tiene que ir en fecha LOCAL.
  fechaHoy(): string {
    return this.formatearFechaLocal(new Date());
  }

  sumarDias(fecha: string, dias: number): string {
    const [y, m, d] = fecha.split('-').map(Number);
    // Mediodía local (no medianoche) para no toparse con el cambio de
    // horario de verano al sumar/restar días.
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    dt.setDate(dt.getDate() + dias);
    return this.formatearFechaLocal(dt);
  }

  private diasEntreFechas(desde: string, hasta: string): number {
    const [y1, m1, d1] = desde.split('-').map(Number);
    const [y2, m2, d2] = hasta.split('-').map(Number);
    const msDesde = new Date(y1, m1 - 1, d1, 12, 0, 0).getTime();
    const msHasta = new Date(y2, m2 - 1, d2, 12, 0, 0).getTime();
    return Math.round((msHasta - msDesde) / 86400000);
  }

  private formatearFechaLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}`;
  }

  /**
   * Revisa si pasaron días sin practicar desde la última vez y, si es así,
   * "cierra" esos días: los cubre con congeladores si hay suficientes
   * disponibles (la racha sigue viva) o, si no alcanzan, corta la racha a 0.
   * Sin esto la racha quedaba "colgada" con el número viejo hasta la
   * siguiente lección, como si nunca se pudiera perder.
   *
   * Idempotente por día: `racha_evaluada_hasta` evita procesar el mismo
   * hueco dos veces si el usuario abre la app varias veces el mismo día.
   */
  private async evaluarRachaSiCorresponde(userId: string, stats: UserStats): Promise<UserStats> {
    const hoy = this.fechaHoy();
    if (!stats.ultima_fecha_practica || stats.ultima_fecha_practica === hoy) return stats;
    if (stats.racha_evaluada_hasta === hoy) return stats;

    const diasSinPracticar = this.diasEntreFechas(stats.ultima_fecha_practica, hoy);

    // Practicó ayer (dentro de la ventana normal) o ya no tenía racha que
    // proteger: no hay nada que congelar ni que cortar, solo se marca el día.
    if (diasSinPracticar <= 1 || (stats.racha_actual ?? 0) === 0) {
      const actualizado: Partial<UserStats> = { racha_evaluada_hasta: hoy };
      await this.db.from('user_stats').update(actualizado).eq('user_id', userId);
      return { ...stats, ...actualizado };
    }

    const diasPerdidos = diasSinPracticar - 1;
    const congeladoresDisponibles = stats.racha_congeladores ?? 0;
    const seCubreConCongeladores = congeladoresDisponibles >= diasPerdidos;

    const filasHistorial = Array.from({ length: diasPerdidos }, (_, i) => ({
      user_id: userId,
      fecha: this.sumarDias(stats.ultima_fecha_practica!, i + 1),
      estado: seCubreConCongeladores ? 'congelado' : 'perdido',
    }));

    const { error: errorHistorial } = await this.db
      .from('racha_historial')
      .upsert(filasHistorial, { onConflict: 'user_id,fecha' });
    if (errorHistorial) console.error(errorHistorial);

    const actualizado: Partial<UserStats> = seCubreConCongeladores
      ? { racha_congeladores: congeladoresDisponibles - diasPerdidos, racha_evaluada_hasta: hoy }
      : { racha_actual: 0, racha_evaluada_hasta: hoy };

    const { error } = await this.db.from('user_stats').update(actualizado).eq('user_id', userId);
    if (error) throw error;

    // `eventoRacha` es solo para quien llamó a getMisStats en este instante
    // (para poder avisarle con una notificación) — nunca se persiste.
    const eventoRacha: EventoRacha = seCubreConCongeladores
      ? { tipo: 'congelado', diasCubiertos: diasPerdidos, congeladoresRestantes: congeladoresDisponibles - diasPerdidos }
      : { tipo: 'perdida', diasCubiertos: diasPerdidos, congeladoresRestantes: 0 };

    return { ...stats, ...actualizado, eventoRacha };
  }

  /** Historial de días para el calendario de racha en el perfil. */
  async obtenerHistorialRacha(userId: string, dias = 28): Promise<RachaHistorialDia[]> {
    const desde = this.sumarDias(this.fechaHoy(), -dias);
    const { data, error } = await this.db
      .from('racha_historial')
      .select('fecha, estado')
      .eq('user_id', userId)
      .gte('fecha', desde)
      .order('fecha', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  /** Actualiza racha y XP al terminar una lección. Regla simple: si ya
   * practicaste hoy, la racha no cambia; si practicaste ayer, sube +1; si
   * no, se reinicia en 1. `getMisStats` (llamado arriba) ya corrió la
   * evaluación de racha con congeladores, así que `stats.racha_actual` ya
   * refleja si la racha sigue viva — no hace falta comparar fechas de nuevo
   * acá (si se comparara de nuevo, un día cubierto por un congelador se
   * vería como "no fue ayer" y cortaría la racha igual, aunque el
   * congelador ya la haya protegido). Cada 5 días de racha se gana 1
   * congelador (tope 2) para no perderla si algún día se pasa por alto. */
  async actualizarStatsTrasLeccion(userId: string, xpGanado: number): Promise<UserStats> {
    const stats = await this.getMisStats(userId);
    const hoy = this.fechaHoy();

    const nuevaRacha = stats.ultima_fecha_practica === hoy
      ? stats.racha_actual ?? 0 // ya practicó hoy, no cambia
      : (stats.racha_actual ?? 0) + 1;

    const ganaCongelador = nuevaRacha > 0 && nuevaRacha % ContenidoService.RACHA_CONGELADORES_CADA === 0;
    const congeladoresFinal = Math.min(
      ContenidoService.RACHA_CONGELADORES_MAX,
      (stats.racha_congeladores ?? 0) + (ganaCongelador ? 1 : 0)
    );

    const actualizado: Partial<UserStats> = {
      racha_actual: nuevaRacha,
      max_racha: Math.max(stats.max_racha ?? 0, nuevaRacha),
      puntos_experiencia: (stats.puntos_experiencia ?? 0) + xpGanado,
      ultima_fecha_practica: hoy,
      racha_evaluada_hasta: hoy,
      racha_congeladores: congeladoresFinal,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.db.from('user_stats').update(actualizado).eq('user_id', userId);
    if (error) throw error;

    const { error: errorHistorial } = await this.db
      .from('racha_historial')
      .upsert({ user_id: userId, fecha: hoy, estado: 'practicado' }, { onConflict: 'user_id,fecha' });
    if (errorHistorial) console.error(errorHistorial);

    // otorgarLogroPorCodigo hace upsert (no duplica ni revienta si ya lo
    // tenía), así que no hace falta controlar "primera vez que cruza el
    // umbral" acá: comparar >= es suficiente y más a prueba de saltos.
    if (nuevaRacha >= 7) this.otorgarLogroPorCodigo(userId, 'racha_7').catch(console.error);
    if (nuevaRacha >= 30) this.otorgarLogroPorCodigo(userId, 'racha_30').catch(console.error);
    if (nuevaRacha >= 100) this.otorgarLogroPorCodigo(userId, 'racha_100').catch(console.error);
    if (ganaCongelador) this.otorgarLogroPorCodigo(userId, 'congelador').catch(console.error);

    return { ...stats, ...actualizado };
  }

  async descontarVida(userId: string): Promise<number> {
    const stats = await this.getMisStats(userId);
    const nuevasVidas = Math.max(0, (stats.vidas ?? 5) - 1);
    await this.db
      .from('user_stats')
      .update({ vidas: nuevasVidas, ultima_vida_perdida: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    return nuevasVidas;
  }

  // ---------- Intentos y fallos (para repaso personalizado) ----------
  async registrarIntento(userId: string, senaId: number, correcto: boolean, scoreSimilitud: number | null = null) {
    const { error } = await this.db.from('intentos_ejercicio').insert({
      user_id: userId,
      sena_id: senaId,
      correcto,
      score_similitud: scoreSimilitud,
    });
    if (error) throw error;

    if (!correcto) {
      await this.registrarFallo(userId, senaId);
    }
  }

  private async registrarFallo(userId: string, senaId: number) {
    const { data } = await this.db
      .from('practica_fallos')
      .select('*')
      .eq('user_id', userId)
      .eq('sena_id', senaId)
      .maybeSingle();

    if (data) {
      await this.db
        .from('practica_fallos')
        .update({ cantidad_fallos: (data.cantidad_fallos ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', data.id);
    } else {
      await this.db.from('practica_fallos').insert({
        user_id: userId,
        sena_id: senaId,
        cantidad_fallos: 1,
        updated_at: new Date().toISOString(),
      });
    }
  }

  /** Palabras que más le cuestan al usuario, para la pantalla de Perfil. */
  async getMisFallos(userId: string, limite = 5): Promise<{ palabra: string; icono: string | null; cantidad_fallos: number }[]> {
    const { data, error } = await this.db
      .from('practica_fallos')
      .select('cantidad_fallos, senas ( palabra, icono )')
      .eq('user_id', userId)
      .order('cantidad_fallos', { ascending: false })
      .limit(limite);
    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      palabra: row.senas?.palabra ?? '—',
      icono: row.senas?.icono ?? null,
      cantidad_fallos: row.cantidad_fallos ?? 0,
    }));
  }

  // ---------- Logros ----------
  private logrosCache: Logro[] | null = null;

  async getLogros(): Promise<Logro[]> {
    const { data, error } = await this.db.from('logros').select('*');
    if (error) throw error;
    return data ?? [];
  }

  async getMisLogrosIds(userId: string): Promise<Set<number>> {
    const { data, error } = await this.db.from('usuario_logros').select('logro_id').eq('user_id', userId);
    if (error) throw error;
    return new Set((data ?? []).map(r => r.logro_id));
  }

  async otorgarLogro(userId: string, logroId: number) {
    await this.db
      .from('usuario_logros')
      .upsert({ user_id: userId, logro_id: logroId, fecha_obtenido: new Date().toISOString() }, { onConflict: 'user_id,logro_id' });
  }

  /** Punto de entrada que usa el resto del código para otorgar logros: por
   * código en vez de id, para no tener que hardcodear ids que Postgres
   * asigna solo al insertar (ver MIGRACION.sql). La lista de logros se
   * cachea en memoria (dura para toda la sesión) porque es chica y no
   * cambia mientras el usuario tiene la app abierta — evita una consulta
   * repetida cada vez que se completa una lección o sube la racha.
   *
   * Si el código no existe todavía (por ejemplo, el equipo no ha corrido
   * el seed de logros en Supabase), no hace nada — nunca revienta el flujo
   * principal (guardar progreso/racha) por un logro que falte. */
  async otorgarLogroPorCodigo(userId: string, codigo: string) {
    if (!this.logrosCache) {
      this.logrosCache = await this.getLogros();
    }
    const logro = this.logrosCache.find(l => l.codigo === codigo);
    if (!logro) return;
    await this.otorgarLogro(userId, logro.id);
  }
}