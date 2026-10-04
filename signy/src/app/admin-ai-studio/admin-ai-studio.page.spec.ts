import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AdminAiStudioPage } from './admin-ai-studio.page';
import { SupabaseService } from '../services/supabase';
import { BotonAtrasService } from '../services/boton-atras';
import { ReconocedorSenasService, construirModeloReferencia, MuestraSena, compactarCaptura } from '../motor-senas';
import { generarCaptura, SENAS } from '../motor-senas/testing/manos-sinteticas';
import { Sena } from '../data/db-types';

describe('AdminAiStudioPage', () => {
  let page: AdminAiStudioPage;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;

  const conModelo = (id: number, nombre: string): Sena => ({
    id, subnivel_id: 1, palabra: nombre.toLowerCase(), descripcion: null, video_url: null, icono: null, created_at: null,
    landmarks_referencia: construirModeloReferencia(generarCaptura(nombre, { semilla: 100, pausaAntesMs: 300, pausaDespuesMs: 300, ruido: 0.03 }), {
      palabra: nombre, tipo: SENAS[nombre].tipo, manosRequeridas: SENAS[nombre].manos,
    }),
  });
  const sinModelo: Sena = { id: 9, subnivel_id: 1, palabra: 'pendiente', descripcion: null, video_url: null, icono: null, created_at: null, landmarks_referencia: null };

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['listarNiveles', 'listarSubniveles', 'listarSenas', 'contarMuestrasPorSena', 'listarMuestrasSena']);
    supabaseSpy.listarNiveles.and.resolveTo([]);
    supabaseSpy.listarSubniveles.and.resolveTo([]);
    supabaseSpy.listarSenas.and.resolveTo([conModelo(1, 'HOLA'), conModelo(2, 'SI'), conModelo(3, 'GRACIAS'), sinModelo]);
    supabaseSpy.contarMuestrasPorSena.and.resolveTo(new Map([[1, 12], [2, 3]]));
    spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 404 })); // sin clasificador entrenado
    spyOn(console, 'warn');

    TestBed.configureTestingModule({
      imports: [AdminAiStudioPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    });
    TestBed.overrideProvider(ModalController, { useValue: jasmine.createSpyObj('ModalController', ['create']) });
    await TestBed.compileComponents();
    page = TestBed.createComponent(AdminAiStudioPage).componentInstance;
    await page.cargarDatos();
    await new Promise((r) => setTimeout(r));
  });

  it('cuenta como calibradas solo las señas con un modelo utilizable', () => {
    expect(page.calibradasCount).toBe(3);
    expect(page.pendientesCount).toBe(1);
    expect(page.estaCalibrada(sinModelo)).toBeFalse();
  });

  it('muestra cuántas muestras de dataset tiene cada seña', () => {
    expect(page.totalMuestras).toBe(15);
    expect(page.muestrasDe(1)).toBe(12);
    expect(page.muestrasDe(9)).toBe(0);
  });

  it('si la tabla del dataset no existe todavía, la pantalla igual carga', async () => {
    supabaseSpy.contarMuestrasPorSena.and.rejectWith({ code: '42P01' });
    await page.cargarDatos();
    await new Promise((r) => setTimeout(r));
    expect(page.error).toBeNull();
    expect(page.muestrasPorSena).toBeNull();
  });

  it('el laboratorio en vivo pone primero la seña que se está haciendo', async () => {
    const captura = generarCaptura('SI', { pausaAntesMs: 300, pausaDespuesMs: 300, ruido: 0.03, semilla: 4 });
    const buffer = (page as any).labBuffer;
    captura.frames.forEach((f) => buffer.agregar({ landmarks: f.manos }, f.t, captura.ancho, captura.alto));
    await (page as any).evaluarBufferContraModelo();
    expect(page.mejorPrediccion!.palabra).toBe('si');
    expect(page.mejorPrediccion!.esCoincidente).toBeTrue();
    expect(page.prediccionesEnVivo.length).toBe(3); // la seña sin modelo no participa
    expect(page.prediccionesEnVivo[1].similitud).toBeLessThan(page.prediccionesEnVivo[0].similitud);
    expect(page.prediccionesClasificador).toEqual([]);
  });

  describe('exportar dataset', () => {
    const muestra = (id: number, sena_id: number, autor: string): MuestraSena => ({
      id, sena_id, autor_id: autor, formato: 1, tipo: 'dinamica', manos_requeridas: 1, ancho: 640, alto: 480,
      duracion_ms: 1000, total_frames: 3, created_at: '', captura: compactarCaptura(generarCaptura('HOLA', { duracionMs: 60 })),
    });

    it('descarga un JSON con el formato de ml/entrenar.py y sin ids de usuario', async () => {
      supabaseSpy.listarMuestrasSena.and.resolveTo([muestra(1, 1, 'uuid-ana'), muestra(2, 2, 'uuid-beto')]);
      let blob: Blob | null = null;
      spyOn(URL, 'createObjectURL').and.callFake((b: Blob | MediaSource) => {
        blob = b as Blob;
        return 'blob:x';
      });
      spyOn(URL, 'revokeObjectURL');
      const click = spyOn(HTMLAnchorElement.prototype, 'click');

      await page.exportarDataset();

      expect(click).toHaveBeenCalled();
      const json = JSON.parse(await blob!.text());
      expect(json.formato).toBe('signy-dataset');
      expect(json.muestras.map((m: any) => m.participante)).toEqual(['p1', 'p2']);
      expect(json.senas.map((s: any) => s.palabra)).toEqual(['hola', 'si']);
      expect(JSON.stringify(json)).not.toContain('uuid-');
      expect(page.exportando).toBeFalse();
    });

    it('en el celular explica cómo entrenar en vez de intentar una descarga que el WebView no hace', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      const alerta = spyOn(window, 'alert');
      await page.exportarDataset();
      expect(alerta.calls.mostRecent().args[0]).toContain('entrenar.py --supabase');
      expect(supabaseSpy.listarMuestrasSena).not.toHaveBeenCalled();
    });

    it('sin muestras avisa en vez de descargar un archivo vacío', async () => {
      supabaseSpy.listarMuestrasSena.and.resolveTo([]);
      const alerta = spyOn(window, 'alert');
      const click = spyOn(HTMLAnchorElement.prototype, 'click');
      await page.exportarDataset();
      expect(alerta).toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    });

    it('un error de red se informa y libera el botón', async () => {
      supabaseSpy.listarMuestrasSena.and.rejectWith(new Error('sin red'));
      const alerta = spyOn(window, 'alert');
      await page.exportarDataset();
      expect(alerta.calls.mostRecent().args[0]).toContain('sin red');
      expect(page.exportando).toBeFalse();
    });
  });

  it('no cierra el HandLandmarker compartido al salir', () => {
    const cerrar = jasmine.createSpy('close');
    (page as any).labHandLandmarker = { close: cerrar };
    page.ngOnDestroy();
    expect(cerrar).not.toHaveBeenCalled();
    expect(TestBed.inject(ReconocedorSenasService)).toBeTruthy();
  });

  describe('botón atrás del teléfono', () => {
    it('cierra primero el modal de nueva seña', () => {
      page.abrirModalCrear();
      expect(page.alPresionarAtras()).toBeTrue();
      expect(page.modalCrearAbierto).toBeFalse();
    });

    it('no cierra el modal mientras se está creando la seña', () => {
      page.modalCrearAbierto = true;
      page.guardandoNueva = true;
      expect(page.alPresionarAtras()).toBeTrue();
      expect(page.modalCrearAbierto).toBeTrue();
    });

    it('después cierra la ficha de la seña elegida en el grafo', () => {
      page.senaSeleccionada = conModelo(1, 'HOLA');
      expect(page.alPresionarAtras()).toBeTrue();
      expect(page.senaSeleccionada).toBeNull();
    });

    it('sin nada abierto, deja volver a la pantalla anterior', () => {
      expect(page.alPresionarAtras()).toBeFalse();
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
