import { Component, ViewChild, ElementRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CachedSrcDirective } from './cached-src.directive';
import { ImageCacheService } from '../services/image-cache';

@Component({
  standalone: true,
  imports: [CachedSrcDirective],
  template: `<img #img [appCachedSrc]="url" />`,
})
class HostDeImagen {
  url: string | null | undefined = 'https://cdn.signy.app/gato.gif';
  @ViewChild('img') img!: ElementRef<HTMLImageElement>;
}

describe('CachedSrcDirective', () => {
  let fixture: ComponentFixture<HostDeImagen>;
  let cacheSpy: jasmine.SpyObj<ImageCacheService>;

  beforeEach(async () => {
    cacheSpy = jasmine.createSpyObj('ImageCacheService', ['resolve', 'getSincrono']);
    cacheSpy.resolve.and.callFake((url: string) => Promise.resolve(`blob:cached/${url}`));
    cacheSpy.getSincrono.and.returnValue(null);

    await TestBed.configureTestingModule({
      imports: [HostDeImagen],
      providers: [{ provide: ImageCacheService, useValue: cacheSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostDeImagen);
  });

  it('resuelve la URL original a través de ImageCacheService y la aplica al elemento', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cacheSpy.resolve).toHaveBeenCalledWith('https://cdn.signy.app/gato.gif');
    expect(fixture.componentInstance.img.nativeElement.src).toContain('blob:cached/https://cdn.signy.app/gato.gif');
  });

  it('no llama a resolve si la URL es null o vacía', async () => {
    fixture.componentInstance.url = null;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cacheSpy.resolve).not.toHaveBeenCalled();
  });

  it('vuelve a resolver cuando la URL cambia', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    cacheSpy.resolve.calls.reset();

    fixture.componentInstance.url = 'https://cdn.signy.app/perro.gif';
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cacheSpy.resolve).toHaveBeenCalledWith('https://cdn.signy.app/perro.gif');
  });

  it('usa la URL ya precargada en memoria sin esperar a resolve', async () => {
    cacheSpy.getSincrono.and.returnValue('blob:precargado');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cacheSpy.resolve).not.toHaveBeenCalled();
    expect(fixture.componentInstance.img.nativeElement.src).toContain('blob:precargado');
  });

  it('si la URL cambia mientras la anterior se resolvía, gana la última (no se ve la seña anterior)', async () => {
    let soltarLenta!: (v: string) => void;
    cacheSpy.resolve.and.callFake((url: string) =>
      url.includes('gato') ? new Promise<string>((r) => (soltarLenta = r)) : Promise.resolve(`blob:cached/${url}`));
    fixture.detectChanges(); // empieza a resolver gato (lenta)
    fixture.componentInstance.url = 'https://cdn.signy.app/perro.gif';
    fixture.detectChanges();
    await fixture.whenStable();
    soltarLenta('blob:cached/gato-tardio');
    await fixture.whenStable();

    expect(fixture.componentInstance.img.nativeElement.src).toContain('blob:cached/https://cdn.signy.app/perro.gif');
  });
});
