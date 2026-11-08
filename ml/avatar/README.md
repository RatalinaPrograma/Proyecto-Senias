# 🦊 Cara del zorrito 3D (avatar de AI Studio)

La cabeza del zorrito 3D (`signy/src/app/motor-senas/avatar/personajes.ts`) lleva pintada la cara
de la ilustración oficial (`signy/src/assets/img/EstasListo.png`): ojos, cejas, nariz y boca son
los del dibujo, no una imitación. Esta carpeta tiene el proceso que hornea esa textura:

```
 EstasListo.png ──► calibracion.py ──► proyectar.py ──► signy/src/assets/modelos/zorro-cara.webp
 (ilustración)      (dónde estaba        (proyecta el       (la app la carga al mostrar el zorrito)
                     la "cámara")         dibujo en 3D)
                                    └──► blender_cabeza.py ──► salida/ (vistas, .glb y .blend para retocar)
```

| Archivo | Qué hace |
| --- | --- |
| `cabeza.py` | Forma de la cabeza, **igual** que `radioCabezaZorro` en `personajes.ts`. |
| `calibracion.py` | Rasgos marcados a mano en el dibujo + `solvePnP` de OpenCV → pose de la cabeza en la ilustración. |
| `proyectar.py` | Hornea la textura: z-buffer (no toma color de lo tapado), simetría con la mitad que mejor se ve, colores del modelo donde el dibujo no muestra nada. |
| `blender_cabeza.py` | Arma la cabeza en Blender, la renderiza de frente, 3/4, perfil y espalda, y exporta `.glb` + `.blend`. |

## Uso

Desde la raíz del repo:

```bash
python -m pip install -r ml/avatar/requirements.txt
python ml/avatar/calibracion.py   # error por rasgo (unos pocos px está bien)
python ml/avatar/proyectar.py     # reescribe signy/src/assets/modelos/zorro-cara.webp
```

Para revisar en Blender (opcional): `pip install bpy` (en la versión de Python que pida Blender) y
`python ml/avatar/blender_cabeza.py`, o con Blender instalado:
`blender --background --python ml/avatar/blender_cabeza.py`. Los archivos quedan en `ml/avatar/salida/`.

## Si se cambia la cabeza

La textura está hecha para una forma exacta. Si se cambia `radioCabezaZorro` en `personajes.ts`
(o las orejas), hay que hacer el mismo cambio en `cabeza.py`, volver a correr `proyectar.py` y
subir la textura nueva. Si se cambia la ilustración, hay que volver a marcar los rasgos en
`RASGOS_DIBUJO` (`calibracion.py`).

## Límites

- El dibujo muestra la cara de 3/4: la mitad del ojo cercano se usa para ambos lados (la cara queda
  simétrica). Nuca, coronilla y costados bajos usan los colores del modelo con un sombreado suave.
- Los ojos están pintados: no se mueven por separado. El parpadeo es un párpado que se dibuja encima.
