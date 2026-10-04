import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { BotonAtrasService } from './services/boton-atras';

describe('AppComponent', () => {
  it('should create the app', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('activa el manejo del botón atrás de Android al arrancar', async () => {
    const botonAtras = jasmine.createSpyObj<BotonAtrasService>('BotonAtrasService', ['iniciar']);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), { provide: BotonAtrasService, useValue: botonAtras }]
    }).compileComponents();

    TestBed.createComponent(AppComponent);
    expect(botonAtras.iniciar).toHaveBeenCalledTimes(1);
  });
});
