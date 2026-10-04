import { Component, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { BotonAtrasService } from './services/boton-atras';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: 'app.component.html',
  imports: [IonicModule],
})
export class AppComponent {
  constructor() {
    // Botón atrás de Android: vuelve a la pantalla anterior en vez de cerrar la app.
    inject(BotonAtrasService).iniciar();
  }
}
