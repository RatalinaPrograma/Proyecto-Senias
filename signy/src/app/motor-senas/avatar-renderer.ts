/**
 * Motor de Avatar 2D Chibi / Plano (Waist-Up 2D Character Rig) para Signy.
 *
 * Utiliza los 21 landmarks de MediaPipe Hands con cinemática estabilizada por
 * vector gravitacional (sin singularidades ni flips de codo) para animar
 * personajes 2D estéticos desde la cintura hacia arriba:
 *  - 'zorro': Mascota oficial Zorrito Signy con proporciones Chibi / Kawaii
 *             fieles al arte de `assets/img/` (cabeza grande redondeada, mejillas
 *             esponjosas sin líneas duras internas, ojos grandes expresivos con
 *             brillo y rubor, pañuelo azul de explorador y patitas redondeadas).
 *  - 'persona': Persona minimalista sin cara (estilo ilustración plana moderna).
 *  - 'cyber': Entrenador de alto contraste sin cara (chaqueta oscura y manos claras).
 *  - 'huesos': Maniquí técnico con visualización del rig cinemático.
 */
import { CONEXIONES_MANO } from './dibujo';

export type TemaAvatar = 'zorro' | 'persona' | 'cyber' | 'huesos';

export interface ConfiguracionAvatar {
  tema: TemaAvatar;
  /** Factor de escala de las manos y brazos (0.7 a 1.5). */
  grosorHueso: number;
  /** En el tema Zorro, permite alternar entre rostro kawaii completo o versión sin cara. */
  mostrarMallaPalma: boolean;
  /** Muestra accesorios del personaje (pañuelo azul de explorador y correas / cuello). */
  mostrarAntebrazo: boolean;
  /** Muestra resplandor ambiental detrás del personaje. */
  mostrarAura: boolean;
  /** Superpone el rig de huesos guía para depuración técnica. */
  mostrarEsqueletoGuia?: boolean;
  /** Suavizado temporal Lerp (0 = directo, 0.7 = ultra suave). */
  suavizado: number;
}

export const CONFIG_AVATAR_PREDETERMINADA: ConfiguracionAvatar = {
  tema: 'zorro',
  grosorHueso: 1.0,
  mostrarMallaPalma: true,
  mostrarAntebrazo: true,
  mostrarAura: true,
  mostrarEsqueletoGuia: false,
  suavizado: 0.35,
};

interface Punto2D {
  x: number;
  y: number;
}

interface Punto3D {
  x: number;
  y: number;
  z?: number;
}

interface EstadoBrazo {
  puntosMano: Punto2D[];
  codo: Punto2D;
  activo: boolean;
}

export class RenderizadorAvatar2D {
  private config: ConfiguracionAvatar = { ...CONFIG_AVATAR_PREDETERMINADA };
  private brazoIzqSuavizado: Punto2D[] | null = null;
  private brazoDerSuavizado: Punto2D[] | null = null;
  private codoIzqSuavizado: Punto2D | null = null;
  private codoDerSuavizado: Punto2D | null = null;
  private escalaManoRefSuavizada = 0.16;
  private ultimoLadoUnicaMano: -1 | 1 = 1;

  constructor(configuracionInicial?: Partial<ConfiguracionAvatar>) {
    if (configuracionInicial) {
      this.config = { ...this.config, ...configuracionInicial };
    }
  }

  actualizarConfig(nueva: Partial<ConfiguracionAvatar>): void {
    this.config = { ...this.config, ...nueva };
  }

  obtenerConfig(): ConfiguracionAvatar {
    return { ...this.config };
  }

  reiniciar(): void {
    this.brazoIzqSuavizado = null;
    this.brazoDerSuavizado = null;
    this.codoIzqSuavizado = null;
    this.codoDerSuavizado = null;
    this.escalaManoRefSuavizada = 0.16;
  }

  /**
   * Renderiza el personaje Chibi / Plano de cintura hacia arriba animado por `manos`.
   */
  renderizar(
    ctx: CanvasRenderingContext2D,
    ancho: number,
    alto: number,
    manos: Punto3D[][]
  ): void {
    const ahora = performance.now();
    const escalaBase = Math.min(ancho, alto);
    const cx = ancho * 0.5;
    const esZorro = this.config.tema === 'zorro';

    // 1. Respiración suave en reposo (idle bounce)
    const faseResp = Math.sin(ahora * 0.003);
    const offsetRespY = faseResp * (escalaBase * 0.005);

    // Proporciones Chibi para el Zorrito (cabeza grande adorable, torso compacto y tierno)
    const cinturaY = alto * 0.96;
    const hombroY = (esZorro ? alto * 0.54 : alto * 0.50) + offsetRespY;
    const hombroSepX = escalaBase * (esZorro ? 0.125 : 0.165);
    const cabezaRadio = escalaBase * (esZorro ? 0.22 : 0.15);
    // Cabeza pegada directamente al cuerpo/hombros (sin cuello visible en modo Chibi zorro)
    const cabezaCentroY = esZorro
      ? hombroY + escalaBase * 0.015 - cabezaRadio * 0.76
      : hombroY - cabezaRadio * 0.90;

    // 2. Asignar las manos detectadas a los brazos izquierdo (-1) y derecho (+1)
    const { manoIzqRaw, manoDerRaw } = this.asignarManosABrazos(manos);

    // Inclinación tierna de la cabeza
    let inclinacionCabeza = Math.sin(ahora * 0.0016) * 0.028;
    if (manoIzqRaw && !manoDerRaw) inclinacionCabeza = -0.045;
    else if (manoDerRaw && !manoIzqRaw) inclinacionCabeza = 0.045;

    this.actualizarEscalaReferencia(manoIzqRaw, manoDerRaw);

    // 3. Mapear manos a espacio de personaje (o pose de descanso junto a la cintura)
    const targetIzq = manoIzqRaw
      ? this.mapearManoAPersonaje(manoIzqRaw, cx, alto, escalaBase, hombroY)
      : this.generarManoEnReposo(-1, cx, alto, escalaBase, offsetRespY);

    const targetDer = manoDerRaw
      ? this.mapearManoAPersonaje(manoDerRaw, cx, alto, escalaBase, hombroY)
      : this.generarManoEnReposo(1, cx, alto, escalaBase, offsetRespY);

    // 4. Suavizado temporal (Lerp)
    const alpha = 1 - Math.max(0, Math.min(0.85, this.config.suavizado));
    this.brazoIzqSuavizado = this.interpolarPuntos(this.brazoIzqSuavizado, targetIzq, alpha);
    this.brazoDerSuavizado = this.interpolarPuntos(this.brazoDerSuavizado, targetDer, alpha);

    // Hombros con ligero acompañamiento suave pero anclados al cuerpo
    const hombroIzq: Punto2D = {
      x: cx - hombroSepX,
      y: hombroY + Math.max(-escalaBase * 0.02, Math.min(escalaBase * 0.015, (this.brazoIzqSuavizado[0].y - hombroY) * 0.08)),
    };
    const hombroDer: Punto2D = {
      x: cx + hombroSepX,
      y: hombroY + Math.max(-escalaBase * 0.02, Math.min(escalaBase * 0.015, (this.brazoDerSuavizado[0].y - hombroY) * 0.08)),
    };

    // 5. Cálculo de Codo 100% Estable por Polo Gravitacional (jamás hace flip ni tiembla)
    const codoTargetIzq = this.calcularCodoEstable(hombroIzq, this.brazoIzqSuavizado[0], escalaBase, -1);
    const codoTargetDer = this.calcularCodoEstable(hombroDer, this.brazoDerSuavizado[0], escalaBase, 1);

    this.codoIzqSuavizado = this.interpolarPuntoUnico(this.codoIzqSuavizado, codoTargetIzq, alpha * 0.85);
    this.codoDerSuavizado = this.interpolarPuntoUnico(this.codoDerSuavizado, codoTargetDer, alpha * 0.85);

    const estadoIzq: EstadoBrazo = {
      puntosMano: this.brazoIzqSuavizado,
      codo: this.codoIzqSuavizado,
      activo: !!manoIzqRaw,
    };
    const estadoDer: EstadoBrazo = {
      puntosMano: this.brazoDerSuavizado,
      codo: this.codoDerSuavizado,
      activo: !!manoDerRaw,
    };

    ctx.save();

    // A. Aura ambiental de fondo
    if (this.config.mostrarAura) {
      this.dibujarAuraFondo(ctx, cx, hombroY - escalaBase * 0.06, escalaBase);
    }

    // B. Cola esponjosa del Zorrito Signy (detrás del cuerpo)
    if (esZorro) {
      this.dibujarColaZorroChibi(ctx, cx, cinturaY, escalaBase, ahora);
    }

    // C. Torso Chibi / Plano (cintura a hombros)
    this.dibujarTorsoPersonaje(ctx, cx, cinturaY, hombroY, hombroIzq, hombroDer, escalaBase);

    // D. Brazos en reposo van detrás de la cabeza grande Chibi; brazos activos van al frente
    const ordenBrazos = [
      { lado: -1 as const, hombro: hombroIzq, estado: estadoIzq },
      { lado: 1 as const, hombro: hombroDer, estado: estadoDer },
    ];

    for (const item of ordenBrazos.filter((b) => !b.estado.activo)) {
      this.dibujarBrazoYManoPlana(ctx, item.hombro, item.estado.codo, item.estado.puntosMano, item.lado, escalaBase);
    }

    // E. Pañuelo de explorador / cuello (sobre los hombros, debajo del mentón)
    if (this.config.mostrarAntebrazo) {
      this.dibujarAccesoriosCuello(ctx, cx, hombroY, escalaBase);
    }

    // F. Cabeza Chibi del Zorrito o Persona Sin Cara
    this.dibujarCabezaPersonaje(ctx, cx, cabezaCentroY, cabezaRadio, hombroY, inclinacionCabeza, ahora);

    // G. Brazos activos señando al frente
    for (const item of ordenBrazos.filter((b) => b.estado.activo)) {
      this.dibujarBrazoYManoPlana(ctx, item.hombro, item.estado.codo, item.estado.puntosMano, item.lado, escalaBase);
    }

    // H. Esqueleto guía opcional (solo si se activa para depuración)
    if (this.config.mostrarEsqueletoGuia || this.config.tema === 'huesos') {
      this.dibujarRigGuia(ctx, cx, cinturaY, hombroY, cabezaCentroY, hombroIzq, hombroDer, estadoIzq, estadoDer);
    }

    ctx.restore();
  }

  // ============================================================================
  // 1. CINEMÁTICA ESTABLE SIN SALTOS DE CODO
  // ============================================================================

  private asignarManosABrazos(manos: Punto3D[][]): { manoIzqRaw: Punto3D[] | null; manoDerRaw: Punto3D[] | null } {
    const validas = (manos || []).filter((m) => Array.isArray(m) && m.length >= 21);
    if (validas.length === 0) {
      return { manoIzqRaw: null, manoDerRaw: null };
    }

    if (validas.length === 1) {
      const m = validas[0];
      const xCentro = m[9].x;
      if (xCentro < 0.40) this.ultimoLadoUnicaMano = -1;
      else if (xCentro > 0.60) this.ultimoLadoUnicaMano = 1;

      return this.ultimoLadoUnicaMano === -1
        ? { manoIzqRaw: m, manoDerRaw: null }
        : { manoIzqRaw: null, manoDerRaw: m };
    }

    const ordenadas = [...validas].sort((a, b) => a[9].x - b[9].x);
    return {
      manoIzqRaw: ordenadas[0],
      manoDerRaw: ordenadas[1],
    };
  }

  private actualizarEscalaReferencia(manoIzq: Punto3D[] | null, manoDer: Punto3D[] | null): void {
    const mediciones: number[] = [];
    for (const m of [manoIzq, manoDer]) {
      if (!m) continue;
      const dPalma = Math.hypot(m[9].x - m[0].x, m[9].y - m[0].y, (m[9].z ?? 0) - (m[0].z ?? 0));
      const dAncho = Math.hypot(m[17].x - m[5].x, m[17].y - m[5].y) * 1.25;
      const ref = Math.max(dPalma, dAncho);
      if (ref > 0.04 && ref < 0.65) mediciones.push(ref);
    }
    if (mediciones.length > 0) {
      const promedio = mediciones.reduce((a, b) => a + b, 0) / mediciones.length;
      this.escalaManoRefSuavizada = this.escalaManoRefSuavizada * 0.88 + promedio * 0.12;
    }
  }

  private mapearManoAPersonaje(
    mano: Punto3D[],
    cx: number,
    alto: number,
    escalaBase: number,
    hombroY: number
  ): Punto2D[] {
    const esZorro = this.config.tema === 'zorro';
    const tamanoPalmaObjetivo = escalaBase * (esZorro ? 0.105 : 0.112) * this.config.grosorHueso;
    const factorEscala = tamanoPalmaObjetivo / Math.max(0.08, this.escalaManoRefSuavizada);

    // Zona de señado frente al pecho/abdomen para que no tape la carita Chibi
    const anclaRaw = mano[9];
    const centroSignoY = esZorro ? alto * 0.63 : alto * 0.54;
    const anclaX = cx + (anclaRaw.x - 0.5) * (escalaBase * 0.72);
    const anclaY = Math.max(alto * 0.24, Math.min(alto * 0.86, centroSignoY + (anclaRaw.y - 0.54) * (alto * 0.52)));

    // En modo Chibi acortamos ligeramente los dedos (0.86) para que se vean tiernos y redondeados
    const factorDedo = esZorro ? 0.86 : 0.95;

    // Primero calculamos la muñeca y el centro de la palma
    const munecaPx: Punto2D = {
      x: anclaX + (mano[0].x - anclaRaw.x) * factorEscala,
      y: anclaY + (mano[0].y - anclaRaw.y) * factorEscala,
    };

    // Limitar la distancia máxima desde el hombro para que el brazo nunca se estire de forma irreal
    const maxAlcanceHombro = escalaBase * 0.40;
    const distCentro = Math.hypot(munecaPx.x - cx, munecaPx.y - hombroY);
    let ajusteX = 0;
    let ajusteY = 0;
    if (distCentro > maxAlcanceHombro) {
      const f = maxAlcanceHombro / distCentro;
      const nuevaMunecaX = cx + (munecaPx.x - cx) * f;
      const nuevaMunecaY = hombroY + (munecaPx.y - hombroY) * f;
      ajusteX = nuevaMunecaX - munecaPx.x;
      ajusteY = nuevaMunecaY - munecaPx.y;
    }

    return mano.map((p, idx) => {
      const esc = idx <= 0 ? factorEscala : factorEscala * factorDedo;
      return {
        x: anclaX + (p.x - anclaRaw.x) * esc + ajusteX,
        y: anclaY + (p.y - anclaRaw.y) * esc + ajusteY,
      };
    });
  }

  private generarManoEnReposo(
    lado: -1 | 1,
    cx: number,
    alto: number,
    escalaBase: number,
    offsetRespY: number
  ): Punto2D[] {
    const esZorro = this.config.tema === 'zorro';
    const munecaX = cx + lado * (escalaBase * (esZorro ? 0.19 : 0.23));
    const munecaY = alto * (esZorro ? 0.80 : 0.79) + offsetRespY * 0.8;
    const r = escalaBase * 0.075 * this.config.grosorHueso;

    const dirX = -lado * 0.15;
    const dirY = 0.98;
    const perpX = -lado * 0.95;
    const perpY = -0.15;

    const pt = (along: number, spread: number): Punto2D => ({
      x: munecaX + (dirX * along + perpX * spread) * r,
      y: munecaY + (dirY * along + perpY * spread) * r,
    });

    return [
      pt(0, 0),
      pt(0.24, -0.32), pt(0.48, -0.44), pt(0.68, -0.40), pt(0.82, -0.34),
      pt(0.60, -0.20), pt(0.86, -0.18), pt(1.02, -0.14), pt(1.12, -0.10),
      pt(0.62, -0.04), pt(0.90, -0.03), pt(1.08, -0.01), pt(1.16, 0.02),
      pt(0.58, 0.12),  pt(0.84, 0.12),  pt(1.00, 0.13),  pt(1.08, 0.14),
      pt(0.50, 0.26),  pt(0.74, 0.25),  pt(0.88, 0.24),  pt(0.95, 0.23),
    ];
  }

  private interpolarPuntos(prev: Punto2D[] | null, target: Punto2D[], alpha: number): Punto2D[] {
    if (!prev || prev.length !== target.length || alpha >= 0.99) {
      return target.map((p) => ({ x: p.x, y: p.y }));
    }
    return target.map((t, i) => ({
      x: prev[i].x + (t.x - prev[i].x) * alpha,
      y: prev[i].y + (t.y - prev[i].y) * alpha,
    }));
  }

  private interpolarPuntoUnico(prev: Punto2D | null, target: Punto2D, alpha: number): Punto2D {
    if (!prev || alpha >= 0.99) return { x: target.x, y: target.y };
    return {
      x: prev.x + (target.x - prev.x) * alpha,
      y: prev.y + (target.y - prev.y) * alpha,
    };
  }

  /**
   * Calcula la posición del codo usando un atractor de Polo Gravitacional fijo
   * (hacia abajo y hacia afuera del cuerpo). A diferencia del IK trigonométrico
   * con dos raíces, esta función es 100% continua y jamás salta ni rota en falso.
   */
  private calcularCodoEstable(
    hombro: Punto2D,
    muneca: Punto2D,
    escalaBase: number,
    lado: -1 | 1
  ): Punto2D {
    const midX = (hombro.x + muneca.x) * 0.5;
    const midY = (hombro.y + muneca.y) * 0.5;

    const dx = muneca.x - hombro.x;
    const dy = muneca.y - hombro.y;
    const dist = Math.hypot(dx, dy);

    // Longitud característica de medio brazo
    const largoMedio = escalaBase * 0.19;
    const ratio = Math.min(1, dist / (largoMedio * 2));
    // Cuanto más cerca está la mano del hombro, más se flexiona el codo hacia abajo y afuera
    const flexion = largoMedio * (0.35 + (1 - ratio * ratio) * 0.55);

    // Dirección de polo anatómico constante: afuera (lado) y abajo (+Y por gravedad)
    const poleDirX = lado * 0.58;
    const poleDirY = 0.81;

    return {
      x: midX + poleDirX * flexion,
      y: Math.max(hombro.y + escalaBase * 0.04, midY + poleDirY * flexion),
    };
  }

  // ============================================================================
  // 2. DIBUJO DEL CUERPO Y CABEZA CHIBI (ZORRITO SIGNY Y PERSONA SIN CARA)
  // ============================================================================

  private dibujarAuraFondo(ctx: CanvasRenderingContext2D, cx: number, cy: number, escalaBase: number): void {
    const grad = ctx.createRadialGradient(cx, cy, escalaBase * 0.05, cx, cy, escalaBase * 0.44);
    if (this.config.tema === 'zorro') {
      grad.addColorStop(0, 'rgba(245, 121, 31, 0.20)');
      grad.addColorStop(1, 'rgba(245, 121, 31, 0)');
    } else if (this.config.tema === 'persona') {
      grad.addColorStop(0, 'rgba(44, 166, 164, 0.20)');
      grad.addColorStop(1, 'rgba(44, 166, 164, 0)');
    } else {
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, escalaBase * 0.44, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Cola redondita y esponjosa estilo Chibi */
  private dibujarColaZorroChibi(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cinturaY: number,
    escalaBase: number,
    ahora: number
  ): void {
    const balanceo = Math.sin(ahora * 0.0024) * (escalaBase * 0.014);
    const baseX = cx - escalaBase * 0.10;
    const baseY = cinturaY - escalaBase * 0.03;
    const puntaX = cx - escalaBase * 0.31 + balanceo;
    const puntaY = cinturaY - escalaBase * 0.22 + balanceo * 0.4;
    const borde = Math.max(2, escalaBase * 0.0075);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(cx - escalaBase * 0.28, cinturaY + escalaBase * 0.01, puntaX, puntaY);
    ctx.quadraticCurveTo(cx - escalaBase * 0.17, cinturaY - escalaBase * 0.29, baseX + escalaBase * 0.03, baseY - escalaBase * 0.10);
    ctx.closePath();

    ctx.fillStyle = '#F27418';
    ctx.fill();
    ctx.lineWidth = borde;
    ctx.strokeStyle = '#3B1A06';
    ctx.stroke();

    // Punta crema suave
    ctx.beginPath();
    ctx.arc(puntaX + escalaBase * 0.045, puntaY + escalaBase * 0.035, escalaBase * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF5E4';
    ctx.fill();

    ctx.restore();
  }

  /** Torso Chibi (forma de perita tierna para el Zorrito, o torso limpio para Persona) */
  private dibujarTorsoPersonaje(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cinturaY: number,
    hombroY: number,
    hombroIzq: Punto2D,
    hombroDer: Punto2D,
    escalaBase: number
  ): void {
    const paleta = this.obtenerPaleta();
    const esZorro = this.config.tema === 'zorro';
    const anchoCintura = escalaBase * (esZorro ? 0.145 : 0.14);
    const borde = Math.max(2, escalaBase * 0.0075);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (!esZorro) {
      const anchoCuello = escalaBase * 0.048;
      ctx.beginPath();
      ctx.roundRect(
        cx - anchoCuello,
        hombroY - escalaBase * 0.085,
        anchoCuello * 2,
        escalaBase * 0.11,
        anchoCuello * 0.4
      );
      ctx.fillStyle = paleta.pielCabeza;
      ctx.fill();
      ctx.lineWidth = borde;
      ctx.strokeStyle = paleta.bordeGeneral;
      ctx.stroke();
    }

    // Silueta del cuerpo (en modo Zorro es más redondeada tipo pancita Chibi)
    ctx.beginPath();
    ctx.moveTo(cx - anchoCintura, cinturaY);
    if (esZorro) {
      ctx.quadraticCurveTo(
        cx - anchoCintura * 1.15,
        (cinturaY + hombroY) * 0.55,
        hombroIzq.x,
        hombroY
      );
      // El torso sube suavemente conectando con la base de la cabeza
      ctx.quadraticCurveTo(cx, hombroY - escalaBase * 0.035, hombroDer.x, hombroY);
      ctx.quadraticCurveTo(
        cx + anchoCintura * 1.15,
        (cinturaY + hombroY) * 0.55,
        cx + anchoCintura,
        cinturaY
      );
    } else {
      ctx.quadraticCurveTo(
        cx - anchoCintura * 1.15,
        (cinturaY + hombroIzq.y) * 0.5,
        hombroIzq.x,
        hombroIzq.y - escalaBase * 0.015
      );
      ctx.quadraticCurveTo(cx, hombroY - escalaBase * 0.05, hombroDer.x, hombroDer.y - escalaBase * 0.015);
      ctx.quadraticCurveTo(
        cx + anchoCintura * 1.15,
        (cinturaY + hombroDer.y) * 0.5,
        cx + anchoCintura,
        cinturaY
      );
    }
    ctx.closePath();

    const gradTorso = ctx.createLinearGradient(cx, hombroY, cx, cinturaY);
    gradTorso.addColorStop(0, paleta.torsoClaro);
    gradTorso.addColorStop(1, paleta.torsoOscuro);
    ctx.fillStyle = gradTorso;
    ctx.fill();

    ctx.lineWidth = borde;
    ctx.strokeStyle = paleta.bordeGeneral;
    ctx.stroke();

    if (esZorro) {
      // Pancita / pecho crema suave y redondeado estilo Chibi
      const pechoTopY = hombroY + escalaBase * 0.02;
      const pechoBotY = cinturaY - escalaBase * 0.015;
      const rxPecho = escalaBase * 0.088;

      ctx.beginPath();
      ctx.ellipse(
        cx,
        (pechoTopY + pechoBotY) * 0.5,
        rxPecho,
        (pechoBotY - pechoTopY) * 0.48,
        0,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = '#FFF5E4';
      ctx.fill();

      // Correas de la mochila Chibi
      if (this.config.mostrarAntebrazo) {
        this.dibujarCorreasMochilaZorro(ctx, hombroIzq, hombroDer, cinturaY, escalaBase, borde);
      }
    }

    ctx.restore();
  }

  private dibujarCorreasMochilaZorro(
    ctx: CanvasRenderingContext2D,
    hombroIzq: Punto2D,
    hombroDer: Punto2D,
    cinturaY: number,
    escalaBase: number,
    borde: number
  ): void {
    const anchoCorrea = escalaBase * 0.026;
    for (const lado of [-1, 1] as const) {
      const h = lado === -1 ? hombroIzq : hombroDer;
      const xCentro = h.x - lado * (escalaBase * 0.012);
      const yTop = h.y + escalaBase * 0.01;
      const yBot = (h.y + cinturaY) * 0.54;

      ctx.beginPath();
      ctx.roundRect(xCentro - anchoCorrea * 0.5, yTop, anchoCorrea, yBot - yTop, 5);
      ctx.fillStyle = '#734625';
      ctx.fill();
      ctx.lineWidth = borde * 0.7;
      ctx.strokeStyle = '#3B1A06';
      ctx.stroke();

      // Hebilla dorada
      const hebillaY = (yTop + yBot) * 0.52;
      ctx.fillStyle = '#F7BC33';
      ctx.beginPath();
      ctx.roundRect(xCentro - anchoCorrea * 0.62, hebillaY, anchoCorrea * 1.24, escalaBase * 0.018, 3);
      ctx.fill();
      ctx.stroke();
    }
  }

  private dibujarAccesoriosCuello(
    ctx: CanvasRenderingContext2D,
    cx: number,
    hombroY: number,
    escalaBase: number
  ): void {
    const borde = Math.max(2, escalaBase * 0.007);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.config.tema === 'zorro') {
      const yCuello = hombroY + escalaBase * 0.005;
      const rx = escalaBase * 0.115;

      // Puntas del pañuelo azul de explorador
      ctx.beginPath();
      ctx.moveTo(cx - escalaBase * 0.015, yCuello + escalaBase * 0.015);
      ctx.quadraticCurveTo(cx + escalaBase * 0.01, yCuello + escalaBase * 0.095, cx + escalaBase * 0.025, yCuello + escalaBase * 0.095);
      ctx.quadraticCurveTo(cx + escalaBase * 0.055, yCuello + escalaBase * 0.05, cx + escalaBase * 0.055, yCuello + escalaBase * 0.015);
      ctx.closePath();
      ctx.fillStyle = '#1659C2';
      ctx.fill();
      ctx.lineWidth = borde;
      ctx.strokeStyle = '#3B1A06';
      ctx.stroke();

      // Rollo suave del pañuelo alrededor del cuello
      ctx.beginPath();
      ctx.ellipse(cx, yCuello, rx, escalaBase * 0.032, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2276F2';
      ctx.fill();
      ctx.stroke();

      // Insignia circular naranja del zorrito en el pañuelo
      const pinY = yCuello + escalaBase * 0.022;
      const pinR = escalaBase * 0.024;
      ctx.beginPath();
      ctx.arc(cx, pinY, pinR, 0, Math.PI * 2);
      ctx.fillStyle = '#F78222';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, escalaBase * 0.0045);
      ctx.strokeStyle = '#FFF5E4';
      ctx.stroke();
    } else {
      const yCollar = hombroY - escalaBase * 0.028;
      const rx = escalaBase * 0.065;
      ctx.beginPath();
      ctx.arc(cx, yCollar - escalaBase * 0.01, rx, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.lineWidth = escalaBase * 0.02;
      ctx.strokeStyle = this.config.tema === 'cyber' ? '#F2701A' : '#12263F';
      ctx.stroke();
    }

    ctx.restore();
  }

  private dibujarCabezaPersonaje(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    _hombroY: number,
    inclinacion: number,
    ahora: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(inclinacion);

    if (this.config.tema === 'zorro') {
      this.dibujarCabezaZorroChibi(ctx, r, ahora);
    } else {
      this.dibujarCabezaPersonaSinCara(ctx, r);
    }

    ctx.restore();
  }

  /**
   * Dibuja la cabeza del Zorrito Signy con proporciones 100% Chibi / Kawaii
   * (redondita, tierna, sin líneas negras cruzando el rostro, ojos grandes
   * expresivos color chocolate con doble brillo y mejillas sonrojadas).
   */
  private dibujarCabezaZorroChibi(ctx: CanvasRenderingContext2D, r: number, ahora: number): void {
    const borde = Math.max(2.2, r * 0.038);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. Orejitas grandes y redondeadas estilo Chibi
    for (const lado of [-1, 1] as const) {
      ctx.save();
      const baseIntX = lado * r * 0.34;
      const baseIntY = -r * 0.66;
      const baseExtX = lado * r * 0.96;
      const baseExtY = -r * 0.14;
      const puntaX = lado * r * 0.96;
      const puntaY = -r * 1.24;

      const gradOreja = ctx.createLinearGradient(baseIntX, baseExtY, puntaX, puntaY);
      gradOreja.addColorStop(0, '#F78222');
      gradOreja.addColorStop(0.60, '#EB6E14');
      gradOreja.addColorStop(0.76, '#472109');
      gradOreja.addColorStop(1, '#331605');

      ctx.beginPath();
      ctx.moveTo(baseIntX, baseIntY);
      ctx.quadraticCurveTo(lado * r * 0.56, -r * 1.18, puntaX, puntaY);
      ctx.quadraticCurveTo(lado * r * 1.10, -r * 0.68, baseExtX, baseExtY);
      ctx.closePath();
      ctx.fillStyle = gradOreja;
      ctx.fill();
      ctx.lineWidth = borde;
      ctx.strokeStyle = '#3B1A06';
      ctx.stroke();

      // Interior rosado pastel de la oreja
      ctx.beginPath();
      ctx.moveTo(lado * r * 0.46, -r * 0.58);
      ctx.quadraticCurveTo(lado * r * 0.64, -r * 0.98, lado * r * 0.85, -r * 1.04);
      ctx.quadraticCurveTo(lado * r * 0.94, -r * 0.62, lado * r * 0.80, -r * 0.24);
      ctx.closePath();
      ctx.fillStyle = '#FAD0C0';
      ctx.fill();

      // Mechoncito crema tierno en la base de la oreja
      ctx.beginPath();
      ctx.ellipse(lado * r * 0.66, -r * 0.44, r * 0.14, r * 0.10, lado * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#FFF5E4';
      ctx.fill();
      ctx.restore();
    }

    // 2. Silueta Chibi redondita y ancha de la cabeza (con mofletes suaves)
    const trazarSiluetaCabeza = () => {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.84);
      // Frente amplia hacia la mejilla derecha
      ctx.bezierCurveTo(r * 0.68, -r * 0.84, r * 1.06, -r * 0.42, r * 1.08, r * 0.04);
      // Moflete derecho redondito y tierno
      ctx.bezierCurveTo(r * 1.18, r * 0.34, r * 0.82, r * 0.78, 0, r * 0.78);
      // Moflete izquierdo simétrico
      ctx.bezierCurveTo(-r * 0.82, r * 0.78, -r * 1.18, r * 0.34, -r * 1.08, r * 0.04);
      ctx.bezierCurveTo(-r * 1.06, -r * 0.42, -r * 0.68, -r * 0.84, 0, -r * 0.84);
      ctx.closePath();
    };

    trazarSiluetaCabeza();
    const gradCabeza = ctx.createRadialGradient(0, -r * 0.2, r * 0.1, 0, 0, r * 1.15);
    gradCabeza.addColorStop(0, '#FF963D');
    gradCabeza.addColorStop(0.75, '#F77E1E');
    gradCabeza.addColorStop(1, '#E0640E');
    ctx.fillStyle = gradCabeza;
    ctx.fill();

    // 3. Máscara facial crema suave (recortada dentro de la silueta de la cabeza, SIN línea negra interna)
    ctx.save();
    trazarSiluetaCabeza();
    ctx.clip();

    ctx.beginPath();
    // Empieza justo en el puente de la nariz y se abre en dos mejillas redondas
    ctx.moveTo(0, r * 0.14);
    ctx.bezierCurveTo(r * 0.25, r * 0.14, r * 0.65, -r * 0.04, r * 1.18, r * 0.12);
    ctx.lineTo(r * 1.25, r * 0.90);
    ctx.lineTo(-r * 1.25, r * 0.90);
    ctx.lineTo(-r * 1.18, r * 0.12);
    ctx.bezierCurveTo(-r * 0.65, -r * 0.04, -r * 0.25, r * 0.14, 0, r * 0.14);
    ctx.closePath();
    ctx.fillStyle = '#FFF5E4';
    ctx.fill();
    ctx.restore();

    // Contorno exterior único de toda la cabeza Chibi
    trazarSiluetaCabeza();
    ctx.lineWidth = borde;
    ctx.strokeStyle = '#3B1A06';
    ctx.stroke();

    // 4. Mechoncito suave arriba en la cabeza
    ctx.beginPath();
    ctx.moveTo(-r * 0.14, -r * 0.81);
    ctx.quadraticCurveTo(-r * 0.04, -r * 1.04, r * 0.08, -r * 0.98);
    ctx.quadraticCurveTo(r * 0.04, -r * 0.88, r * 0.02, -r * 0.83);
    ctx.quadraticCurveTo(r * 0.16, -r * 0.94, r * 0.22, -r * 0.84);
    ctx.lineTo(r * 0.08, -r * 0.78);
    ctx.closePath();
    ctx.fillStyle = '#FF9238';
    ctx.fill();
    ctx.lineWidth = borde * 0.85;
    ctx.strokeStyle = '#3B1A06';
    ctx.stroke();

    // 5. Rostro Kawaii / Chibi (si está activado)
    if (this.config.mostrarMallaPalma) {
      const cicloParpadeo = ahora % 3900;
      const parpadeando = cicloParpadeo > 3760;

      // Rubor rosado tierno en las mejillas
      for (const lado of [-1, 1] as const) {
        ctx.beginPath();
        ctx.ellipse(lado * r * 0.62, r * 0.24, r * 0.15, r * 0.085, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 132, 116, 0.34)';
        ctx.fill();
      }

      // Cejas crema simétricas y pequeñitas estilo Chibi
      for (const lado of [-1, 1] as const) {
        ctx.save();
        ctx.translate(lado * r * 0.38, -r * 0.38);
        ctx.rotate(lado * 0.14);
        ctx.beginPath();
        ctx.roundRect(-r * 0.12, -r * 0.04, r * 0.24, r * 0.08, r * 0.04);
        ctx.fillStyle = '#FFF5E4';
        ctx.fill();
        ctx.restore();
      }

      // Ojos grandes Kawaii (iris chocolate ocupa casi todo el ojo, sin mirada fija blanca)
      for (const lado of [-1, 1] as const) {
        const ox = lado * r * 0.40;
        const oy = -r * 0.06;

        if (parpadeando) {
          // Ojito cerrado feliz (arco suave)
          ctx.beginPath();
          ctx.arc(ox, oy + r * 0.04, r * 0.18, 1.15 * Math.PI, 1.85 * Math.PI);
          ctx.lineWidth = borde * 1.3;
          ctx.strokeStyle = '#3B1A06';
          ctx.stroke();
        } else {
          // Base blanca muy sutil
          ctx.beginPath();
          ctx.ellipse(ox, oy, r * 0.22, r * 0.235, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = borde;
          ctx.strokeStyle = '#3B1A06';
          ctx.stroke();

          // Gran iris marrón chocolate cálido (ocupa casi todo el óvalo como en el arte original)
          ctx.beginPath();
          ctx.ellipse(ox - lado * r * 0.015, oy + r * 0.005, r * 0.19, r * 0.21, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#2E1305';
          ctx.fill();

          // Media luna inferior color miel/ámbar dentro del iris
          ctx.beginPath();
          ctx.arc(ox - lado * r * 0.015, oy + r * 0.03, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.lineWidth = r * 0.045;
          ctx.strokeStyle = '#7C3B10';
          ctx.stroke();

          // Gran brillo blanco superior (mirada tierna Chibi)
          ctx.beginPath();
          ctx.ellipse(ox - r * 0.065, oy - r * 0.075, r * 0.068, r * 0.078, -0.2, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();

          // Brillo pequeñito inferior
          ctx.beginPath();
          ctx.arc(ox + r * 0.065, oy + r * 0.085, r * 0.032, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();

          // Pestaña superior gruesa y curva
          ctx.beginPath();
          ctx.arc(ox, oy + r * 0.01, r * 0.225, 1.12 * Math.PI, 1.88 * Math.PI);
          ctx.lineWidth = borde * 1.35;
          ctx.strokeStyle = '#260F03';
          ctx.stroke();
        }
      }

      // Boquita Chibi tierna y pequeña con lengüita rosada
      const bocaY = r * 0.34;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-r * 0.14, bocaY);
      ctx.quadraticCurveTo(0, bocaY + r * 0.04, r * 0.14, bocaY);
      ctx.quadraticCurveTo(r * 0.11, bocaY + r * 0.21, 0, bocaY + r * 0.21);
      ctx.quadraticCurveTo(-r * 0.11, bocaY + r * 0.21, -r * 0.14, bocaY);
      ctx.closePath();
      ctx.fillStyle = '#6E1E1E';
      ctx.fill();
      ctx.clip();

      // Lengüita rosada dentro del clip de la sonrisa
      ctx.beginPath();
      ctx.ellipse(0, bocaY + r * 0.16, r * 0.10, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#FF7E7E';
      ctx.fill();
      ctx.restore();

      // Línea superior de la sonrisa tipo 'w' suave
      ctx.beginPath();
      ctx.moveTo(-r * 0.16, bocaY - r * 0.02);
      ctx.quadraticCurveTo(-r * 0.08, bocaY + r * 0.05, 0, bocaY - r * 0.01);
      ctx.quadraticCurveTo(r * 0.08, bocaY + r * 0.05, r * 0.16, bocaY - r * 0.02);
      ctx.lineWidth = borde * 0.9;
      ctx.strokeStyle = '#3B1A06';
      ctx.stroke();

      // Naricita pequeña de botón (óvalo triangular redondeado)
      ctx.beginPath();
      ctx.ellipse(0, r * 0.18, r * 0.105, r * 0.072, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#261005';
      ctx.fill();

      // Brillo en la nariz
      ctx.beginPath();
      ctx.ellipse(-r * 0.03, r * 0.16, r * 0.038, r * 0.018, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fill();
    }
  }

  /** Cabeza humana minimalista sin cara ("Persona sin cara") */
  private dibujarCabezaPersonaSinCara(ctx: CanvasRenderingContext2D, r: number): void {
    const paleta = this.obtenerPaleta();
    const borde = Math.max(2, r * 0.05);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const lado of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(lado * r * 0.78, r * 0.04, r * 0.16, r * 0.22, lado * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = paleta.pielCabeza;
      ctx.fill();
      ctx.lineWidth = borde;
      ctx.strokeStyle = paleta.bordeGeneral;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.76, r * 0.90, 0, 0, Math.PI * 2);
    ctx.fillStyle = paleta.pielCabeza;
    ctx.fill();
    ctx.lineWidth = borde;
    ctx.strokeStyle = paleta.bordeGeneral;
    ctx.stroke();

    if (this.config.tema !== 'huesos') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, -r * 0.15);
      ctx.quadraticCurveTo(-r * 0.85, -r * 0.95, -r * 0.10, -r * 1.02);
      ctx.quadraticCurveTo(r * 0.65, -r * 1.08, r * 0.84, -r * 0.42);
      ctx.quadraticCurveTo(r * 0.86, -r * 0.15, r * 0.75, -r * 0.10);
      ctx.quadraticCurveTo(r * 0.35, -r * 0.48, -r * 0.22, -r * 0.44);
      ctx.quadraticCurveTo(-r * 0.58, -r * 0.42, -r * 0.78, -r * 0.15);
      ctx.closePath();
      ctx.fillStyle = paleta.cabello;
      ctx.fill();
      ctx.lineWidth = borde;
      ctx.strokeStyle = paleta.bordeGeneral;
      ctx.stroke();
    }
  }

  // ============================================================================
  // 3. BRAZOS CURVOS CHIBI Y MANOS PLANAS EXPRESIVAS
  // ============================================================================

  private dibujarBrazoYManoPlana(
    ctx: CanvasRenderingContext2D,
    hombro: Punto2D,
    codo: Punto2D,
    m: Punto2D[],
    _lado: -1 | 1,
    escalaBase: number
  ): void {
    const paleta = this.obtenerPaleta();
    const muneca = m[0];
    const grosorEscala = this.config.grosorHueso;
    const borde = Math.max(2, escalaBase * 0.007);
    const anchoBrazo = escalaBase * 0.066 * Math.sqrt(grosorEscala);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.config.tema === 'zorro') {
      // Brazo curvo continuo estilo Chibi (de Hombro a Muñeca pasando suavemente por el codo)
      ctx.beginPath();
      ctx.moveTo(hombro.x, hombro.y);
      ctx.quadraticCurveTo(codo.x, codo.y, muneca.x, muneca.y);
      ctx.lineWidth = anchoBrazo + borde * 2;
      ctx.strokeStyle = paleta.bordeGeneral;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(hombro.x, hombro.y);
      ctx.quadraticCurveTo(codo.x, codo.y, muneca.x, muneca.y);
      ctx.lineWidth = anchoBrazo;
      ctx.strokeStyle = paleta.mangaBrazo;
      ctx.stroke();

      // Guante/patita marrón chocolate en el tercio final del antebrazo hacia la muñeca
      const inicioGuante: Punto2D = {
        x: codo.x * 0.42 + muneca.x * 0.58,
        y: codo.y * 0.42 + muneca.y * 0.58,
      };
      ctx.beginPath();
      ctx.moveTo(inicioGuante.x, inicioGuante.y);
      ctx.lineTo(muneca.x, muneca.y);
      ctx.lineWidth = anchoBrazo * 0.96 + borde * 2;
      ctx.strokeStyle = paleta.bordeMano;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(inicioGuante.x, inicioGuante.y);
      ctx.lineTo(muneca.x, muneca.y);
      ctx.lineWidth = anchoBrazo * 0.96;
      ctx.strokeStyle = paleta.mano;
      ctx.stroke();
    } else {
      // Brazo curvo continuo para Persona Sin Cara / Cyber
      ctx.beginPath();
      ctx.moveTo(hombro.x, hombro.y);
      ctx.quadraticCurveTo(codo.x, codo.y, muneca.x, muneca.y);
      ctx.lineWidth = anchoBrazo + borde * 2;
      ctx.strokeStyle = paleta.bordeGeneral;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(hombro.x, hombro.y);
      ctx.quadraticCurveTo(codo.x, codo.y, muneca.x, muneca.y);
      ctx.lineWidth = anchoBrazo;
      ctx.strokeStyle = paleta.mangaBrazo;
      ctx.stroke();
    }

    // Mano plana y redondeada encima de la muñeca
    this.dibujarManoPlana(ctx, m, paleta, borde);

    ctx.restore();
  }

  private dibujarManoPlana(
    ctx: CanvasRenderingContext2D,
    m: Punto2D[],
    paleta: ReturnType<typeof this.obtenerPaleta>,
    borde: number
  ): void {
    const esZorro = this.config.tema === 'zorro';
    const refMano = Math.hypot(m[9].x - m[0].x, m[9].y - m[0].y) || 42;
    const grosorDedo = Math.max(7, refMano * (esZorro ? 0.25 : 0.22));

    const dedos = [
      { indices: [1, 2, 3, 4], ancho: grosorDedo * 1.12, esPulgar: true },
      { indices: [5, 6, 7, 8], ancho: grosorDedo * 0.98, esPulgar: false },
      { indices: [9, 10, 11, 12], ancho: grosorDedo * 1.02, esPulgar: false },
      { indices: [13, 14, 15, 16], ancho: grosorDedo * 0.95, esPulgar: false },
      { indices: [17, 18, 19, 20], ancho: grosorDedo * 0.86, esPulgar: false },
    ].map((d) => {
      const base = m[d.indices[0]];
      const punta = m[d.indices[3]];
      const distMunecaPunta = Math.hypot(punta.x - m[0].x, punta.y - m[0].y);
      const distMunecaBase = Math.hypot(base.x - m[0].x, base.y - m[0].y) || 1;
      const ratioExtension = distMunecaPunta / distMunecaBase;
      return { ...d, ratioExtension, doblado: ratioExtension < 1.36 };
    });

    // A. Dedos extendidos
    for (const d of dedos) {
      if (!d.doblado && !d.esPulgar) {
        this.dibujarTrazoDedo(ctx, m, d.indices, d.ancho, paleta.mano, paleta.bordeMano, borde, false);
      }
    }

    // B. Palma redondeada y sólida
    const grosorPalma = grosorDedo * 0.96;
    const trazarPoligonoPalma = () => {
      ctx.beginPath();
      ctx.moveTo(m[0].x, m[0].y);
      ctx.lineTo(m[1].x, m[1].y);
      ctx.lineTo(m[5].x, m[5].y);
      ctx.lineTo(m[9].x, m[9].y);
      ctx.lineTo(m[13].x, m[13].y);
      ctx.lineTo(m[17].x, m[17].y);
      ctx.closePath();
    };

    trazarPoligonoPalma();
    ctx.lineWidth = grosorPalma + borde * 2;
    ctx.strokeStyle = paleta.bordeMano;
    ctx.stroke();
    ctx.fillStyle = paleta.bordeMano;
    ctx.fill();

    trazarPoligonoPalma();
    ctx.lineWidth = grosorPalma;
    ctx.strokeStyle = paleta.mano;
    ctx.stroke();
    ctx.fillStyle = paleta.mano;
    ctx.fill();

    for (const d of dedos) {
      if (!d.doblado && !d.esPulgar) {
        this.dibujarRellenoDedo(ctx, m, d.indices, d.ancho, paleta.mano, paleta.detalleDedo);
      }
    }

    // Almohadilla rosada/crema tierna en la palma del Zorrito
    const centroPalmaX = (m[0].x + m[5].x + m[9].x + m[17].x) * 0.25;
    const centroPalmaY = (m[0].y + m[5].y + m[9].y + m[17].y) * 0.25;
    if (esZorro) {
      ctx.beginPath();
      ctx.arc(centroPalmaX, centroPalmaY, refMano * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(242, 178, 140, 0.42)';
      ctx.fill();
    }

    // C. Dedos doblados y pulgar encima de la palma
    const dedosSuperpuestos = dedos
      .filter((d) => d.doblado || d.esPulgar)
      .sort((a, b) => Number(a.esPulgar) - Number(b.esPulgar));

    for (const d of dedosSuperpuestos) {
      this.dibujarTrazoDedo(ctx, m, d.indices, d.ancho, paleta.mano, paleta.bordeMano, borde, true);
      this.dibujarRellenoDedo(ctx, m, d.indices, d.ancho, paleta.mano, paleta.detalleDedo);
    }
  }

  private dibujarTrazoDedo(
    ctx: CanvasRenderingContext2D,
    m: Punto2D[],
    idx: number[],
    ancho: number,
    colorRelleno: string,
    colorBorde: string,
    borde: number,
    fundirBase: boolean
  ): void {
    ctx.beginPath();
    ctx.moveTo(m[idx[0]].x, m[idx[0]].y);
    ctx.lineTo(m[idx[1]].x, m[idx[1]].y);
    ctx.lineTo(m[idx[2]].x, m[idx[2]].y);
    ctx.lineTo(m[idx[3]].x, m[idx[3]].y);
    ctx.lineWidth = ancho + borde * 2;
    ctx.strokeStyle = colorBorde;
    ctx.stroke();

    if (fundirBase) {
      ctx.beginPath();
      ctx.arc(m[idx[0]].x, m[idx[0]].y, ancho * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = colorRelleno;
      ctx.fill();
    }
  }

  private dibujarRellenoDedo(
    ctx: CanvasRenderingContext2D,
    m: Punto2D[],
    idx: number[],
    ancho: number,
    colorRelleno: string,
    colorDetalle: string
  ): void {
    ctx.beginPath();
    ctx.moveTo(m[idx[0]].x, m[idx[0]].y);
    ctx.lineTo(m[idx[1]].x, m[idx[1]].y);
    ctx.lineTo(m[idx[2]].x, m[idx[2]].y);
    ctx.lineTo(m[idx[3]].x, m[idx[3]].y);
    ctx.lineWidth = ancho;
    ctx.strokeStyle = colorRelleno;
    ctx.stroke();

    const punta = m[idx[3]];
    ctx.beginPath();
    ctx.arc(punta.x, punta.y, ancho * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = colorDetalle;
    ctx.fill();
  }

  private dibujarRigGuia(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cinturaY: number,
    hombroY: number,
    cabezaY: number,
    hombroIzq: Punto2D,
    hombroDer: Punto2D,
    estadoIzq: EstadoBrazo,
    estadoDer: EstadoBrazo
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
    ctx.fillStyle = '#00F0FF';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(cx, cinturaY);
    ctx.lineTo(cx, cabezaY);
    ctx.moveTo(hombroIzq.x, hombroIzq.y);
    ctx.lineTo(hombroDer.x, hombroDer.y);
    ctx.stroke();

    for (const [hombro, est] of [
      [hombroIzq, estadoIzq],
      [hombroDer, estadoDer],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(hombro.x, hombro.y);
      ctx.lineTo(est.codo.x, est.codo.y);
      ctx.lineTo(est.puntosMano[0].x, est.puntosMano[0].y);
      ctx.stroke();

      for (const [a, b] of CONEXIONES_MANO) {
        ctx.beginPath();
        ctx.moveTo(est.puntosMano[a].x, est.puntosMano[a].y);
        ctx.lineTo(est.puntosMano[b].x, est.puntosMano[b].y);
        ctx.stroke();
      }

      for (const p of [hombro, est.codo, est.puntosMano[0]]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private obtenerPaleta() {
    switch (this.config.tema) {
      case 'zorro':
        return {
          torsoClaro: '#F78222',
          torsoOscuro: '#DF640F',
          pielCabeza: '#F78222',
          cabello: '#F78222',
          mangaBrazo: '#F78222',
          mano: '#572B0C', // Marrón chocolate cálido Chibi
          bordeMano: '#331605',
          detalleDedo: 'rgba(255, 205, 165, 0.28)',
          bordeGeneral: '#3B1A06',
        };
      case 'persona':
        return {
          torsoClaro: '#2CA6A4',
          torsoOscuro: '#1F7E7C',
          pielCabeza: '#F4C29F',
          cabello: '#182538',
          mangaBrazo: '#2CA6A4',
          mano: '#F4C29F',
          bordeMano: '#6B3D20',
          detalleDedo: 'rgba(255, 255, 255, 0.35)',
          bordeGeneral: '#122238',
        };
      case 'cyber':
        return {
          torsoClaro: '#1F345A',
          torsoOscuro: '#13223D',
          pielCabeza: '#FFD6B8',
          cabello: '#F2701A',
          mangaBrazo: '#1F345A',
          mano: '#FFD6B8',
          bordeMano: '#4A2511',
          detalleDedo: 'rgba(255, 255, 255, 0.4)',
          bordeGeneral: '#0A1526',
        };
      case 'huesos':
      default:
        return {
          torsoClaro: '#334669',
          torsoOscuro: '#23324D',
          pielCabeza: '#DCE4F2',
          cabello: '#8FA3C7',
          mangaBrazo: '#334669',
          mano: '#DCE4F2',
          bordeMano: '#1A263B',
          detalleDedo: 'rgba(0, 240, 255, 0.35)',
          bordeGeneral: '#0F1B2E',
        };
    }
  }
}
