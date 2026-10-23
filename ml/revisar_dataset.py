#!/usr/bin/env python3
"""Revisa las grabaciones del dataset SIN modificar nada (solo lectura).

    python ml/revisar_dataset.py --supabase --email admin@correo.cl

Descarga las muestras y las referencias de Supabase y genera una página
(ml/reportes/revision-AAAAMMDD-HHMMSS.html) que se abre en el navegador, con:
  - cada grabación animada como esqueleto de las manos, para ver si la seña
    quedó completa (lo que no se puede revisar al grabar),
  - avisos automáticos: mano perdida (movimiento muy rápido o borroso),
    seña posiblemente cortada al final, poco movimiento, mano faltante,
  - quién la grabó y cuándo, para ubicar las que conviene repetir,
  - la referencia de cada seña ("Usar como referencia") animada.

Nada se borra ni se cambia en Supabase: este script solo hace consultas de lectura.
"""
from __future__ import annotations

import argparse
import getpass
import html
import json
import os
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))

from signy_ml.calidad import evaluar_muestra, evaluar_referencia  # noqa: E402
from signy_ml.caracteristicas import PRESENCIA_MINIMA, a_isotropico, mano_en_reposo, resumir_pistas, seguir_manos  # noqa: E402
from signy_ml.consola import consola_utf8  # noqa: E402
from signy_ml.dataset import DatasetInvalido, expandir_captura  # noqa: E402


def _persona(m: dict, perfiles: dict) -> str:
    if m.get("participante"):
        return str(m["participante"]).strip()
    perfil = perfiles.get(m.get("autor_id")) or {}
    nombre = perfil.get("full_name") or perfil.get("username")
    return f"{nombre} (cuenta)" if nombre else f"cuenta …{str(m.get('autor_id') or '')[-4:]}"


def _animacion(captura: dict) -> dict:
    """Frames para dibujar: por frame, la mano de cada pista (x, y de imagen) y cuál es la que descansa."""
    iso = a_isotropico(captura)
    pistas = seguir_manos(iso)
    activas = sorted((r for r in resumir_pistas(pistas) if r["presencia"] >= PRESENCIA_MINIMA), key=lambda r: r["x_media"])
    reposo = mano_en_reposo(pistas, activas)
    k = captura["ancho"] / captura["alto"] if captura["alto"] else 1.0
    frames = []
    for f, p in zip(iso, pistas):
        manos = []
        for m in p:
            manos.append(None if m is None else [[round(float(x) / k, 4), round(float(y), 4)] for x, y in m[:, :2]])
        frames.append([round(float(f["t"])), manos])
    return {"ancho": captura["ancho"], "alto": captura["alto"], "reposo": reposo, "frames": frames}


def _referencia_animacion(ref: dict) -> list:
    """Frames de la referencia (ya normalizados): lista de manos con 21 puntos (x, y)."""
    salida = []
    for plano in ref.get("frames") or []:
        manos = []
        for i in range(0, len(plano) - 62, 63):
            manos.append([[round(plano[i + j * 3], 4), round(plano[i + j * 3 + 1], 4)] for j in range(21)])
        salida.append(manos)
    return salida


def armar_revision(datos: dict) -> dict:
    perfiles = {p["id"]: p for p in datos.get("perfiles", [])}
    senas = {s["id"]: s for s in datos.get("senas", [])}
    grupos: dict[int, dict] = {}
    for m in sorted(datos.get("muestras", []), key=lambda x: x["id"]):
        sena = senas.get(m["sena_id"], {"id": m["sena_id"], "palabra": f"seña #{m['sena_id']}"})
        g = grupos.setdefault(m["sena_id"], {"id": m["sena_id"], "palabra": sena["palabra"], "muestras": [], "referencia": None})
        try:
            captura = expandir_captura(m["captura"])
        except (DatasetInvalido, KeyError, TypeError, ValueError):
            g["muestras"].append({"id": m["id"], "persona": _persona(m, perfiles), "fecha": m.get("created_at"),
                                  "tipo": m.get("tipo"), "manos": m.get("manos_requeridas"), "nivel": "rojo",
                                  "avisos": [["rojo", "La captura está dañada y no se puede leer."]], "anim": None})
            continue
        calidad = evaluar_muestra(captura, m.get("tipo", "dinamica"), int(m.get("manos_requeridas") or 1))
        g["muestras"].append({
            "id": m["id"], "persona": _persona(m, perfiles), "fecha": m.get("created_at"),
            "tipo": m.get("tipo"), "manos": m.get("manos_requeridas"),
            "nivel": calidad["nivel"], "avisos": [list(a) for a in calidad["avisos"]],
            "duracionMs": calidad["duracionMs"], "cobertura": calidad["cobertura"], "huecoMaxMs": calidad["huecoMaxMs"],
            "anim": _animacion(captura),
        })
    for sena_id, g in grupos.items():
        ref = (senas.get(sena_id) or {}).get("landmarks_referencia")
        if isinstance(ref, str):
            try:
                ref = json.loads(ref)
            except ValueError:
                ref = None
        rev = evaluar_referencia(ref)
        g["referencia"] = {"nivel": rev["nivel"], "avisos": [list(a) for a in rev["avisos"]],
                           "tipo": (ref or {}).get("tipo"), "frames": _referencia_animacion(ref) if ref else []}
        g["personas"] = len({x["persona"] for x in g["muestras"]})
    # Señas con referencia pero todavía sin muestras también se listan (para revisar su referencia).
    for sena_id, s in senas.items():
        if sena_id not in grupos and s.get("landmarks_referencia"):
            ref = s["landmarks_referencia"] if not isinstance(s["landmarks_referencia"], str) else json.loads(s["landmarks_referencia"])
            rev = evaluar_referencia(ref)
            grupos[sena_id] = {"id": sena_id, "palabra": s["palabra"], "muestras": [], "personas": 0,
                               "referencia": {"nivel": rev["nivel"], "avisos": [list(a) for a in rev["avisos"]],
                                              "tipo": ref.get("tipo"), "frames": _referencia_animacion(ref)}}
    return {"generado": f"{datetime.now():%d-%m-%Y %H:%M}",
            "senas": sorted(grupos.values(), key=lambda g: g["palabra"].lower())}


def escribir_html(revision: dict, ruta: Path) -> None:
    datos = json.dumps(revision, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    ruta.write_text(PLANTILLA.replace("__DATOS__", datos).replace("__FECHA__", html.escape(revision["generado"])), encoding="utf-8")


def resumen_consola(revision: dict) -> None:
    muestras = [m for g in revision["senas"] for m in g["muestras"]]
    cuenta = {n: sum(m["nivel"] == n for m in muestras) for n in ("verde", "amarillo", "rojo")}
    print(f"Señas: {len(revision['senas'])} · muestras: {len(muestras)} · "
          f"🟢 {cuenta['verde']}  🟡 {cuenta['amarillo']}  🔴 {cuenta['rojo']}")
    for g in revision["senas"]:
        for m in g["muestras"]:
            if m["nivel"] == "rojo":
                aviso = next((t for n, t in m["avisos"] if n == "rojo"), "")
                print(f"  🔴 #{m['id']} {g['palabra']} ({m['persona']}): {aviso}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    origen = p.add_mutually_exclusive_group(required=True)
    origen.add_argument("--supabase", action="store_true", help="Descargar de Supabase (solo lectura; pide --email)")
    origen.add_argument("--datos", type=Path, help="Usar un archivo guardado antes con --guardar-datos")
    p.add_argument("--email", help="Cuenta admin de la app. La contraseña se pide o se lee de SIGNY_PASSWORD")
    p.add_argument("--salida", type=Path, help="Archivo HTML (por defecto ml/reportes/revision-<fecha>.html)")
    p.add_argument("--guardar-datos", type=Path, help="Guardar también lo descargado (para revisar sin conexión)")
    a = p.parse_args(argv)

    if a.supabase:
        from signy_ml.supabase_descarga import ErrorSupabase, descargar_para_revision, leer_config_app

        if not a.email:
            print("✖ Con --supabase hay que indicar --email (una cuenta admin de la app).", file=sys.stderr)
            return 2
        password = os.environ.get("SIGNY_PASSWORD") or getpass.getpass(f"Contraseña de {a.email}: ")
        try:
            url, clave = leer_config_app(RAIZ.parent)
            print("Descargando muestras y referencias (solo lectura)…")
            datos = descargar_para_revision(url, clave, a.email, password, lambda n: print(f"  {n} muestras", end="\r"))
        except (ErrorSupabase, OSError) as e:
            print(f"✖ {e}", file=sys.stderr)
            return 2
        if a.guardar_datos:
            a.guardar_datos.parent.mkdir(parents=True, exist_ok=True)
            a.guardar_datos.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    else:
        try:
            datos = json.loads(a.datos.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"✖ No se pudo leer {a.datos}: {e}", file=sys.stderr)
            return 2

    if not datos.get("muestras") and not any(s.get("landmarks_referencia") for s in datos.get("senas", [])):
        print("No hay muestras ni referencias para revisar.")
        return 0
    revision = armar_revision(datos)
    destino = a.salida or (RAIZ / "reportes" / f"revision-{datetime.now():%Y%m%d-%H%M%S}.html")
    destino.parent.mkdir(parents=True, exist_ok=True)
    escribir_html(revision, destino)
    resumen_consola(revision)
    print(f"✔ Revisión en {destino} (ábrela con doble clic)")
    return 0


PLANTILLA = r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisión del dataset · Signy</title>
<style>
  :root { --ink:#12213B; --deep:#0A1526; --card:#1B2E4E; --line:#2C3E60; --cream:#F7F5F0; --muted:#93A3C4;
          --fox:#F2701A; --mint:#2CA6A4; --amarillo:#F2A93B; --rojo:#E14F3D; --verde:#2CA6A4; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--ink); color:var(--cream); font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header { padding:24px 20px 8px; max-width:1200px; margin:0 auto; }
  h1 { margin:0 0 4px; font-size:24px; }
  .sub { color:var(--muted); margin:0 0 14px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }
  .chip { background:var(--card); border-radius:999px; padding:6px 12px; font-weight:700; }
  .barra { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:12px 0 4px; }
  button.filtro, label.op { background:var(--card); color:var(--cream); border:1px solid var(--line); border-radius:999px; padding:7px 14px; font:inherit; cursor:pointer; }
  button.filtro.activo { background:var(--fox); border-color:var(--fox); color:#2b1300; font-weight:700; }
  input[type=search] { background:var(--deep); color:var(--cream); border:1px solid var(--line); border-radius:999px; padding:8px 14px; font:inherit; min-width:220px; }
  main { max-width:1200px; margin:0 auto; padding:0 20px 40px; }
  section.sena { background:var(--deep); border-radius:18px; padding:16px; margin:16px 0; }
  section.sena h2 { margin:0; font-size:20px; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  section.sena h2 small { color:var(--muted); font-weight:500; font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px; margin-top:12px; }
  .card { background:var(--card); border-radius:14px; padding:10px; border-top:4px solid var(--verde); }
  .card.amarillo { border-top-color:var(--amarillo); } .card.rojo { border-top-color:var(--rojo); }
  .card.ref { border-top-color:var(--fox); } .card.gris { border-top-color:var(--line); }
  canvas { width:100%; background:#0d1b30; border-radius:10px; display:block; cursor:pointer; }
  .meta { font-size:13px; color:var(--muted); margin-top:6px; }
  .meta b { color:var(--cream); }
  ul.avisos { margin:6px 0 0; padding:0; list-style:none; font-size:13px; }
  ul.avisos li { padding:3px 0 3px 18px; position:relative; }
  ul.avisos li::before { content:""; position:absolute; left:2px; top:9px; width:9px; height:9px; border-radius:50%; background:var(--muted); }
  ul.avisos li.rojo::before { background:var(--rojo); } ul.avisos li.amarillo::before { background:var(--amarillo); } ul.avisos li.info::before { background:var(--mint); }
  .ok { color:var(--verde); font-size:13px; margin-top:6px; }
  .nota { background:var(--card); border-radius:14px; padding:14px 16px; color:var(--muted); font-size:14px; }
  .nota code { background:var(--deep); color:var(--cream); padding:1px 6px; border-radius:6px; }
  .oculto { display:none !important; }
  @media (max-width:520px) { .grid { grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); } }
</style>
</head>
<body>
<header>
  <h1>Revisión del dataset</h1>
  <p class="sub">Generada el __FECHA__ · solo lectura: no se cambió nada en Supabase. Toca una animación para pausarla.</p>
  <div class="chips" id="resumen"></div>
  <div class="barra">
    <button class="filtro activo" data-f="todas">Todas</button>
    <button class="filtro" data-f="avisos">Con avisos</button>
    <button class="filtro" data-f="rojo">Solo para repetir</button>
    <input type="search" id="buscar" placeholder="Buscar seña…">
    <label class="op"><input type="checkbox" id="espejo" checked> Ver como espejo (igual que en la pantalla al grabar)</label>
  </div>
</header>
<main>
  <div id="senas"></div>
  <div class="nota">
    <p><b>Cómo leer esto.</b> 🟢 bien · 🟡 revisar la animación (puede servir) · 🔴 conviene volver a grabarla.
      En gris se dibuja la otra mano cuando está descansando abajo: el modelo la ignora.</p>
    <p><b>Si una muestra está mal</b>, se puede borrar en Supabase → SQL Editor con
      <code>delete from muestras_sena where id in (12, 34);</code> (los números son los <b>#</b> de cada tarjeta).
      Antes de borrar, revisa bien la animación: lo borrado no se recupera.</p>
  </div>
</main>
<script>
const DATOS = __DATOS__;
const CONEX = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const PUNTAS = new Set([4,8,12,16,20]);
const TIPO = { dinamica: 'dinámica', estatica: 'estática' };
const animaciones = [];
let espejo = true;

function el(tag, attrs = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const h of hijos) if (h != null) e.append(h);
  return e;
}
function fecha(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); }
function listaAvisos(avisos) {
  if (!avisos.length) return el('div', { class: 'ok' }, '✓ Sin problemas detectados');
  const ul = el('ul', { class: 'avisos' });
  for (const [nivel, texto] of avisos) ul.append(el('li', { class: nivel }, texto));
  return ul;
}
function dibujarMano(ctx, puntos, aPx, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  for (const [a, b] of CONEX) { const p = aPx(puntos[a]), q = aPx(puntos[b]); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
  for (let i = 0; i < 21; i++) { const p = aPx(puntos[i]); ctx.beginPath(); ctx.fillStyle = PUNTAS.has(i) ? '#F2701A' : '#F7F5F0'; ctx.arc(p[0], p[1], PUNTAS.has(i) ? 3 : 2, 0, 7); ctx.fill(); }
}
function lienzoMuestra(anim) {
  const w = 460, h = Math.round(w * anim.alto / anim.ancho);
  const c = el('canvas', { width: w, height: Math.min(h, 620) });
  const ctx = c.getContext('2d');
  const t0 = anim.frames[0][0], dur = Math.max(1, anim.frames[anim.frames.length - 1][0] - t0);
  const st = { pausa: false, inicio: performance.now() };
  c.addEventListener('click', () => { st.pausa = !st.pausa; if (!st.pausa) st.inicio = performance.now() - (st.t || 0); });
  function cuadro(ahora) {
    if (!st.pausa) st.t = (ahora - st.inicio) % (dur + 600);
    const tt = t0 + Math.min(st.t, dur);
    let k = 0; while (k < anim.frames.length - 1 && anim.frames[k + 1][0] <= tt) k++;
    ctx.clearRect(0, 0, c.width, c.height);
    const aPx = (p) => [(espejo ? 1 - p[0] : p[0]) * c.width, p[1] * c.height];
    const manos = anim.frames[k][1];
    let alguna = false;
    manos.forEach((m, i) => { if (m) { alguna = true; dibujarMano(ctx, m, aPx, i === anim.reposo ? '#8796b8' : '#2CA6A4'); } });
    // Tiempo y progreso ARRIBA: abajo suele estar la otra mano descansando.
    ctx.fillStyle = '#F2701A'; ctx.fillRect(0, 0, c.width * Math.min(st.t, dur) / dur, 4);
    ctx.fillStyle = alguna ? '#93A3C4' : '#E14F3D'; ctx.font = '15px system-ui';
    ctx.fillText(alguna ? `${((tt - t0) / 1000).toFixed(1)} s` : `${((tt - t0) / 1000).toFixed(1)} s · sin manos detectadas`, 10, 24);
  }
  animaciones.push({ c, cuadro });
  return c;
}
function lienzoReferencia(frames) {
  const c = el('canvas', { width: 460, height: 460 });
  const ctx = c.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of frames) for (const m of f) for (const [x, y] of m) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const lado = Math.max(maxX - minX, maxY - minY) || 1, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const st = { pausa: false, inicio: performance.now() };
  c.addEventListener('click', () => { st.pausa = !st.pausa; if (!st.pausa) st.inicio = performance.now() - (st.t || 0); });
  const dur = Math.max(1, frames.length * 50);
  function cuadro(ahora) {
    if (!st.pausa) st.t = (ahora - st.inicio) % (dur + 600);
    const k = Math.min(frames.length - 1, Math.floor(Math.min(st.t, dur) / 50));
    ctx.clearRect(0, 0, c.width, c.height);
    const aPx = (p) => [((espejo ? -(p[0] - cx) : p[0] - cx) / lado * 0.85 + 0.5) * c.width, ((p[1] - cy) / lado * 0.85 + 0.5) * c.height];
    for (const m of frames[k]) dibujarMano(ctx, m, aPx, '#F2701A');
  }
  animaciones.push({ c, cuadro });
  return c;
}

const muestras = DATOS.senas.flatMap((g) => g.muestras);
const cuenta = (n) => muestras.filter((m) => m.nivel === n).length;
const personas = new Set(muestras.map((m) => m.persona));
document.getElementById('resumen').append(
  el('span', { class: 'chip' }, `${DATOS.senas.length} señas`), el('span', { class: 'chip' }, `${muestras.length} muestras`),
  el('span', { class: 'chip' }, `${personas.size} personas`), el('span', { class: 'chip' }, `🟢 ${cuenta('verde')}`),
  el('span', { class: 'chip' }, `🟡 ${cuenta('amarillo')}`), el('span', { class: 'chip' }, `🔴 ${cuenta('rojo')}`));

const cont = document.getElementById('senas');
for (const g of DATOS.senas) {
  const sec = el('section', { class: 'sena', 'data-palabra': g.palabra.toLowerCase() });
  sec.append(el('h2', {}, g.palabra, el('small', {}, `#${g.id} · ${g.muestras.length} muestra(s) · ${g.personas} persona(s)`)));
  const grid = el('div', { class: 'grid' });
  if (g.referencia) {
    const r = g.referencia;
    const card = el('div', { class: 'card ' + (r.frames.length ? 'ref' : 'gris'), 'data-nivel': r.nivel === 'verde' || r.nivel === 'gris' ? 'verde' : r.nivel });
    if (r.frames.length) card.append(lienzoReferencia(r.frames));
    card.append(el('div', { class: 'meta' }, el('b', {}, 'Referencia'), ` · ${TIPO[r.tipo] || ''} · ${r.frames.length} frame(s) (centrada, sin la posición en la imagen)`), listaAvisos(r.avisos));
    grid.append(card);
  }
  for (const m of g.muestras) {
    const card = el('div', { class: 'card ' + m.nivel, 'data-nivel': m.nivel, id: 'm' + m.id });
    if (m.anim) card.append(lienzoMuestra(m.anim));
    const det = m.anim ? ` · ${(m.duracionMs / 1000).toFixed(1)} s · mano visible ${Math.round(m.cobertura * 100)} %` : '';
    card.append(el('div', { class: 'meta' }, el('b', {}, `#${m.id}`), ` · ${m.persona} · ${fecha(m.fecha)}`, el('br'), `${TIPO[m.tipo] || ''} · ${m.manos} mano(s)${det}`), listaAvisos(m.avisos));
    grid.append(card);
  }
  sec.append(grid);
  cont.append(sec);
}

let filtro = 'todas';
function aplicar() {
  const q = document.getElementById('buscar').value.trim().toLowerCase();
  for (const sec of cont.children) {
    let visibles = 0;
    for (const card of sec.querySelectorAll('.card')) {
      const n = card.dataset.nivel;
      const ok = filtro === 'todas' || (filtro === 'avisos' && n !== 'verde') || (filtro === 'rojo' && n === 'rojo');
      card.classList.toggle('oculto', !ok); if (ok) visibles++;
    }
    sec.classList.toggle('oculto', !visibles || (q && !sec.dataset.palabra.includes(q)));
  }
}
document.querySelectorAll('button.filtro').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('button.filtro').forEach((x) => x.classList.toggle('activo', x === b)); filtro = b.dataset.f; aplicar();
}));
document.getElementById('buscar').addEventListener('input', aplicar);
document.getElementById('espejo').addEventListener('change', (e) => { espejo = e.target.checked; });

const visibles = new Set();
const obs = new IntersectionObserver((ents) => ents.forEach((e) => e.isIntersecting ? visibles.add(e.target) : visibles.delete(e.target)));
animaciones.forEach((a) => obs.observe(a.c));
(function bucle(ahora) { for (const a of animaciones) if (visibles.has(a.c)) a.cuadro(ahora); requestAnimationFrame(bucle); })(performance.now());
</script>
</body>
</html>
"""


if __name__ == "__main__":
    consola_utf8()
    sys.exit(main())
