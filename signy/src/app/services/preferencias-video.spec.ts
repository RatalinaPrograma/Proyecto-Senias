import { PreferenciasVideoService } from './preferencias-video';
import { PreferencesAdapter } from './capacitor-plugins';

describe('PreferenciasVideoService', () => {
  let almacen: Map<string, string>;
  let prefs: jasmine.SpyObj<PreferencesAdapter>;

  beforeEach(() => {
    almacen = new Map();
    prefs = jasmine.createSpyObj('PreferencesAdapter', ['get', 'set']);
    prefs.get.and.callFake(async ({ key }) => ({ value: almacen.get(key) ?? null }));
    prefs.set.and.callFake(async ({ key, value }) => { almacen.set(key, value); });
  });

  it('por defecto anima todas las señas a la vez', async () => {
    expect(await new PreferenciasVideoService(prefs).animarTodas()).toBeTrue();
  });

  it('recuerda la elección en el dispositivo', async () => {
    await new PreferenciasVideoService(prefs).setAnimarTodas(false);
    expect(await new PreferenciasVideoService(prefs).animarTodas()).toBeFalse();
  });

  it('si el almacenamiento falla, usa el comportamiento por defecto', async () => {
    prefs.get.and.rejectWith(new Error('sin almacenamiento'));
    expect(await new PreferenciasVideoService(prefs).animarTodas()).toBeTrue();
  });
});
