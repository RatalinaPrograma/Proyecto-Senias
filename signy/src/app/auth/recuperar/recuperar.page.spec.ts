import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RecuperarPage } from './recuperar.page';
import { SupabaseService } from '../../services/supabase';
import { BotonAtrasService } from '../../services/boton-atras';

describe('RecuperarPage', () => {
  let page: RecuperarPage;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['requestPasswordResetCode']);
    supabaseSpy.requestPasswordResetCode.and.resolveTo({ error: null } as any);
    await TestBed.configureTestingModule({
      imports: [RecuperarPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    }).compileComponents();
    page = TestBed.createComponent(RecuperarPage).componentInstance;
  });

  describe('botón atrás del teléfono', () => {
    it('desde el paso del código vuelve al del correo', async () => {
      page.formEmail.setValue({ email: 'ana@correo.cl' });
      await page.enviarCodigo();
      expect(page.paso).toBe('codigo');
      page.formCodigo.patchValue({ codigo: '123' });

      expect(page.alPresionarAtras()).toBeTrue();
      expect(page.paso).toBe('email');
      expect(page.formCodigo.value.codigo).toBeFalsy();
    });

    it('en el paso del correo deja volver al login', () => {
      expect(page.alPresionarAtras()).toBeFalse();
    });

    it('mientras envía, espera', () => {
      page.paso = 'codigo';
      page.cargando = true;
      expect(page.alPresionarAtras()).toBeTrue();
      expect(page.paso).toBe('codigo');
    });

    it('se hace cargo del botón atrás al entrar y lo suelta al salir', () => {
      const servicio = TestBed.inject(BotonAtrasService);
      const quitar = jasmine.createSpy('quitar');
      spyOn(servicio, 'registrar').and.returnValue(quitar);
      page.ionViewWillEnter();
      expect(servicio.registrar).toHaveBeenCalledTimes(1);
      page.ionViewWillLeave();
      expect(quitar).toHaveBeenCalled();
    });
  });
});
