import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';

export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { data } = await supabaseService.getUser();

  if (data?.user) {
    return true;
  }

  router.navigate(['/auth/login']);
  return false;
};

// Evita que alguien ya logueado vuelva a ver login/register
export const guestGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  const { data } = await supabaseService.getUser();

  if (data?.user) {
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

  const { data } = await supabaseService.getUser();
  if (!data?.user) {
    router.navigate(['/auth/login']);
    return false;
  }

  const esAdmin = await supabaseService.esAdmin(data.user.id);
  if (!esAdmin) {
    router.navigate(['/home']);
    return false;
  }

  return true;
};
