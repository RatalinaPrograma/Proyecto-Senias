import { SupabaseService } from './supabase';
import { MockSupabaseClient, ok, fail, perfilDePrueba } from '../../testing/supabase-mock';

/**
 * SupabaseService no tiene dependencias propias inyectadas (solo crea el
 * cliente de Supabase en su constructor), así que se instancia directo con
 * `new` y se reemplaza `.supabase` por el mock — no hace falta TestBed.
 */
function crearServicio() {
  const service = new SupabaseService();
  const db = new MockSupabaseClient();
  service.supabase = db as any;
  return { service, db };
}

describe('SupabaseService', () => {
  describe('getUsuarioLocal', () => {
    it('devuelve el usuario de la sesión guardada localmente, sin pegarle a la red', async () => {
      const { service, db } = crearServicio();
      db.auth.getSession.and.resolveTo({ data: { session: { user: { id: 'user-1' } } }, error: null });

      const { user } = await service.getUsuarioLocal();

      expect(user).toEqual({ id: 'user-1' } as any);
      expect(db.auth.getUser).not.toHaveBeenCalled();
    });

    it('devuelve null si no hay sesión guardada', async () => {
      const { service, db } = crearServicio();
      db.auth.getSession.and.resolveTo({ data: { session: null }, error: null });

      const { user } = await service.getUsuarioLocal();

      expect(user).toBeNull();
    });
  });

  describe('usernameDisponible', () => {
    it('true cuando nadie más tiene ese username', async () => {
      const { service, db } = crearServicio();
      db.cuando('profiles', ok(null));

      expect(await service.usernameDisponible('benja', 'user-1')).toBeTrue();
    });

    it('false cuando otro usuario ya tiene ese username', async () => {
      const { service, db } = crearServicio();
      db.cuando('profiles', ok({ id: 'otro-user' }));

      expect(await service.usernameDisponible('benja', 'user-1')).toBeFalse();
    });

    it('propaga el error si la consulta falla', async () => {
      const { service, db } = crearServicio();
      db.cuando('profiles', fail('conexión perdida'));

      await expectAsync(service.usernameDisponible('benja', 'user-1')).toBeRejected();
    });
  });

  describe('uploadAvatar', () => {
    it('sube el archivo con el mismo ID de usuario y devuelve la URL pública', async () => {
      const { service, db } = crearServicio();
      const storageBucket = jasmine.createSpyObj('bucket', ['upload', 'getPublicUrl']);
      storageBucket.upload.and.resolveTo({ error: null });
      storageBucket.getPublicUrl.and.returnValue({ data: { publicUrl: 'https://cdn/avatars/user-1/avatar.png' } });
      (db.storage.from as jasmine.Spy).and.returnValue(storageBucket);

      const archivo = new File(['x'], 'foto.png', { type: 'image/png' });
      const { data, error } = await service.uploadAvatar('user-1', archivo);

      expect(storageBucket.upload).toHaveBeenCalledWith('user-1/avatar.png', archivo, { upsert: true });
      expect(data).toBe('https://cdn/avatars/user-1/avatar.png');
      expect(error).toBeNull();
    });

    it('devuelve el error sin pedir la URL pública si la subida falla', async () => {
      const { service, db } = crearServicio();
      const storageBucket = jasmine.createSpyObj('bucket', ['upload', 'getPublicUrl']);
      storageBucket.upload.and.resolveTo({ error: { message: 'demasiado grande' } });
      (db.storage.from as jasmine.Spy).and.returnValue(storageBucket);

      const { data, error } = await service.uploadAvatar('user-1', new File(['x'], 'foto.png'));

      expect(data).toBeNull();
      expect(error).toEqual({ message: 'demasiado grande' } as any);
      expect(storageBucket.getPublicUrl).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('rechaza con un mensaje amigable si la contraseña actual es incorrecta', async () => {
      const { service, db } = crearServicio();
      db.auth.signInWithPassword.and.resolveTo({ error: { message: 'Invalid login credentials' } });

      const resultado = await service.changePassword('a@a.com', 'mala', 'Nueva1234');

      expect(resultado).toEqual({ error: { message: 'Tu contraseña actual no es correcta' } });
      expect(db.auth.updateUser).not.toHaveBeenCalled();
    });

    it('actualiza la contraseña si la re-autenticación es correcta', async () => {
      const { service, db } = crearServicio();
      db.auth.signInWithPassword.and.resolveTo({ error: null });
      db.auth.updateUser.and.resolveTo({ data: {}, error: null });

      await service.changePassword('a@a.com', 'buena', 'Nueva1234');

      expect(db.auth.updateUser).toHaveBeenCalledWith({ password: 'Nueva1234' });
    });
  });

  describe('requestPasswordResetCode / confirmPasswordResetCode', () => {
    it('sin error, devuelve error: null', async () => {
      const { service, db } = crearServicio();
      db.functions.invoke.and.resolveTo({ error: null });

      const { error } = await service.requestPasswordResetCode('a@a.com');

      expect(error).toBeNull();
    });

    it('lee el mensaje real del body de la Edge Function, no el genérico de invoke()', async () => {
      const { service, db } = crearServicio();
      const errorDeInvoke = { message: 'Edge Function returned a non-2xx status code', context: { json: () => Promise.resolve({ error: 'El código ya expiró' }) } };
      db.functions.invoke.and.resolveTo({ error: errorDeInvoke });

      const { error } = await service.confirmPasswordResetCode('a@a.com', '123456', 'Nueva1234');

      expect(error).toEqual({ message: 'El código ya expiró' });
    });

    it('si no puede leer el body, cae de vuelta al mensaje genérico', async () => {
      const { service, db } = crearServicio();
      const errorDeInvoke = { message: 'network error', context: { json: () => Promise.reject('no json') } };
      db.functions.invoke.and.resolveTo({ error: errorDeInvoke });

      const { error } = await service.requestPasswordResetCode('a@a.com');

      expect(error).toEqual({ message: 'network error' });
    });
  });

  describe('amigos (follows)', () => {
    it('seguir() rechaza sin sesión activa', async () => {
      const { service, db } = crearServicio();
      db.auth.getUser.and.resolveTo({ data: { user: null }, error: null });

      const resultado: any = await service.seguir('otro-user');

      expect(resultado).toEqual({ error: { message: 'No hay sesión activa' } });
    });

    it('seguir() inserta la relación con mi propio ID como follower', async () => {
      const { service, db } = crearServicio();
      db.auth.getUser.and.resolveTo({ data: { user: { id: 'user-1' } }, error: null });
      db.cuando('follows', ok(null));

      await service.seguir('otro-user');

      expect(db.from).toHaveBeenCalledWith('follows');
    });

    it('loSigo() es false si no hay sesión activa', async () => {
      const { service, db } = crearServicio();
      db.auth.getUser.and.resolveTo({ data: { user: null }, error: null });

      expect(await service.loSigo('otro-user')).toBeFalse();
    });

    it('contarSeguidores() devuelve 0 en vez de null cuando la tabla no trae count', async () => {
      const { service, db } = crearServicio();
      db.cuando('follows', ok(null, { count: null }));

      expect(await service.contarSeguidores('user-1')).toBe(0);
    });

    it('perfilesParaIds (vía listaSeguidos) rellena con un perfil mínimo a quien no tiene fila en profiles', async () => {
      const { service, db } = crearServicio();
      db.cuando('follows', ok([{ followed_id: 'sin-perfil' }]));
      db.cuando('profiles', ok([])); // nadie encontrado

      const resultado = await service.listaSeguidos('user-1');

      expect(resultado).toEqual([{
        id: 'sin-perfil', full_name: 'Usuario Signy', username: null, avatar_url: null,
        tts_habilitado: true, tts_voz: null, es_admin: false, created_at: null,
      }]);
    });

    it('listaSeguidos() devuelve [] sin consultar profiles si no sigue a nadie', async () => {
      const { service, db } = crearServicio();
      db.cuando('follows', ok([]));

      const resultado = await service.listaSeguidos('user-1');

      expect(resultado).toEqual([]);
      expect(db.from).not.toHaveBeenCalledWith('profiles');
    });
  });

  describe('buscarPersonas', () => {
    it('devuelve [] sin consultar la base si la búsqueda está vacía', async () => {
      const { service, db } = crearServicio();

      const resultado = await service.buscarPersonas('   ', 'user-1');

      expect(resultado).toEqual([]);
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe('getOCrearProfile', () => {
    it('devuelve el perfil existente sin crear uno nuevo', async () => {
      const { service, db } = crearServicio();
      const existente = perfilDePrueba({ id: 'user-1' });
      db.cuando('profiles', ok(existente));

      const perfil = await service.getOCrearProfile('user-1', 'Fallback');

      expect(perfil).toEqual(existente);
    });

    it('crea un perfil mínimo con el nombre de respaldo si todavía no existe', async () => {
      const { service, db } = crearServicio();
      db.cuando('profiles', ok(null), ok(null));

      const perfil = await service.getOCrearProfile('user-1', 'Nombre de Respaldo');

      expect(perfil.full_name).toBe('Nombre de Respaldo');
      expect(perfil.id).toBe('user-1');
    });
  });

  describe('esAdmin', () => {
    it('true solo si profiles.es_admin es true', async () => {
      const { service, db } = crearServicio();
      db.cuando('profiles', ok(perfilDePrueba({ es_admin: true })));

      expect(await service.esAdmin('user-1')).toBeTrue();
    });

    it('false si el perfil no existe todavía', async () => {
      const { service, db } = crearServicio();
      db.cuando('profiles', ok(null));

      expect(await service.esAdmin('user-1')).toBeFalse();
    });
  });

  describe('eliminarSenaMediaSiEsPropia', () => {
    it('borra el archivo si la URL apunta al bucket senas-media', async () => {
      const { service, db } = crearServicio();
      const storageBucket = jasmine.createSpyObj('bucket', ['remove']);
      storageBucket.remove.and.resolveTo({ error: null });
      (db.storage.from as jasmine.Spy).and.returnValue(storageBucket);

      await service.eliminarSenaMediaSiEsPropia('https://bjxcdhtigbsbibcltnup.supabase.co/storage/v1/object/public/senas-media/123-abc.gif');

      expect(storageBucket.remove).toHaveBeenCalledWith(['123-abc.gif']);
    });

    it('NO borra nada si la URL apunta a otro bucket u otro sitio', async () => {
      const { service, db } = crearServicio();
      const storageBucket = jasmine.createSpyObj('bucket', ['remove']);
      (db.storage.from as jasmine.Spy).and.returnValue(storageBucket);

      await service.eliminarSenaMediaSiEsPropia('https://otro-sitio.com/imagenes/foto.gif');

      expect(storageBucket.remove).not.toHaveBeenCalled();
    });

    it('no revienta si el borrado de fondo falla (limpieza no crítica)', async () => {
      const { service, db } = crearServicio();
      const storageBucket = jasmine.createSpyObj('bucket', ['remove']);
      storageBucket.remove.and.rejectWith(new Error('boom'));
      (db.storage.from as jasmine.Spy).and.returnValue(storageBucket);

      await expectAsync(
        service.eliminarSenaMediaSiEsPropia('https://x.supabase.co/storage/v1/object/public/senas-media/a.gif')
      ).toBeResolved();
    });
  });

  describe('CRUD de administración (patrón común)', () => {
    it('listarNiveles() propaga el error si la consulta falla', async () => {
      const { service, db } = crearServicio();
      db.cuando('niveles', fail('sin permisos'));

      await expectAsync(service.listarNiveles()).toBeRejected();
    });

    it('listarSubniveles() filtra por nivel solo si se pasa un nivelId', async () => {
      const { service, db } = crearServicio();
      db.cuando('subniveles', ok([{ id: 1 }]));

      const resultado = await service.listarSubniveles(3);

      expect(resultado).toEqual([{ id: 1 }] as any);
    });
  });
});
