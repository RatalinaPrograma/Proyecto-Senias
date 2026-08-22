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
  updated_at: string | null;
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
export type EstadoSubnivel = 'completado' | 'actual' | 'bloqueado';

export interface SubnivelConEstado extends Subnivel {
  estado: EstadoSubnivel;
}

export interface NivelConEstado extends Nivel {
  accesible: boolean;
  completado: boolean;
  subniveles: SubnivelConEstado[];
}
