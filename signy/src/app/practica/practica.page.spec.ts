// PracticaPage NO se prueba todavía: llama a 6 métodos que no existen en
// SupabaseService (getCurrentUser, obtenerSenasDeSubnivel, obtenerDistractores,
// registrarIntento, registrarFallo, marcarSubnivelCompletado — esos últimos
// tres sí existen, pero en ContenidoService, que esta página ni siquiera
// inyecta). Ahora mismo la página no está en app.routes.ts, así que es
// código muerto que no compila. Importar la clase acá rompía la compilación
// de TODO el suite de tests, no solo la de esta página.
//
// Pendiente: decidir si se borra el archivo o se arregla apuntando a
// ContenidoService (ver LEEME de esta entrega). Cuando se resuelva, esta
// spec se reemplaza por una real.
xdescribe('PracticaPage (en cuarentena — ver comentario arriba)', () => {
  it('pendiente de reactivar', () => {
    expect(true).toBeTrue();
  });
});
