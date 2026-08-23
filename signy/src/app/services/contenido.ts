import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase';
import {
  Nivel, Subnivel, Sena, ProgresoNivelUsuario, ProgresoSubnivelUsuario,
  UserStats, PracticaFallo, Logro, NivelConEstado
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

  async getPoolDePalabras(limite = 200): Promise<string[]> {
    const { data, error } = await this.db.from('senas').select('palabra').limit(limite);
    if (error) throw error;
    return (data ?? []).map(r => r.palabra);
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
    const [niveles, progresoNiveles, progresoSubniveles] = await Promise.all([
      this.getNiveles(),
      this.getMisProgresosNivel(userId),
      this.getMisProgresosSubnivel(userId),
    ]);

    const progresoNivelPorId = new Map(progresoNiveles.map(p => [p.nivel_id, p]));
    const progresoSubnivelPorId = new Map(progresoSubniveles.map(p => [p.subnivel_id, p]));

    const resultado: NivelConEstado[] = [];

    for (let i = 0; i < niveles.length; i++) {
      const nivel = niveles[i];
      const progNivel = progresoNivelPorId.get(nivel.id);

      // El primer nivel (numero_nivel más bajo) es accesible por defecto
      // aunque todavía no exista una fila de progreso para el usuario.
      const accesible = progNivel?.acceso === true || (i === 0 && !progNivel);
      const completadoNivel = progNivel?.completado === true;

      const subniveles = await this.getSubniveles(nivel.id);
      let yaHayActual = false;

      const subnivelesConEstado = subniveles.map((sub) => {
        const progSub = progresoSubnivelPorId.get(sub.id);
        const completado = progSub?.completado === true;

        let estado: 'completado' | 'actual' | 'bloqueado';
        if (!accesible) {
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

  async getMisStats(userId: string): Promise<UserStats> {
    const { data, error } = await this.db.from('user_stats').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (data) return this.regenerarVidasSiCorresponde(userId, data);

    // Primera vez del usuario: se crea su fila de estadísticas iniciales
    const inicial: UserStats = {
      user_id: userId,
      racha_actual: 0,
      max_racha: 0,
      ultima_fecha_practica: null,
      puntos_experiencia: 0,
      vidas: 5,
      ultima_vida_perdida: null,
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

  /** Actualiza racha y XP al terminar una lección. Regla simple: si ya
   * practicaste hoy, la racha no cambia; si practicaste ayer, sube +1; si
   * no, se reinicia en 1. */
  async actualizarStatsTrasLeccion(userId: string, xpGanado: number): Promise<UserStats> {
    const stats = await this.getMisStats(userId);
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    let nuevaRacha = stats.racha_actual ?? 0;
    if (stats.ultima_fecha_practica === hoy) {
      // ya practicó hoy, no cambia
    } else if (stats.ultima_fecha_practica === ayer) {
      nuevaRacha += 1;
    } else {
      nuevaRacha = 1;
    }

    const actualizado: Partial<UserStats> = {
      racha_actual: nuevaRacha,
      max_racha: Math.max(stats.max_racha ?? 0, nuevaRacha),
      puntos_experiencia: (stats.puntos_experiencia ?? 0) + xpGanado,
      ultima_fecha_practica: hoy,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.db.from('user_stats').update(actualizado).eq('user_id', userId);
    if (error) throw error;
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
  async getMisFallos(userId: string, limite = 5): Promise<{ palabra: string; cantidad_fallos: number }[]> {
    const { data, error } = await this.db
      .from('practica_fallos')
      .select('cantidad_fallos, senas ( palabra )')
      .eq('user_id', userId)
      .order('cantidad_fallos', { ascending: false })
      .limit(limite);
    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      palabra: row.senas?.palabra ?? '—',
      cantidad_fallos: row.cantidad_fallos ?? 0,
    }));
  }

  // ---------- Logros ----------
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
}
