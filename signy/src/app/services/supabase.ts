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
}