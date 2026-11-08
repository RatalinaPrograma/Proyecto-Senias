import { Injectable, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { PreloadingStrategy, Route, RouteReuseStrategy, provideRouter, withPreloading } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { Observable, of } from 'rxjs';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

/**
 * Precarga en segundo plano las pantallas de uso común del estudiante,
 * excluyendo rutas pesadas de administración y laboratorio (`data.preload === false`).
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return route.data?.['preload'] === false ? of(null) : load();
  }
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    importProvidersFrom(IonicModule.forRoot()),
    provideRouter(routes, withPreloading(SelectivePreloadingStrategy)),
  ],
});
