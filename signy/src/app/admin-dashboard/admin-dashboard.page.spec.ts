import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AdminDashboardPage } from './admin-dashboard.page';
import { SupabaseService } from '../services/supabase';
import { ReconocedorSenasService } from '../motor-senas';
import { Kpis } from './kpis';
import { kpisEjemplo } from './testing/kpis-ejemplo';

describe('AdminDashboardPage', () => {
  let fixture: ComponentFixture<AdminDashboardPage>;
  let page: AdminDashboardPage;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let router: jasmine.SpyObj<Router>;

  const respuesta = (data: Kpis | null, error: unknown = null) => ({ data, error }) as any;
  const esperar = () => new Promise((r) => setTimeout(r));

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', ['adminKpis']);
    supabaseSpy.adminKpis.and.callFake(async () => respuesta(kpisEjemplo()));
    router = jasmine.createSpyObj('Router', ['navigate']);
    const reconocedor = {
      clasificador: () =>
        Promise.resolve({
          umbralSugerido: 0.95,
          modelo: {
            creado: '2026-10-26T04:17:41+00:00',
            clases: [{ senaId: 0 }, { senaId: 1 }, { senaId: 2 }],
            metricas: { exactitud: 0.7045, exactitudPersonasNuevas: 0.278, muestrasEntrenamiento: 125, muestrasPrueba: 44 },
          },
        }),
    };

    TestBed.configureTestingModule({
      imports: [AdminDashboardPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: router },
        { provide: ReconocedorSenasService, useValue: reconocedor },
      ],
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(AdminDashboardPage);
    page = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → cargar()
    await fixture.whenStable();
    await esperar();
    fixture.detectChanges();
  });

  it('pide los KPIs de 30 días sin las cuentas del equipo y dibuja todo', () => {
    expect(supabaseSpy.adminKpis).toHaveBeenCalledWith(30, true);
    expect(page.cargando).toBeFalse();
    expect(page.error).toBe('');
    const html: string = fixture.nativeElement.textContent;
    expect(html).toContain('Terminaron el nivel 1');
    expect(html).toContain('Embudo de aprendizaje');
    expect(html).toContain('¿Cuándo practican?');
    expect(fixture.nativeElement.querySelectorAll('.tarjeta').length).toBe(8);
    expect(fixture.nativeElement.querySelector('app-grafico-linea')).not.toBeNull();
  });

  it('la tarjeta del nivel 1 va destacada con su % de los registrados', () => {
    const nivel1 = page.tarjetas.find((t) => t.id === 'nivel1')!;
    expect(nivel1.destacada).toBeTrue();
    expect(nivel1.valor).toBe('56');
    expect(nivel1.detalle).toBe('47 % de los registrados');
    expect(nivel1.medidor).toBeCloseTo(46.67, 1);
  });

  it('compara con el período anterior (y las tasas en puntos)', () => {
    const activos = page.tarjetas.find((t) => t.id === 'activos')!;
    expect(activos.variacion?.texto).toBe('+40 %');
    const lecciones = page.tarjetas.find((t) => t.id === 'lecciones')!;
    expect(lecciones.variacion?.tono).toBe('malo');
    const quiz = page.tarjetas.find((t) => t.id === 'quiz')!;
    expect(quiz.valor).toBe('80 %');
    expect(quiz.variacion?.texto).toBe('+10 pts');
    expect(page.textoComparacion).toBe('vs. los 7 días anteriores');
  });

  it('al cambiar el período vuelve a pedir los datos; con "Todo" no hay comparación', async () => {
    page.cambiarPeriodo(7);
    expect(supabaseSpy.adminKpis).toHaveBeenCalledWith(7, true);
    page.cambiarPeriodo(0);
    await esperar();
    expect(supabaseSpy.adminKpis).toHaveBeenCalledWith(0, true);
    expect(page.textoComparacion).toBe('');
    expect(page.tarjetas.every((t) => t.variacion === null)).toBeTrue();
  });

  it('el interruptor del equipo incluye las cuentas de admin', () => {
    page.cambiarExcluirAdmins(false);
    expect(supabaseSpy.adminKpis).toHaveBeenCalledWith(30, false);
  });

  it('si llega tarde una respuesta vieja, no pisa la del filtro nuevo', async () => {
    let resolverVieja!: (v: any) => void;
    const vieja = kpisEjemplo();
    vieja.resumen.usuarios_total = 999;
    supabaseSpy.adminKpis.and.returnValues(new Promise((r) => (resolverVieja = r)) as any, Promise.resolve(respuesta(kpisEjemplo())));
    page.cambiarPeriodo(7);
    page.cambiarPeriodo(90);
    await esperar();
    resolverVieja(respuesta(vieja));
    await esperar();
    expect(page.kpis?.resumen.usuarios_total).toBe(120);
    expect(page.actualizando).toBeFalse();
  });

  it('si falta la migración, lo dice con el nombre del archivo', async () => {
    supabaseSpy.adminKpis.and.resolveTo(respuesta(null, { code: 'PGRST202', message: 'Could not find the function public.admin_kpis' }));
    page.kpis = null;
    await page.cargar();
    fixture.detectChanges();
    expect(page.error).toContain('20261027120000_dashboard_kpis.sql');
    expect(fixture.nativeElement.querySelector('.estado.error')).not.toBeNull();
  });

  it('si falla al actualizar, mantiene los datos anteriores a la vista', async () => {
    supabaseSpy.adminKpis.and.resolveTo(respuesta(null, { message: 'Failed to fetch' }));
    await page.cargar();
    fixture.detectChanges();
    expect(page.kpis).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.aviso-error')?.textContent).toContain('No hay conexión');
  });

  it('el gráfico cambia de métrica; "Registrados" es el total acumulado', () => {
    page.cambiarMetrica('registrados');
    const puntos = page.puntosSerie;
    expect(puntos.length).toBe(7);
    expect(puntos[puntos.length - 1].y).toBe(120);
    expect(puntos[0].y).toBe(111); // 120 − 10 nuevos + 1 del primer día
    expect(page.resumenSerie[0]).toEqual({ etiqueta: 'Al cierre del período', valor: '120' });

    page.cambiarMetrica('activos');
    // Los activos no se suman día a día (se contaría dos veces a quien vino dos días).
    expect(page.resumenSerie[0]).toEqual({ etiqueta: 'Personas distintas', valor: '70' });
    expect(page.resumenSerie[2].valor).toBe('20 · vie 23 oct');
  });

  it('el embudo resalta la etapa donde más gente se queda', () => {
    expect(page.registradosPeriodo).toBe(10);
    expect(page.caidaEmbudo).toEqual({ etapa: 'Completaron 3 lecciones', perdidos: 5 });
    expect(page.embudo.filter((e) => e.destacada).length).toBe(1);
    expect(page.embudo[1].detalle).toBe('90 % de la etapa anterior');
  });

  it('ordena y busca señas (sin importar tildes); las sin datos van al final', () => {
    page.ordenarSenas('camara'); // de menor a mayor: primero las difíciles
    expect(page.senasVisibles.map((s) => s.palabra)).toEqual(['Día', 'Gracias', 'Hola', 'Ayuda']);
    page.ordenarSenas('camara');
    expect(page.senasVisibles.map((s) => s.palabra)).toEqual(['Hola', 'Gracias', 'Día', 'Ayuda']);
    expect(page.ordenAria('camara')).toBe('descending');

    page.busquedaSena = 'dia';
    page.filtrarSenas();
    expect(page.senasVisibles.map((s) => s.palabra)).toEqual(['Día']);
  });

  it('muestra las métricas del modelo que trae la app (sin contar la clase "ninguna")', () => {
    expect(page.modelo).toEqual({
      exactitud: 0.7045,
      personasNuevas: 0.278,
      umbral: 0.95,
      senas: 2,
      muestras: 169,
      creado: '2026-10-26T04:17:41+00:00',
    });
  });

  it('copia el resumen al portapapeles', async () => {
    const escribir = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    await page.copiarResumen();
    expect(escribir.calls.mostRecent().args[0]).toContain('Signy · KPIs');
    expect(page.aviso).toContain('Resumen copiado');
  });

  it('navega a las otras pantallas del panel de admin', () => {
    page.irAVocabulario();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/vocabulario']);
    page.irAAIStudio();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/ai-studio']);
  });
});
