import { Injectable } from '@angular/core';
import { Capacitor, PermissionState } from '@capacitor/core';
import { EventoRacha } from '../data/db-types';
import { PreferencesAdapter, LocalNotificationsAdapter } from './capacitor-plugins';

export interface NotifConfig {
  recordatorioActivado: boolean;
  /** Formato 'HH:mm', 24 horas. */
  horaRecordatorio: string;
  avisoVidasActivado: boolean;
}

const STORAGE_KEY = 'signy_notif_config';

const CONFIG_POR_DEFECTO: NotifConfig = {
  recordatorioActivado: true,
  horaRecordatorio: '19:00',
  avisoVidasActivado: true,
};

interface MensajeNotif {
  title: string;
  body: string;
}

/** Recordatorio genérico: se usa cuando todavía no hay racha activa que
 * defender (o el usuario ya practicó y está en pausa). */
const MENSAJES_RECORDATORIO: MensajeNotif[] = [
  { title: '¡Signy te está esperando! 🦊', body: 'Tus manos tienen algo que decir hoy. Son solo 5 minutitos.' },
  { title: 'Psst... 🦊', body: 'Todavía no hiciste tu lección de hoy. Signy está mirando la puerta.' },
  { title: 'Una seña al día 🤟', body: 'mantiene tus manos despiertas. Entra un ratito a Signy.' },
  { title: 'La comunidad sorda te espera 💛', body: 'Cada lección te acerca un poco más a comunicarte de verdad.' },
  { title: '¿Ya guardaste el celular por hoy? 📵', body: 'Antes dale 5 minutos a tu lección de LSCh.' },
  { title: 'Tu zorro favorito te extraña 🦊', body: 'Entra a Signy y dale una alegría de vuelta.' },
];

/** Se usa en vez del genérico cuando el usuario tiene una racha activa y
 * todavía no practicó hoy — el tono es más urgente/juguetón a propósito.
 * `{n}` se reemplaza por los días de racha. */
const MENSAJES_RECORDATORIO_RACHA: MensajeNotif[] = [
  { title: '🔥 Racha de {n} días en juego', body: 'No dejes que se apague justo hoy — una lección rapidita y sigue viva.' },
  { title: '{n} días seguidos... 😱', body: '¿Los vas a cortar justo hoy? Todavía estás a tiempo.' },
  { title: 'Tu racha de {n} días te mira fijo 👀🔥', body: 'Una lección y sigue firme.' },
  { title: 'Quedan pocas horas ⏳🔥', body: 'para salvar tus {n} días de racha. Entra a Signy.' },
];

const MENSAJES_VIDAS: MensajeNotif[] = [
  { title: '¡Ya tienes una vida nueva! 💛', body: 'Vuelve a Signy y sigue practicando tus señas.' },
  { title: 'Corazón recargado 💛', body: 'Hora de volver a intentarlo en Signy.' },
  { title: 'Tu próxima vida ya está lista 🦊', body: '¡A darle de nuevo con tu lección!' },
];

/** Primer aviso de la noche (más horas por delante todavía): urgente pero
 * sin ser dramático — hay tiempo de sobra. `{n}` = racha, `{t}` = tiempo
 * restante hasta medianoche ("3 horas", "45 minutos", etc). */
const MENSAJES_RACHA_RIESGO_TEMPRANO: MensajeNotif[] = [
  { title: '🔥 Tu racha de {n} días sigue esperando', body: 'Quedan {t} antes de medianoche. Una lección rapidita y la dejas segura.' },
  { title: 'Ey, {n} días de racha... 👀', body: 'Todavía no has practicado hoy. Te quedan {t} para no perderla.' },
  { title: 'Faltan unas horas ⏳', body: 'para que se acabe el día. Quedan {t} para que tu racha de {n} siga intacta.' },
  { title: 'Tu racha te está esperando 🦊🔥', body: 'Quedan {t}. No hace falta apurarse todavía, pero no lo dejes para el final.' },
];

/** Última alerta antes de medianoche: tono dramático a propósito — es la
 * última oportunidad real del día. */
const MENSAJES_RACHA_RIESGO_URGENTE: MensajeNotif[] = [
  { title: '¿Seguro que quieres perder tu racha? 😨', body: 'Quedan {t} para medianoche y tus {n} días de racha están en juego. Todavía alcanzas una lección.' },
  { title: '🚨 Última llamada para tu racha de {n} días', body: 'En {t} se acaba el día. No dejes que se termine justo ahora.' },
  { title: 'Tu racha está a punto de apagarse 🔥💨', body: 'Faltan {t}. Una lección rapidita y la salvas.' },
  { title: 'Quedan {t}... ⏰', body: '¿de verdad vas a dejar que se corten tus {n} días? Todavía puedes evitarlo.' },
];

/** Un congelador cubrió automáticamente un día que se pasó por alto: la
 * racha sigue viva, pero ya gastó protección — conviene practicar hoy para
 * no depender del último que le queda. `{c}` = congeladores restantes. */
const MENSAJES_CONGELADOR_USADO: MensajeNotif[] = [
  { title: '❄️ Un congelador te salvó ', body: 'Ayer se te pasó, pero un congelador cubrió el día. Aún tienes {c} — activa tu racha hoy para no gastar el que queda.' },
  { title: 'Tu racha de {n} días sigue viva gracias a un congelador ❄️', body: 'Se usó automáticamente para cubrir ayer. Practica hoy para no depender de otro.' },
  { title: '¡Uf, por poco! ❄️🔥', body: 'Un congelador salvó tu racha de {n} días. Aún tienes {c} — actívala hoy para no gastarlos todos.' },
];

/** No alcanzaron los congeladores y la racha volvió a 0: tono empático, sin
 * culpar — invitando a retomar hoy mismo. */
const MENSAJES_RACHA_PERDIDA: MensajeNotif[] = [
  { title: 'Tu racha volvió a 0 😔', body: 'No alcanzaron los congeladores para cubrir los días que pasaron. Hoy es un buen día para empezar una nueva.' },
  { title: 'Se cortó la racha, pero no las ganas 🦊', body: 'A todos nos pasa alguna vez. Arranca hoy de nuevo con una lección.' },
  { title: 'Racha reiniciada', body: 'No pasa nada — lo importante es volver. Haz tu lección de hoy y arranca una nueva racha.' },
];

/**
 * Notificaciones locales de la app (sin servidor / push): recordatorio diario
 * de práctica y aviso cuando se recupera una vida. Usa
 * `@capacitor/local-notifications`, así que en un navegador de escritorio
 * (`ionic serve`) simplemente no hace nada — `disponible()` corta todo antes.
 *
 * Los permisos y la programación real solo se piden/hacen si el usuario tiene
 * al menos un tipo de notificación activado en su configuración; nunca se
 * interrumpe con el diálogo del sistema si no hace falta.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private static readonly ID_RECORDATORIO = 1001;
  private static readonly ID_VIDAS = 1002;
  private static readonly ID_PRUEBA = 1099;
  private static readonly ID_RACHA_RIESGO_TEMPRANO = 1003;
  private static readonly ID_RACHA_RIESGO_URGENTE = 1004;
  private static readonly ID_RACHA_EVENTO = 1005;

  private canalesListos = false;

  constructor(
    private preferences: PreferencesAdapter,
    private localNotifications: LocalNotificationsAdapter
  ) {}

  disponible(): boolean {
    return Capacitor.isNativePlatform();
  }

  // ========== CONFIGURACIÓN (guardada en el dispositivo, no en Supabase) ==========
  async obtenerConfiguracion(): Promise<NotifConfig> {
    if (!this.disponible()) return { ...CONFIG_POR_DEFECTO };
    const { value } = await this.preferences.get({ key: STORAGE_KEY });
    if (!value) return { ...CONFIG_POR_DEFECTO };
    try {
      return { ...CONFIG_POR_DEFECTO, ...JSON.parse(value) };
    } catch {
      return { ...CONFIG_POR_DEFECTO };
    }
  }

  async guardarConfiguracion(cambios: Partial<NotifConfig>): Promise<NotifConfig> {
    const nueva = { ...(await this.obtenerConfiguracion()), ...cambios };
    await this.preferences.set({ key: STORAGE_KEY, value: JSON.stringify(nueva) });
    return nueva;
  }

  // ========== PERMISOS ==========
  async verificarPermiso(): Promise<PermissionState> {
    if (!this.disponible()) return 'denied';
    const { display } = await this.localNotifications.checkPermissions();
    return display;
  }

  async pedirPermiso(): Promise<PermissionState> {
    if (!this.disponible()) return 'denied';
    const { display } = await this.localNotifications.requestPermissions();
    return display;
  }

  private async asegurarCanales() {
    if (this.canalesListos || !this.disponible()) return;
    await Promise.all([
      this.localNotifications.createChannel({
        id: 'recordatorios',
        name: 'Recordatorio diario',
        description: 'Aviso para practicar tu lección del día',
        importance: 3,
        visibility: 1,
        vibration: true,
      }),
      this.localNotifications.createChannel({
        id: 'vidas',
        name: 'Vidas recuperadas',
        description: 'Aviso cuando recuperas una vida para seguir practicando',
        importance: 3,
        visibility: 1,
        vibration: true,
      }),
    ]).catch(() => {});
    this.canalesListos = true;
  }

  /**
   * Punto de entrada principal: revisa la configuración del usuario y deja
   * programadas (o canceladas) las notificaciones que correspondan. Se llama
   * cada vez que se cargan las estadísticas en Home, así que "vidas" y el
   * tono del recordatorio (según haya racha en riesgo o no) siempre quedan
   * al día. Si nunca se pidió permiso y el usuario tiene algo activado, lo
   * pide acá (una sola vez: si lo rechaza, Android no vuelve a preguntar
   * solo porque llamemos requestPermissions() de nuevo).
   *
   * `yaPracticoHoy` es lo que activa o apaga las dos alertas de "vas a
   * perder la racha esta noche" — sin esto no hay forma de saber si hoy ya
   * está a salvo o todavía está en juego.
   */
  async sincronizar(vidasActuales: number, minutosParaProximaVida: number, rachaActual = 0, yaPracticoHoy = false) {
    if (!this.disponible()) return;

    const config = await this.obtenerConfiguracion();
    if (!config.recordatorioActivado && !config.avisoVidasActivado) {
      await this.cancelarTodo();
      return;
    }

    let permiso = await this.verificarPermiso();
    if (permiso === 'prompt' || permiso === 'prompt-with-rationale') {
      permiso = await this.pedirPermiso();
    }
    if (permiso !== 'granted') return;

    await this.asegurarCanales();

    if (config.recordatorioActivado) {
      await this.programarRecordatorioDiario(config.horaRecordatorio, rachaActual);
      await this.programarAvisoRachaEnRiesgo(rachaActual, yaPracticoHoy);
    } else {
      await this.cancelar(NotificationsService.ID_RECORDATORIO);
      await this.cancelar(NotificationsService.ID_RACHA_RIESGO_TEMPRANO);
      await this.cancelar(NotificationsService.ID_RACHA_RIESGO_URGENTE);
    }

    if (config.avisoVidasActivado) {
      await this.programarAvisoVidas(vidasActuales, minutosParaProximaVida);
    } else {
      await this.cancelar(NotificationsService.ID_VIDAS);
    }
  }

  private elegir<T>(lista: T[]): T {
    return lista[Math.floor(Math.random() * lista.length)];
  }

  /** Recordatorio que se repite todos los días a la hora elegida (id fijo:
   * reprogramarlo reemplaza el anterior, no acumula notificaciones). El
   * mensaje se re-elige cada vez que se llama esto (cada vez que se abre
   * Home o se cambia algo en Configuración), así que no siempre es el mismo
   * texto — y si hay racha activa, cambia el tono para no perderla. */
  private async programarRecordatorioDiario(hora: string, rachaActual: number) {
    const [horaNum, minutoNum] = hora.split(':').map(Number);
    const pool = rachaActual > 0 ? MENSAJES_RECORDATORIO_RACHA : MENSAJES_RECORDATORIO;
    const mensaje = this.elegir(pool);

    await this.cancelar(NotificationsService.ID_RECORDATORIO);
    await this.localNotifications.schedule({
      notifications: [
        {
          id: NotificationsService.ID_RECORDATORIO,
          title: mensaje.title.replace('{n}', String(rachaActual)),
          body: mensaje.body.replace('{n}', String(rachaActual)),
          channelId: 'recordatorios',
          schedule: { on: { hour: horaNum, minute: minutoNum }, allowWhileIdle: true },
          isExactNotification: false,
          autoCancel: true,
        },
      ],
    }).catch(() => {});
  }

  /** Aviso de una sola vez para cuando se recupere la próxima vida. Si el
   * usuario ya tiene vidas disponibles no hace falta avisarle nada. */
  private async programarAvisoVidas(vidasActuales: number, minutosParaProximaVida: number) {
    await this.cancelar(NotificationsService.ID_VIDAS);
    if (vidasActuales > 0 || minutosParaProximaVida <= 0) return;

    const mensaje = this.elegir(MENSAJES_VIDAS);
    const cuando = new Date(Date.now() + minutosParaProximaVida * 60000);
    await this.localNotifications.schedule({
      notifications: [
        {
          id: NotificationsService.ID_VIDAS,
          title: mensaje.title,
          body: mensaje.body,
          channelId: 'vidas',
          schedule: { at: cuando, allowWhileIdle: true },
          isExactNotification: false,
          autoCancel: true,
        },
      ],
    }).catch(() => {});
  }

  async cancelarTodo() {
    if (!this.disponible()) return;
    await this.cancelar(NotificationsService.ID_RECORDATORIO);
    await this.cancelar(NotificationsService.ID_VIDAS);
    await this.cancelar(NotificationsService.ID_RACHA_RIESGO_TEMPRANO);
    await this.cancelar(NotificationsService.ID_RACHA_RIESGO_URGENTE);
    await this.cancelar(NotificationsService.ID_RACHA_EVENTO);
  }

  private async cancelar(id: number) {
    await this.localNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
  }

  /** "125" -> "2 horas"; "40" -> "40 minutos". Para insertar en `{t}`. */
  private formatearTiempoRestante(minutos: number): string {
    if (minutos >= 60) {
      const horas = Math.round(minutos / 60);
      return horas <= 1 ? '1 hora' : `${horas} horas`;
    }
    return `${Math.max(1, minutos)} minutos`;
  }

  /**
   * Dos alertas de "vas a perder la racha hoy", de una sola vez (no se
   * repiten como el recordatorio diario): una a las 21:00 (todavía hay
   * tiempo de sobra) y otra a las 23:00 (última oportunidad real). Solo
   * tienen sentido si hoy no se ha practicado y hay una racha activa que
   * perder — si cualquiera de esas condiciones no se cumple, se cancelan.
   *
   * Se reprograman cada vez que se llama sincronizar() (Home, Configuración),
   * así que apenas el usuario practica, la siguiente sincronización las
   * cancela solas sin que quede una alerta "vieja" pendiente.
   *
   * Si el usuario recién abre la app después de las 23:00 y todavía no
   * practicó, la alerta urgente no se pierde en silencio: se dispara casi
   * de inmediato en vez de esperar a una hora que ya pasó.
   */
  private async programarAvisoRachaEnRiesgo(rachaActual: number, yaPracticoHoy: boolean) {
    if (rachaActual <= 0 || yaPracticoHoy) {
      await this.cancelar(NotificationsService.ID_RACHA_RIESGO_TEMPRANO);
      await this.cancelar(NotificationsService.ID_RACHA_RIESGO_URGENTE);
      return;
    }

    const ahora = new Date();
    const medianoche = new Date(ahora);
    medianoche.setHours(24, 0, 0, 0);

    const tiers = [
      { hora: 21, minuto: 0, id: NotificationsService.ID_RACHA_RIESGO_TEMPRANO, pool: MENSAJES_RACHA_RIESGO_TEMPRANO },
      { hora: 23, minuto: 0, id: NotificationsService.ID_RACHA_RIESGO_URGENTE, pool: MENSAJES_RACHA_RIESGO_URGENTE },
    ];

    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const esUltimoTier = i === tiers.length - 1;
      const cuando = new Date(ahora);
      cuando.setHours(tier.hora, tier.minuto, 0, 0);

      if (cuando.getTime() > ahora.getTime()) {
        const minutosEnEseMomento = Math.round((medianoche.getTime() - cuando.getTime()) / 60000);
        await this.programarUnaAlertaRacha(tier.id, tier.pool, rachaActual, minutosEnEseMomento, cuando);
        continue;
      }

      // Esta hora ya pasó hoy: si es la última alerta y todavía queda un
      // margen real antes de medianoche, avisar ahora mismo en vez de dejar
      // pasar la última oportunidad en silencio.
      const minutosRestantes = Math.round((medianoche.getTime() - ahora.getTime()) / 60000);
      if (esUltimoTier && minutosRestantes > 2) {
        await this.programarUnaAlertaRacha(tier.id, tier.pool, rachaActual, minutosRestantes, new Date(Date.now() + 5000));
      } else {
        await this.cancelar(tier.id);
      }
    }
  }

  private async programarUnaAlertaRacha(id: number, pool: MensajeNotif[], rachaActual: number, minutosRestantes: number, cuando: Date) {
    await this.cancelar(id);
    const mensaje = this.elegir(pool);
    const tiempoTexto = this.formatearTiempoRestante(minutosRestantes);
    await this.localNotifications.schedule({
      notifications: [
        {
          id,
          title: mensaje.title.replace('{n}', String(rachaActual)).replace('{t}', tiempoTexto),
          body: mensaje.body.replace('{n}', String(rachaActual)).replace('{t}', tiempoTexto),
          channelId: 'recordatorios',
          schedule: { at: cuando, allowWhileIdle: true },
          isExactNotification: false,
          autoCancel: true,
        },
      ],
    }).catch(() => {});
  }

  /**
   * Aviso inmediato para cuando `ContenidoService` detecta, al evaluar la
   * racha, que un congelador cubrió un día saltado o que la racha se cortó
   * por falta de congeladores. Se dispara una sola vez por evento (la
   * evaluación en sí ya es idempotente por día), así que no hay riesgo de
   * spamear al usuario con el mismo aviso varias veces.
   */
  async avisarEventoRacha(evento: EventoRacha, rachaActual: number) {
    if (!this.disponible()) return;
    const config = await this.obtenerConfiguracion();
    if (!config.recordatorioActivado) return;

    let permiso = await this.verificarPermiso();
    if (permiso === 'prompt' || permiso === 'prompt-with-rationale') {
      permiso = await this.pedirPermiso();
    }
    if (permiso !== 'granted') return;

    await this.asegurarCanales();
    const pool = evento.tipo === 'congelado' ? MENSAJES_CONGELADOR_USADO : MENSAJES_RACHA_PERDIDA;
    const mensaje = this.elegir(pool);
    const congeladoresTexto = evento.congeladoresRestantes === 1 ? '1 congelador' : `${evento.congeladoresRestantes} congeladores`;

    await this.localNotifications.schedule({
      notifications: [
        {
          id: NotificationsService.ID_RACHA_EVENTO,
          title: mensaje.title.replace('{n}', String(rachaActual)),
          body: mensaje.body.replace('{n}', String(rachaActual)).replace('{c}', congeladoresTexto),
          channelId: 'recordatorios',
          schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
          isExactNotification: false,
          autoCancel: true,
        },
      ],
    }).catch(() => {});
  }

  /** Notificación inmediata (5s) para el botón "Probar" en Configuración.
   * Usa el mismo pool que usaría el recordatorio real (según haya racha o
   * no), así el usuario ve exactamente el tipo de aviso que va a recibir. */
  async notificacionDePrueba(rachaActual = 0) {
    if (!this.disponible()) return;
    await this.asegurarCanales();
    const pool = rachaActual > 0 ? MENSAJES_RECORDATORIO_RACHA : MENSAJES_RECORDATORIO;
    const mensaje = this.elegir(pool);
    await this.localNotifications.schedule({
      notifications: [
        {
          id: NotificationsService.ID_PRUEBA,
          title: mensaje.title.replace('{n}', String(rachaActual)),
          body: mensaje.body.replace('{n}', String(rachaActual)),
          channelId: 'recordatorios',
          schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
          isExactNotification: false,
          autoCancel: true,
        },
      ],
    }).catch(() => {});
  }
}
