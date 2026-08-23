import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Profile } from '../data/db-types';

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

  // ---------- Perfil (tabla real: id, full_name, username, avatar_url, created_at) ----------
  async getProfile(userId: string): Promise<{ data: Profile | null; error: any }> {
    return this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  }

  async upsertProfile(profile: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null }) {
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

  // ---------- Recuperar contraseña con código por correo ----------
  // Importante: en Supabase Dashboard → Authentication → Email Templates →
  // "Reset Password", el template debe incluir {{ .Token }} (el código de
  // 6 dígitos), no solo {{ .ConfirmationURL }}, para que esto funcione.
  requestPasswordResetCode(email: string) {
    return this.supabase.auth.resetPasswordForEmail(email);
  }

  async confirmPasswordResetCode(email: string, code: string, newPassword: string) {
    const { error: verifyError } = await this.supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'recovery',
    });
    if (verifyError) {
      return { error: verifyError };
    }
    return this.supabase.auth.updateUser({ password: newPassword });
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

    const nuevo: Profile = { id: userId, full_name: nombreFallback, username: null, avatar_url: null, created_at: null };
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
}
