import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'onboarding',
    pathMatch: 'full'
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./onboarding/onboarding.page').then(m => m.OnboardingPage)
  },
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/login/login.page').then(m => m.LoginPage)
  },
  {
    path: 'auth/register',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/register/register.page').then(m => m.RegisterPage)
  },
  {
    path: 'auth/recuperar',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/recuperar/recuperar.page').then(m => m.RecuperarPage)
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.page').then(m => m.HomePage)
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./profile/profile.page').then(m => m.ProfilePage)
  },
  {
    path: 'friends',
    canActivate: [authGuard],
    loadComponent: () => import('./friends/friends.page').then(m => m.FriendsPage)
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./settings/settings.page').then(m => m.SettingsPage)
  },
  {
    path: 'lesson/:subnivelId',
    canActivate: [authGuard],
    loadComponent: () => import('./lesson/lesson.page').then(m => m.LessonPage)
  }
];