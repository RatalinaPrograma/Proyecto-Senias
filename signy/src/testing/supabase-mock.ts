/**
 * Utilidades para simular el cliente de Supabase en pruebas unitarias, sin
 * pegarle a la red ni a la base de datos real.
 *
 * El query builder de supabase-js es "thenable": cada método (.select,
 * .eq, .order, etc.) devuelve el mismo builder para poder encadenar, y
 * recién al hacer `await` se resuelve a `{ data, error }` (o `{ count }`
 * cuando se pide `{ count: 'exact' }`). `FakeQueryBuilder` imita ese
 * comportamiento: cualquier método encadenado devuelve `this`, y el
 * `await` final resuelve al resultado que se le haya configurado.
 */
export class FakeQueryBuilder implements PromiseLike<any> {
  constructor(private resultado: any) {}

  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  or() { return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  gte() { return this; }
  lte() { return this; }
  maybeSingle() { return this; }
  single() { return this; }
  insert() { return this; }
  update() { return this; }
  upsert() { return this; }
  delete() { return this; }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resultado).then(onfulfilled, onrejected);
  }
}

/** Respuesta exitosa: `{ data, error: null }`, con extras opcionales (ej. `count`). */
export function ok(data: any = null, extra: Record<string, any> = {}): FakeQueryBuilder {
  return new FakeQueryBuilder({ data, error: null, ...extra });
}

/** Respuesta con error: `{ data: null, error }`. */
export function fail(error: any): FakeQueryBuilder {
  const mensaje = typeof error === 'string' ? { message: error } : error;
  return new FakeQueryBuilder({ data: null, error: mensaje });
}

/**
 * Reemplazo mínimo de `SupabaseClient` para pruebas. `.from(tabla)`
 * devuelve, en orden, los builders encolados para esa tabla con
 * `cuando(...)`; si se llama más veces de las configuradas, repite el
 * último (así un método bajo prueba puede leer y escribir la misma tabla
 * varias veces sin que el test tenga que prever cada llamada de más).
 *
 * Si una tabla no fue configurada, tira un error claro en vez de devolver
 * `undefined` — eso deja en evidencia de inmediato qué le faltó al test,
 * en vez de fallar más adelante con un TypeError confuso.
 */
export class MockSupabaseClient {
  private colasPorTabla = new Map<string, FakeQueryBuilder[]>();
  private colaRpc: any[] = [];

  cuando(tabla: string, ...builders: FakeQueryBuilder[]): this {
    this.colasPorTabla.set(tabla, builders.slice());
    return this;
  }

  cuandoRpc(...resultados: any[]): this {
    this.colaRpc = resultados.slice();
    return this;
  }

  from = jasmine.createSpy('from').and.callFake((tabla: string) => {
    const cola = this.colasPorTabla.get(tabla);
    if (!cola || cola.length === 0) {
      throw new Error(`MockSupabaseClient: no configuraste una respuesta para la tabla "${tabla}". Usá .cuando('${tabla}', ok(...)) antes de llamar al servicio.`);
    }
    return cola.length > 1 ? cola.shift()! : cola[0];
  });

  rpc = jasmine.createSpy('rpc').and.callFake(() => {
    const resultado = this.colaRpc.length > 1 ? this.colaRpc.shift() : this.colaRpc[0] ?? { data: null, error: null };
    return new FakeQueryBuilder(resultado);
  });

  auth = jasmine.createSpyObj('auth', [
    'getUser', 'getSession', 'signInWithPassword', 'signUp', 'signOut', 'updateUser',
  ], {
    mfa: jasmine.createSpyObj('mfa', ['listFactors', 'enroll', 'challenge', 'verify', 'unenroll', 'getAuthenticatorAssuranceLevel']),
  });

  storage = { from: jasmine.createSpy('storageFrom') };
  functions = { invoke: jasmine.createSpy('invoke') };
}

/** Perfil mínimo válido, para no repetir todos los campos en cada test. */
export function perfilDePrueba(overrides: Partial<import('../app/data/db-types').Profile> = {}): import('../app/data/db-types').Profile {
  return {
    id: 'user-1',
    full_name: 'Usuario de Prueba',
    username: 'usuario_prueba',
    avatar_url: null,
    tts_habilitado: true,
    tts_voz: null,
    es_admin: false,
    created_at: null,
    ...overrides,
  };
}

/** Fila de user_stats mínima válida, para no repetir todos los campos en cada test. */
export function statsDePrueba(overrides: Partial<import('../app/data/db-types').UserStats> = {}): import('../app/data/db-types').UserStats {
  return {
    user_id: 'user-1',
    racha_actual: 0,
    max_racha: 0,
    ultima_fecha_practica: null,
    puntos_experiencia: 0,
    vidas: 5,
    ultima_vida_perdida: null,
    racha_congeladores: 0,
    racha_evaluada_hasta: null,
    updated_at: null,
    ...overrides,
  };
}
