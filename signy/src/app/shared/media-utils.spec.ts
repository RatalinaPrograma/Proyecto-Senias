import { esVideoMp4 } from './media-utils';

describe('esVideoMp4', () => {
  it('devuelve true para una URL que termina en .mp4', () => {
    expect(esVideoMp4('https://cdn.signy.app/senas/hola.mp4')).toBeTrue();
  });

  it('ignora mayúsculas/minúsculas en la extensión', () => {
    expect(esVideoMp4('https://cdn.signy.app/senas/HOLA.MP4')).toBeTrue();
  });

  it('ignora un query string después del .mp4', () => {
    expect(esVideoMp4('https://cdn.signy.app/senas/hola.mp4?token=abc123')).toBeTrue();
  });

  it('devuelve false para GIFs', () => {
    expect(esVideoMp4('https://cdn.signy.app/senas/hola.gif')).toBeFalse();
  });

  it('devuelve false para WebP', () => {
    expect(esVideoMp4('https://cdn.signy.app/senas/hola.webp')).toBeFalse();
  });

  it('devuelve false para null, undefined o string vacío', () => {
    expect(esVideoMp4(null)).toBeFalse();
    expect(esVideoMp4(undefined)).toBeFalse();
    expect(esVideoMp4('')).toBeFalse();
  });
});
