import {
  destacados,
  embudoConConversion,
  fechaConDia,
  fechaCorta,
  horaPico,
  matrizHabitos,
  mayorCaida,
  mensajeError,
  numero,
  porcentaje,
  resumenTexto,
  serieCsv,
  tasa,
  ticksEje,
  variacion,
  variacionPuntos,
} from './kpis';
import { kpisEjemplo } from './testing/kpis-ejemplo';

describe('kpis (cálculos del dashboard)', () => {
  it('formatea números y abrevia los grandes', () => {
    expect(numero(0)).toBe('0');
    expect(numero(12900)).toBe('12,9 mil');
    expect(numero(2_500_000)).toBe('2,5 M');
    expect(numero(null)).toBe('—');
    expect(numero(NaN)).toBe('—');
  });

  it('formatea porcentajes con coma y sin "NaN"', () => {
    expect(porcentaje(4.4)).toBe('4,4 %');
    expect(porcentaje(12.6)).toBe('13 %');
    expect(porcentaje(100)).toBe('100 %');
    expect(porcentaje(null)).toBe('—');
    expect(tasa(3, 0)).toBeNull();
    expect(tasa(1, 4)).toBe(25);
  });

  it('calcula la variación contra el período anterior con flecha y tono', () => {
    expect(variacion(120, 100)).toEqual({ texto: '+20 %', tono: 'bueno', flecha: '↑' });
    expect(variacion(90, 100)).toEqual({ texto: '−10 %', tono: 'malo', flecha: '↓' });
    expect(variacion(90, 100, false)?.tono).toBe('bueno');
    expect(variacion(5, 0)?.texto).toBe('nuevo');
    expect(variacion(0, 0)?.texto).toBe('=');
    expect(variacion(null, 3)).toBeNull();
  });

  it('las tasas varían en puntos, no en %', () => {
    expect(variacionPuntos(80, 70)).toEqual({ texto: '+10 pts', tono: 'bueno', flecha: '↑' });
    expect(variacionPuntos(60, 62.5)?.texto).toBe('−2,5 pts');
    expect(variacionPuntos(null, 50)).toBeNull();
  });

  it('muestra fechas sin correrse un día por la zona horaria', () => {
    expect(fechaCorta('2026-10-26')).toBe('26 oct');
    expect(fechaCorta('2026-10-26T04:17:41+00:00')).toBe('26 oct');
    expect(fechaConDia('2026-10-26')).toBe('lun 26 oct');
    expect(fechaConDia('2026-10-25')).toBe('dom 25 oct');
  });

  it('el embudo calcula el % del total y del paso, y encuentra la mayor caída', () => {
    const etapas = embudoConConversion(kpisEjemplo().embudo);
    expect(etapas[0].pctPaso).toBeNull();
    expect(etapas[2].pctTotal).toBe(80);
    expect(etapas[3].pctPaso).toBeCloseTo(37.5);
    // Se mide en personas: de 8 a 3 se pierden 5. "Nivel 2" tiene 0 % pero solo pierde 2.
    const caida = mayorCaida(etapas)!;
    expect(caida.etapa.etapa).toBe('Completaron 3 lecciones');
    expect(caida.perdidos).toBe(5);
    expect(mayorCaida(embudoConConversion([{ etapa: 'Se registraron', usuarios: 0 }]))).toBeNull();
  });

  it('arma la matriz de hábitos 7×24 y la hora pico', () => {
    const k = kpisEjemplo();
    const m = matrizHabitos(k.habitos);
    expect(m.length).toBe(7);
    expect(m[0].length).toBe(24);
    expect(m[4][19]).toBe(131);
    expect(m[0][8]).toBe(29);
    expect(horaPico(k.habitos)).toBe('Viernes a las 19:00');
    expect(horaPico([])).toBeNull();
  });

  it('el eje Y usa valores redondos que cubren el máximo', () => {
    expect(ticksEje(23)).toEqual([0, 10, 20, 30]);
    expect(ticksEje(100)).toEqual([0, 25, 50, 75, 100]);
    expect(ticksEje(0)).toEqual([0, 1]);
  });

  it('el CSV trae encabezado y una fila por día', () => {
    const csv = serieCsv(kpisEjemplo().serie).split('\n');
    expect(csv[0]).toBe('fecha;usuarios_activos;usuarios_nuevos;lecciones_completadas;ejercicios');
    expect(csv.length).toBe(8);
    expect(csv[1]).toBe('2026-10-20;10;1;5;30');
  });

  it('el resumen de texto incluye el nivel 1 y el embudo', () => {
    const texto = resumenTexto(kpisEjemplo());
    expect(texto).toContain('Terminaron el nivel 1: 56 (47 % de los registrados)');
    expect(texto).toContain('Se registraron 10 → Hicieron su primer ejercicio 9');
    expect(texto).toContain('sin cuentas del equipo');
  });

  it('los destacados cuentan lo importante y omiten lo que no tiene datos', () => {
    const frases = destacados(kpisEjemplo());
    expect(frases[0]).toBe('56 de 120 usuarios (47 %) ya terminaron el nivel 1.');
    expect(frases).toContain('Los usuarios activos subieron 40 % respecto de los 7 días anteriores.');
    expect(frases).toContain('El momento con más práctica es el viernes a las 19:00.');
    expect(frases).toContain('La mayor fuga del embudo está antes de «Completaron 3 lecciones»: 5 personas no llegan (pasa el 38 %).');
    // "Ayuda" tiene solo 2 intentos de quiz: no puede ser la "más difícil".
    expect(frases.some((f) => f.includes('«Día»: 30 % aprobadas'))).toBeTrue();
    expect(frases.some((f) => f.includes('Ayuda'))).toBeFalse();
  });

  it('explica los errores típicos en palabras simples', () => {
    expect(mensajeError({ code: 'PGRST202', message: 'Could not find the function public.admin_kpis' })).toContain('20261027120000_dashboard_kpis.sql');
    expect(mensajeError({ code: '42501', message: 'Solo los administradores…' })).toContain('no es administradora');
    expect(mensajeError(new TypeError('Failed to fetch'))).toContain('No hay conexión');
    expect(mensajeError(null)).toBe('No se pudieron cargar los KPIs.');
  });
});
