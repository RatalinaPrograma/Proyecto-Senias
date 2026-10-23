"""Entrenamiento, evaluación y exportación del clasificador de señas."""
from __future__ import annotations

import base64
import math
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

from .aumentacion import aumentar, espejar
from .caracteristicas import ConfigCaracteristicas, caracteristicas, dimension_por_frame
from .dataset import Dataset

FORMATO = "signy-clasificador"
# 2: las características ignoran la mano que descansa abajo (mano_en_reposo).
VERSION = 2


@dataclass
class OpcionesEntrenamiento:
    config: ConfigCaracteristicas = ConfigCaracteristicas()
    capas_ocultas: tuple[int, ...] = (64, 32)
    aumentos_por_muestra: int = 10
    incluir_espejo: bool = True
    regularizacion: float = 1e-3
    iteraciones: int = 400
    fraccion_prueba: float = 0.25
    semilla: int = 42
    umbral_sugerido: float = 0.6


def _vectores(capturas: list[dict], etiquetas: list[int], op: OpcionesEntrenamiento, rng: np.random.Generator, aumentar_datos: bool):
    X, y = [], []
    for captura, etiqueta in zip(capturas, etiquetas):
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
    return np.array(X), np.array(y)


SIN_EVALUACION = "sin evaluación (muy pocas muestras para separar una parte de prueba: graba más)"


def _particion(ds: Dataset, op: OpcionesEntrenamiento) -> tuple[np.ndarray, np.ndarray, str]:
    """Separa entrenamiento/prueba. Si hay 3+ personas distintas, la prueba se hace
    con personas que el modelo NUNCA vio (lo que de verdad importa en la app).

    Con muy pocas muestras (lo normal al empezar a grabar) no siempre se puede
    separar una parte de prueba: en ese caso la prueba queda vacía y el modelo
    igual se entrena, pero sin métricas."""
    n = len(ds.muestras)
    indices = np.arange(n)
    etiquetas = np.array([m.sena_id for m in ds.muestras])
    grupos = np.array([m.participante for m in ds.muestras])
    if len(set(grupos)) >= 3:
        gss = GroupShuffleSplit(n_splits=1, test_size=op.fraccion_prueba, random_state=op.semilla)
        tr, te = next(gss.split(indices, etiquetas, grupos))
        if len(set(etiquetas[tr])) >= 2:
            return tr, te, "por persona (la prueba es con personas no vistas en el entrenamiento)"
        # Las personas que quedaron para entrenar grabaron una sola seña: se separa al azar.

    clases, conteo = np.unique(etiquetas, return_counts=True)
    n_prueba = max(1, math.ceil(op.fraccion_prueba * n))
    if conteo.min() >= 2:
        # Estratificada: al menos una muestra de cada seña en prueba (y en entrenamiento).
        n_prueba = max(n_prueba, len(clases))
        if n - n_prueba >= len(clases):
            tr, te = train_test_split(indices, test_size=n_prueba, random_state=op.semilla, stratify=etiquetas)
            return tr, te, "aleatoria (hay menos de 3 personas: la precisión real con alumnos nuevos puede ser menor)"
    if n - n_prueba >= 2:
        tr, te = train_test_split(indices, test_size=n_prueba, random_state=op.semilla)
        if len(set(etiquetas[tr])) >= 2:
            return tr, te, ("aleatoria, no estratificada (hay señas con 1 sola muestra; "
                            "la precisión real con alumnos nuevos puede ser menor)")
    return indices, np.array([], dtype=int), SIN_EVALUACION


def _entrenar_red(X: np.ndarray, y: np.ndarray, op: OpcionesEntrenamiento) -> tuple[StandardScaler, MLPClassifier]:
    escalador = StandardScaler().fit(X)
    red = MLPClassifier(
        hidden_layer_sizes=op.capas_ocultas, activation="relu", alpha=op.regularizacion,
        max_iter=op.iteraciones, early_stopping=len(X) >= 50, random_state=op.semilla,
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        red.fit(escalador.transform(X), y)
    return escalador, red


def entrenar(ds: Dataset, op: OpcionesEntrenamiento = OpcionesEntrenamiento()) -> tuple[dict, dict]:
    """Devuelve (modelo_json, metricas). El modelo final se entrena con TODOS los datos."""
    clases = sorted(ds.conteo_por_sena())
    if len(clases) < 2:
        raise ValueError("Se necesitan muestras de al menos 2 señas distintas para entrenar un clasificador.")
    rng = np.random.default_rng(op.semilla)
    capturas = [m.captura for m in ds.muestras]
    etiquetas = [m.sena_id for m in ds.muestras]

    # 1) Evaluación honesta con datos separados.
    tr, te, tipo_particion = _particion(ds, op)
    metricas = {
        "particion": tipo_particion,
        "muestrasEntrenamiento": int(len(tr)), "muestrasPrueba": int(len(te)),
        "personasPrueba": len({ds.muestras[i].participante for i in te}),
        "vectoresEntrenamiento": 0,
        "exactitud": None, "exactitudSobreUmbral": None, "coberturaUmbral": None,
        "reporte": {}, "confusion": [], "clasesConfusion": [],
    }
    Xte, yte = _vectores([capturas[i] for i in te], [etiquetas[i] for i in te], op, rng, False)
    Xtr, ytr = _vectores([capturas[i] for i in tr], [etiquetas[i] for i in tr], op, rng, True) if len(Xte) else (None, None)
    if len(Xte) and len(set(ytr.tolist())) >= 2:
        escalador, red = _entrenar_red(Xtr, ytr, op)
        pred = red.predict(escalador.transform(Xte))
        prob = red.predict_proba(escalador.transform(Xte))
        acepta = prob.max(axis=1) >= op.umbral_sugerido
        # Señas que solo aparecen en la prueba (las grabó solo una persona) también cuentan en el reporte.
        etiquetas_reporte = np.union1d(red.classes_, yte)
        nombres = [ds.nombre(int(c)) for c in etiquetas_reporte]
        metricas.update({
            "vectoresEntrenamiento": int(len(Xtr)),
            "exactitud": float(accuracy_score(yte, pred)),
            "exactitudSobreUmbral": float(accuracy_score(yte[acepta], pred[acepta])) if acepta.any() else None,
            "coberturaUmbral": float(acepta.mean()),
            "reporte": classification_report(yte, pred, labels=etiquetas_reporte, target_names=nombres, zero_division=0, output_dict=True),
            "confusion": confusion_matrix(yte, pred, labels=etiquetas_reporte).tolist(),
            "clasesConfusion": nombres,
        })
    elif len(te):
        metricas["particion"] = SIN_EVALUACION

    # 2) Modelo final con todos los datos.
    Xall, yall = _vectores(capturas, etiquetas, op, rng, True)
    if len(set(yall.tolist())) < 2:
        raise ValueError("Hay manos visibles en las muestras de menos de 2 señas: revisa las grabaciones.")
    escalador, red = _entrenar_red(Xall, yall, op)
    modelo = exportar(red, escalador, ds, op, metricas)
    return modelo, metricas


def _b64(arr: np.ndarray, tipo: str) -> str:
    return base64.b64encode(np.ascontiguousarray(arr, dtype="<f2" if tipo == "float16" else "<f4").tobytes()).decode("ascii")


def capas_desde_red(red: MLPClassifier) -> list[tuple[np.ndarray, np.ndarray, str]]:
    """(pesos entrada×salida, sesgos, activación). Convierte la salida binaria
    de scikit-learn (1 neurona logística) en softmax de 2 neuronas equivalente."""
    capas = []
    n = len(red.coefs_)
    for i, (W, b) in enumerate(zip(red.coefs_, red.intercepts_)):
        if i < n - 1:
            capas.append((W, b, "relu"))
        elif red.out_activation_ == "logistic":
            capas.append((np.hstack([np.zeros_like(W), W]), np.concatenate([[0.0], b]), "softmax"))
        else:
            capas.append((W, b, "softmax"))
    return capas


def exportar(red: MLPClassifier, escalador: StandardScaler, ds: Dataset, op: OpcionesEntrenamiento, metricas: dict,
             tipo_pesos: str = "float16") -> dict:
    escala = np.where(escalador.scale_ > 0, escalador.scale_, 1.0)
    dim = dimension_por_frame(op.config) * op.config.frames
    assert escalador.mean_.shape[0] == dim
    capas = capas_desde_red(red)
    return {
        "formato": FORMATO,
        "version": VERSION,
        "creado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "caracteristicas": op.config.a_json(),
        "clases": [{"senaId": int(c), "palabra": ds.senas[int(c)]} for c in red.classes_],
        "normalizacion": {"media": _b64(escalador.mean_, "float32"), "escala": _b64(escala, "float32")},
        "tipoPesos": tipo_pesos,
        "capas": [
            {"entrada": int(W.shape[0]), "salida": int(W.shape[1]), "activacion": act, "pesos": _b64(W, tipo_pesos), "sesgos": _b64(b, tipo_pesos)}
            for W, b, act in capas
        ],
        "umbralSugerido": op.umbral_sugerido,
        "metricas": {k: metricas[k] for k in ("particion", "muestrasEntrenamiento", "muestrasPrueba", "exactitud", "exactitudSobreUmbral", "coberturaUmbral")},
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
