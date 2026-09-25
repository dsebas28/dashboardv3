/* =============================================================
   Atlas Financiero — estado, render y interacción
   ============================================================= */

(() => {
  const DATA = window.DASHBOARD_DATA;
  if (!DATA) {
    document.body.innerHTML = '<p style="padding:40px;font:15px system-ui">' +
      'Falta <code>data/dataset.js</code>. Genéralo con <code>python scripts/build_bundle.py</code>.</p>';
    return;
  }

  const ALL = DATA.financials.companies;
  const SEGMENTS = DATA.segments.companies;
  const SERIES_SLOTS = ['--series-1', '--series-2', '--series-3', '--series-4',
    '--series-5', '--series-6', '--series-7', '--series-8'];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const METRICS = {
    revenue:         { label: 'Ingresos',    ttm: true },
    net_income:      { label: 'Beneficio neto', ttm: false },
    capex:           { label: 'Capex',       ttm: false },
    free_cash_flow:  { label: 'Caja libre',  ttm: false },
  };

  const AXIS_LABEL = { segmento: 'Segmento', producto: 'Producto', geografia: 'Geografía' };

  const state = {
    basis: 'fy',
    metric: 'revenue',
    selected: 'NVDA',
    mixAxis: null,
    filter: '',
    sort: { key: 'revenue', dir: -1 },
  };

  // ── helpers de datos ─────────────────────────────────────────
  const last = c => c.annual[c.annual.length - 1];
  const prev = c => c.annual[c.annual.length - 2];

  const sumQ = qs => qs.reduce((a, q) => a + q.revenue, 0);

  /** Valor de la métrica activa, en la base activa (ejercicio o TTM). */
  function value(c, when = 'current') {
    if (state.basis === 'ttm') {
      const q = c.quarterly;
      const slice = when === 'current' ? q.slice(-4) : q.slice(-8, -4);
      return slice.length === 4 ? sumQ(slice) : null;
    }
    const row = when === 'current' ? last(c) : prev(c);
    return row ? row[state.metric] : null;
  }

  const growth = c => {
    const a = value(c, 'current'), b = value(c, 'previous');
    return a != null && b ? ((a - b) / Math.abs(b)) * 100 : null;
  };

  const periodLabel = c => (state.basis === 'ttm'
    ? (c.ttm ? c.ttm.label : 'últimos 12 meses')
    : `FY${last(c).fy}`);

  /** Versión corta para el eje: siete columnas no admiten un rango completo. */
  const shortPeriod = c => {
    if (state.basis !== 'ttm') return `FY${last(c).fy}`;
    const q = c.quarterly[c.quarterly.length - 1];
    return `TTM ${q.q}T·${String(q.fy).slice(2)}`;
  };

  const visible = () => {
    const q = state.filter.trim().toLowerCase();
    const list = q
      ? ALL.filter(c => (c.ticker + c.name + c.sector).toLowerCase().includes(q))
      : ALL.slice();
    return list.sort((a, b) => (value(b) || 0) - (value(a) || 0));
  };

  const current = () => ALL.find(c => c.ticker === state.selected) || ALL[0];

  // ── tiles ────────────────────────────────────────────────────
  function renderTiles() {
    const list = visible();
    const agg = key => list.reduce((a, c) => a + (last(c)[key] || 0), 0);
    const aggPrev = key => list.reduce((a, c) => a + ((prev(c) || {})[key] || 0), 0);
    const trend = key => {
      const depth = Math.min(...list.map(c => c.annual.length), 6);
      return Array.from({ length: depth }, (_, i) =>
        list.reduce((a, c) => a + (c.annual[c.annual.length - depth + i][key] || 0), 0));
    };

    const rev = agg('revenue');
    const tiles = [
      {
        hero: true, label: 'Ingresos agregados', key: 'revenue',
        value: rev, prev: aggPrev('revenue'),
        unit: `${list.length} compañías · último ejercicio reportado`,
      },
      {
        label: 'Beneficio neto agregado', key: 'net_income',
        value: agg('net_income'), prev: aggPrev('net_income'),
        unit: `Margen neto ${Fmt.pctPlain((agg('net_income') / rev) * 100)}`,
      },
      {
        label: 'Inversión en capital (capex)', key: 'capex',
        value: agg('capex'), prev: aggPrev('capex'),
        unit: `${Fmt.pctPlain((agg('capex') / rev) * 100)} de los ingresos`,
      },
      {
        label: 'Caja libre agregada', key: 'free_cash_flow',
        value: agg('free_cash_flow'), prev: aggPrev('free_cash_flow'),
        unit: `Conversión ${Fmt.pctPlain((agg('free_cash_flow') / rev) * 100)} sobre ventas`,
      },
    ];

    const host = document.getElementById('tiles');
    host.textContent = '';
    tiles.forEach(t => {
      const d = t.prev ? ((t.value - t.prev) / Math.abs(t.prev)) * 100 : null;
      const node = document.createElement('article');
      node.className = `tile${t.hero ? ' tile--hero' : ''}`;
      node.innerHTML =
        `<span class="tile__label">${t.label}</span>` +
        `<span class="tile__value">${Fmt.millions(t.value)}</span>` +
        `<span class="tile__unit">millones de $ · ${t.unit}</span>` +
        `<span class="tile__foot">${d == null ? '' :
          `<span class="delta delta--${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Fmt.pct(d)}</span>`}</span>`;
      node.querySelector('.tile__foot')
        .appendChild(Charts.spark(trend(t.key), t.hero ? 'rgba(255,255,255,.85)' : css('--accent')));
      host.appendChild(node);
    });
  }

  // ── comparativa por compañía ─────────────────────────────────
  function renderColumn() {
    const list = visible();
    const isTtm = state.basis === 'ttm';
    const labelNow = isTtm ? 'Últimos 12 meses' : 'Ejercicio en curso';
    const labelPrev = isTtm ? '12 meses anteriores' : 'Ejercicio anterior';

    Charts.column(document.getElementById('columnChart'), {
      categories: list.map(c => ({ key: c.ticker, label: c.name, short: shortPeriod(c) })),
      series: [
        { label: labelNow, color: css('--accent'), values: list.map(c => value(c, 'current')) },
        { label: labelPrev, color: css('--accent-prev'), values: list.map(c => value(c, 'previous')) },
      ],
      selected: state.selected,
      extra: i => {
        const g = growth(list[i]);
        return g == null ? '' : `<div class="row"><em>Variación</em><span>${Fmt.pct(g)}</span></div>`;
      },
      onSelect: select,
    });

    document.getElementById('columnLegend').innerHTML =
      `<span><i style="background:${css('--accent')}"></i>${labelNow}</span>` +
      `<span><i style="background:${css('--accent-prev')}"></i>${labelPrev}</span>`;

    document.getElementById('columnSub').textContent = isTtm
      ? 'Ingresos de los últimos cuatro trimestres cerrados frente a los cuatro anteriores. Base homogénea pese a los distintos cierres fiscales.'
      : `${METRICS[state.metric].label} del último ejercicio fiscal reportado frente al anterior. Cada compañía cierra su ejercicio en un mes distinto.`;
  }

  // ── ranking ──────────────────────────────────────────────────
  function renderRank() {
    const list = visible();
    const max = Math.max(...list.map(c => value(c) || 0), 1);
    const host = document.getElementById('rankList');
    host.textContent = '';

    list.forEach((c, i) => {
      const g = growth(c);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rank__row${c.ticker === state.selected ? ' is-active' : ''}`;
      btn.innerHTML =
        `<span class="rank__pos">${i + 1}</span>` +
        `<span><span class="rank__name">${c.name.replace(/,? Inc\.?$|,? Corporation$| Platforms, Inc\.| Corp\.?$/, '')}` +
        `<b class="rank__tic">${c.ticker}</b></span>` +
        `<span class="rank__bar"><span style="width:${((value(c) || 0) / max) * 100}%"></span></span></span>` +
        `<span class="rank__val"><b>${Fmt.millions(value(c))}</b>` +
        `<small>${g == null ? periodLabel(c) : Fmt.pct(g)}</small></span>`;
      btn.addEventListener('click', () => select(c.ticker));
      li.appendChild(btn);
      host.appendChild(li);
    });
  }

  // ── trayectoria trimestral ───────────────────────────────────
  function renderArea() {
    const c = current();
    const qs = c.quarterly;
    const points = qs.map((q, i) => {
      const yoy = i >= 4 ? ((q.revenue - qs[i - 4].revenue) / qs[i - 4].revenue) * 100 : null;
      return {
        label: `${q.q}T`,
        title: `FY${q.fy} · ${q.q}T`,
        value: q.revenue,
        derived: !!q.derived,
        growth: yoy,
      };
    });

    Charts.area(document.getElementById('areaChart'), { points, color: css('--accent') });

    const first = qs[0], lastQ = qs[qs.length - 1];
    document.getElementById('trendTitle').textContent = `Trayectoria trimestral · ${c.name}`;
    document.getElementById('trendSub').textContent =
      `Ingresos por trimestre fiscal, de FY${first.fy}·${first.q}T a FY${lastQ.fy}·${lastQ.q}T. ` +
      'Los puntos huecos son trimestres de cierre, derivados del anual auditado.';
    const y = points[points.length - 1].growth;
    document.getElementById('trendPill').textContent =
      y == null ? periodLabel(c) : `${Fmt.pct(y)} interanual`;
  }

  // ── mezcla de ingresos ───────────────────────────────────────
  function renderMix() {
    const c = current();
    const seg = SEGMENTS[c.ticker];
    const axisHost = document.getElementById('mixAxis');
    const legend = document.getElementById('mixLegend');

    if (!seg) {
      axisHost.textContent = '';
      legend.innerHTML = '<li><span>Sin desglose dimensional en el último 10-K.</span></li>';
      document.getElementById('donutChart').textContent = '';
      return;
    }

    // el segmento reportable manda sobre el detalle de producto o país
    const order = ['segmento', 'producto', 'geografia'];
    const axes = order.filter(a => seg.breakdowns[a]);
    if (!axes.includes(state.mixAxis)) state.mixAxis = axes[0];

    axisHost.textContent = '';
    axes.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = AXIS_LABEL[a] || a;
      b.className = a === state.mixAxis ? 'is-active' : '';
      b.addEventListener('click', () => { state.mixAxis = a; renderMix(); });
      axisHost.appendChild(b);
    });

    // como máximo 8 sectores: la cola se agrupa para no inventar tonos nuevos
    const raw = seg.breakdowns[state.mixAxis];
    let items = raw.slice(0, 7);
    if (raw.length > 7) {
      const tail = raw.slice(7);
      items.push({
        label: 'Resto de líneas',
        revenue: tail.reduce((a, b) => a + b.revenue, 0),
        share: tail.reduce((a, b) => a + b.share, 0),
      });
    }
    items = items.map((it, i) => ({ ...it, color: css(SERIES_SLOTS[i]) }));

    Charts.donut(document.getElementById('donutChart'), {
      items, centerLabel: `M$ · FY${seg.fiscal_year}`,
    });

    legend.textContent = '';
    items.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = `<i style="background:${it.color}"></i>` +
        `<span title="${it.label}">${it.label}</span>` +
        `<b>${Fmt.millions(it.revenue)}<small>${Fmt.pctPlain(it.share)}</small></b>`;
      legend.appendChild(li);
    });

    document.getElementById('mixTitle').textContent = `Mezcla de ingresos · ${c.name}`;
    document.getElementById('mixSub').innerHTML =
      `Ejercicio FY${seg.fiscal_year} · desglose por ${(AXIS_LABEL[state.mixAxis] || '').toLowerCase()} ` +
      `resuelto desde los contextos XBRL del <a href="${seg.filing}" target="_blank" rel="noopener">10-K</a>.`;
  }

  // ── posicionamiento ──────────────────────────────────────────
  function renderBubble() {
    const list = visible().filter(c => last(c).revenue && last(c).operating_income != null);
    Charts.bubble(document.getElementById('bubbleChart'), {
      color: css('--accent'),
      selected: state.selected,
      onSelect: select,
      points: list.map(c => ({
        key: c.ticker,
        label: `${c.name} · FY${last(c).fy}`,
        x: last(c).revenue_growth ?? 0,
        y: (last(c).operating_income / last(c).revenue) * 100,
        size: last(c).revenue,
      })),
    });
  }

  // ── lectura del analista ─────────────────────────────────────
  function renderInsights() {
    const list = visible();
    if (!list.length) return;
    const margin = c => (last(c).operating_income / last(c).revenue) * 100;
    const capexInt = c => ((last(c).capex || 0) / last(c).revenue) * 100;
    const fcfMargin = c => ((last(c).free_cash_flow || 0) / last(c).revenue) * 100;

    const fastest = [...list].sort((a, b) => (last(b).revenue_growth ?? -99) - (last(a).revenue_growth ?? -99))[0];
    const heaviest = [...list].sort((a, b) => capexInt(b) - capexInt(a))[0];
    // si la que más crece es también la que más caja convierte, se cede el foco
    // a la siguiente: repetir compañía en tres lecturas no aporta información
    const cashRank = [...list].sort((a, b) => fcfMargin(b) - fcfMargin(a));
    const bestCash = (cashRank[0] === fastest && cashRank[1]) ? cashRank[1] : cashRank[0];
    const totalRev = list.reduce((a, c) => a + last(c).revenue, 0);
    const totalCapex = list.reduce((a, c) => a + (last(c).capex || 0), 0);
    const capexPrev = list.reduce((a, c) => a + ((prev(c) || {}).capex || 0), 0);
    const c = current();
    const seg = SEGMENTS[c.ticker];
    const topLine = seg ? seg.breakdowns[state.mixAxis || Object.keys(seg.breakdowns)[0]][0] : null;

    const items = [
      {
        mark: '01',
        title: `${fastest.ticker} lidera el crecimiento con ${Fmt.pct(last(fastest).revenue_growth)}`,
        text: `Cierra FY${last(fastest).fy} con ${Fmt.money(last(fastest).revenue)} de ingresos y un margen ` +
          `operativo del ${Fmt.pctPlain(margin(fastest))}. Crecer a ese ritmo sobre una base ya grande es lo ` +
          `que separa a esta cohorte del resto del índice.`,
      },
      {
        mark: '02',
        title: `El capex agregado sube a ${Fmt.money(totalCapex)}`,
        text: `Equivale al ${Fmt.pctPlain((totalCapex / totalRev) * 100)} de los ingresos conjuntos, ` +
          `${Fmt.pct(((totalCapex - capexPrev) / capexPrev) * 100)} frente al ejercicio anterior. ` +
          `${heaviest.ticker} es la más intensiva en capital, con ${Fmt.pctPlain(capexInt(heaviest))} de sus ventas ` +
          `reinvertidas en infraestructura.`,
      },
      {
        mark: '03',
        title: `${bestCash.ticker} convierte mejor las ventas en caja`,
        text: `Genera ${Fmt.money(last(bestCash).free_cash_flow)} de flujo de caja libre, un ` +
          `${Fmt.pctPlain(fcfMargin(bestCash))} de sus ingresos. La conversión de caja es el contrapeso natural ` +
          `al ciclo inversor: mide cuánto queda después de pagar la expansión.`,
      },
    ];

    if (topLine) {
      items.push({
        mark: '04',
        title: `${c.ticker} concentra el ${Fmt.pctPlain(topLine.share)} de sus ingresos en «${topLine.label}»`,
        text: `Sobre ${Fmt.money(seg.total_revenue)} declarados en FY${seg.fiscal_year}. ` +
          `Una concentración así amplifica el resultado en ambas direcciones: es el primer riesgo a vigilar ` +
          `en cualquier tesis sobre el valor.`,
      });
    }

    const host = document.getElementById('insights');
    host.textContent = '';
    items.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="mark">${it.mark}</span><div><h3>${it.title}</h3><p>${it.text}</p></div>`;
      host.appendChild(li);
    });
  }

  // ── tabla ────────────────────────────────────────────────────
  const COLUMNS = [
    { key: 'name',     label: 'Compañía',   get: c => c.name, type: 'text' },
    { key: 'fy',       label: 'Ejercicio',  get: c => `FY${last(c).fy}`, sort: c => last(c).fy, type: 'text' },
    { key: 'revenue',  label: 'Ingresos',   get: c => Fmt.millions(last(c).revenue), sort: c => last(c).revenue },
    { key: 'growth',   label: 'Δ ingresos', get: c => Fmt.pct(last(c).revenue_growth), sort: c => last(c).revenue_growth, signed: true },
    { key: 'net',      label: 'Bº neto',    get: c => Fmt.millions(last(c).net_income), sort: c => last(c).net_income },
    { key: 'opm',      label: 'Margen op.', get: c => Fmt.pctPlain((last(c).operating_income / last(c).revenue) * 100), sort: c => last(c).operating_income / last(c).revenue },
    { key: 'npm',      label: 'Margen neto', get: c => Fmt.pctPlain((last(c).net_income / last(c).revenue) * 100), sort: c => last(c).net_income / last(c).revenue },
    { key: 'rnd',      label: 'I+D / ventas', get: c => Fmt.pctPlain(((last(c).rnd || 0) / last(c).revenue) * 100), sort: c => (last(c).rnd || 0) / last(c).revenue },
    { key: 'capex',    label: 'Capex',      get: c => Fmt.millions(last(c).capex), sort: c => last(c).capex },
    { key: 'fcf',      label: 'Caja libre', get: c => Fmt.millions(last(c).free_cash_flow), sort: c => last(c).free_cash_flow },
    { key: 'eps',      label: 'BPA',        get: c => Fmt.eps(last(c).eps_diluted), sort: c => last(c).eps_diluted },
    { key: 'roe',      label: 'ROE',        get: c => Fmt.pctPlain(c.kpi.roe), sort: c => c.kpi.roe },
  ];

  function renderTable() {
    const table = document.getElementById('dataTable');
    const head = table.tHead, body = table.tBodies[0];

    head.textContent = '';
    const tr = document.createElement('tr');
    COLUMNS.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label + (state.sort.key === col.key ? (state.sort.dir < 0 ? ' ↓' : ' ↑') : '');
      th.className = state.sort.key === col.key ? 'is-sorted' : '';
      th.addEventListener('click', () => {
        state.sort = { key: col.key, dir: state.sort.key === col.key ? -state.sort.dir : -1 };
        renderTable();
      });
      tr.appendChild(th);
    });
    head.appendChild(tr);

    const col = COLUMNS.find(c => c.key === state.sort.key) || COLUMNS[2];
    const rows = visible().sort((a, b) => {
      const va = (col.sort || col.get)(a), vb = (col.sort || col.get)(b);
      if (typeof va === 'string') return state.sort.dir * vb.localeCompare(va, 'es');
      return state.sort.dir * ((vb ?? -Infinity) - (va ?? -Infinity));
    });

    body.textContent = '';
    rows.forEach(c => {
      const row = document.createElement('tr');
      if (c.ticker === state.selected) row.className = 'is-active';
      COLUMNS.forEach(cl => {
        const td = document.createElement('td');
        td.textContent = cl.get(c);
        if (cl.signed) {
          const v = cl.sort(c);
          td.className = v >= 0 ? 'pos' : 'neg';
        }
        if (cl.key === 'name') td.title = `${c.sector} · ${c.hq} · CIK ${c.cik}`;
        row.appendChild(td);
      });
      row.addEventListener('click', () => select(c.ticker));
      body.appendChild(row);
    });
  }

  function exportCsv() {
    const rows = [COLUMNS.map(c => c.label)];
    visible().forEach(c => rows.push(COLUMNS.map(cl => cl.get(c))));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas-financiero-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── orquestación ─────────────────────────────────────────────
  function renderAll() {
    renderTiles();
    renderColumn();
    renderRank();
    renderArea();
    renderMix();
    renderBubble();
    renderInsights();
    renderTable();
  }

  function select(ticker) {
    state.selected = ticker;
    state.mixAxis = null;
    Charts.hideTip();
    renderAll();
  }

  // ── controles ────────────────────────────────────────────────
  function wire() {
    document.querySelectorAll('[data-basis]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.basis = btn.dataset.basis;
        document.querySelectorAll('[data-basis]').forEach(b => b.classList.toggle('is-active', b === btn));
        document.querySelectorAll('[data-metric]').forEach(b => {
          const ok = state.basis === 'fy' || METRICS[b.dataset.metric].ttm;
          b.disabled = !ok;
          b.style.opacity = ok ? '' : '.4';
          b.title = ok ? '' : 'La SEC solo publica esta partida con cadencia anual';
        });
        if (state.basis === 'ttm') {
          state.metric = 'revenue';
          document.querySelectorAll('[data-metric]')
            .forEach(b => b.classList.toggle('is-active', b.dataset.metric === 'revenue'));
        }
        renderAll();
      });
    });

    document.querySelectorAll('[data-metric]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.metric = btn.dataset.metric;
        document.querySelectorAll('[data-metric]').forEach(b => b.classList.toggle('is-active', b === btn));
        renderAll();
      });
    });

    let t;
    document.getElementById('search').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.filter = e.target.value;
        const list = visible();
        if (list.length && !list.some(c => c.ticker === state.selected)) state.selected = list[0].ticker;
        renderAll();
      }, 140);
    });

    document.getElementById('exportCsv').addEventListener('click', exportCsv);

    const toggle = document.getElementById('themeToggle');
    toggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('atlas-theme', next); } catch (_) { /* modo privado */ }
      renderAll();
    });

    // navegación lateral
    const links = [...document.querySelectorAll('[data-nav]')];
    links.forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      document.querySelector(a.getAttribute('href'))
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const io = new IntersectionObserver(entries => {
      entries.filter(en => en.isIntersecting).forEach(en => {
        links.forEach(a => a.classList.toggle('is-active', a.dataset.nav === en.target.id));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    links.forEach(a => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) io.observe(target);
    });

    addEventListener('scroll', Charts.hideTip, { passive: true });
  }

  // ── arranque ─────────────────────────────────────────────────
  try {
    const saved = localStorage.getItem('atlas-theme');
    if (saved) document.documentElement.dataset.theme = saved;
    else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  } catch (_) { /* almacenamiento no disponible */ }

  const generated = new Date(DATA.financials.meta.generated_at);
  document.getElementById('periodLine').textContent =
    `${ALL.length} compañías · último ejercicio fiscal reportado por cada una · datos XBRL de la SEC`;
  document.getElementById('sourceLine').innerHTML =
    `SEC EDGAR · <a href="https://www.sec.gov/edgar/sec-api-documentation" target="_blank" rel="noopener">XBRL company facts API</a> ` +
    `e instancias XBRL de los 10-K. Extracción del ${generated.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}. ` +
    `Cifras auditadas en dólares estadounidenses.`;

  wire();
  renderAll();
})();
