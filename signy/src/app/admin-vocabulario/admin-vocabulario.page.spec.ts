import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AdminVocabularioPage } from './admin-vocabulario.page';
import { SupabaseService } from '../services/supabase';
import { Nivel, Subnivel, Sena } from '../data/db-types';

describe('AdminVocabularioPage', () => {
  let component: AdminVocabularioPage;
  let fixture: ComponentFixture<AdminVocabularioPage>;
  let supabaseSpy: jasmine.SpyObj<SupabaseService>;
  let routerSpy: jasmine.SpyObj<Router>;

  const nivel1: Nivel = { id: 1, numero_nivel: 1, nombre: 'Saludos', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null };
  const nivel2: Nivel = { id: 2, numero_nivel: 2, nombre: 'Familia', descripcion: null, dificultad: null, etiqueta: null, color: null, color_oscuro: null, icono: null, created_at: null };
  const sub1: Subnivel = { id: 10, nivel_id: 1, numero_subnivel: 1, nombre: 'Básico', tipo: null, pagina_quiz_local: null, descripcion: null, created_at: null };
  const sena1: Sena = { id: 100, subnivel_id: 10, palabra: 'Hola', descripcion: null, icono: '👋', video_url: 'https://cdn/hola.gif', created_at: null } as any;

  function prepararCargaExitosa(niveles = [nivel1, nivel2], subniveles = [sub1], senas = [sena1]) {
    supabaseSpy.listarNiveles.and.resolveTo(niveles);
    supabaseSpy.listarSubniveles.and.resolveTo(subniveles);
    supabaseSpy.listarSenas.and.resolveTo(senas);
  }

  beforeEach(async () => {
    supabaseSpy = jasmine.createSpyObj('SupabaseService', [
      'listarNiveles', 'listarSubniveles', 'listarSenas',
      'crearNivel', 'actualizarNivel', 'eliminarNivel',
      'crearSubnivel', 'actualizarSubnivel', 'eliminarSubnivel',
      'crearSena', 'actualizarSena', 'eliminarSena', 'uploadSenaMedia', 'eliminarSenaMediaSiEsPropia',
    ]);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [AdminVocabularioPage],
      providers: [
        { provide: SupabaseService, useValue: supabaseSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminVocabularioPage);
    component = fixture.componentInstance;
  });

  describe('cargarTodo', () => {
    it('carga niveles, subniveles y señas, e indexa por padre', async () => {
      prepararCargaExitosa();
      await component.ngOnInit();

      expect(component.niveles.length).toBe(2);
      expect(component.subnivelesDe(1)).toEqual([sub1]);
      expect(component.senasDe(10)).toEqual([sena1]);
      expect(component.cargando).toBeFalse();
    });

    it('muestra un mensaje de error si falla la carga', async () => {
      supabaseSpy.listarNiveles.and.rejectWith(new Error('sin conexión'));
      supabaseSpy.listarSubniveles.and.resolveTo([]);
      supabaseSpy.listarSenas.and.resolveTo([]);

      await component.ngOnInit();

      expect(component.error).toBe('sin conexión');
      expect(component.cargando).toBeFalse();
    });
  });

  describe('filtrarSenas', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('sin subnivel activo, la lista filtrada queda vacía', () => {
      component.subnivelActivo = null;
      component.filtrarSenas();
      expect(component.senasFiltradas).toEqual([]);
    });

    it('con subnivel activo y sin texto de búsqueda, muestra todas las señas de ese subnivel', () => {
      component.abrirSubnivel(sub1);
      expect(component.senasFiltradas).toEqual([sena1]);
    });

    it('filtra por palabra sin importar mayúsculas/minúsculas', () => {
      component.abrirSubnivel(sub1);
      component.buscarSena = 'HOL';
      component.filtrarSenas();
      expect(component.senasFiltradas).toEqual([sena1]);

      component.buscarSena = 'perro';
      component.filtrarSenas();
      expect(component.senasFiltradas).toEqual([]);
    });
  });

  describe('navegación tipo carpetas', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('abrirNivel entra a subniveles y cierra formularios abiertos', () => {
      component.formNivelAbierto = true;
      component.abrirNivel(nivel1);
      expect(component.vista).toBe('subniveles');
      expect(component.nivelActivo).toBe(nivel1);
      expect(component.formNivelAbierto).toBeFalse();
    });

    it('abrirSubnivel entra a señas y limpia el buscador', () => {
      component.buscarSena = 'algo viejo';
      component.abrirSubnivel(sub1);
      expect(component.vista).toBe('senas');
      expect(component.buscarSena).toBe('');
    });

    it('volver() retrocede un escalón desde señas a subniveles', () => {
      component.abrirNivel(nivel1);
      component.abrirSubnivel(sub1);
      component.volver();
      expect(component.vista).toBe('subniveles');
      expect(component.subnivelActivo).toBeNull();
    });

    it('volver() retrocede un escalón desde subniveles a niveles', () => {
      component.abrirNivel(nivel1);
      component.volver();
      expect(component.vista).toBe('niveles');
      expect(component.nivelActivo).toBeNull();
    });

    it('volver() navega a /home si ya está en la raíz (niveles)', () => {
      component.volver();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('subnivelesDelNivelActivo devuelve [] si no hay nivel activo', () => {
      expect(component.subnivelesDelNivelActivo).toEqual([]);
    });
  });

  describe('CRUD de niveles', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); });

    it('abrirNuevoNivel numera automáticamente el siguiente nivel', () => {
      component.abrirNuevoNivel();
      expect(component.formNivel.numero_nivel).toBe(3); // ya hay 2 niveles
    });

    it('rechaza guardar sin nombre', async () => {
      component.formNivel = { numero_nivel: 5 };
      await component.guardarNivel();
      expect(component.errorForm).toContain('obligatorios');
      expect(supabaseSpy.crearNivel).not.toHaveBeenCalled();
    });

    it('rechaza un número de nivel duplicado', async () => {
      component.formNivel = { nombre: 'Otro', numero_nivel: 1 }; // ya existe nivel1 con numero 1
      await component.guardarNivel();
      expect(component.errorForm).toContain('Ya existe un nivel');
      expect(supabaseSpy.crearNivel).not.toHaveBeenCalled();
    });

    it('permite guardar sin duplicado al editar el mismo nivel que ya tenía ese número', async () => {
      component.editarNivel(nivel1, new Event('click'));
      component.formNivel.nombre = 'Saludos editado';
      supabaseSpy.actualizarNivel.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa(); // para el recargarTodo() posterior

      await component.guardarNivel();

      expect(supabaseSpy.actualizarNivel).toHaveBeenCalled();
      expect(supabaseSpy.crearNivel).not.toHaveBeenCalled();
    });

    it('crea un nivel nuevo con los defaults normalizados', async () => {
      component.abrirNuevoNivel();
      component.formNivel.nombre = '  Colores  ';
      supabaseSpy.crearNivel.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.guardarNivel();

      expect(supabaseSpy.crearNivel).toHaveBeenCalledWith(jasmine.objectContaining({ nombre: 'Colores' }));
      expect(component.formNivelAbierto).toBeFalse(); // se cierra el formulario
    });

    it('muestra el error del servidor si falla el guardado', async () => {
      component.abrirNuevoNivel();
      component.formNivel.nombre = 'Colores';
      supabaseSpy.crearNivel.and.resolveTo({ data: null, error: { message: 'sin permisos' } } as any);

      await component.guardarNivel();

      expect(component.errorForm).toBe('sin permisos');
    });

    it('eliminarNivel avisa y NO borra si el nivel tiene subniveles adentro', async () => {
      spyOn(window, 'alert');
      await component.eliminarNivel(nivel1, new Event('click')); // nivel1 tiene sub1 adentro
      expect(window.alert).toHaveBeenCalled();
      expect(supabaseSpy.eliminarNivel).not.toHaveBeenCalled();
    });

    it('eliminarNivel no hace nada si el admin cancela la confirmación', async () => {
      spyOn(window, 'confirm').and.returnValue(false);
      await component.eliminarNivel(nivel2, new Event('click')); // nivel2 no tiene subniveles
      expect(supabaseSpy.eliminarNivel).not.toHaveBeenCalled();
    });

    it('eliminarNivel borra y recarga si se confirma', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      supabaseSpy.eliminarNivel.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.eliminarNivel(nivel2, new Event('click'));

      expect(supabaseSpy.eliminarNivel).toHaveBeenCalledWith(2);
    });
  });

  describe('CRUD de subniveles', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); component.abrirNivel(nivel1); });

    it('abrirNuevoSubnivel numera automáticamente dentro del nivel activo', () => {
      component.abrirNuevoSubnivel();
      expect(component.formSubnivel.numero_subnivel).toBe(2); // ya hay 1 subnivel en nivel1
      expect(component.formSubnivel.nivel_id).toBe(1);
    });

    it('rechaza un número de subnivel duplicado DENTRO DEL MISMO NIVEL', async () => {
      component.formSubnivel = { nombre: 'Otro', nivel_id: 1, numero_subnivel: 1 };
      await component.guardarSubnivel();
      expect(component.errorForm).toContain('Ya existe un subnivel');
    });

    it('permite el mismo número de subnivel en OTRO nivel distinto', async () => {
      component.formSubnivel = { nombre: 'Otro', nivel_id: 2, numero_subnivel: 1 }; // nivel2, no nivel1
      supabaseSpy.crearSubnivel.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.guardarSubnivel();

      expect(component.errorForm).toBeNull();
      expect(supabaseSpy.crearSubnivel).toHaveBeenCalled();
    });

    it('eliminarSubnivel avisa y NO borra si tiene señas adentro', async () => {
      spyOn(window, 'alert');
      await component.eliminarSubnivel(sub1, new Event('click'));
      expect(window.alert).toHaveBeenCalled();
      expect(supabaseSpy.eliminarSubnivel).not.toHaveBeenCalled();
    });
  });

  describe('CRUD de señas', () => {
    beforeEach(async () => { prepararCargaExitosa(); await component.ngOnInit(); component.abrirNivel(nivel1); component.abrirSubnivel(sub1); });

    function archivo(tipo: string, tamanoBytes: number): File {
      const blob = new Blob([new Uint8Array(tamanoBytes)], { type: tipo });
      return new File([blob], 'archivo', { type: tipo });
    }

    function eventoConArchivo(file: File | null): any {
      const input = { files: file ? [file] : [], value: 'C:\\fakepath\\archivo' };
      return { target: input };
    }

    it('onArchivoSeleccionado rechaza un tipo de archivo no permitido', () => {
      const evento = eventoConArchivo(archivo('application/pdf', 100));
      component.onArchivoSeleccionado(evento);
      expect(component.errorForm).toContain('no está permitido');
      expect(component.archivoSeleccionado).toBeNull();
      expect(evento.target.value).toBe('');
    });

    it('onArchivoSeleccionado rechaza un archivo de más de 20MB', () => {
      const evento = eventoConArchivo(archivo('image/gif', 21 * 1024 * 1024));
      component.onArchivoSeleccionado(evento);
      expect(component.errorForm).toContain('20 MB');
    });

    it('onArchivoSeleccionado acepta un GIF dentro del límite', () => {
      const f = archivo('image/gif', 1024);
      component.onArchivoSeleccionado(eventoConArchivo(f));
      expect(component.archivoSeleccionado).toBe(f);
      expect(component.errorForm).toBeNull();
    });

    it('rechaza guardar sin palabra', async () => {
      component.formSena = { subnivel_id: 10 };
      await component.guardarSena();
      expect(component.errorForm).toContain('obligatoria');
    });

    it('en modo "subir" exige un archivo si no hay video_url ya cargado', async () => {
      component.formSena = { subnivel_id: 10, palabra: 'Chao' };
      component.modoMedia = 'subir';
      component.archivoSeleccionado = null;

      await component.guardarSena();

      expect(component.errorForm).toContain('Selecciona un archivo');
    });

    it('rechaza una palabra duplicada DENTRO DEL MISMO SUBNIVEL (sin importar mayúsculas)', async () => {
      component.formSena = { subnivel_id: 10, palabra: 'hola' }; // sena1 ya es "Hola" en sub 10
      await component.guardarSena();
      expect(component.errorForm).toContain('ya existe');
      expect(supabaseSpy.crearSena).not.toHaveBeenCalled();
    });

    it('sube el archivo primero cuando modoMedia="subir", y usa esa URL al guardar', async () => {
      component.formSena = { subnivel_id: 10, palabra: 'Chao' };
      component.modoMedia = 'subir';
      component.archivoSeleccionado = archivo('image/gif', 100);
      supabaseSpy.uploadSenaMedia.and.resolveTo({ data: 'https://cdn/chao.gif', error: null });
      supabaseSpy.crearSena.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.guardarSena();

      expect(supabaseSpy.uploadSenaMedia).toHaveBeenCalled();
      expect(supabaseSpy.crearSena).toHaveBeenCalledWith(jasmine.objectContaining({ video_url: 'https://cdn/chao.gif' }));
    });

    it('borra el media anterior si al editar se cambió la URL', async () => {
      component.editarSena(sena1); // video_url original: https://cdn/hola.gif
      component.formSena.video_url = 'https://cdn/hola-nueva.gif';
      supabaseSpy.actualizarSena.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.guardarSena();

      expect(supabaseSpy.eliminarSenaMediaSiEsPropia).toHaveBeenCalledWith('https://cdn/hola.gif');
    });

    it('NO borra el media anterior si la URL no cambió', async () => {
      component.editarSena(sena1);
      // formSena.video_url queda igual (no se modifica)
      supabaseSpy.actualizarSena.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.guardarSena();

      expect(supabaseSpy.eliminarSenaMediaSiEsPropia).not.toHaveBeenCalled();
    });

    it('eliminarSena no hace nada si se cancela la confirmación', async () => {
      spyOn(window, 'confirm').and.returnValue(false);
      await component.eliminarSena(sena1);
      expect(supabaseSpy.eliminarSena).not.toHaveBeenCalled();
    });

    it('eliminarSena borra la fila y limpia el archivo asociado', async () => {
      spyOn(window, 'confirm').and.returnValue(true);
      supabaseSpy.eliminarSena.and.resolveTo({ data: null, error: null } as any);
      prepararCargaExitosa();

      await component.eliminarSena(sena1);

      expect(supabaseSpy.eliminarSena).toHaveBeenCalledWith(100);
      expect(supabaseSpy.eliminarSenaMediaSiEsPropia).toHaveBeenCalledWith('https://cdn/hola.gif');
    });

    it('elegirIcono asigna el emoji al formulario', () => {
      component.elegirIcono('🐶');
      expect(component.formSena.icono).toBe('🐶');
    });
  });
});
