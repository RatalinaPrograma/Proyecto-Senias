// Estos tipos son un espejo 1:1 de las columnas reales en Supabase.
// Si el equipo agrega/renombra una columna en la base de datos, hay que
// reflejar el mismo cambio acá.

export interface Nivel {
  id: number;
  numero_nivel: number;
  nombre: string;
  descripcion: string | null;
  dificultad: string | null;
  etiqueta: string | null;
  color: string | null;
  color_oscuro: string | null;
  icono: string | null;
  created_at: string | null;
}

export interface Subnivel {
  id: number;
  nivel_id: number;
  numero_subnivel: number;
  nombre: string;
  tipo: string | null;
  pagina_quiz_local: string | null;
  descripcion: string | null;
  created_at: string | null;
}

export interface Sena {
  id: number;
  subnivel_id: number;
  palabra: string;
  descripcion: string | null;
  video_url: string | null;
  /** Emoji que representa el CONCEPTO/objeto de la palabra (ej. 🐱 para
   * "gato"), no la seña en sí — ayuda a asociar la palabra escrita con su
   * significado a personas cuya primera lengua es LSCh y no el español.
   * Nunca reemplaza al video real de la seña. */
  icono: string | null;
  landmarks_referencia: unknown | null;
  created_at: string | null;
}

export interface ProgresoNivelUsuario {
  user_id: string;
  nivel_id: number;
  acceso: boolean | null;
  completado: boolean | null;
  updated_at: string | null;
}

export interface ProgresoSubnivelUsuario {
  user_id: string;
  subnivel_id: number;
  completado: boolean | null;
  puntaje: number | null;
  fecha_completado: string | null;
  updated_at: string | null;
}

export interface UserStats {
  user_id: string;
  racha_actual: number | null;
  max_racha: number | null;
  ultima_fecha_practica: string | null;
  puntos_experiencia: number | null;
  vidas: number | null;
  ultima_vida_perdida: string | null;
  racha_congeladores: number | null;
  racha_evaluada_hasta: string | null;
  updated_at: string | null;
  /** Transiente: NO es una columna de la tabla, nunca se manda a Supabase.
   * `ContenidoService.evaluarRachaSiCorresponde` lo agrega en memoria solo
   * durante el llamado en que detecta que un congelador cubrió un día
   * saltado, o que la racha se cortó por falta de congeladores, para que
   * quien llame a `getMisStats` (Home) pueda avisarle al usuario con una
   * notificación. En cualquier otro llamado viene `undefined`. */
  eventoRacha?: EventoRacha | null;
}

export type EstadoDiaRacha = 'practicado' | 'congelado' | 'perdido';

export interface EventoRacha {
  tipo: 'congelado' | 'perdida';
  diasCubiertos: number;
  congeladoresRestantes: number;
}

export interface RachaHistorialDia {
  fecha: string;
  estado: EstadoDiaRacha;
}

export interface PracticaFallo {
  id: number;
  user_id: string;
  sena_id: number;
  cantidad_fallos: number | null;
  updated_at: string | null;
}

export interface IntentoEjercicio {
  id: number;
  user_id: string;
  sena_id: number;
  correcto: boolean;
  score_similitud: number | null;
  created_at: string | null;
}

export interface Logro {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  icono_url: string | null;
  /** Emoji del logro (mismo criterio que Sena.icono: liviano, sin gastar
   * caché/egress, sin depender de subir una imagen). icono_url queda
   * reservado por si algún día se quiere una ilustración real en vez de
   * un emoji. */
  icono: string | null;
  created_at: string | null;
}

export interface UsuarioLogro {
  user_id: string;
  logro_id: number;
  fecha_obtenido: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  tts_habilitado: boolean | null;
  tts_voz: string | null;
  es_admin: boolean | null;
  created_at: string | null;
}

export interface Follow {
  follower_id: string;
  followed_id: string;
  created_at: string | null;
}

/** Perfil de otra persona ya combinado con si tú la sigues y si te sigue. */
export interface PerfilConRelacion extends Profile {
  loSigo: boolean;
  meSigue: boolean;
  seguidores: number;
  seguidos: number;
}

// ---- Tipos "de vista", combinan datos + progreso para la UI ----
export type EstadoSubnivel = 'completado' | 'actual' | 'bloqueado' | 'proximamente';

export interface SubnivelConEstado extends Subnivel {
  estado: EstadoSubnivel;
}

export interface NivelConEstado extends Nivel {
  accesible: boolean;
  completado: boolean;
  subniveles: SubnivelConEstado[];
}

export interface RankingEntry {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  racha_actual: number;
  puntos_experiencia: number;
  esYo: boolean;
}
