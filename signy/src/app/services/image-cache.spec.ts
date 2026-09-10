import { TestBed } from '@angular/core/testing';
import { ImageCacheService } from './image-cache';

/** Fake mínimo de la Cache API del navegador (no pega a la red real). */
function crearFakeCache() {
  const almacen = new Map<string, Response>();
  return {
    match: jasmine.createSpy('match').and.callFake(async (url: string) => almacen.get(url)),
    add: jasmine.createSpy('add').and.callFake(async (url: string) => {
      almacen.set(url, new Response(new Blob(['contenido-falso'])));
    }),
    _almacen: almacen,
  };
}

describe('ImageCacheService', () => {
  let service: ImageCacheService;
  let fakeCache: ReturnType<typeof crearFakeCache>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ImageCacheService] });
    service = TestBed.inject(ImageCacheService);

    fakeCache = crearFakeCache();
    spyOn(window.caches, 'open').and.resolveTo(fakeCache as any);
  });

  describe('precargarSubnivel', () => {
    it('no hace nada con una lista vacía', async () => {
      await service.precargarSubnivel([]);
      expect(window.caches.open).not.toHaveBeenCalled();
    });

    it('descarga y cachea cada URL nueva, avisando el progreso', async () => {
      const progreso: Array<[number, number]> = [];

      await service.precargarSubnivel(['https://cdn/a.gif', 'https://cdn/b.gif'], (c, t) => progreso.push([c, t]));

      expect(fakeCache.add).toHaveBeenCalledTimes(2);
      expect(progreso.length).toBe(2);
      expect(progreso[progreso.length - 1]).toEqual([2, 2]);
    });

    it('no vuelve a descargar una URL que ya está en la caché de disco', async () => {
      fakeCache._almacen.set('https://cdn/ya-visto.gif', new Response(new Blob(['x'])));

      await service.precargarSubnivel(['https://cdn/ya-visto.gif']);

      expect(fakeCache.add).not.toHaveBeenCalled();
    });

    it('cuenta una URL null/vacía dentro de la lista como completada sin intentar descargarla', async () => {
      const progreso: Array<[number, number]> = [];

      await service.precargarSubnivel(['https://cdn/a.gif', null as any], (c, t) => progreso.push([c, t]));

      expect(fakeCache.add).toHaveBeenCalledTimes(1);
      expect(progreso[progreso.length - 1]).toEqual([2, 2]);
    });

    it('si una URL falla, avisa el progreso igual y no interrumpe a las demás', async () => {
      fakeCache.add.and.callFake(async (url: string) => {
        if (url === 'https://cdn/rota.gif') throw new Error('404');
        fakeCache._almacen.set(url, new Response(new Blob(['x'])));
      });
      const progreso: Array<[number, number]> = [];

      await service.precargarSubnivel(['https://cdn/rota.gif', 'https://cdn/buena.gif'], (c, t) => progreso.push([c, t]));

      expect(progreso.length).toBe(2);
    });
  });

  describe('resolve', () => {
    it('devuelve la misma URL sin tocarla si viene vacía', async () => {
      expect(await service.resolve('')).toBe('');
      expect(window.caches.open).not.toHaveBeenCalled();
    });

    it('la primera vez descarga, cachea en disco y devuelve un blob: URL', async () => {
      const resultado = await service.resolve('https://cdn/gato.gif');

      expect(fakeCache.add).toHaveBeenCalledWith('https://cdn/gato.gif');
      expect(resultado.startsWith('blob:')).toBeTrue();
    });

    it('la segunda vez responde desde memoria, sin volver a tocar la caché de disco', async () => {
      await service.resolve('https://cdn/gato.gif');
      (window.caches.open as jasmine.Spy).calls.reset();

      await service.resolve('https://cdn/gato.gif');

      expect(window.caches.open).not.toHaveBeenCalled();
    });

    it('si algo falla (ej. CORS), devuelve la URL original en vez de romper', async () => {
      (window.caches.open as jasmine.Spy).and.rejectWith(new Error('CORS'));

      const resultado = await service.resolve('https://otro-sitio.com/gato.gif');

      expect(resultado).toBe('https://otro-sitio.com/gato.gif');
    });
  });

  describe('liberarMemoriaRAM', () => {
    it('revoca los blob URLs creados y limpia la memoria', async () => {
      await service.resolve('https://cdn/gato.gif');
      spyOn(URL, 'revokeObjectURL');

      service.liberarMemoriaRAM();

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);

      // Tras liberar, resolver la misma URL de nuevo debe volver a tocar el disco.
      (window.caches.open as jasmine.Spy).calls.reset();
      await service.resolve('https://cdn/gato.gif');
      expect(window.caches.open).toHaveBeenCalled();
    });

    it('no revienta si revocar una URL falla', async () => {
      await service.resolve('https://cdn/gato.gif');
      spyOn(URL, 'revokeObjectURL').and.throwError('boom');

      expect(() => service.liberarMemoriaRAM()).not.toThrow();
    });
  });
});
