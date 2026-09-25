#!/usr/bin/env python3
"""
ETL: instancia XBRL del ultimo 10-K -> data/segments.json

La API companyfacts devuelve solo los totales consolidados: no trae las
dimensiones. Para abrir los ingresos por segmento, por producto y por geografia
hay que leer el documento de instancia XBRL del propio 10-K y resolver los
contextos con miembros explicitos.

Uso:
    python scripts/fetch_segments.py [--refresh]
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

from fetch_sec_data import COMPANIES, USER_AGENT, fiscal_year, _d

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "data" / "segments.json"

SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"

REVENUE_TAGS = {
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
}

# Ejes XBRL que nos interesan y como llamarlos en el dashboard.
AXES = {
    "StatementBusinessSegmentsAxis": "segmento",
    "ProductOrServiceAxis": "producto",
    "StatementGeographicalAxis": "geografia",
}

# Miembros de reconciliacion, nunca lineas de negocio.
SKIP_MEMBER_PAT = re.compile(
    r"(Consolidat|Elimination|Intersegment|ReconcilingItem|OperatingSegmentsMember$"
    r"|RelatedParty|Hedg)", re.I)

# Etiquetas legibles, por nombre local del miembro (sin prefijo de namespace).
LABELS = {
    "ServiceMember": "Servicios", "ProductMember": "Productos",
    "IPhoneMember": "iPhone", "IPadMember": "iPad", "MacMember": "Mac",
    "WearablesHomeandAccessoriesMember": "Wearables y hogar",
    "ComputeMember": "Cómputo (centros de datos)", "NetworkingMember": "Redes",
    "DataCenterMember": "Centros de datos",
    "ProfessionalVisualizationMember": "Visualización profesional",
    "OEMAndOtherMember": "OEM y otros", "GamingMember": "Gaming",
    "AutomotiveMember": "Automoción",
    "MicrosoftThreeSixFiveCommercialProductsAndCloudServicesMember": "Microsoft 365 empresas",
    "MicrosoftThreeSixFiveConsumerProductsAndCloudServicesMember": "Microsoft 365 consumo",
    "ServerProductsAndCloudServicesMember": "Servidores y nube (Azure)",
    "WindowsAndDevicesMember": "Windows y dispositivos",
    "SearchAdvertisingMember": "Buscador y publicidad",
    "EnterpriseAndPartnerServicesMember": "Servicios a empresas",
    "DynamicsProductsAndCloudServicesMember": "Dynamics",
    "LinkedInCorporationMember": "LinkedIn", "XBOXMember": "Xbox",
    "OtherProductsAndServicesMember": "Otros",
    "ProductivityAndBusinessProcessesMember": "Productividad y procesos",
    "IntelligentCloudMember": "Nube inteligente",
    "MorePersonalComputingMember": "Computación personal",
    "OnlineStoresMember": "Tienda online",
    "ThirdPartySellerServicesMember": "Vendedores externos",
    "AmazonWebServicesMember": "AWS", "AmazonWebServicesSegmentMember": "AWS",
    "SubscriptionServicesMember": "Suscripciones",
    "PhysicalStoresMember": "Tienda física", "AdvertisingMember": "Publicidad",
    "OtherServicesMember": "Otros servicios",
    "NorthAmericaSegmentMember": "Norteamérica",
    "InternationalSegmentMember": "Internacional",
    "GoogleServicesMember": "Google Services", "GoogleCloudMember": "Google Cloud",
    "AllOtherSegmentsMember": "Other Bets y otros",
    "FamilyOfAppsMember": "Familia de apps", "RealityLabsMember": "Reality Labs",
    "AutomotiveSalesMember": "Venta de vehículos",
    "AutomotiveRegulatoryCreditsMember": "Créditos regulatorios",
    "AutomotiveLeasingMember": "Leasing de vehículos",
    "AutomotiveRevenuesMember": "Automoción", "AutomotiveSegmentMember": "Automoción",
    "EnergyGenerationAndStorageMember": "Energía y almacenamiento",
    "EnergyGenerationAndStorageSegmentMember": "Energía y almacenamiento",
    "EnergyGenerationAndStorageSalesMember": "Energía (venta)",
    "EnergyGenerationAndStorageLeasingMember": "Energía (leasing)",
    "ServicesAndOtherMember": "Servicios y otros",
    # geografía
    "US": "Estados Unidos", "CN": "China", "TW": "Taiwán", "DE": "Alemania",
    "GB": "Reino Unido", "JP": "Japón", "SG": "Singapur", "KR": "Corea del Sur",
    "ChinaIncludingHongKongMember": "China (incl. Hong Kong)",
    "OtherCountriesMember": "Resto de países", "NonUsMember": "Resto del mundo",
    "RestOfWorldMember": "Resto del mundo", "EMEAMember": "EMEA",
    "AsiaPacificMember": "Asia-Pacífico", "EuropeMember": "Europa",
    "AmericasExcludingUnitedStatesMember": "América (sin EE. UU.)",
    "USCanadaMember": "EE. UU. y Canadá",
}


def best_decomposition(members: dict[str, float], total: float) -> list[tuple[str, float]]:
    """Elige el reparto real de entre miembros que mezclan jerarquias.

    Un 10-K publica a la vez el subtotal y su detalle (Apple etiqueta
    'Productos' y ademas iPhone, Mac, iPad...). Sumar todo duplicaria los
    ingresos, asi que se busca el subconjunto que cuadra con el total
    consolidado y, entre los que cuadran, el mas detallado.
    """
    items = sorted(members.items(), key=lambda kv: -kv[1])[:16]
    tol = max(total * 0.003, 1.0)
    best: list[tuple[str, float]] = []
    for mask in range(1, 1 << len(items)):
        chosen = [items[i] for i in range(len(items)) if mask >> i & 1]
        if len(chosen) < len(best):
            continue
        diff = abs(sum(v for _, v in chosen) - total)
        if diff > tol:
            continue
        if len(chosen) > len(best) or (len(chosen) == len(best) and diff < abs(
                sum(v for _, v in best) - total)):
            best = chosen
    return sorted(best, key=lambda kv: -kv[1])


def get_json(url: str, cache_name: str, refresh: bool) -> dict:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / cache_name
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    path.write_bytes(raw)
    time.sleep(0.2)
    return json.loads(raw.decode("utf-8"))


def get_bytes(url: str, cache_name: str, refresh: bool) -> bytes:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / cache_name
    if path.exists() and not refresh:
        return path.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    path.write_bytes(raw)
    time.sleep(0.2)
    return raw


def latest_10k(cik: int, refresh: bool) -> tuple[str, str]:
    """(accession sin guiones, documento principal) del ultimo 10-K."""
    data = get_json(SUBMISSIONS.format(cik=cik), f"submissions_{cik}.json", refresh)
    rec = data["filings"]["recent"]
    for i, form in enumerate(rec["form"]):
        if form == "10-K":
            return rec["accessionNumber"][i].replace("-", ""), rec["primaryDocument"][i]
    raise RuntimeError(f"sin 10-K para CIK {cik}")


def humanize(member: str) -> str:
    """aapl:IPhoneMember -> 'iPhone'. Usa LABELS si el miembro esta mapeado."""
    local = member.split(":")[-1]
    if local in LABELS:
        return LABELS[local]
    local = re.sub(r"(Member|Segment|Reportable)+$", "", local)
    local = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", local)
    return local.replace(" And ", " y ").strip() or member


def parse_instance(raw: bytes, fy_end_month: int) -> dict:
    root = ET.fromstring(raw)

    # 1) contextos: id -> (inicio, fin, [(eje, miembro)])
    ctx: dict[str, dict] = {}
    for c in root.iter():
        if not c.tag.endswith("}context"):
            continue
        cid = c.get("id")
        period = start = end = None
        members: list[tuple[str, str]] = []
        for el in c.iter():
            tag = el.tag.split("}")[-1]
            if tag == "startDate":
                start = el.text
            elif tag == "endDate":
                end = el.text
            elif tag == "instant":
                period = el.text
            elif tag == "explicitMember":
                members.append((el.get("dimension", "").split(":")[-1], (el.text or "").strip()))
        if start and end:
            ctx[cid] = {"start": start, "end": end, "members": members}
        elif period:
            ctx[cid] = {"start": None, "end": period, "members": members}

    # 2) el periodo anual mas reciente del documento
    annual = [(v["start"], v["end"]) for v in ctx.values()
              if v["start"] and 330 <= (_d(v["end"]) - _d(v["start"])).days <= 400]
    if not annual:
        return {}
    fy_period = max(annual, key=lambda p: p[1])
    fy = fiscal_year(_d(fy_period[1]), fy_end_month)

    # 3) hechos de ingresos con exactamente un miembro explicito
    out: dict[str, dict[str, float]] = {}
    total = None
    for f in root.iter():
        tag = f.tag.split("}")[-1]
        if tag not in REVENUE_TAGS or not f.get("contextRef"):
            continue
        c = ctx.get(f.get("contextRef"))
        if not c or (c["start"], c["end"]) != fy_period:
            continue
        try:
            val = float(f.text)
        except (TypeError, ValueError):
            continue
        if not c["members"]:
            total = max(total or 0, val)
            continue
        if len(c["members"]) != 1:
            continue  # cruces de dos ejes: duplicarian el reparto
        axis, member = c["members"][0]
        if axis not in AXES or SKIP_MEMBER_PAT.search(member):
            continue
        out.setdefault(AXES[axis], {})[member] = val

    result = {"fiscal_year": fy, "period_start": fy_period[0], "period_end": fy_period[1],
              "total_revenue": total, "breakdowns": {}}
    if not total:
        return result
    for axis_name, members in out.items():
        chosen = best_decomposition(members, total)
        if len(chosen) < 2:
            continue
        items = [{"member": m, "label": humanize(m), "revenue": v,
                  "share": v / total * 100} for m, v in chosen]
        result["breakdowns"][axis_name] = items
    return result


def main(refresh: bool) -> None:
    payload = {"meta": {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "SEC EDGAR - documento de instancia XBRL del ultimo 10-K de cada compania",
        "note": "Reparto de ingresos resuelto desde los contextos dimensionales "
                "(ejes de segmento, producto y geografia). 'Otros' es el residuo "
                "hasta el total consolidado.",
    }, "companies": {}}

    for meta in COMPANIES:
        acc, doc = latest_10k(meta["cik"], refresh)
        inst = doc.rsplit(".", 1)[0] + "_htm.xml"
        url = ARCHIVE.format(cik=meta["cik"], acc=acc, doc=inst)
        print(f"  -> {meta['ticker']:<6} {inst}")
        try:
            raw = get_bytes(url, f"instance_{meta['cik']}.xml", refresh)
            parsed = parse_instance(raw, meta["fy_end_month"])
        except Exception as exc:  # una compania caida no tumba el resto
            print(f"     !! {exc}")
            continue
        if not parsed.get("breakdowns"):
            print("     !! sin repartos utilizables")
            continue
        parsed["filing"] = f"https://www.sec.gov/Archives/edgar/data/{meta['cik']}/{acc}/{doc}"
        payload["companies"][meta["ticker"]] = parsed
        for axis, items in parsed["breakdowns"].items():
            print(f"     {axis:<10} {len(items)} lineas, "
                  f"{sum(i['revenue'] for i in items)/1e9:,.1f}B de {parsed['total_revenue']/1e9:,.1f}B")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nOK -> {OUT.relative_to(ROOT)} ({len(payload['companies'])} companias)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    main(ap.parse_args().refresh)
