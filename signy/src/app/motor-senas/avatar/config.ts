/**
 * Configuración del avatar 3D de señas (sin dependencia de three.js, para que
 * cualquier pantalla pueda importarla sin cargar el motor 3D).
 */

export type TemaAvatar = 'zorro' | 'persona' | 'cyber' | 'huesos';

export interface ConfiguracionAvatar {
  tema: TemaAvatar;
  /** Tamaño de las manos respecto del cuerpo (0.8 a 1.4). */
  tamanoManos: number;
  /** Suavizado del movimiento (0 = directo, 0.65 = muy suave). Filtro One Euro: casi no agrega retraso en movimientos rápidos. */
  suavizado: number;
  /** Ojos, boca y rubor. Sin rostro queda un personaje neutro. */
  mostrarRostro: boolean;
  /** Pañuelo, capucha, etc. */
  mostrarAccesorios: boolean;
  /** Resplandor suave detrás del personaje. */
  mostrarAura: boolean;
  /** Dibuja encima los huesos del rig (hombro, codo, muñeca y dedos). */
  mostrarEsqueletoGuia: boolean;
  /** 'alta': pelaje por capas y sombras. 'media': sin ellos (para celulares lentos). */
  calidad: 'alta' | 'media';
}

export const CONFIG_AVATAR_PREDETERMINADA: ConfiguracionAvatar = {
  tema: 'zorro',
  tamanoManos: 1,
  suavizado: 0.35,
  mostrarRostro: true,
  mostrarAccesorios: true,
  mostrarAura: true,
  mostrarEsqueletoGuia: false,
  calidad: 'alta',
};

export interface InfoTemaAvatar {
  tema: TemaAvatar;
  nombre: string;
  descripcion: string;
  /** Color representativo (para el selector). */
  color: string;
}

export const TEMAS_AVATAR: InfoTemaAvatar[] = [
  { tema: 'zorro', nombre: 'Zorrito Signy', descripcion: 'Mascota 3D de peluche', color: '#F5791F' },
  { tema: 'persona', nombre: 'Persona', descripcion: 'Humano amigable con polerón', color: '#2CA6A4' },
  { tema: 'cyber', nombre: 'Alto contraste', descripcion: 'Ropa oscura, manos muy visibles', color: '#1F345A' },
  { tema: 'huesos', nombre: 'Maniquí + rig', descripcion: 'Cuerpo translúcido y huesos', color: '#00F0FF' },
];
