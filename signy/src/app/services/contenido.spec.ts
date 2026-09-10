import { TestBed } from '@angular/core/testing';
import { ContenidoService } from './contenido';
import { SupabaseService } from './supabase';
import { MockSupabaseClient, ok, fail, statsDePrueba } from '../../testing/supabase-mock';
import { ProgresoSubnivelUsuario, Nivel, Subnivel } from '../data/db-types';

/** Formatea una fecha en YYYY-MM-DD LOCAL, igual que `formatearFechaLocal`
 * del servicio — se usa solo para armar fixtures de fecha en los tests. */
function fechaLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

describe('ContenidoService', () => {
  let service: ContenidoService;
  let db: MockSupabaseClient;
  let supabaseServiceSpy: { supabase: MockSupabaseClient; idsSeguidos: jasmine.Spy };

  beforeEach(() => {
    db = new MockSupabaseClient();
    supabaseServiceSpy = {
      supabase: db,
      idsSeguidos: jasmine.createSpy('idsSeguidos'),
    };

    TestBed.configureTestingModule({
      providers: [
        ContenidoService,
        { provide: SupabaseService, useValue: supabaseServiceSpy },
      ],
    });
    service = TestBed.inject(ContenidoService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  // ==================== Fechas ====================
  describe('fechas locales', () => {
    it('fechaHoy() devuelve la fecha LOCAL de hoy, no UTC', () => {
      jasmine.clock().install();
      // 23:30 hora local del 8 de septiembre -> en UTC ya sería 9 de
      // septiembre en varios husos horarios; fechaHoy() debe usar la local.
      jasmine.clock().mockDate(new Date(2026, 8, 8, 23, 30, 0));

      expect(service.fechaHoy()).toBe('2026-09-08');
    });

    it('sumarDias cruza el fin de mes correctamente', () => {
      expect(service.sumarDias('2026-01-31', 1)).toBe('2026-02-01');
    });

    it('sumarDias cruza el fin de año correctamente', () => {
      expect(service.sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('sumarDias respeta años bisiestos (2024 sí, 2026 no)', () => {
      expect(service.sumarDias('2024-02-28', 1)).toBe('2024-02-29');
      expect(service.sumarDias('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('sumarDias con números negativos resta días', () => {
      expect(service.sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    });
  });

  // ==================== Vidas ====================
  describe('minutosParaProximaVida', () => {
    it('devuelve 0 si ya está al máximo de vidas', () => {
      const stats = statsDePrueba({ vidas: 5, ultima_vida_perdida: new Date().toISOString() });
      expect(service.minutosParaProximaVida(stats)).toBe(0);
    });

    it('devuelve 0 si nunca perdió una vida', () => {
      const stats = statsDePrueba({ vidas: 3, ultima_vida_perdida: null });
      expect(service.minutosParaProximaVida(stats)).toBe(0);
    });

    it('calcula los minutos restantes dentro de la ventana de 4 horas', () => {
      jasmine.clock().install();
      const ahora = new Date(2026, 8, 8, 12, 0, 0);
      jasmine.clock().mockDate(ahora);
      // Perdió una vida hace 1 hora -> quedan 3 horas = 180 min para la próxima.
      const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000).toISOString();
      const stats = statsDePrueba({ vidas: 3, ultima_vida_perdida: haceUnaHora });

      expect(service.minutosParaProximaVida(stats)).toBe(180);
    });
  });

  describe('getMisStats — regeneración de vidas', () => {
    it('crea una fila inicial de stats si el usuario nunca tuvo una', async () => {
      db.cuando('user_stats', ok(null), ok(null));

      const stats = await service.getMisStats('user-1');

      expect(stats.vidas).toBe(5);
      expect(stats.racha_actual).toBe(0);
      expect(stats.puntos_experiencia).toBe(0);
    });

    it('no toca las vidas si ya está al máximo', async () => {
      const hoy = service.fechaHoy();
      const existentes = statsDePrueba({ vidas: 5, ultima_vida_perdida: null, ultima_fecha_practica: hoy, racha_evaluada_hasta: hoy });
      db.cuando('user_stats', ok(existentes));

      const stats = await service.getMisStats('user-1');

      expect(stats.vidas).toBe(5);
      expect(db.from).toHaveBeenCalledTimes(1); // solo el select, sin update
    });

    it('regenera 1 vida por cada 4 horas transcurridas, sin pasar el máximo', async () => {
      jasmine.clock().install();
      const ahora = new Date(2026, 8, 8, 12, 0, 0);
      jasmine.clock().mockDate(ahora);
      const hoy = fechaLocal(ahora);

      // Perdió vidas hace 5 horas -> a 4h/vida, gana 1 vida y le sobra 1h de progreso.
      const haceCincoHoras = new Date(ahora.getTime() - 5 * 60 * 60 * 1000).toISOString();
      const existentes = statsDePrueba({
        vidas: 2, ultima_vida_perdida: haceCincoHoras,
        ultima_fecha_practica: hoy, racha_evaluada_hasta: hoy,
      });
      db.cuando('user_stats', ok(existentes), ok(null));

      const stats = await service.getMisStats('user-1');

      expect(stats.vidas).toBe(3);
      expect(stats.ultima_vida_perdida).not.toBeNull();
    });

    it('llega al máximo de vidas y limpia la marca de "última vida perdida"', async () => {
      const hoy = service.fechaHoy();
      // Perdió vidas hace 100 horas -> de sobra para regenerar todas.
      const haceMucho = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
      const existentes = statsDePrueba({
        vidas: 1, ultima_vida_perdida: haceMucho,
        ultima_fecha_practica: hoy, racha_evaluada_hasta: hoy,
      });
      db.cuando('user_stats', ok(existentes), ok(null));

      const stats = await service.getMisStats('user-1');

      expect(stats.vidas).toBe(5);
      expect(stats.ultima_vida_perdida).toBeNull();
    });
  });

  describe('getMisStats — evaluación de racha (congeladores)', () => {
    it('no hace nada si ya practicó hoy', async () => {
      const hoy = service.fechaHoy();
      const existentes = statsDePrueba({ vidas: 5, ultima_fecha_practica: hoy, racha_actual: 4 });
      db.cuando('user_stats', ok(existentes));

      const stats = await service.getMisStats('user-1');

      expect(stats.racha_actual).toBe(4);
      expect(db.from).toHaveBeenCalledTimes(1);
    });

    it('no hace nada si el día ya fue evaluado antes (idempotente)', async () => {
      const hoy = service.fechaHoy();
      const ayer = service.sumarDias(hoy, -1);
      const existentes = statsDePrueba({ vidas: 5, ultima_fecha_practica: ayer, racha_evaluada_hasta: hoy, racha_actual: 4 });
      db.cuando('user_stats', ok(existentes));

      const stats = await service.getMisStats('user-1');

      expect(stats.racha_actual).toBe(4);
      expect(db.from).toHaveBeenCalledTimes(1);
    });

    it('cubre un día saltado con un congelador si hay suficientes disponibles', async () => {
      const hoy = service.fechaHoy();
      const hace2Dias = service.sumarDias(hoy, -2); // faltó ayer -> 1 día perdido
      const existentes = statsDePrueba({
        vidas: 5, ultima_fecha_practica: hace2Dias, racha_evaluada_hasta: null,
        racha_actual: 5, racha_congeladores: 2,
      });
      db.cuando('user_stats', ok(existentes), ok(null));
      db.cuando('racha_historial', ok(null));

      const stats = await service.getMisStats('user-1');

      expect(stats.racha_congeladores).toBe(1);
      expect(stats.racha_actual).toBe(5); // la racha se conserva
      expect(stats.eventoRacha).toEqual({ tipo: 'congelado', diasCubiertos: 1, congeladoresRestantes: 1 });
    });

    it('corta la racha a 0 si no hay congeladores suficientes para cubrir los días perdidos', async () => {
      const hoy = service.fechaHoy();
      const hace3Dias = service.sumarDias(hoy, -3); // 3 días sin practicar -> 2 días perdidos
      const existentes = statsDePrueba({
        vidas: 5, ultima_fecha_practica: hace3Dias, racha_evaluada_hasta: null,
        racha_actual: 10, racha_congeladores: 0,
      });
      db.cuando('user_stats', ok(existentes), ok(null));
      db.cuando('racha_historial', ok(null));

      const stats = await service.getMisStats('user-1');

      expect(stats.racha_actual).toBe(0);
      expect(stats.eventoRacha).toEqual({ tipo: 'perdida', diasCubiertos: 2, congeladoresRestantes: 0 });
    });

    it('no genera evento si la racha ya estaba en 0 (no hay nada que proteger)', async () => {
      const hoy = service.fechaHoy();
      const hace5Dias = service.sumarDias(hoy, -5);
      const existentes = statsDePrueba({ vidas: 5, ultima_fecha_practica: hace5Dias, racha_evaluada_hasta: null, racha_actual: 0 });
      db.cuando('user_stats', ok(existentes), ok(null));

      const stats = await service.getMisStats('user-1');

      expect(stats.eventoRacha).toBeUndefined();
      expect(stats.racha_evaluada_hasta).toBe(hoy);
    });
  });

  // ==================== Actualizar stats tras lección ====================
  describe('actualizarStatsTrasLeccion', () => {
    it('sube la racha en 1 si practicó ayer', async () => {
      const hoy = service.fechaHoy();
      const ayer = service.sumarDias(hoy, -1);
      const existentes = statsDePrueba({ ultima_fecha_practica: ayer, racha_actual: 3, max_racha: 3, puntos_experiencia: 50 });
      db.cuando('user_stats', ok(existentes), ok(null));
      db.cuando('racha_historial', ok(null));
      db.cuando('logros', ok([]));

      const resultado = await service.actualizarStatsTrasLeccion('user-1', 20);

      expect(resultado.racha_actual).toBe(4);
      expect(resultado.max_racha).toBe(4);
      expect(resultado.puntos_experiencia).toBe(70);
    });

    it('no cambia la racha si ya había practicado hoy (segunda lección del día)', async () => {
      const hoy = service.fechaHoy();
      const existentes = statsDePrueba({ ultima_fecha_practica: hoy, racha_actual: 3, puntos_experiencia: 50 });
      db.cuando('user_stats', ok(existentes), ok(null));
      db.cuando('racha_historial', ok(null));
      db.cuando('logros', ok([]));

      const resultado = await service.actualizarStatsTrasLeccion('user-1', 20);

      expect(resultado.racha_actual).toBe(3);
      expect(resultado.puntos_experiencia).toBe(70);
    });

    it('reinicia la racha en 1 si no practicó ayer ni tenía congeladores (racha ya cortada por getMisStats)', async () => {
      // getMisStats ya habrá cortado la racha a 0 antes de llegar acá,
      // así que actualizarStatsTrasLeccion solo ve racha_actual: 0.
      const hoy = service.fechaHoy();
      const anteAyer = service.sumarDias(hoy, -2);
      const existentes = statsDePrueba({ ultima_fecha_practica: anteAyer, racha_actual: 0, racha_congeladores: 0 });
      db.cuando('user_stats', ok(existentes), ok(null), ok(null));
      db.cuando('racha_historial', ok(null), ok(null));
      db.cuando('logros', ok([]));

      const resultado = await service.actualizarStatsTrasLeccion('user-1', 20);

      expect(resultado.racha_actual).toBe(1);
    });

    it('gana un congelador cada 5 días de racha, sin pasar el tope de 2', async () => {
      const hoy = service.fechaHoy();
      const ayer = service.sumarDias(hoy, -1);
      const existentes = statsDePrueba({ ultima_fecha_practica: ayer, racha_actual: 4, racha_congeladores: 1 });
      db.cuando('user_stats', ok(existentes), ok(null));
      db.cuando('racha_historial', ok(null));
      db.cuando('logros', ok([]));

      // 4 -> 5: cruza el múltiplo de 5, debería ganar un congelador (1 -> 2)
      const resultado = await service.actualizarStatsTrasLeccion('user-1', 10);

      expect(resultado.racha_actual).toBe(5);
      expect(resultado.racha_congeladores).toBe(2);
    });

    it('no pasa el tope de 2 congeladores aunque cruce otro múltiplo de 5', async () => {
      const hoy = service.fechaHoy();
      const ayer = service.sumarDias(hoy, -1);
      const existentes = statsDePrueba({ ultima_fecha_practica: ayer, racha_actual: 9, racha_congeladores: 2 });
      db.cuando('user_stats', ok(existentes), ok(null));
      db.cuando('racha_historial', ok(null));
      db.cuando('logros', ok([]));

      const resultado = await service.actualizarStatsTrasLeccion('user-1', 10);

      expect(resultado.racha_actual).toBe(10);
      expect(resultado.racha_congeladores).toBe(2);
    });
  });

  // ==================== Vidas al fallar ====================
  describe('descontarVida', () => {
    it('resta una vida', async () => {
      const existentes = statsDePrueba({ vidas: 3, ultima_fecha_practica: service.fechaHoy(), racha_evaluada_hasta: service.fechaHoy() });
      db.cuando('user_stats', ok(existentes), ok(null));

      const vidas = await service.descontarVida('user-1');

      expect(vidas).toBe(2);
    });

    it('nunca baja de 0', async () => {
      const existentes = statsDePrueba({ vidas: 0, ultima_fecha_practica: service.fechaHoy(), racha_evaluada_hasta: service.fechaHoy() });
      db.cuando('user_stats', ok(existentes), ok(null));

      const vidas = await service.descontarVida('user-1');

      expect(vidas).toBe(0);
    });
  });

  // ==================== Mapa de aprendizaje (estado de niveles/subniveles) ====================
  describe('obtenerMapaDeAprendizaje', () => {
    const niveles: Nivel[] = [
      { id: 1, numero_nivel: 1, nombre: 'Nivel 1', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null },
      { id: 2, numero_nivel: 2, nombre: 'Nivel 2', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null },
    ];
    const subniveles: Subnivel[] = [
      { id: 10, nivel_id: 1, numero_subnivel: 1, nombre: 'Sub 1.1', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null },
      { id: 11, nivel_id: 1, numero_subnivel: 2, nombre: 'Sub 1.2', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null },
      { id: 20, nivel_id: 2, numero_subnivel: 1, nombre: 'Sub 2.1', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null },
    ];

    function preparar(progresoNiveles: any[], progresoSubniveles: ProgresoSubnivelUsuario[], conContenido: number[]) {
      db.cuando('niveles', ok(niveles));
      db.cuando('progreso_nivel_usuario', ok(progresoNiveles));
      db.cuando('progreso_subnivel_usuario', ok(progresoSubniveles));
      db.cuando('subniveles', ok(subniveles));
      db.cuando('senas', ok(conContenido.map(subnivel_id => ({ subnivel_id }))));
    }

    it('el primer nivel es accesible por defecto aunque no exista progreso', async () => {
      preparar([], [], [10, 11, 20]);

      const mapa = await service.obtenerMapaDeAprendizaje('user-1');

      expect(mapa[0].accesible).toBeTrue();
      expect(mapa[1].accesible).toBeFalse();
    });

    it('marca "proximamente" un subnivel sin señas cargadas, aunque el nivel esté accesible', async () => {
      preparar([], [], [11, 20]); // 10 no tiene contenido todavía

      const mapa = await service.obtenerMapaDeAprendizaje('user-1');
      const sub10 = mapa[0].subniveles.find(s => s.id === 10)!;

      expect(sub10.estado).toBe('proximamente');
    });

    it('marca solo el primer subnivel pendiente como "actual", el resto "bloqueado"', async () => {
      preparar([], [], [10, 11, 20]);

      const mapa = await service.obtenerMapaDeAprendizaje('user-1');

      expect(mapa[0].subniveles[0].estado).toBe('actual');
      expect(mapa[0].subniveles[1].estado).toBe('bloqueado');
    });

    it('marca "completado" un subnivel ya aprobado y deja el siguiente como "actual"', async () => {
      const progresoSubniveles: ProgresoSubnivelUsuario[] = [
        { user_id: 'user-1', subnivel_id: 10, completado: true, puntaje: 100, fecha_completado: null, updated_at: null },
      ];
      preparar([], progresoSubniveles, [10, 11, 20]);

      const mapa = await service.obtenerMapaDeAprendizaje('user-1');

      expect(mapa[0].subniveles[0].estado).toBe('completado');
      expect(mapa[0].subniveles[1].estado).toBe('actual');
    });

    it('bloquea todos los subniveles de un nivel sin acceso', async () => {
      preparar([], [], [20]);

      const mapa = await service.obtenerMapaDeAprendizaje('user-1');

      expect(mapa[1].subniveles[0].estado).toBe('bloqueado');
    });
  });

  // ==================== Avance de nivel ====================
  describe('avanzarNivelSiCorresponde', () => {
    const niveles: Nivel[] = [
      { id: 1, numero_nivel: 1, nombre: 'Nivel 1', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null },
      { id: 2, numero_nivel: 2, nombre: 'Nivel 2', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null },
    ];
    const subnivelesNivel1: Subnivel[] = [
      { id: 10, nivel_id: 1, numero_subnivel: 1, nombre: 'Sub 1.1', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null },
    ];

    it('no avanza si todavía quedan subniveles sin completar', async () => {
      db.cuando('niveles', ok(niveles));
      db.cuando('subniveles', ok(subnivelesNivel1));
      db.cuando('progreso_subnivel_usuario', ok([]));

      const resultado = await service.avanzarNivelSiCorresponde('user-1', 1);

      expect(resultado.nivelRecienCompletado).toBeFalse();
    });

    it('completa el nivel y da acceso al siguiente la primera vez que se cumplen todos los subniveles', async () => {
      db.cuando('niveles', ok(niveles));
      db.cuando('subniveles', ok(subnivelesNivel1));
      db.cuando('progreso_subnivel_usuario', ok([{ user_id: 'user-1', subnivel_id: 10, completado: true, puntaje: 100, fecha_completado: null, updated_at: null }]));
      db.cuando('progreso_nivel_usuario', ok(null), ok(null), ok(null));
      db.cuando('logros', ok([]));

      const resultado = await service.avanzarNivelSiCorresponde('user-1', 1);

      expect(resultado.nivelRecienCompletado).toBeTrue();
    });

    it('NO vuelve a marcar "recién completado" si el nivel ya estaba completo antes (repaso)', async () => {
      db.cuando('niveles', ok(niveles));
      db.cuando('subniveles', ok(subnivelesNivel1));
      db.cuando('progreso_subnivel_usuario', ok([{ user_id: 'user-1', subnivel_id: 10, completado: true, puntaje: 100, fecha_completado: null, updated_at: null }]));
      db.cuando('progreso_nivel_usuario', ok({ completado: true }), ok(null), ok(null));
      db.cuando('logros', ok([]));

      const resultado = await service.avanzarNivelSiCorresponde('user-1', 1);

      expect(resultado.nivelRecienCompletado).toBeFalse();
    });
  });

  // ==================== Logros ====================
  describe('otorgarLogroPorCodigo', () => {
    const logros = [{ id: 1, codigo: 'primera_leccion', nombre: 'Primera lección', descripcion: null, icono_url: null, icono: null, created_at: null }];

    it('otorga el logro si el código existe en el catálogo', async () => {
      db.cuando('logros', ok(logros));
      db.cuando('usuario_logros', ok(null));

      await service.otorgarLogroPorCodigo('user-1', 'primera_leccion');

      expect(db.from).toHaveBeenCalledWith('usuario_logros');
    });

    it('no hace nada (ni revienta) si el código no existe todavía en el catálogo', async () => {
      db.cuando('logros', ok(logros));

      await expectAsync(service.otorgarLogroPorCodigo('user-1', 'codigo_inexistente')).toBeResolved();
      expect(db.from).not.toHaveBeenCalledWith('usuario_logros');
    });

    it('cachea el catálogo de logros: solo consulta "logros" una vez por sesión', async () => {
      db.cuando('logros', ok(logros));
      db.cuando('usuario_logros', ok(null), ok(null));

      await service.otorgarLogroPorCodigo('user-1', 'primera_leccion');
      await service.otorgarLogroPorCodigo('user-1', 'primera_leccion');

      expect(db.from).toHaveBeenCalledTimes(3); // 1 x 'logros' + 2 x 'usuario_logros'
    });
  });

  // ==================== Ranking ====================
  describe('getRanking', () => {
    it('ordena por racha descendente y usa XP como desempate', async () => {
      supabaseServiceSpy.idsSeguidos.and.resolveTo(['amigo-a', 'amigo-b']);
      db.cuando('profiles', ok([
        { id: 'user-1', full_name: 'Yo', avatar_url: null },
        { id: 'amigo-a', full_name: 'Amigo A', avatar_url: null },
        { id: 'amigo-b', full_name: 'Amigo B', avatar_url: null },
      ]));
      db.cuando('user_stats', ok([
        { user_id: 'user-1', racha_actual: 5, puntos_experiencia: 100 },
        { user_id: 'amigo-a', racha_actual: 5, puntos_experiencia: 200 },
        { user_id: 'amigo-b', racha_actual: 8, puntos_experiencia: 10 },
      ]));

      const ranking = await service.getRanking('user-1');

      expect(ranking.map(r => r.id)).toEqual(['amigo-b', 'amigo-a', 'user-1']);
      expect(ranking.find(r => r.id === 'user-1')!.esYo).toBeTrue();
    });

    it('a alguien sin fila en user_stats le pone racha y xp en 0 en vez de romper', async () => {
      supabaseServiceSpy.idsSeguidos.and.resolveTo([]);
      db.cuando('profiles', ok([{ id: 'user-1', full_name: 'Yo', avatar_url: null }]));
      db.cuando('user_stats', ok([]));

      const ranking = await service.getRanking('user-1');

      expect(ranking[0].racha_actual).toBe(0);
      expect(ranking[0].puntos_experiencia).toBe(0);
    });
  });

  // ==================== Tienda de congeladores ====================
  describe('comprarCongelador', () => {
    it('rechaza la compra si ya tiene el máximo de congeladores', async () => {
      db.cuando('user_stats', ok(statsDePrueba({ racha_congeladores: 2, puntos_experiencia: 500, ultima_fecha_practica: service.fechaHoy(), racha_evaluada_hasta: service.fechaHoy() })));

      const resultado = await service.comprarCongelador('user-1');

      expect(resultado).toEqual({ ok: false, error: 'Ya tienes el máximo de congeladores.' });
    });

    it('rechaza la compra si no le alcanza el XP, indicando cuánto le falta', async () => {
      db.cuando('user_stats', ok(statsDePrueba({ racha_congeladores: 0, puntos_experiencia: 120, ultima_fecha_practica: service.fechaHoy(), racha_evaluada_hasta: service.fechaHoy() })));

      const resultado = await service.comprarCongelador('user-1');

      expect(resultado).toEqual({ ok: false, error: 'Te faltan 80 XP.' });
    });

    it('completa la compra descontando 200 XP y sumando 1 congelador', async () => {
      db.cuando('user_stats', ok(statsDePrueba({ racha_congeladores: 0, puntos_experiencia: 300, ultima_fecha_practica: service.fechaHoy(), racha_evaluada_hasta: service.fechaHoy() })), ok(null));

      const resultado = await service.comprarCongelador('user-1');

      expect(resultado).toEqual({ ok: true });
    });

    it('devuelve error genérico si la escritura en la base de datos falla', async () => {
      db.cuando('user_stats', ok(statsDePrueba({ racha_congeladores: 0, puntos_experiencia: 300, ultima_fecha_practica: service.fechaHoy(), racha_evaluada_hasta: service.fechaHoy() })), fail('boom'));

      const resultado = await service.comprarCongelador('user-1');

      expect(resultado).toEqual({ ok: false, error: 'No se pudo completar la compra.' });
    });
  });

  describe('getAmigosBajosEnCongelador', () => {
    it('excluye a quienes ya tienen el máximo y ordena de menor a mayor', async () => {
      supabaseServiceSpy.idsSeguidos.and.resolveTo(['a', 'b', 'c']);
      db.cuando('profiles', ok([
        { id: 'a', full_name: 'A', avatar_url: null },
        { id: 'b', full_name: 'B', avatar_url: null },
        { id: 'c', full_name: 'C', avatar_url: null },
      ]));
      db.cuando('user_stats', ok([
        { user_id: 'a', racha_congeladores: 2 },
        { user_id: 'b', racha_congeladores: 0 },
        { user_id: 'c', racha_congeladores: 1 },
      ]));

      const resultado = await service.getAmigosBajosEnCongelador('user-1');

      expect(resultado.map(r => r.id)).toEqual(['b', 'c']);
    });

    it('devuelve una lista vacía sin consultar la base de datos si no sigue a nadie', async () => {
      supabaseServiceSpy.idsSeguidos.and.resolveTo([]);

      const resultado = await service.getAmigosBajosEnCongelador('user-1');

      expect(resultado).toEqual([]);
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe('obtenerHistorialRacha', () => {
    it('devuelve [] si la tabla no tiene filas para ese rango', async () => {
      db.cuando('racha_historial', ok(null));
      const historial = await service.obtenerHistorialRacha('user-1', 27);
      expect(historial).toEqual([]);
    });

    it('propaga el error si la consulta falla', async () => {
      db.cuando('racha_historial', fail('sin permisos'));
      await expectAsync(service.obtenerHistorialRacha('user-1')).toBeRejected();
    });
  });

  describe('regalarCongelador', () => {
    it('devuelve el resultado de la función regalar_congelador si no hay error', async () => {
      db.cuandoRpc({ data: { ok: true }, error: null });
      const resultado = await service.regalarCongelador('amigo-1');
      expect(resultado).toEqual({ ok: true });
    });

    it('devuelve un error genérico si la función falla (ej. ya está al tope, o enfriamiento activo)', async () => {
      db.cuandoRpc({ data: null, error: { message: 'cooldown activo' } });
      const resultado = await service.regalarCongelador('amigo-1');
      expect(resultado).toEqual({ ok: false, error: 'No se pudo completar el regalo.' });
    });
  });

  // ==================== Intentos y fallos ====================
  describe('registrarIntento', () => {
    it('solo registra el intento cuando la respuesta es correcta', async () => {
      db.cuando('intentos_ejercicio', ok(null));

      await service.registrarIntento('user-1', 10, true);

      expect(db.from).not.toHaveBeenCalledWith('practica_fallos');
    });

    it('crea una fila de fallo nueva la primera vez que se falla una seña', async () => {
      db.cuando('intentos_ejercicio', ok(null));
      db.cuando('practica_fallos', ok(null), ok(null));

      await service.registrarIntento('user-1', 10, false);

      expect(db.from).toHaveBeenCalledWith('practica_fallos');
    });

    it('incrementa el contador si ya existía una fila de fallo para esa seña', async () => {
      db.cuando('intentos_ejercicio', ok(null));
      db.cuando('practica_fallos', ok({ id: 1, cantidad_fallos: 2 }), ok(null));

      await service.registrarIntento('user-1', 10, false);

      expect(db.from).toHaveBeenCalledWith('practica_fallos');
    });
  });

  describe('getMisFallos', () => {
    it('usa un guion largo como palabra de respaldo si la relación con senas viene vacía', async () => {
      db.cuando('practica_fallos', ok([{ cantidad_fallos: 3, senas: null }]));

      const fallos = await service.getMisFallos('user-1');

      expect(fallos[0]).toEqual({ palabra: '—', icono: null, cantidad_fallos: 3 });
    });

    it('mapea correctamente cuando sí viene la relación con senas', async () => {
      db.cuando('practica_fallos', ok([{ cantidad_fallos: 5, senas: { palabra: 'gato', icono: '🐱' } }]));

      const fallos = await service.getMisFallos('user-1');

      expect(fallos[0]).toEqual({ palabra: 'gato', icono: '🐱', cantidad_fallos: 5 });
    });
  });
});
