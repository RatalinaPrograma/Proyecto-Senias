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
