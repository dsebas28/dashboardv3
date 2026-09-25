#!/usr/bin/env python3
"""
Empaqueta los dos JSON en data/dataset.js para que el dashboard funcione
abriendo index.html directamente (file:// bloquea fetch de ficheros locales).

Uso:
    python scripts/build_bundle.py
"""

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main() -> None:
    financials = json.loads((DATA / "financials.json").read_text(encoding="utf-8"))
    segments = json.loads((DATA / "segments.json").read_text(encoding="utf-8"))

    bundle = {
        "financials": financials,
        "segments": segments,
        "built_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    out = DATA / "dataset.js"
    out.write_text(
        "/* Generado por scripts/build_bundle.py - no editar a mano. */\n"
        "window.DASHBOARD_DATA = " + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"OK -> {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
