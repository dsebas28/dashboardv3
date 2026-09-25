#!/usr/bin/env python3
"""
ETL: SEC EDGAR XBRL "companyfacts" -> data/financials.json

Fuente: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
Son los mismos hechos XBRL que las companias presentan en sus 10-K / 10-Q.
No hay cifras escritas a mano en este fichero: todo sale de la SEC.

Uso:
    python scripts/fetch_sec_data.py            # descarga (con cache) y genera el JSON
    python scripts/fetch_sec_data.py --refresh  # ignora la cache local

La SEC exige una cabecera User-Agent identificable y <= 10 peticiones/segundo.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "data" / "financials.json"

USER_AGENT = "dashboard-v31 analytics (dsebastian620@gmail.com)"
API = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# --- universo analizado -------------------------------------------------------
# fy_end_month = mes de cierre fiscal; sirve para etiquetar los ejercicios.
COMPANIES = [
    {"ticker": "NVDA", "cik": 1045810, "name": "NVIDIA Corporation",   "sector": "Semiconductores",       "fy_end_month": 1,  "hq": "Santa Clara, CA"},
    {"ticker": "AAPL", "cik": 320193,  "name": "Apple Inc.",           "sector": "Hardware y servicios",  "fy_end_month": 9,  "hq": "Cupertino, CA"},
    {"ticker": "MSFT", "cik": 789019,  "name": "Microsoft Corporation","sector": "Software y cloud",      "fy_end_month": 6,  "hq": "Redmond, WA"},
    {"ticker": "GOOGL","cik": 1652044, "name": "Alphabet Inc.",        "sector": "Publicidad y cloud",    "fy_end_month": 12, "hq": "Mountain View, CA"},
    {"ticker": "AMZN", "cik": 1018724, "name": "Amazon.com, Inc.",     "sector": "E-commerce y cloud",    "fy_end_month": 12, "hq": "Seattle, WA"},
    {"ticker": "META", "cik": 1326801, "name": "Meta Platforms, Inc.", "sector": "Redes sociales",        "fy_end_month": 12, "hq": "Menlo Park, CA"},
    {"ticker": "TSLA", "cik": 1318605, "name": "Tesla, Inc.",          "sector": "Automocion y energia",  "fy_end_month": 12, "hq": "Austin, TX"},
]

# us-gaap tags por metrica, en orden de preferencia (no todas las companias
# usan el mismo tag para los ingresos).
CONCEPTS = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss"],
    "gross_profit": ["GrossProfit"],
    "rnd": ["ResearchAndDevelopmentExpense"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities",
                            "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment",
              "PaymentsToAcquireProductiveAssets"],
    "eps_diluted": ["EarningsPerShareDiluted"],
    "assets": ["Assets"],
    "equity": ["StockholdersEquity"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue"],
}

POINT_IN_TIME = {"assets", "equity", "cash"}  # metricas de balance (instant)


def fetch_facts(cik: int, refresh: bool) -> dict:
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / f"companyfacts_{cik}.json"
    if cached.exists() and not refresh:
        return json.loads(cached.read_text(encoding="utf-8"))
    req = urllib.request.Request(API.format(cik=cik), headers={"User-Agent": USER_AGENT,
                                                               "Accept-Encoding": "gzip, deflate"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
    cached.write_bytes(raw)
    time.sleep(0.2)  # cortesia con el rate limit de la SEC
    return json.loads(raw.decode("utf-8"))


def _d(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def fiscal_year(end: date, fy_end_month: int) -> int:
    """Ejercicio fiscal al que pertenece una fecha de cierre.

    Un periodo que termina despues del mes de cierre ya pertenece al ejercicio
    siguiente: el trimestre de Apple que acaba en diciembre de 2024 es 1T FY2025,
    y el de NVIDIA que acaba en abril de 2025 es 1T FY2026.
    """
    return end.year + 1 if end.month > fy_end_month else end.year


def pick_units(concept: dict) -> list[dict]:
    for unit in ("USD", "USD/shares"):
        if unit in concept.get("units", {}):
            return concept["units"][unit]
    return []


def annual_series(facts: dict, tags: list[str], fy_end_month: int,
                  instant: bool) -> dict[int, float]:
    """Valor anual por ejercicio fiscal.

    Las companias cambian de tag us-gaap con los anos (Tesla paso de `Revenues` a
    `RevenueFromContractWithCustomerExcludingAssessedTax`), asi que se recorren
    todos los tags y para cada ejercicio gana el tag mas preferente disponible y,
    dentro de el, la presentacion mas reciente.
    """
    cands: dict[int, list[tuple[int, str, float]]] = {}  # fy -> [(prioridad_tag, filed, valor)]
    usgaap = facts.get("facts", {}).get("us-gaap", {})
    for rank, tag in enumerate(tags):
        if tag not in usgaap:
            continue
        for f in pick_units(usgaap[tag]):
            if f.get("form") not in ("10-K", "10-K/A"):
                continue
            end = _d(f["end"])
            if instant:
                if end.month != fy_end_month:  # balance: solo el cierre fiscal
                    continue
            else:
                if "start" not in f:
                    continue
                if not (330 <= (end - _d(f["start"])).days <= 400):
                    continue
            fy = fiscal_year(end, fy_end_month)
            cands.setdefault(fy, []).append((rank, f.get("filed", ""), float(f["val"])))
    # gana el tag mas preferente (rank menor) y, dentro de el, el 10-K mas reciente
    return {fy: min(c, key=lambda t: (t[0], _inv(t[1])))[2] for fy, c in cands.items()}


def _inv(filed: str) -> tuple:
    """Clave para ordenar fechas de presentacion de forma descendente."""
    return tuple(-ord(ch) for ch in filed)


def annual_end_dates(facts: dict, tags: list[str], fy_end_month: int) -> dict[int, date]:
    """Fecha real de cierre de cada ejercicio, para fechar el 4T derivado."""
    out: dict[int, date] = {}
    usgaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        for f in pick_units(usgaap.get(tag, {})):
            if f.get("form") not in ("10-K", "10-K/A") or "start" not in f:
                continue
            end = _d(f["end"])
            if 330 <= (end - _d(f["start"])).days <= 400:
                out.setdefault(fiscal_year(end, fy_end_month), end)
    return out


def quarterly_revenue(facts: dict, tags: list[str], fy_end_month: int,
                      annual: dict[int, float], fy_ends: dict[int, date]) -> list[dict]:
    """Serie trimestral. El ultimo trimestre no se reporta suelto en el 10-K:
    se deriva como anual menos los tres trimestres ya publicados."""
    usgaap = facts.get("facts", {}).get("us-gaap", {})
    rows: dict[date, list[tuple[int, str, float]]] = {}  # fin de trimestre -> candidatos
    for rank, tag in enumerate(tags):
        if tag not in usgaap:
            continue
        for f in pick_units(usgaap[tag]):
            if f.get("form") not in ("10-Q", "10-Q/A") or "start" not in f:
                continue
            start, end = _d(f["start"]), _d(f["end"])
            if not (80 <= (end - start).days <= 100):
                continue
            rows.setdefault(end, []).append((rank, f.get("filed", ""), float(f["val"])))

    by_fy: dict[int, list[tuple[date, float]]] = {}
    for end, c in rows.items():
        val = min(c, key=lambda t: (t[0], _inv(t[1])))[2]
        by_fy.setdefault(fiscal_year(end, fy_end_month), []).append((end, val))

    out: list[dict] = []
    for fy in sorted(by_fy):
        qs = sorted(by_fy[fy])[:4]
        vals = [{"fy": fy, "q": i + 1, "end": e.isoformat(), "revenue": v, "derived": False}
                for i, (e, v) in enumerate(qs)]
        if len(vals) == 3 and fy in annual:  # 4T derivado
            rest = annual[fy] - sum(v["revenue"] for v in vals)
            if rest > 0:
                vals.append({"fy": fy, "q": 4, "revenue": rest, "derived": True,
                             "end": fy_ends.get(fy, date(fy, fy_end_month, 28)).isoformat()})
        out.extend(vals)
    return sorted(out, key=lambda r: r["end"])


def pct(new: float | None, old: float | None) -> float | None:
    if new is None or old is None or old == 0:
        return None
    return (new - old) / abs(old) * 100.0


def build(refresh: bool) -> dict:
    companies = []
    for meta in COMPANIES:
        print(f"  -> {meta['ticker']:<6} CIK {meta['cik']}")
        facts = fetch_facts(meta["cik"], refresh)
        series = {
            name: annual_series(facts, tags, meta["fy_end_month"], name in POINT_IN_TIME)
            for name, tags in CONCEPTS.items()
        }
        years = sorted(series["revenue"])[-6:]
        latest = years[-1]
        prev = years[-2] if len(years) > 1 else None

        def val(metric: str, fy: int | None) -> float | None:
            return series[metric].get(fy) if fy is not None else None

        rev, rev_prev = val("revenue", latest), val("revenue", prev)
        op, ni = val("operating_income", latest), val("net_income", latest)
        ocf, capex = val("operating_cash_flow", latest), val("capex", latest)

        # Los cierres fiscales no coinciden (Apple cierra en septiembre, Microsoft
        # en junio, NVIDIA en enero). El TTM -ultimos cuatro trimestres cerrados-
        # es la unica base homogenea para compararlas entre si.
        fy_ends = annual_end_dates(facts, CONCEPTS["revenue"], meta["fy_end_month"])
        quarters = quarterly_revenue(facts, CONCEPTS["revenue"], meta["fy_end_month"],
                                     series["revenue"], fy_ends)
        last4, prev4 = quarters[-4:], quarters[-8:-4]
        ttm = None
        if len(last4) == 4:
            ttm_rev = sum(q["revenue"] for q in last4)
            ttm = {
                "revenue": ttm_rev,
                "period_end": last4[-1]["end"],
                "period_start": last4[0]["end"],
                "label": f"{last4[0]['fy']} {last4[0]['q']}T - {last4[-1]['fy']} {last4[-1]['q']}T",
                "growth": pct(ttm_rev, sum(q["revenue"] for q in prev4)) if len(prev4) == 4 else None,
            }

        companies.append({
            **{k: meta[k] for k in ("ticker", "name", "sector", "hq", "cik")},
            "fiscal_year": latest,
            "fiscal_year_label": f"FY{latest}",
            "fiscal_year_end_month": meta["fy_end_month"],
            "annual": [
                {
                    "fy": fy,
                    "revenue": val("revenue", fy),
                    "operating_income": val("operating_income", fy),
                    "net_income": val("net_income", fy),
                    "gross_profit": val("gross_profit", fy),
                    "rnd": val("rnd", fy),
                    "capex": val("capex", fy),
                    "operating_cash_flow": val("operating_cash_flow", fy),
                    "free_cash_flow": (val("operating_cash_flow", fy) - val("capex", fy))
                    if val("operating_cash_flow", fy) is not None and val("capex", fy) is not None else None,
                    "eps_diluted": val("eps_diluted", fy),
                    "assets": val("assets", fy),
                    "equity": val("equity", fy),
                    "cash": val("cash", fy),
                    "revenue_growth": pct(val("revenue", fy), val("revenue", fy - 1)),
                }
                for fy in years
            ],
            "quarterly": quarters[-12:],
            "ttm": ttm,
            "kpi": {
                "revenue": rev,
                "revenue_growth": pct(rev, rev_prev),
                "net_income": ni,
                "net_income_growth": pct(ni, val("net_income", prev)),
                "operating_margin": (op / rev * 100) if op and rev else None,
                "net_margin": (ni / rev * 100) if ni and rev else None,
                "gross_margin": (val("gross_profit", latest) / rev * 100) if val("gross_profit", latest) and rev else None,
                "rnd_intensity": (val("rnd", latest) / rev * 100) if val("rnd", latest) and rev else None,
                "free_cash_flow": (ocf - capex) if ocf is not None and capex is not None else None,
                "fcf_margin": ((ocf - capex) / rev * 100) if ocf is not None and capex is not None and rev else None,
                "capex": capex,
                "capex_intensity": (capex / rev * 100) if capex and rev else None,
                "roe": (ni / val("equity", latest) * 100) if ni and val("equity", latest) else None,
                "eps_diluted": val("eps_diluted", latest),
                "assets": val("assets", latest),
            },
            "source": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{meta['cik']:010d}.json",
            "filings": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={meta['cik']:010d}&type=10-K",
        })

    return {
        "meta": {
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": "SEC EDGAR - XBRL company facts API (data.sec.gov)",
            "source_url": "https://www.sec.gov/edgar/sec-api-documentation",
            "currency": "USD",
            "note": "Cifras auditadas tal y como se presentan en los 10-K / 10-Q. "
                    "El 4T marcado como 'derived' se calcula como anual menos los tres primeros trimestres.",
            "companies_count": len(companies),
        },
        "companies": companies,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="ignora la cache local")
    args = ap.parse_args()

    print("Descargando company facts de la SEC...")
    payload = build(args.refresh)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    size = OUT.stat().st_size / 1024
    print(f"\nOK -> {OUT.relative_to(ROOT)} ({size:.0f} KB, {payload['meta']['companies_count']} companias)")
