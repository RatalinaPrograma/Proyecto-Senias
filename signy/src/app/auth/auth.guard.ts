import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';
import { ContenidoService } from '../services/contenido';

export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { user } = await supabaseService.getUsuarioLocal();

  if (user) {
    return true;
  }

  router.navigate(['/auth/login']);
  return false;
};

// Evita que alguien ya logueado vuelva a ver login/register
export const guestGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { user } = await supabaseService.getUsuarioLocal();

  if (user) {
    router.navigate(['/home']);
    return false;
  }

  return true;
};

// Solo deja pasar a profiles.es_admin === true. La protección real vive
// en el RLS de Supabase (este guard es solo para no mostrar la pantalla
// a quien no debería verla, no es la única línea de defensa).
export const adminGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { user } = await supabaseService.getUsuarioLocal();
  if (!user) {
    router.navigate(['/auth/login']);
    return false;
  }

  const esAdmin = await supabaseService.esAdmin(user.id);
  if (!esAdmin) {
    router.navigate(['/home']);
    return false;
  }

  return true;
};

// Antes solo el botón del Home evitaba entrar a un subnivel bloqueado o
// sin contenido -- pero la ruta en sí quedaba abierta si alguien
// navegaba directo por URL (ej. /lesson/5). Reutiliza el mismo cálculo
// de estado que pinta el camino en Home, para que el guard nunca quede
// desincronizado de lo que el usuario ve en pantalla.
export const lessonGuard: CanActivateFn = async (route) => {
  const supabaseService = inject(SupabaseService);
  const contenidoService = inject(ContenidoService);
  const router = inject(Router);

  const { user } = await supabaseService.getUsuarioLocal();
  if (!user) {
    router.navigate(['/auth/login']);
    return false;
  }

  const subnivelId = Number(route.paramMap.get('subnivelId'));

  let mapa: Awaited<ReturnType<typeof contenidoService.obtenerMapaDeAprendizaje>>;
  try {
    mapa = await contenidoService.obtenerMapaDeAprendizaje(user.id);
  } catch (e) {
    // Sin conexión: en vez de bloquear en silencio (que se ve como un
    // botón que "no hace nada"), se usa el último mapa que Home ya cargó
    // con éxito en esta sesión, si lo hay.
    console.warn('lessonGuard: no se pudo verificar por red, se usa el último mapa conocido:', e);
    const respaldo = contenidoService.obtenerMapaDeAprendizajeEnMemoria(user.id);
    if (!respaldo) {
      router.navigate(['/home']);
      return false;
    }
    mapa = respaldo;
  }

  const todosLosSubniveles = mapa.reduce<typeof mapa[number]['subniveles']>((acc, n) => acc.concat(n.subniveles), []);
  const subnivel = todosLosSubniveles.find(s => s.id === subnivelId);

  if (subnivel && (subnivel.estado === 'actual' || subnivel.estado === 'completado')) {
    return true;
  }

  router.navigate(['/home']);
  return false;
};
