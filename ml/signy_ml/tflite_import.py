"""Importa un clasificador MLP exportado a TFLite (p. ej. desde Keras) al formato de la app.

Por qué leer el .tflite y no los pesos de Keras: al convertir a TFLite, las
capas BatchNormalization quedan FUSIONADAS dentro de la capa densa siguiente.
Exportar a JSON solo los pesos de las capas densas (sin la BatchNorm) da un
modelo DISTINTO al entrenado. Leyendo el .tflite se obtiene exactamente lo que
se entrenó, ya fusionado.

Soporta: FULLY_CONNECTED (activación NONE o RELU fusionada) + SOFTMAX final,
pesos float32/float16 o int8 con cuantización por canal (rango dinámico).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

try:  # dependencia opcional: solo hace falta para importar modelos TFLite
    import tflite
except ImportError:  # pragma: no cover
    tflite = None


class ModeloNoSoportado(ValueError):
    pass


def _tensor(modelo, grafo, indice: int) -> np.ndarray:
    t = grafo.Tensors(indice)
    datos = modelo.Buffers(t.Buffer()).DataAsNumpy()
    if isinstance(datos, int) or datos is None or len(datos) == 0:
        raise ModeloNoSoportado(f"El tensor {t.Name().decode()} no tiene valores constantes.")
    forma = t.ShapeAsNumpy().tolist()
    crudo = np.asarray(datos).tobytes()
    tipo = t.Type()
    if tipo == tflite.TensorType.FLOAT32:
        return np.frombuffer(crudo, dtype="<f4").astype(np.float64).reshape(forma)
    if tipo == tflite.TensorType.FLOAT16:
        return np.frombuffer(crudo, dtype="<f2").astype(np.float64).reshape(forma)
    if tipo == tflite.TensorType.INT8:
        q = t.Quantization()
        escala, cero = q.ScaleAsNumpy(), q.ZeroPointAsNumpy()
        valores = np.frombuffer(crudo, dtype=np.int8).astype(np.float64).reshape(forma)
        if np.size(escala) == forma[0]:  # por canal de salida
            return (valores - np.reshape(cero, (-1, 1))) * np.reshape(escala, (-1, 1))
        return (valores - float(np.ravel(cero)[0])) * float(np.ravel(escala)[0])
    if tipo == tflite.TensorType.INT32 and len(forma) == 1:  # sesgos de modelos totalmente cuantizados
        raise ModeloNoSoportado("Modelo cuantizado entero completo: exportar con cuantización de rango dinámico o float.")
    raise ModeloNoSoportado(f"Tipo de tensor no soportado: {tipo}.")


def leer_mlp_tflite(ruta) -> list[tuple[np.ndarray, np.ndarray, str]]:
    """Capas (pesos entrada×salida, sesgos, 'relu'|'softmax') de un MLP en TFLite."""
    if tflite is None:
        raise ModeloNoSoportado("Falta el paquete 'tflite': pip install tflite")
    buf = Path(ruta).read_bytes()
    modelo = tflite.Model.GetRootAsModel(buf, 0)
    grafo = modelo.Subgraphs(0)
    nombres = {v: k for k, v in vars(tflite.BuiltinOperator).items() if not k.startswith("_")}

    capas: list[tuple[np.ndarray, np.ndarray, str]] = []
    termina_en_softmax = False
    for i in range(grafo.OperatorsLength()):
        op = grafo.Operators(i)
        codigo = modelo.OperatorCodes(op.OpcodeIndex())
        nombre = nombres.get(max(codigo.BuiltinCode(), codigo.DeprecatedBuiltinCode()), "?")
        if termina_en_softmax:
            raise ModeloNoSoportado(f"Hay una operación ({nombre}) después del SOFTMAX.")
        if nombre == "FULLY_CONNECTED":
            opciones = tflite.FullyConnectedOptions()
            tabla = op.BuiltinOptions()
            opciones.Init(tabla.Bytes, tabla.Pos)
            activacion = opciones.FusedActivationFunction()
            if activacion not in (tflite.ActivationFunctionType.NONE, tflite.ActivationFunctionType.RELU):
                raise ModeloNoSoportado("Solo se soportan activaciones ReLU.")
            W = _tensor(modelo, grafo, op.Inputs(1))  # TFLite guarda [salida, entrada]
            b = _tensor(modelo, grafo, op.Inputs(2)) if op.InputsLength() > 2 and op.Inputs(2) >= 0 else np.zeros(W.shape[0])
            capas.append((W.T.copy(), np.asarray(b, dtype=np.float64), "relu" if activacion == tflite.ActivationFunctionType.RELU else "lineal"))
        elif nombre == "SOFTMAX":
            termina_en_softmax = True
        elif nombre in ("RESHAPE",):
            continue
        else:
            raise ModeloNoSoportado(f"Operación no soportada en el modelo: {nombre}. Solo MLP (densas + ReLU + softmax).")

    if not capas or not termina_en_softmax or capas[-1][2] != "lineal":
        raise ModeloNoSoportado("El modelo debe terminar en una capa densa sin activación seguida de SOFTMAX.")
    if any(act == "lineal" for _, _, act in capas[:-1]):
        raise ModeloNoSoportado("Las capas ocultas deben usar ReLU.")
    for (W1, _, _), (W2, _, _) in zip(capas, capas[1:]):
        if W1.shape[1] != W2.shape[0]:
            raise ModeloNoSoportado("Las dimensiones de las capas no encadenan.")
    W, b, _ = capas[-1]
    capas[-1] = (W, b, "softmax")
    return capas


def inferir(capas, x: np.ndarray) -> np.ndarray:
    """Probabilidades del MLP (x ya normalizado). Acepta un vector o una matriz de filas."""
    h = np.atleast_2d(np.asarray(x, dtype=np.float64))
    for W, b, act in capas:
        z = h @ W + b
        if act == "relu":
            h = np.maximum(z, 0.0)
        else:
            e = np.exp(z - z.max(axis=1, keepdims=True))
            h = e / e.sum(axis=1, keepdims=True)
    return h if np.ndim(x) > 1 else h[0]
