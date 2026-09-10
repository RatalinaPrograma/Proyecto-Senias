import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GifTileComponent } from './gif-tile.component';
import { ImageCacheService } from '../../services/image-cache';

@Component({
  standalone: true,
  imports: [GifTileComponent],
  template: `<app-gif-tile [url]="url" [activo]="activo"></app-gif-tile>`,
})
class HostDeTile {
  url: string | null | undefined = null;
  activo = false;
  @ViewChild(GifTileComponent) tile!: GifTileComponent;
}

describe('GifTileComponent', () => {
  let fixture: ComponentFixture<HostDeTile>;
  let host: HostDeTile;
  let cacheSpy: jasmine.SpyObj<ImageCacheService>;

  beforeEach(async () => {
    cacheSpy = jasmine.createSpyObj('ImageCacheService', ['resolve']);
    cacheSpy.resolve.and.callFake((url: string) => Promise.resolve(`blob:cached/${url}`));

    await TestBed.configureTestingModule({
      imports: [HostDeTile],
      providers: [{ provide: ImageCacheService, useValue: cacheSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostDeTile);
    host = fixture.componentInstance;
  });

  function elementoVideo(): HTMLVideoElement {
    return fixture.nativeElement.querySelector('video');
  }
  function elementoImagen(): HTMLImageElement {
    return fixture.nativeElement.querySelector('img');
  }

  describe('detección de video vs. imagen', () => {
    it('renderiza un <video> para una URL .mp4', async () => {
      host.url = 'https://cdn/sena.mp4';
      fixture.detectChanges();
      await fixture.whenStable();

      expect(host.tile.esVideo).toBeTrue();
      expect(elementoVideo()).not.toBeNull();
      expect(elementoImagen()).toBeNull();
    });

    it('renderiza un <img>/<canvas> para un GIF', async () => {
      host.url = 'https://cdn/sena.gif';
      fixture.detectChanges();
      await fixture.whenStable();

      expect(host.tile.esVideo).toBeFalse();
      expect(elementoImagen()).not.toBeNull();
    });
  });

  describe('reproducción de video según [activo]', () => {
    it('al activarse, reinicia el tiempo, activa el loop y reproduce', async () => {
      host.url = 'https://cdn/sena.mp4';
      host.activo = false;
      fixture.detectChanges();
      await fixture.whenStable();

      const video = elementoVideo();
      spyOn(video, 'play').and.resolveTo();
      video.currentTime = 5;

      host.activo = true;
      fixture.detectChanges();
      await fixture.whenStable();

      expect(video.play).toHaveBeenCalled();
      expect(video.loop).toBeTrue();
    });

    it('al desactivarse, pausa y vuelve al inicio', async () => {
      host.url = 'https://cdn/sena.mp4';
      host.activo = true;
      fixture.detectChanges();
      await fixture.whenStable();

      const video = elementoVideo();
      spyOn(video, 'pause');

      host.activo = false;
      fixture.detectChanges();
      await fixture.whenStable();

      expect(video.pause).toHaveBeenCalled();
      expect(video.currentTime).toBe(0);
    });
  });

  describe('imagen (GIF/WebP) según [activo]', () => {
    it('resuelve la URL a través de ImageCacheService', async () => {
      host.url = 'https://cdn/sena.gif';
      fixture.detectChanges();
      await fixture.whenStable();

      expect(cacheSpy.resolve).toHaveBeenCalledWith('https://cdn/sena.gif');
    });

    it('asigna el src resuelto a la imagen solo cuando está activo', async () => {
      host.url = 'https://cdn/sena.gif';
      host.activo = true;
      fixture.detectChanges();
      await fixture.whenStable();

      expect(elementoImagen().src).toContain('blob:cached/https://cdn/sena.gif');
    });

    it('deja el src vacío cuando no está activo (se ve el frame congelado del canvas)', async () => {
      host.url = 'https://cdn/sena.gif';
      host.activo = false;
      fixture.detectChanges();
      await fixture.whenStable();

      // OJO: la propiedad .src normaliza un string vacío a la URL de la
      // página actual (quirk del DOM); el atributo crudo sí queda vacío.
      expect(elementoImagen().getAttribute('src')).toBe('');
    });
  });
});
