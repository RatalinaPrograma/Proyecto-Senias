import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { TtsService } from '../services/tts';
import { ContenidoService } from '../services/contenido';
import { NotificationsService, NotifConfig } from '../services/notifications';
import { PermissionState } from '@capacitor/core';
import { SpeechSynthesisVoice } from '@capacitor-community/text-to-speech';
import { passwordStrengthValidator, passwordsMatchValidator } from '../shared/validators';
import { Profile } from '../data/db-types';
import { addIcons } from 'ionicons';
import { arrowBack, paw, cameraOutline, shieldCheckmark, trashOutline, volumeHigh, notificationsOutline } from 'ionicons/icons';

addIcons({
  'arrow-back': arrowBack,
  paw,
  'camera-outline': cameraOutline,
  'shield-checkmark': shieldCheckmark,
  'trash-outline': trashOutline,
  'volume-high': volumeHigh,
  'notifications-outline': notificationsOutline,
});

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IonicModule],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class SettingsPage implements OnInit {
  cargando = true;
  userId = '';
  email = '';

  // ---- editar perfil ----
  perfil: Profile | null = null;
  avatarUrlActual: string | null = null;
  subiendoAvatar = false;

  formPerfil = this.fb.group({
    full_name: ['', [Validators.required, Validators.minLength(2)]],
    username: ['', [Validators.pattern(/^[a-z0-9_.]{3,20}$/)]],
  });
  guardandoPerfil = false;
  errorPerfil = '';
  exitoPerfil = false;

  // ---- cambiar contraseña ----
  formPassword = this.fb.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(8), passwordStrengthValidator()]],
    confirmPassword: ['', [Validators.required]],
  }, {
    validators: passwordsMatchValidator('newPassword', 'confirmPassword'),
  });
  cambiandoPassword = false;
  errorPassword = '';
  exitoPassword = false;

  // ---- accesibilidad ----
  ttsDisponible = true;
  ttsHabilitado = true;
  guardandoTts = false;
  voces: SpeechSynthesisVoice[] = [];
  vozSeleccionada: string | null = null;
  guardandoVoz = false;

  // ---- notificaciones ----
  notifDisponible = true;
  notifPermiso: PermissionState = 'prompt';
  recordatorioActivado = true;
  horaRecordatorio = '19:00';
  avisoVidasActivado = true;
  guardandoNotif = false;
  horasDisponibles = Array.from({ length: 16 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`);

  // ---- 2FA ----
  mfaActivado = false;
  private factorIdActivo: string | null = null;

  inscribiendoMfa = false;
  qrCode: string | null = null;
  secretoManual: string | null = null;
  private factorIdPendiente: string | null = null;
  codigoMfa = '';
  cargandoMfa = false;
  errorMfa = '';

  // ---- eliminar cuenta ----
  confirmandoEliminar = false;
  textoConfirmacion = '';
  eliminandoCuenta = false;
  errorEliminar = '';

  constructor(
    private fb: FormBuilder,
    private supabaseService: SupabaseService,
    private ttsService: TtsService,
    private contenidoService: ContenidoService,
    private notificationsService: NotificationsService,
    private router: Router
  ) {}

  async ngOnInit() {
    const { user } = await this.supabaseService.getUsuarioLocal();
    if (!user) { this.router.navigate(['/auth/login']); return; }
    this.userId = user.id;
    this.email = user.email ?? '';

    const nombreFallback = user.user_metadata?.['full_name'] ?? 'Usuario Signy';
    this.perfil = await this.supabaseService.getOCrearProfile(this.userId, nombreFallback);
    this.avatarUrlActual = this.perfil.avatar_url;

    this.formPerfil.patchValue({
      full_name: this.perfil.full_name ?? '',
      username: this.perfil.username ?? '',
    });

    this.ttsDisponible = this.ttsService.disponible();
    this.ttsHabilitado = await this.ttsService.estaHabilitado(this.userId);
    if (this.ttsDisponible) {
      this.voces = await this.ttsService.listarVoces();
      this.vozSeleccionada = await this.ttsService.obtenerVozPreferida(this.userId);
    }

    const { data: factores } = await this.supabaseService.mfaListFactors();
    const verificado = factores?.totp?.find(f => f.status === 'verified');
    this.mfaActivado = !!verificado;
    this.factorIdActivo = verificado?.id ?? null;

    this.notifDisponible = this.notificationsService.disponible();
    if (this.notifDisponible) {
      const config = await this.notificationsService.obtenerConfiguracion();
      this.recordatorioActivado = config.recordatorioActivado;
      this.horaRecordatorio = config.horaRecordatorio;
      this.avisoVidasActivado = config.avisoVidasActivado;
      this.notifPermiso = await this.notificationsService.verificarPermiso();
    }

    this.cargando = false;
  }

  // ========== PERFIL ==========
  async subirAvatar(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.subiendoAvatar = true;
    this.errorPerfil = '';
    const { data, error } = await this.supabaseService.uploadAvatar(this.userId, file);
    this.subiendoAvatar = false;

    if (error || !data) {
      this.errorPerfil = 'No se pudo subir la foto. Intenta con otra imagen.';
      return;
    }

    this.avatarUrlActual = data;
    await this.supabaseService.upsertProfile({ id: this.userId, avatar_url: data });
  }

  async guardarPerfil() {
    this.errorPerfil = '';
    this.exitoPerfil = false;

    if (this.formPerfil.invalid) {
      this.formPerfil.markAllAsTouched();
      if (this.formPerfil.get('username')?.errors?.['pattern']) {
        this.errorPerfil = 'El usuario solo puede tener minúsculas, números, "." o "_" (3 a 20 caracteres)';
      }
      return;
    }

    const { full_name, username } = this.formPerfil.value;

    if (username) {
      const disponible = await this.supabaseService.usernameDisponible(username, this.userId);
      if (!disponible) {
        this.errorPerfil = 'Ese nombre de usuario ya está en uso';
        return;
      }
    }

    this.guardandoPerfil = true;
    const { error } = await this.supabaseService.upsertProfile({
      id: this.userId,
      full_name: full_name || undefined,
      username: username || undefined,
    });
    this.guardandoPerfil = false;

    if (error) {
      this.errorPerfil = error.message;
      return;
    }

    this.exitoPerfil = true;
    setTimeout(() => (this.exitoPerfil = false), 2500);
  }

  // ========== ACCESIBILIDAD (TEXTO A VOZ) ==========
  async cambiarTts(evento: any) {
    const valor: boolean = evento.detail.checked;
    this.ttsHabilitado = valor; // optimista, se revierte si falla el guardado
    this.guardandoTts = true;
    const { error } = await this.ttsService.establecerHabilitado(this.userId, valor);
    this.guardandoTts = false;

    if (error) {
      this.ttsHabilitado = !valor; // revertir
    }
  }

  probarTts() {
    this.ttsService.hablar('Así sonará el texto a voz en Signy', this.vozSeleccionada);
  }

  async cambiarVoz(evento: any) {
    const nombreVoz: string | null = evento.detail.value || null;
    const anterior = this.vozSeleccionada;
    this.vozSeleccionada = nombreVoz; // optimista
    this.guardandoVoz = true;
    const { error } = await this.ttsService.establecerVoz(this.userId, nombreVoz);
    this.guardandoVoz = false;

    if (error) {
      this.vozSeleccionada = anterior; // revertir
    }
  }

  // ========== NOTIFICACIONES ==========
  get notifPermisoDenegado(): boolean {
    return this.notifPermiso === 'denied';
  }

  labelHora(hora: string): string {
    const h = Number(hora.split(':')[0]);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:00 ${ampm}`;
  }

  async cambiarRecordatorio(evento: any) {
    const valor: boolean = evento.detail.checked;
    this.recordatorioActivado = valor; // optimista
    await this.guardarConfigNotif({ recordatorioActivado: valor });
  }

  async cambiarHoraRecordatorio(evento: any) {
    const valor: string = evento.detail.value;
    const anterior = this.horaRecordatorio;
    this.horaRecordatorio = valor; // optimista
    const ok = await this.guardarConfigNotif({ horaRecordatorio: valor });
    if (!ok) this.horaRecordatorio = anterior;
  }

  async cambiarAvisoVidas(evento: any) {
    const valor: boolean = evento.detail.checked;
    this.avisoVidasActivado = valor; // optimista
    await this.guardarConfigNotif({ avisoVidasActivado: valor });
  }

  /** Guarda la config y reprograma de inmediato (no espera a que el usuario
   * vuelva a Home). Devuelve false si algo falló, para poder revertir el
   * cambio optimista en la UI. */
  private async guardarConfigNotif(cambios: Partial<NotifConfig>): Promise<boolean> {
    this.guardandoNotif = true;
    try {
      await this.notificationsService.guardarConfiguracion(cambios);
      const stats = await this.contenidoService.getMisStats(this.userId);
      await this.notificationsService.sincronizar(
        stats.vidas ?? 0,
        this.contenidoService.minutosParaProximaVida(stats),
        stats.racha_actual ?? 0
      );
      this.notifPermiso = await this.notificationsService.verificarPermiso();
      return true;
    } catch {
      return false;
    } finally {
      this.guardandoNotif = false;
    }
  }

  async probarNotificacion() {
    let permiso = await this.notificationsService.verificarPermiso();
    if (permiso === 'prompt' || permiso === 'prompt-with-rationale') {
      permiso = await this.notificationsService.pedirPermiso();
    }
    this.notifPermiso = permiso;
    if (permiso !== 'granted') return;
    const stats = await this.contenidoService.getMisStats(this.userId);
    await this.notificationsService.notificacionDePrueba(stats.racha_actual ?? 0);
  }

  // ========== CONTRASEÑA ==========
  async cambiarPassword() {
    this.errorPassword = '';
    this.exitoPassword = false;

    if (this.formPassword.invalid) {
      this.formPassword.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword } = this.formPassword.value;

    this.cambiandoPassword = true;
    const { error } = await this.supabaseService.changePassword(this.email, currentPassword!, newPassword!);
    this.cambiandoPassword = false;

    if (error) {
      this.errorPassword = error.message;
      return;
    }

    this.exitoPassword = true;
    this.formPassword.reset();
    setTimeout(() => (this.exitoPassword = false), 2500);
  }

  // ========== 2FA ==========
  async iniciarActivacionMfa() {
    this.errorMfa = '';
    this.cargandoMfa = true;
    const { data, error } = await this.supabaseService.mfaEnroll();
    this.cargandoMfa = false;

    if (error || !data) {
      this.errorMfa = error?.message ?? 'No se pudo iniciar la activación. ¿Está habilitado MFA en el proyecto?';
      return;
    }

    this.factorIdPendiente = data.id;
    this.qrCode = data.totp.qr_code;
    this.secretoManual = data.totp.secret;
    this.inscribiendoMfa = true;
  }

  async confirmarActivacionMfa() {
    if (!this.factorIdPendiente || this.codigoMfa.length !== 6) return;

    this.errorMfa = '';
    this.cargandoMfa = true;
    const { error } = await this.supabaseService.mfaVerifyEnrollment(this.factorIdPendiente, this.codigoMfa);
    this.cargandoMfa = false;

    if (error) {
      this.errorMfa = 'Código incorrecto. Revisa la hora de tu teléfono y vuelve a intentar.';
      return;
    }

    this.mfaActivado = true;
    this.factorIdActivo = this.factorIdPendiente;
    this.cancelarActivacionMfa();
  }

  cancelarActivacionMfa() {
    this.inscribiendoMfa = false;
    this.qrCode = null;
    this.secretoManual = null;
    this.factorIdPendiente = null;
    this.codigoMfa = '';
    this.errorMfa = '';
  }

  async desactivarMfa() {
    if (!this.factorIdActivo) return;
    this.cargandoMfa = true;
    const { error } = await this.supabaseService.mfaUnenroll(this.factorIdActivo);
    this.cargandoMfa = false;

    if (error) {
      this.errorMfa = error.message;
      return;
    }

    this.mfaActivado = false;
    this.factorIdActivo = null;
  }

  // ========== ELIMINAR CUENTA ==========
  get confirmacionValida(): boolean {
    return this.textoConfirmacion.trim().toUpperCase() === 'ELIMINAR';
  }

  async eliminarCuenta() {
    if (!this.confirmacionValida) return;

    this.errorEliminar = '';
    this.eliminandoCuenta = true;
    const { error } = await this.supabaseService.deleteAccount();
    this.eliminandoCuenta = false;

    if (error) {
      this.errorEliminar = error.message ?? 'No se pudo eliminar la cuenta. Intenta de nuevo.';
      return;
    }

    await this.notificationsService.cancelarTodo();
    await this.supabaseService.signOut();
    this.router.navigate(['/onboarding']);
  }

  volver() {
    this.router.navigate(['/profile']);
  }
}
