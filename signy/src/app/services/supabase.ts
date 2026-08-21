import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabase.url, environment.supabase.key);
  }

  signUp(email: string, password: string, fullName: string) {
    return this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });
  }

  signIn(email: string, password: string) {
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  signOut() {
    return this.supabase.auth.signOut();
  }

  getUser() {
    return this.supabase.auth.getUser();
  }

  getMyStats() {
    return this.supabase.from('user_stats').select('*');
  }


  //NIVELES---------------------------------------------------------


  async getCurrentUser() {
    const { data: { user }, error } = await this.supabase.auth.getUser();
    if (error) throw error;
    return user;
  }

  async obtenerUnidadesConProgreso(userId: string) {
    const { data: niveles, error: errNiveles } = await this.supabase
      .from('niveles')
      .select(`
      id,
      numero_nivel,
      nombre,
      descripcion,
      etiqueta,
      color,
      color_oscuro,
      icono,
      subniveles (
        id,
        numero_subnivel,
        nombre,
        tipo,
        descripcion
      )
    `)
      .order('numero_nivel', { ascending: true })
      .order('numero_subnivel', { referencedTable: 'subniveles', ascending: true });

    if (errNiveles) throw errNiveles;

    const { data: progresoNivel, error: errPN } = await this.supabase
      .from('progreso_nivel_usuario')
      .select('nivel_id, acceso, completado')
      .eq('user_id', userId);

    if (errPN) throw errPN;

    const { data: progresoSubnivel, error: errPS } = await this.supabase
      .from('progreso_subnivel_usuario')
      .select('subnivel_id, completado')
      .eq('user_id', userId);

    if (errPS) throw errPS;

    return { niveles, progresoNivel, progresoSubnivel };
  }

  async obtenerStats(userId: string) {
    const { data, error } = await this.supabase
      .from('user_stats')
      .select('racha_actual, max_racha, puntos_experiencia, vidas')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return data; // puede ser null si usuario no tener fila todavía
  }

  //PRACTICA---------------------------------------------------------
  async obtenerSenasDeSubnivel(subnivelId: number) {
    const { data, error } = await this.supabase
      .from('senas')
      .select('id, palabra, descripcion, video_url')
      .eq('subnivel_id', subnivelId)
      .order('id', { ascending: true });

    if (error) throw error;
    return data;
  }

  async obtenerDistractores(excluirIds: number[], cantidad: number) {
    const { data, error } = await this.supabase
      .from('senas')
      .select('id, palabra')
      .not('id', 'in', `(${excluirIds.join(',')})`)
      .limit(50);

    if (error) throw error;

    // mezclar y tomar la cantidad pedida
    const mezclado = [...data].sort(() => Math.random() - 0.5);
    return mezclado.slice(0, cantidad);
  }

  async registrarIntento(userId: string, senaId: number, correcto: boolean) {
    const { error } = await this.supabase
      .from('intentos_ejercicio')
      .insert({
        user_id: userId,
        sena_id: senaId,
        correcto,
        score_similitud: correcto ? 1.0 : 0.0,
      });

    if (error) throw error;
  }

  async registrarFallo(userId: string, senaId: number) {
    const { data: existente, error: errBuscar } = await this.supabase
      .from('practica_fallos')
      .select('id, cantidad_fallos')
      .eq('user_id', userId)
      .eq('sena_id', senaId)
      .maybeSingle();

    if (errBuscar) throw errBuscar;

    if (existente) {
      const { error: errUpdate } = await this.supabase
        .from('practica_fallos')
        .update({ cantidad_fallos: existente.cantidad_fallos + 1, updated_at: new Date().toISOString() })
        .eq('id', existente.id);
      if (errUpdate) throw errUpdate;
    } else {
      const { error: errInsert } = await this.supabase
        .from('practica_fallos')
        .insert({ user_id: userId, sena_id: senaId, cantidad_fallos: 1 });
      if (errInsert) throw errInsert;
    }
  }

  async marcarSubnivelCompletado(userId: string, subnivelId: number, puntaje: number) {
    const { data: existente, error: errBuscar } = await this.supabase
      .from('progreso_subnivel_usuario')
      .select('user_id, subnivel_id')
      .eq('user_id', userId)
      .eq('subnivel_id', subnivelId)
      .maybeSingle();

    if (errBuscar) throw errBuscar;

    if (existente) {
      const { error: errUpdate } = await this.supabase
        .from('progreso_subnivel_usuario')
        .update({ completado: true, puntaje, fecha_completado: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('subnivel_id', subnivelId);
      if (errUpdate) throw errUpdate;
    } else {
      const { error: errInsert } = await this.supabase
        .from('progreso_subnivel_usuario')
        .insert({ user_id: userId, subnivel_id: subnivelId, completado: true, puntaje, fecha_completado: new Date().toISOString() });
      if (errInsert) throw errInsert;
    }
  }

}