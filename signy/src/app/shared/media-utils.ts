/**
 * true si la URL/nombre de archivo apunta a un video (.mp4) en vez de una
 * imagen/GIF/WebP. Se usa en varios componentes (admin, flashcards, quiz,
 * tiles de emparejar) para decidir si renderizar <video> en vez de <img>.
 */
export function esVideoMp4(url: string | null | undefined): boolean {
  return !!url && url.split('?')[0].toLowerCase().endsWith('.mp4');
}
