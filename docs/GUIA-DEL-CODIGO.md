# Guía del código

Recorrido por el código de Atlas Financiero para entender cómo está construido. Los fragmentos son copias literales del repositorio.

Este proyecto **no usa base de datos**: es un sitio estático. Los datos se descargan de la SEC con scripts de Python, se guardan en JSON y se empaquetan en un archivo JavaScript que el navegador lee directamente. Así el panel se abre con un doble clic sobre `index.html`, sin servidor.

## Contenido

1. [El recorrido de los datos](#1-el-recorrido-de-los-datos)
2. [ETL: de la API de la SEC al JSON](#2-etl-de-la-api-de-la-sec-al-json)
3. [Ejercicios fiscales distintos](#3-ejercicios-fiscales-distintos)
4. [El cuarto trimestre derivado](#4-el-cuarto-trimestre-derivado)
5. [Desgloses sin duplicar subtotales](#5-desgloses-sin-duplicar-subtotales)
6. [Empaquetado para abrir sin servidor](#6-empaquetado-para-abrir-sin-servidor)
7. [El panel: estado y render](#7-el-panel-estado-y-render)
8. [Gráficos en SVG sin librerías](#8-gráficos-en-svg-sin-librerías)
9. [Diseño, color y accesibilidad](#9-diseño-color-y-accesibilidad)

## 1. El recorrido de los datos

```
SEC EDGAR (API company facts)  ──► scripts/fetch_sec_data.py  ──► data/financials.json
SEC EDGAR (instancias XBRL)    ──► scripts/fetch_segments.py  ──► data/segments.json
                                   scripts/build_bundle.py    ──► data/dataset.js
index.html + assets/js/*.js    lee window.DASHBOARD_DATA      ──► panel en el navegador
```

Las descargas se guardan en `.cache/` (ignorada por git): sin `--refresh`, los scripts reutilizan lo descargado y no vuelven a llamar a la SEC.

## 2. ETL: de la API de la SEC al JSON

`scripts/fetch_sec_data.py` pide a la API *company facts* todos los hechos XBRL de cada compañía (lista `COMPANIES`, con su CIK y su mes de cierre fiscal) y extrae ingresos, beneficio neto, flujo operativo y capex de los 10-K.

El problema: las compañías **cambian de etiqueta** XBRL con los años. Por eso `annual_series` recibe una lista de etiquetas por orden de preferencia y, para cada ejercicio, se queda con la más preferente disponible y, dentro de ella, con la presentación más reciente (que incorpora las correcciones):

```python
# gana el tag mas preferente (rank menor) y, dentro de el, el 10-K mas reciente
return {fy: min(c, key=lambda t: (t[0], _inv(t[1])))[2] for fy, c in cands.items()}
```

Además filtra por duración: un valor anual debe cubrir entre 330 y 400 días, porque el mismo 10-K también publica cifras trimestrales y acumuladas.

## 3. Ejercicios fiscales distintos

NVIDIA cierra su ejercicio en enero, Microsoft en junio, Apple en septiembre y el resto en diciembre. Una sola función asigna cada periodo a su ejercicio:

```python
def fiscal_year(end: date, fy_end_month: int) -> int:
    """Ejercicio fiscal al que pertenece una fecha de cierre.

    Un periodo que termina despues del mes de cierre ya pertenece al ejercicio
    siguiente: el trimestre de Apple que acaba en diciembre de 2024 es 1T FY2025,
    y el de NVIDIA que acaba en abril de 2025 es 1T FY2026.
    """
    return end.year + 1 if end.month > fy_end_month else end.year
```

Por eso el panel etiqueta cada columna con su ejercicio (`FY2025`, `FY2026`) y ofrece la base **Últimos 12 meses**, que suma los cuatro trimestres más recientes de cada compañía y sí es comparable entre ellas.

## 4. El cuarto trimestre derivado

Las compañías publican tres trimestres en sus 10-Q, pero el cuarto no aparece suelto: va dentro del anual del 10-K. `quarterly_revenue` lo calcula:

```python
if len(vals) == 3 and fy in annual:  # 4T derivado
    rest = annual[fy] - sum(v["revenue"] for v in vals)
    if rest > 0:
        vals.append({"fy": fy, "q": 4, "revenue": rest, "derived": True,
                     "end": fy_ends.get(fy, date(fy, fy_end_month, 28)).isoformat()})
```

El campo `derived: True` viaja hasta el navegador, que dibuja esos puntos huecos en la gráfica trimestral y lo indica en el tooltip: el usuario sabe qué cifra es publicada y cuál es calculada.

## 5. Desgloses sin duplicar subtotales

`scripts/fetch_segments.py` lee la instancia XBRL de cada 10-K para obtener los ingresos por segmento, producto y geografía. Un 10-K publica a la vez el subtotal y su detalle (Apple etiqueta "Productos" y también iPhone, Mac, iPad...), así que sumar todo duplicaría los ingresos. `best_decomposition` busca la combinación correcta:

```python
items = sorted(members.items(), key=lambda kv: -kv[1])[:16]
tol = max(total * 0.003, 1.0)
best: list[tuple[str, float]] = []
for mask in range(1, 1 << len(items)):
    chosen = [items[i] for i in range(len(items)) if mask >> i & 1]
```

Prueba los subconjuntos de miembros (cada `mask` es una combinación, como un número binario), se queda con los que suman el total consolidado con un margen del 0,3 % y, entre ellos, con el más detallado. Por eso cada reparto del panel suma exactamente los ingresos declarados.

## 6. Empaquetado para abrir sin servidor

Un navegador no deja leer archivos JSON locales con `fetch` cuando se abre un archivo con `file://`. `scripts/build_bundle.py` resuelve esto escribiendo los dos JSON dentro de un script:

```python
"window.DASHBOARD_DATA = " + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n",
```

`index.html` carga `data/dataset.js` antes que el resto, y el panel encuentra los datos en `window.DASHBOARD_DATA`.

## 7. El panel: estado y render

`assets/js/app.js` guarda todo lo que el usuario puede cambiar en un único objeto:

```js
const state = {
  basis: 'fy',
  metric: 'revenue',
  selected: 'NVDA',
  mixAxis: null,
  filter: '',
  sort: { key: 'revenue', dir: -1 },
};
```

Cada control (base fiscal o últimos 12 meses, métrica, compañía, buscador, orden de la tabla) modifica el estado y vuelve a dibujar el panel. Toda cifra pasa por una sola función, `value()`, que sabe calcular la métrica en las dos bases:

```js
function value(c, when = 'current') {
  if (state.basis === 'ttm') {
    const q = c.quarterly;
    const slice = when === 'current' ? q.slice(-4) : q.slice(-8, -4);
    return slice.length === 4 ? sumQ(slice) : null;
  }
  const row = when === 'current' ? last(c) : prev(c);
  return row ? row[state.metric] : null;
}
```

La sección *Lectura del analista* no está escrita a mano: genera las conclusiones a partir de los datos cargados, así que se actualiza sola cuando se refrescan.

`assets/js/format.js` da formato a los números en español (separador de miles, millones de dólares, porcentajes con signo).

## 8. Gráficos en SVG sin librerías

`assets/js/charts.js` dibuja columnas, líneas, donut y dispersión creando elementos SVG directamente:

```js
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
};
```

Sin dependencias externas el panel pesa poco y no depende de ninguna CDN. Los colores se leen de las variables CSS (`css('--...')`), así que el modo oscuro cambia los gráficos sin volver a calcular nada.

## 9. Diseño, color y accesibilidad

- `assets/css/styles.css` define los colores como variables, con valores propios para el modo oscuro (no una inversión automática). El tema elegido se guarda en `localStorage`; si no hay ninguno, se respeta la preferencia del sistema.
- La paleta categórica está validada para daltonismo.
- Toda serie con color tiene leyenda y etiqueta directa, y la tabla ofrece las mismas cifras sin depender del color; se puede ordenar por cualquier columna y exportar a CSV.
