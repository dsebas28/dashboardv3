# Atlas Financiero · Big Tech

Dashboard de análisis financiero de las siete mayores tecnológicas cotizadas de EE. UU.
Todas las cifras se extraen de los documentos que las propias compañías presentan a la
**SEC** (formularios 10-K y 10-Q en XBRL). No hay datos escritos a mano ni estimaciones.

![Atlas Financiero](docs/screenshots/01-inicio.png)

> **Cómo está hecho:** [Guía del código](docs/GUIA-DEL-CODIGO.md) en español: ETL contra la SEC, ejercicios fiscales, trimestres derivados, desgloses sin duplicar y gráficos SVG sin librerías.

| | |
|---|---|
| **Universo** | NVIDIA, Apple, Microsoft, Alphabet, Amazon, Meta, Tesla |
| **Fuente** | [SEC EDGAR — XBRL company facts API](https://www.sec.gov/edgar/sec-api-documentation) e instancias XBRL de cada 10-K |
| **Cobertura** | Últimos 6 ejercicios fiscales y 12 trimestres por compañía |
| **Stack** | HTML, CSS y JavaScript sin dependencias · Python 3 para el ETL |

---

## Qué resuelve

Comparar estas compañías no es trivial: **cada una cierra su ejercicio fiscal en un mes
distinto**. NVIDIA cierra en enero, Microsoft en junio, Apple en septiembre y el resto en
diciembre. Poner sus «ingresos anuales» en la misma barra sin advertirlo es un error de
análisis frecuente.

El panel lo trata de forma explícita:

- Cada columna indica **qué ejercicio** representa (`FY2025`, `FY2026`…).
- El selector **Últimos 12 meses** recalcula todo sobre los cuatro trimestres cerrados
  más recientes de cada compañía, que sí es una base homogénea.
- El último trimestre de cada ejercicio **no se publica suelto** en el 10-K: se deriva
  restando los tres trimestres ya publicados al anual auditado. Esos puntos se dibujan
  huecos en la serie temporal y se marcan en el tooltip.

## Lo que muestra

| Panel | Contenido |
|---|---|
| **Indicadores** | Ingresos, beneficio neto, capex y caja libre agregados, con variación y tendencia a seis ejercicios |
| **Comparativa** | Columnas por compañía, ejercicio actual frente al anterior, conmutables entre ingresos, beneficio, capex y caja libre |
| **Ranking** | Orden por la métrica activa; al pulsar una compañía se fija en el resto del panel |
| **Trayectoria** | Ingresos de los últimos 12 trimestres fiscales con crecimiento interanual |
| **Mezcla** | Reparto de ingresos por segmento reportable, por producto y por geografía |
| **Posicionamiento** | Crecimiento frente a margen operativo, con el tamaño proporcional a los ingresos |
| **Lectura del analista** | Conclusiones calculadas sobre los datos cargados, no redactadas a mano |
| **Tabla** | Doce columnas ordenables y exportación a CSV |

## Capturas

| | |
|---|---|
| ![Comparativa](docs/screenshots/02-comparativa.png) | ![Trayectoria](docs/screenshots/03-trayectoria.png) |
| **Comparativa** del ejercicio actual frente al anterior | **Trayectoria trimestral** (los puntos huecos son trimestres derivados) |
| ![Mezcla](docs/screenshots/04-mezcla.png) | ![Lectura del analista](docs/screenshots/05-lectura-del-analista.png) |
| **Mezcla de ingresos** por producto y geografía | **Lectura del analista** calculada sobre los datos |
| ![Últimos 12 meses](docs/screenshots/07-ultimos-12-meses.png) | ![Tabla](docs/screenshots/06-tabla.png) |
| Base **últimos 12 meses**, homogénea entre compañías | **Tabla** ordenable con exportación a CSV |
| ![Modo oscuro](docs/screenshots/08-modo-oscuro.png) | |
| **Modo oscuro** con pasos de color propios | |

## Estructura

```
.
├── index.html                  Estructura y puntos de montaje
├── assets/
│   ├── css/styles.css          Tokens de diseño, modo claro y oscuro
│   └── js/
│       ├── format.js           Formateo numérico en español
│       ├── charts.js           Gráficos en SVG, sin librerías
│       └── app.js              Estado, render e interacción
├── data/
│   ├── financials.json         Totales consolidados por ejercicio y trimestre
│   ├── segments.json           Reparto de ingresos por segmento, producto y geografía
│   └── dataset.js              Los dos anteriores empaquetados para abrir sin servidor
├── scripts/
│   ├── fetch_sec_data.py       ETL contra la API company facts
│   ├── fetch_segments.py       ETL contra la instancia XBRL de cada 10-K
│   └── build_bundle.py         Empaquetado
└── docs/                       Capturas y guía del código
```

## Uso

Abre `index.html` en el navegador. No necesita servidor ni instalación: los datos van
empaquetados en `data/dataset.js`.

### Actualizar los datos

```bash
python scripts/fetch_sec_data.py --refresh    # totales consolidados
python scripts/fetch_segments.py --refresh    # desgloses dimensionales
python scripts/build_bundle.py                # empaqueta para el navegador
```

Sin `--refresh` se reutiliza la descarga cacheada en `.cache/`. La SEC exige una cabecera
`User-Agent` identificable: cámbiala en `scripts/fetch_sec_data.py` por tu propio correo
antes de lanzar descargas masivas.

Para añadir una compañía basta con su CIK y su mes de cierre fiscal en la lista
`COMPANIES` de `scripts/fetch_sec_data.py`.

## Notas de metodología

- **Cambios de etiqueta XBRL.** Las compañías cambian el tag us-gaap con los años (Tesla
  pasó de `Revenues` a `RevenueFromContractWithCustomerExcludingAssessedTax`). El ETL
  recorre una cadena de tags por orden de preferencia y resuelve cada ejercicio con el
  más preferente disponible, en lugar de quedarse con el primero que encuentra.
- **Subtotales en los desgloses.** Un 10-K publica a la vez el subtotal y su detalle:
  Apple etiqueta «Productos» y, además, iPhone, Mac e iPad. Sumarlo todo duplicaría los
  ingresos. El parser busca el subconjunto de miembros que cuadra con el consolidado y,
  entre los que cuadran, se queda con el más detallado. Los repartos que ves suman
  exactamente el total declarado.
- **Ejercicio fiscal.** Un periodo que termina después del mes de cierre pertenece ya al
  ejercicio siguiente: el trimestre de Apple que acaba en diciembre de 2024 es 1T FY2025.
- **Capex.** Se toma de `PaymentsToAcquirePropertyPlantAndEquipment`; no incluye
  arrendamientos financieros, que algunas compañías sí suman en sus notas de prensa.
  La caja libre es flujo operativo menos ese capex.

## Accesibilidad y color

La paleta categórica está validada para daltonismo (separación ΔE en OKLab bajo
simulación protan y deutan) en modo claro y oscuro. El modo oscuro usa pasos propios,
no una inversión automática. Toda serie con color lleva además leyenda y etiqueta
directa, y la tabla ofrece las mismas cifras sin depender del color.

## Aviso

Panel de análisis con fines informativos y educativos. No constituye recomendación de
inversión. Los datos pertenecen a los emisores y se obtienen de los registros públicos
de la SEC.
