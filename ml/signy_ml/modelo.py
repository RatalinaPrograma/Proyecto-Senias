"""Entrenamiento (Keras), evaluación y exportación (TFLite + JSON de la app) del clasificador de señas."""
from __future__ import annotations

import base64
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from .aumentacion import aumentar, espejar
from .caracteristicas import ConfigCaracteristicas, caracteristicas, dimension_por_frame
from .dataset import Dataset

FORMATO = "signy-clasificador"
VERSION = 1
# Clase "ninguna seña": ninguna seña real tiene id 0, así que la app nunca la aprueba como la seña pedida.
NINGUNA = 0
NOMBRE_NINGUNA = "(ninguna seña)"


@dataclass
class OpcionesEntrenamiento:
    config: ConfigCaracteristicas = ConfigCaracteristicas()
    capas_ocultas: tuple[int, ...] = (64, 32)
    aumentos_por_muestra: int = 10
    incluir_espejo: bool = True
    dropout: float = 0.2
    epocas: int = 60
    renovar_cada: int = 10            # épocas entre una tanda de variantes aumentadas y la siguiente
    clase_ninguna: bool = True
    precision_objetivo: float = 0.95  # el umbral se calcula para que, al aceptar, acierte al menos esto
    fraccion_prueba: float = 0.25     # solo con menos de 3 personas
    semilla: int = 42
    umbral_sugerido: float = 0.6      # si no hay datos para calcularlo


@dataclass
class Resultado:
    modelo: Optional[dict]   # formato que carga la app (assets/modelos/clasificador-senas.json)
    metricas: dict
    tflite: Optional[bytes]  # el mismo modelo en TFLite (Android/iOS)
    etiquetas: list[str]     # palabra de cada salida, en orden


def nombre_clase(ds: Dataset, sena_id: int) -> str:
    return NOMBRE_NINGUNA if sena_id == NINGUNA else ds.nombre(sena_id)


def _vectores(capturas: list[dict], etiquetas: list[int], op: OpcionesEntrenamiento, rng: np.random.Generator, aumentar_datos: bool):
    """(X, y, origen): origen[i] = índice de la captura de la que salió el vector i."""
    X, y, origen = [], [], []
    for i, (captura, etiqueta) in enumerate(zip(capturas, etiquetas)):
        variantes = [captura]
        if aumentar_datos:
            if op.incluir_espejo:
                variantes.append(espejar(captura))
            base = list(variantes)
            for _ in range(op.aumentos_por_muestra):
                variantes.append(aumentar(base[int(rng.integers(len(base)))], rng))
        for v in variantes:
            vec = caracteristicas(v, op.config)
            if vec is not None:
                X.append(vec)
                y.append(etiqueta)
                origen.append(i)
    return np.array(X), np.array(y), np.array(origen, dtype=int)


def empalmes(capturas: list[dict], etiquetas: list[int], n: int, rng: np.random.Generator) -> list[dict]:
    """Movimientos que no son ninguna seña: el comienzo de una seña empalmado con el final de otra distinta
    (lo que pasa entre una seña y la siguiente, o cuando el alumno hace otra cosa)."""
    etiquetas = np.asarray(etiquetas)
    if len(set(etiquetas.tolist())) < 2:
        return []
    salida = []
    while len(salida) < n:
        i, j = rng.choice(len(capturas), 2, replace=False)
        if etiquetas[i] == etiquetas[j]:
            continue
        a, b = capturas[i], capturas[j]
        # b pasa al sistema de coordenadas de a (otra relación de aspecto).
        ka, kb = a["ancho"] / a["alto"], b["ancho"] / b["alto"]
        ajuste = np.array([kb / ka, 1.0, kb / ka])
        corte_a = int(len(a["frames"]) * rng.uniform(0.3, 0.7))
        corte_b = int(len(b["frames"]) * rng.uniform(0.3, 0.7))
        frames = list(a["frames"][:corte_a])
        t0 = (frames[-1]["t"] if frames else 0.0) - (b["frames"][corte_b]["t"] if corte_b < len(b["frames"]) else 0.0)
        frames += [{"t": f["t"] + t0, "manos": [m * ajuste for m in f["manos"]]} for f in b["frames"][corte_b:]]
        salida.append({**a, "frames": frames})
    return salida


def _con_ninguna(capturas: list[dict], etiquetas: list[int], op: OpcionesEntrenamiento, rng: np.random.Generator):
    """Agrega ejemplos de "ninguna seña": tantos como muestras tiene, en promedio, una seña."""
    if not op.clase_ninguna:
        return capturas, etiquetas
    n = max(2, round(len(capturas) / len(set(etiquetas))))
    negativos = empalmes(capturas, etiquetas, n, rng)
    return capturas + negativos, etiquetas + [NINGUNA] * len(negativos)


SIN_EVALUACION = "sin evaluación (muy pocas muestras para separar una parte de prueba: graba más)"
POR_PERSONA = "por persona (cada persona se prueba con un modelo entrenado sin ella)"


def _estratificada(etiquetas: np.ndarray, n_prueba: int, rng: np.random.Generator) -> np.ndarray:
    """Índices de prueba con al menos 1 muestra de cada seña (y al menos 1 en entrenamiento)."""
    prueba = []
    for c in np.unique(etiquetas):
        idx = rng.permutation(np.flatnonzero(etiquetas == c))
        prueba.extend(idx[:min(len(idx) - 1, max(1, round(n_prueba * len(idx) / len(etiquetas))))])
    return np.sort(np.array(prueba, dtype=int))


def _pliegues(ds: Dataset, op: OpcionesEntrenamiento) -> tuple[list[tuple[np.ndarray, np.ndarray]], str]:
    """Rondas (entrenamiento, prueba). Con 3+ personas, una ronda por persona: se prueba con ella y se
    entrena con todas las demás, así cada persona se mide como un alumno nuevo y el resultado no depende
    de un sorteo. Con menos personas, una sola partición al azar. Con muy pocas muestras, ninguna."""
    rng = np.random.default_rng(op.semilla)
    n = len(ds.muestras)
    indices = np.arange(n)
    etiquetas = np.array([m.sena_id for m in ds.muestras])
    grupos = np.array([m.participante for m in ds.muestras])
    if len(set(grupos.tolist())) >= 3:
        # Si las demás personas grabaron una sola seña no hay con qué entrenar: esa ronda no se hace.
        pliegues = [(indices[grupos != p], indices[grupos == p]) for p in sorted(set(grupos.tolist()))]
        pliegues = [(tr, te) for tr, te in pliegues if len(set(etiquetas[tr].tolist())) >= 2]
        if pliegues:
            return pliegues, POR_PERSONA

    clases, conteo = np.unique(etiquetas, return_counts=True)
    n_prueba = max(1, math.ceil(op.fraccion_prueba * n))
    if conteo.min() >= 2:
        n_prueba = max(n_prueba, len(clases))
        if n - n_prueba >= len(clases):
            te = _estratificada(etiquetas, n_prueba, rng)
            return [(np.setdiff1d(indices, te), te)], "aleatoria (hay menos de 3 personas: la precisión real con alumnos nuevos puede ser menor)"
    if n - n_prueba >= 2:
        perm = rng.permutation(n)
        tr, te = np.sort(perm[n_prueba:]), np.sort(perm[:n_prueba])
        if len(set(etiquetas[tr].tolist())) >= 2:
            return [(tr, te)], ("aleatoria, no estratificada (hay señas con 1 sola muestra; "
                                "la precisión real con alumnos nuevos puede ser menor)")
    return [], SIN_EVALUACION


def _entrenar_red(capturas: list[dict], etiquetas: list[int], op: OpcionesEntrenamiento, rng: np.random.Generator):
    """MLP de Keras: Normalización → Densa+ReLU → BatchNorm → Dropout → Densas+ReLU → Softmax.
    Cada `renovar_cada` épocas se generan variantes aumentadas nuevas. Se entrena con TODAS las
    capturas que recibe (sin apartar validación). Devuelve (red, clases): clases[i] = senaId de la salida i."""
    import keras  # diferido: TensorFlow tarda varios segundos en cargar y el menú no lo necesita

    keras.utils.set_random_seed(op.semilla)
    X, y, _ = _vectores(capturas, etiquetas, op, rng, True)
    clases = np.unique(y)
    media, escala = X.mean(axis=0), X.std(axis=0)
    escala = np.where(escala > 1e-6, escala, 1.0)

    entrada = keras.Input((X.shape[1],))
    h = keras.layers.Normalization(mean=media, variance=escala ** 2)(entrada)
    for i, n in enumerate(op.capas_ocultas):
        h = keras.layers.Dense(n, activation="relu")(h)
        if i == 0:
            h = keras.layers.BatchNormalization()(h)
            h = keras.layers.Dropout(op.dropout)(h)
    red = keras.Model(entrada, keras.layers.Dense(len(clases), activation="softmax")(h))
    red.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy")

    for inicio in range(0, op.epocas, op.renovar_cada):
        if inicio:
            X, y, _ = _vectores(capturas, etiquetas, op, rng, True)
        orden = rng.permutation(len(X))
        red.fit(X[orden], np.searchsorted(clases, y[orden]), initial_epoch=inicio,
                epochs=min(inicio + op.renovar_cada, op.epocas), batch_size=32, verbose=0)
    return red, clases


def _predecir(red, clases: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(seña predicha, su probabilidad)."""
    if not len(X):
        return np.array([], dtype=int), np.array([])
    prob = red.predict(X, verbose=0)
    return clases[prob.argmax(axis=1)], prob.max(axis=1)


def calcular_umbral(real: np.ndarray, pred: np.ndarray, conf: np.ndarray, objetivo: float) -> Optional[float]:
    """El umbral más bajo (0.50 a 0.95) con el que, de lo que el modelo acepta, acierta al menos `objetivo`.
    `real` incluye los ejemplos de "ninguna seña": aceptar uno cuenta como error. Si ninguno llega al
    objetivo, el de mayor precisión."""
    mejor, mejor_precision = None, -1.0
    for t in np.round(np.arange(0.5, 0.951, 0.05), 2):
        acepta = (pred != NINGUNA) & (conf >= t)
        if not acepta.any():
            continue
        precision = float(np.mean(pred[acepta] == real[acepta]))
        if precision >= objetivo:
            return float(t)
        if precision > mejor_precision:
            mejor, mejor_precision = float(t), precision
    return mejor


def _metricas_prueba(yte: np.ndarray, pred: np.ndarray, etiquetas: np.ndarray, nombres: list[str]) -> tuple[dict, list]:
    """Precisión/sensibilidad por seña y matriz de confusión (filas = real, columnas = predicha)."""
    confusion = np.array([[int(np.sum((yte == a) & (pred == b))) for b in etiquetas] for a in etiquetas])
    reporte = {}
    for i, nombre in enumerate(nombres):
        aciertos, predichas, reales = confusion[i, i], confusion[:, i].sum(), confusion[i].sum()
        reporte[nombre] = {"precision": aciertos / predichas if predichas else 0.0,
                           "recall": aciertos / reales if reales else 0.0, "support": int(reales)}
    return reporte, confusion.tolist()


def evaluar(ds: Dataset, op: OpcionesEntrenamiento) -> dict:
    """Métricas con datos que el modelo no vio. Solo mide: no entrega ningún modelo."""
    rng = np.random.default_rng(op.semilla)
    capturas = [m.captura for m in ds.muestras]
    etiquetas = [m.sena_id for m in ds.muestras]
    pliegues, tipo = _pliegues(ds, op)
    metricas = {
        "particion": tipo, "rondas": len(pliegues),
        "muestrasEntrenamiento": int(len(pliegues[0][0])) if len(pliegues) == 1 else len(ds.muestras),
        "muestrasPrueba": int(sum(len(te) for _, te in pliegues)),
        "personasPrueba": len({ds.muestras[i].participante for _, te in pliegues for i in te}),
        "exactitud": None, "exactitudSobreUmbral": None, "coberturaUmbral": None,
        "exactitudPorPersona": {}, "desviacionPersonas": None, "rechazoNinguna": None,
        "umbral": op.umbral_sugerido, "umbralCalculado": False,
        "reporte": {}, "confusion": [], "clasesConfusion": [],
    }
    reales, preds, confs, personas = [], [], [], []      # muestras reales de prueba
    neg_preds, neg_confs = [], []                          # "ninguna seña" de prueba
    for tr, te in pliegues:
        cap_tr, et_tr = _con_ninguna([capturas[i] for i in tr], [etiquetas[i] for i in tr], op, rng)
        red, clases = _entrenar_red(cap_tr, et_tr, op, rng)
        Xte, yte, origen = _vectores([capturas[i] for i in te], [etiquetas[i] for i in te], op, rng, False)
        p, c = _predecir(red, clases, Xte)
        reales.append(yte), preds.append(p), confs.append(c)
        personas += [ds.muestras[te[o]].participante for o in origen]
        if op.clase_ninguna:
            negativos = empalmes([capturas[i] for i in te], [etiquetas[i] for i in te], max(2, len(te) // 4), rng)
            Xn, _, _ = _vectores(negativos, [NINGUNA] * len(negativos), op, rng, False)
            p, c = _predecir(red, clases, Xn)
            neg_preds.append(p), neg_confs.append(c)

    if not pliegues or not sum(len(r) for r in reales):
        metricas["particion"] = SIN_EVALUACION
        return metricas
    real, pred, conf, personas = np.concatenate(reales), np.concatenate(preds), np.concatenate(confs), np.array(personas)
    neg_pred = np.concatenate(neg_preds) if neg_preds else np.array([], dtype=int)
    neg_conf = np.concatenate(neg_confs) if neg_confs else np.array([])

    umbral = calcular_umbral(np.concatenate([real, np.full(len(neg_pred), NINGUNA)]),
                             np.concatenate([pred, neg_pred]), np.concatenate([conf, neg_conf]), op.precision_objetivo)
    if umbral is not None:
        metricas.update(umbral=umbral, umbralCalculado=True)
    umbral = metricas["umbral"]
    acepta = (pred != NINGUNA) & (conf >= umbral)
    por_persona = {p: float(np.mean(pred[personas == p] == real[personas == p])) for p in sorted(set(personas.tolist()))}
    etiquetas_reporte = np.union1d(real, pred)  # incluye señas que solo están en la prueba y "ninguna" si se predijo
    nombres = [nombre_clase(ds, int(c)) for c in etiquetas_reporte]
    reporte, confusion = _metricas_prueba(real, pred, etiquetas_reporte, nombres)
    metricas.update({
        "exactitud": float(np.mean(pred == real)),
        "exactitudSobreUmbral": float(np.mean(pred[acepta] == real[acepta])) if acepta.any() else None,
        "coberturaUmbral": float(acepta.mean()),
        "exactitudPorPersona": por_persona,
        "desviacionPersonas": float(np.std(list(por_persona.values()))) if tipo == POR_PERSONA and len(por_persona) > 1 else None,
        "rechazoNinguna": float(np.mean((neg_pred == NINGUNA) | (neg_conf < umbral))) if len(neg_pred) else None,
        "reporte": reporte, "confusion": confusion, "clasesConfusion": nombres,
    })
    return metricas


def entrenar(ds: Dataset, op: OpcionesEntrenamiento = OpcionesEntrenamiento(), solo_evaluar: bool = False) -> Resultado:
    """Mide con datos no vistos y entrena el modelo final con el 100 % de las muestras y personas."""
    if len(ds.conteo_por_sena()) < 2:
        raise ValueError("Se necesitan muestras de al menos 2 señas distintas para entrenar un clasificador.")
    metricas = evaluar(ds, op)
    if solo_evaluar:
        return Resultado(None, metricas, None, [])

    rng = np.random.default_rng(op.semilla + 1)
    capturas, etiquetas = _con_ninguna([m.captura for m in ds.muestras], [m.sena_id for m in ds.muestras], op, rng)
    if len({e for e, v in zip(etiquetas, capturas) if e != NINGUNA and caracteristicas(v, op.config) is not None}) < 2:
        raise ValueError("Hay manos visibles en las muestras de menos de 2 señas: revisa las grabaciones.")
    red, clases = _entrenar_red(capturas, etiquetas, op, rng)
    return Resultado(
        modelo=exportar(red, clases, ds, op, metricas),
        metricas=metricas,
        tflite=a_tflite(red),
        etiquetas=[nombre_clase(ds, int(c)) for c in clases],
    )


def a_tflite(red) -> bytes:
    import contextlib
    import io

    import tensorflow as tf

    with contextlib.redirect_stdout(io.StringIO()):  # el conversor imprime la firma del modelo
        return tf.lite.TFLiteConverter.from_keras_model(red).convert()


def capas_desde_red(red) -> tuple[np.ndarray, np.ndarray, list[tuple[np.ndarray, np.ndarray, str]]]:
    """(media, escala, capas) con la BatchNorm FUSIONADA en la densa siguiente, igual que TFLite.
    Exportar solo las densas, sin la BatchNorm, daría otro modelo. Dropout no actúa al predecir."""
    media = escala = bn = None  # bn = (a, c): la BatchNorm calcula a·x + c
    capas = []
    for capa in red.layers:
        tipo = type(capa).__name__
        if tipo == "Normalization":
            media = np.asarray(capa.mean, dtype=np.float64).ravel()
            escala = np.sqrt(np.asarray(capa.variance, dtype=np.float64).ravel())
        elif tipo == "BatchNormalization":
            gamma, beta, mm, mv = (np.asarray(w, dtype=np.float64) for w in capa.get_weights())
            a = gamma / np.sqrt(mv + capa.epsilon)
            bn = (a, beta - mm * a)
        elif tipo == "Dense":
            W, b = (np.asarray(w, dtype=np.float64) for w in capa.get_weights())
            if bn is not None:
                W, b, bn = bn[0][:, None] * W, bn[1] @ W + b, None
            capas.append((W, b, capa.activation.__name__))
    return media, escala, capas


def _b64(arr: np.ndarray, tipo: str) -> str:
    return base64.b64encode(np.ascontiguousarray(arr, dtype="<f2" if tipo == "float16" else "<f4").tobytes()).decode("ascii")


def exportar(red, clases: np.ndarray, ds: Dataset, op: OpcionesEntrenamiento, metricas: dict,
             tipo_pesos: str = "float16") -> dict:
    media, escala, capas = capas_desde_red(red)
    assert media.shape[0] == dimension_por_frame(op.config) * op.config.frames
    return {
        "formato": FORMATO,
        "version": VERSION,
        "creado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "caracteristicas": op.config.a_json(),
        "clases": [{"senaId": int(c), "palabra": NOMBRE_NINGUNA if c == NINGUNA else ds.senas[int(c)]} for c in clases],
        "normalizacion": {"media": _b64(media, "float32"), "escala": _b64(escala, "float32")},
        "tipoPesos": tipo_pesos,
        "capas": [
            {"entrada": int(W.shape[0]), "salida": int(W.shape[1]), "activacion": act, "pesos": _b64(W, tipo_pesos), "sesgos": _b64(b, tipo_pesos)}
            for W, b, act in capas
        ],
        "umbralSugerido": metricas["umbral"],
        "metricas": {k: metricas[k] for k in ("particion", "muestrasEntrenamiento", "muestrasPrueba", "exactitud", "exactitudSobreUmbral",
                                              "coberturaUmbral", "desviacionPersonas", "rechazoNinguna", "umbralCalculado")},
    }


# --- Inferencia en Python, EXACTAMENTE como la hace la app (pesos cuantizados) ---

def _decodificar(b64: str, tipo: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype="<f2" if tipo == "float16" else "<f4").astype(np.float64)


def probabilidades(modelo: dict, vector: np.ndarray) -> np.ndarray:
    media = _decodificar(modelo["normalizacion"]["media"], "float32")
    escala = _decodificar(modelo["normalizacion"]["escala"], "float32")
    x = (np.asarray(vector, dtype=np.float64) - media) / np.where(escala != 0, escala, 1.0)
    for capa in modelo["capas"]:
        W = _decodificar(capa["pesos"], modelo["tipoPesos"]).reshape(capa["entrada"], capa["salida"])
        b = _decodificar(capa["sesgos"], modelo["tipoPesos"])
        z = x @ W + b
        if capa["activacion"] == "relu":
            x = np.maximum(z, 0.0)
        else:
            e = np.exp(z - z.max())
            x = e / e.sum()
    return x
