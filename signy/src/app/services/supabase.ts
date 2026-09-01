import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Profile, Nivel, Subnivel, Sena } from '../data/db-types';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabase.url, environment.supabase.key);
  }

  // ---------- Auth básico ----------
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

  getSession() {
    return this.supabase.auth.getSession();
  }

  /**
   * Devuelve el usuario de la sesión guardada en el dispositivo, SIN pegarle
   * a la red (a diferencia de `getUser()`, que siempre revalida contra el
   * servidor de Supabase y por eso falla apenas no hay conexión). Se usa
   * para los chequeos de "¿hay alguien logueado?" que gatillan
   * redirecciones (guards, carga de páginas) — la protección real de los
   * datos la sigue dando el RLS en el servidor, esto es solo para decidir
   * qué pantalla mostrar, así que no necesita ida y vuelta a la red.
   */
  async getUsuarioLocal() {
    const { data, error } = await this.supabase.auth.getSession();
    return { user: data?.session?.user ?? null, error };
  }

  // ---------- Perfil (tabla real: id, full_name, username, avatar_url, created_at) ----------
  async getProfile(userId: string): Promise<{ data: Profile | null; error: any }> {
    return this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  }

  async upsertProfile(profile: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null; tts_habilitado?: boolean | null; tts_voz?: string | null }) {
    return this.supabase.from('profiles').upsert(profile);
  }

  /** true si el username ya está tomado por OTRO usuario. */
  async usernameDisponible(username: string, miUserId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .neq('id', miUserId)
      .maybeSingle();
    if (error) throw error;
    return !data;
  }

  async uploadAvatar(userId: string, file: File) {
    const ext = file.name.split('.').pop();
    const path = `${userId}/avatar.${ext}`;
    const { error: uploadError } = await this.supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) return { data: null, error: uploadError };

    const { data } = this.supabase.storage.from('avatars').getPublicUrl(path);
    return { data: data.publicUrl, error: null };
  }

  // ---------- Cambiar contraseña (re-autenticando primero) ----------
  async changePassword(email: string, currentPassword: string, newPassword: string) {
    const { error: reauthError } = await this.supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (reauthError) {
      return { error: { message: 'Tu contraseña actual no es correcta' } };
    }
    return this.supabase.auth.updateUser({ password: newPassword });
  }

  // ---------- Recuperar contraseña con código por correo (EmailJS) ----------
  // El código se genera, guarda y verifica en la Edge Function
  // supabase/functions/password-reset, que también envía el correo vía la
  // API de EmailJS y cambia la contraseña con la service role key.
  async requestPasswordResetCode(email: string) {
    const { error } = await this.supabase.functions.invoke('password-reset', {
      body: { action: 'request', email },
    });
    return { error: await this.mensajeErrorFuncion(error) };
  }

  async confirmPasswordResetCode(email: string, code: string, newPassword: string) {
    const { error } = await this.supabase.functions.invoke('password-reset', {
      body: { action: 'confirm', email, code, newPassword },
    });
    return { error: await this.mensajeErrorFuncion(error) };
  }

  /** Las Edge Functions devuelven { error: "mensaje" } en el body cuando fallan;
   * invoke() solo da un mensaje genérico, así que hay que leer el body real. */
  private async mensajeErrorFuncion(error: any) {
    if (!error) return null;
    const body = await error.context?.json?.().catch(() => null);
    return { message: body?.error ?? error.message };
  }

  // ---------- Autenticación en dos pasos (TOTP) ----------
  mfaListFactors() {
    return this.supabase.auth.mfa.listFactors();
  }

  mfaEnroll() {
    return this.supabase.auth.mfa.enroll({ factorType: 'totp' });
  }

  async mfaVerifyEnrollment(factorId: string, code: string) {
    const { data: challenge, error: challengeError } = await this.supabase.auth.mfa.challenge({ factorId });
    if (challengeError) return { error: challengeError };
    return this.supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  }

  mfaUnenroll(factorId: string) {
    return this.supabase.auth.mfa.unenroll({ factorId });
  }

  async mfaChallengeAndVerifyLogin(factorId: string, code: string) {
    const { data: challenge, error: challengeError } = await this.supabase.auth.mfa.challenge({ factorId });
    if (challengeError) return { error: challengeError };
    return this.supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  }

  getAuthenticatorAssuranceLevel() {
    return this.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  // ---------- Amigos (tabla follows) ----------

  async seguir(followedId: string) {
    const { data: userData } = await this.supabase.auth.getUser();
    const myId = userData.user?.id;
    if (!myId) return { error: { message: 'No hay sesión activa' } };
    return this.supabase.from('follows').insert({ follower_id: myId, followed_id: followedId });
  }

  async dejarDeSeguir(followedId: string) {
    const { data: userData } = await this.supabase.auth.getUser();
    const myId = userData.user?.id;
    if (!myId) return { error: { message: 'No hay sesión activa' } };
    return this.supabase.from('follows').delete().eq('follower_id', myId).eq('followed_id', followedId);
  }

  async loSigo(followedId: string): Promise<boolean> {
    const { data: userData } = await this.supabase.auth.getUser();
    const myId = userData.user?.id;
    if (!myId) return false;
    const { data } = await this.supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', myId)
      .eq('followed_id', followedId)
      .maybeSingle();
    return !!data;
  }

  async contarSeguidores(userId: string): Promise<number> {
    const { count } = await this.supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('followed_id', userId);
    return count ?? 0;
  }

  async contarSeguidos(userId: string): Promise<number> {
    const { count } = await this.supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);
    return count ?? 0;
  }

  /** IDs de las personas que userId sigue. */
  async idsSeguidos(userId: string): Promise<string[]> {
    const { data } = await this.supabase.from('follows').select('followed_id').eq('follower_id', userId);
    return (data ?? []).map((f: any) => f.followed_id);
  }

  /** Perfiles completos de quienes userId sigue. Si alguno no tiene fila
   * en profiles todavía (se registró antes de esta función), se rellena
   * con un perfil mínimo en vez de desaparecer de la lista. */
  async listaSeguidos(userId: string): Promise<Profile[]> {
    const ids = await this.idsSeguidos(userId);
    return this.perfilesParaIds(ids);
  }

  /** Perfiles completos de quienes siguen a userId. */
  async listaSeguidores(userId: string): Promise<Profile[]> {
    const { data } = await this.supabase.from('follows').select('follower_id').eq('followed_id', userId);
    const ids = (data ?? []).map((f: any) => f.follower_id);
    return this.perfilesParaIds(ids);
  }

  private async perfilesParaIds(ids: string[]): Promise<Profile[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase.from('profiles').select('*').in('id', ids);
    if (error) throw error;

    const encontrados = new Map((data ?? []).map(p => [p.id, p as Profile]));
    return ids.map(id => encontrados.get(id) ?? {
      id,
      full_name: 'Usuario Signy',
      username: null,
      avatar_url: null,
      tts_habilitado: true,
      tts_voz: null,
      es_admin: false,
      created_at: null,
    });
  }

  /** Busca personas por nombre o username, excluyéndome a mí mismo. */
  async buscarPersonas(query: string, miUserId: string): Promise<Profile[]> {
    if (!query.trim()) return [];
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .neq('id', miUserId)
      .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
      .limit(20);
    if (error) throw error;
    return data ?? [];
  }

  /** Trae el perfil, y si el usuario no tiene fila todavía (se registró
   * antes de que existiera esta función), la crea con datos mínimos. */
  async getOCrearProfile(userId: string, nombreFallback: string): Promise<Profile> {
    const { data } = await this.getProfile(userId);
    if (data) return data;

    const nuevo: Profile = { id: userId, full_name: nombreFallback, username: null, avatar_url: null, tts_habilitado: true, tts_voz: null, es_admin: false, created_at: null };
    await this.upsertProfile(nuevo);
    return nuevo;
  }

  // ---------- Eliminar cuenta (vía Edge Function, ver supabase/functions/delete-account) ----------
  async deleteAccount() {
    const { data: sessionData } = await this.supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { error: { message: 'No hay sesión activa' } };

    const { error } = await this.supabase.functions.invoke('delete-account', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { error };
  }

  // ==================== ADMINISTRACIÓN DE VOCABULARIO ====================
  // Todo lo de acá abajo requiere que profiles.es_admin sea true para el
  // usuario logueado — eso lo hace cumplir el RLS de la base de datos, no
  // solo el guard de rutas del lado del cliente.

  async esAdmin(userId: string): Promise<boolean> {
    const { data } = await this.getProfile(userId);
    return data?.es_admin ?? false;
  }

  // ---- Niveles ----
  async listarNiveles(): Promise<Nivel[]> {
    const { data, error } = await this.supabase.from('niveles').select('*').order('numero_nivel');
    if (error) throw error;
    return data ?? [];
  }

  async crearNivel(nivel: Omit<Nivel, 'id' | 'created_at'>) {
    return this.supabase.from('niveles').insert(nivel).select().single();
  }

  async actualizarNivel(id: number, cambios: Partial<Omit<Nivel, 'id' | 'created_at'>>) {
    return this.supabase.from('niveles').update(cambios).eq('id', id);
  }

  async eliminarNivel(id: number) {
    return this.supabase.from('niveles').delete().eq('id', id);
  }

  // ---- Subniveles ----
  async listarSubniveles(nivelId?: number): Promise<Subnivel[]> {
    let query = this.supabase.from('subniveles').select('*').order('numero_subnivel');
    if (nivelId != null) query = query.eq('nivel_id', nivelId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async crearSubnivel(subnivel: Omit<Subnivel, 'id' | 'created_at'>) {
    return this.supabase.from('subniveles').insert(subnivel).select().single();
  }

  async actualizarSubnivel(id: number, cambios: Partial<Omit<Subnivel, 'id' | 'created_at'>>) {
    return this.supabase.from('subniveles').update(cambios).eq('id', id);
  }

  async eliminarSubnivel(id: number) {
    return this.supabase.from('subniveles').delete().eq('id', id);
  }

  // ---- Señas ----
  async listarSenas(subnivelId?: number): Promise<Sena[]> {
    let query = this.supabase.from('senas').select('*').order('palabra');
    if (subnivelId != null) query = query.eq('subnivel_id', subnivelId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async crearSena(sena: Omit<Sena, 'id' | 'created_at' | 'landmarks_referencia'>) {
    return this.supabase.from('senas').insert(sena).select().single();
  }

  async actualizarSena(id: number, cambios: Partial<Omit<Sena, 'id' | 'created_at'>>) {
    return this.supabase.from('senas').update(cambios).eq('id', id);
  }

  async eliminarSena(id: number) {
    return this.supabase.from('senas').delete().eq('id', id);
  }

  /**
   * Sube el GIF/foto de una seña al bucket `senas` y devuelve la URL
   * pública. Mismo patrón que `uploadAvatar`. El nombre del archivo
   * incluye timestamp para no pisar versiones anteriores por accidente
   * (a diferencia del avatar, donde sí queremos que se sobrescriba).
   */
  async uploadSenaMedia(file: File) {
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadError } = await this.supabase.storage
      .from('senas-media')
      .upload(path, file);

    if (uploadError) return { data: null, error: uploadError };

    const { data } = this.supabase.storage.from('senas-media').getPublicUrl(path);
    return { data: data.publicUrl, error: null };
  }

  /**
   * Borra un archivo del bucket `senas-media` a partir de su URL pública,
   * pero SOLO si la URL de verdad apunta a ese bucket — si alguien pegó
   * una URL externa a mano (otro sitio, otro bucket), no se toca nada. Se
   * usa para no dejar basura acumulándose cuando se reemplaza o borra una
   * seña. Falla en silencio: es limpieza de fondo, no debe romper el
   * flujo principal de guardar/borrar si algo sale mal acá.
   */
  async eliminarSenaMediaSiEsPropia(url: string) {
    const marcador = '/storage/v1/object/public/senas-media/';
    const indice = url.indexOf(marcador);
    if (indice === -1) return;

    const path = url.slice(indice + marcador.length);
    if (!path) return;

    try {
      await this.supabase.storage.from('senas-media').remove([path]);
    } catch {
      // limpieza de fondo, no crítico
    }
  }
}
