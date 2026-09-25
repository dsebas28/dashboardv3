/* =============================================================
   Gráficos en SVG, sin dependencias externas.
   Marcas finas, extremos redondeados de 4 px, separación de 2 px
   en color de superficie y capa de hover en todos los formatos.
   ============================================================= */

const Charts = (() => {

  const NS = 'http://www.w3.org/2000/svg';
  const tipEl = document.getElementById('tooltip');

  const el = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    return node;
  };

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ── tooltip compartido ────────────────────────────────────────
  function showTip(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.classList.add('is-on');
    const box = tipEl.getBoundingClientRect();
    const left = Math.min(Math.max(x, box.width / 2 + 8), innerWidth - box.width / 2 - 8);
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${Math.max(y, box.height + 12)}px`;
  }
  const hideTip = () => tipEl.classList.remove('is-on');

  const tipRow = (color, name, value) =>
    `<div class="row">${color ? `<i style="background:${color}"></i>` : ''}<em>${name}</em><span>${value}</span></div>`;

  // ── escalas ──────────────────────────────────────────────────
  function niceScale(max, min = 0, count = 4) {
    if (max === min) max = min + 1;
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { lo, hi, ticks };
  }

  /** Redibuja al cambiar el tamaño del contenedor: el SVG se genera
      con píxeles reales, nunca escalando texto con viewBox. */
  function mount(node, draw) {
    const run = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      if (w < 40 || h < 40) return;
      node.textContent = '';
      node.appendChild(draw(w, h));
    };
    node._draw = run;
    if (!node._ro) {
      node._ro = new ResizeObserver(() => node._draw && node._draw());
      node._ro.observe(node);
    }
    run();
  }

  /** Extremo superior redondeado, base recta sobre la línea cero. */
  function barPath(x, y, w, h, r = 4) {
    const rr = Math.min(r, w / 2, Math.max(h, 0));
    if (h <= 0.5) return `M${x} ${y}h${w}`;
    return `M${x} ${y + h}V${y + rr}a${rr} ${rr} 0 0 1 ${rr} ${-rr}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h}Z`;
  }

  // ══════════════════════════════════════════════════════════════
  // Columnas agrupadas
  // ══════════════════════════════════════════════════════════════
  function column(node, cfg) {
    mount(node, (w, h) => {
      const svg = el('svg', { width: w, height: h });
      const m = { t: 26, r: 10, b: 42, l: 62 };
      const pw = w - m.l - m.r;
      const ph = h - m.t - m.b;
      const cats = cfg.categories;
      const series = cfg.series;

      const max = Math.max(...series.flatMap(s => s.values.map(v => v || 0)), 0);
      const { hi, ticks } = niceScale(max);
      const y = v => m.t + ph - (v / hi) * ph;

      // rejilla + eje de valores
      ticks.forEach(t => {
        svg.appendChild(el('line', { class: 'ax-line', x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t) }));
        const lab = el('text', { class: 'ax-text', x: m.l - 10, y: y(t) + 4, 'text-anchor': 'end' });
        lab.textContent = Fmt.axis(t);
        svg.appendChild(lab);
      });
      const unit = el('text', { class: 'ax-text', x: m.l - 10, y: m.t - 12, 'text-anchor': 'end' });
      unit.textContent = 'M$';
      svg.appendChild(unit);

      const band = pw / cats.length;
      const barW = Math.min(24, (band * 0.54) / series.length);
      const groupW = barW * series.length + 2 * (series.length - 1); // separación de 2 px

      cats.forEach((cat, i) => {
        const cx = m.l + band * i + band / 2;

        if (cat.key === cfg.selected) {
          svg.appendChild(el('rect', {
            x: cx - band / 2 + 3, y: m.t - 12, width: band - 6, height: ph + 12,
            rx: 10, fill: css('--accent-soft')
          }));
        }

        series.forEach((s, si) => {
          const v = s.values[i] || 0;
          const bx = cx - groupW / 2 + si * (barW + 2);
          svg.appendChild(el('path', {
            d: barPath(bx, y(v), barW, m.t + ph - y(v)),
            fill: s.color
          }));
        });

        // una etiqueta por grupo, sobre la barra del ejercicio vigente,
        // solo si la banda da para escribirla sin pisar a la vecina
        const main = series[0].values[i] || 0;
        if (band > 58) {
          const cap = el('text', {
            class: 'val-text', x: cx, y: y(main) - 9, 'text-anchor': 'middle'
          });
          cap.textContent = Fmt.axis(main);
          svg.appendChild(cap);
        }

        const tic = el('text', {
          class: 'ax-text ax-text--strong', x: cx, y: m.t + ph + 19, 'text-anchor': 'middle'
        });
        tic.textContent = cat.key;
        svg.appendChild(tic);

        const nm = el('text', { class: 'ax-text', x: cx, y: m.t + ph + 33, 'text-anchor': 'middle' });
        nm.textContent = cat.short;
        svg.appendChild(nm);

        // zona de interacción: más ancha que la marca
        const hit = el('rect', {
          x: cx - band / 2, y: m.t - 14, width: band, height: ph + 20,
          fill: 'transparent', style: 'cursor:pointer'
        });
        hit.addEventListener('pointerenter', e => {
          const rows = series.map(s => tipRow(s.color, s.label, Fmt.money(s.values[i]))).join('');
          showTip(`<b>${cat.label}</b>${rows}${cfg.extra ? cfg.extra(i) : ''}`,
            e.clientX, node.getBoundingClientRect().top + y(Math.max(...series.map(s => s.values[i] || 0))));
        });
        hit.addEventListener('pointerleave', hideTip);
        hit.addEventListener('click', () => cfg.onSelect && cfg.onSelect(cat.key));
        svg.appendChild(hit);
      });

      return svg;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Área con línea y retícula de seguimiento
  // ══════════════════════════════════════════════════════════════
  function area(node, cfg) {
    mount(node, (w, h) => {
      const svg = el('svg', { width: w, height: h });
      const m = { t: 24, r: 56, b: 36, l: 62 };
      const pw = w - m.l - m.r;
      const ph = h - m.t - m.b;
      const pts = cfg.points;
      const max = Math.max(...pts.map(p => p.value));
      const { hi, ticks } = niceScale(max);
      const x = i => m.l + (pts.length === 1 ? pw / 2 : (pw * i) / (pts.length - 1));
      const y = v => m.t + ph - (v / hi) * ph;

      ticks.forEach(t => {
        svg.appendChild(el('line', { class: 'ax-line', x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t) }));
        const lab = el('text', { class: 'ax-text', x: m.l - 10, y: y(t) + 4, 'text-anchor': 'end' });
        lab.textContent = Fmt.axis(t);
        svg.appendChild(lab);
      });
      const unit = el('text', { class: 'ax-text', x: m.l - 10, y: m.t - 11, 'text-anchor': 'end' });
      unit.textContent = 'M$';
      svg.appendChild(unit);

      const grad = el('linearGradient', { id: 'areaFill', x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(el('stop', { offset: '0%', 'stop-color': cfg.color, 'stop-opacity': .16 }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': cfg.color, 'stop-opacity': 0 }));
      const defs = el('defs');
      defs.appendChild(grad);
      svg.appendChild(defs);

      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.value)}`).join(' ');
      svg.appendChild(el('path', {
        d: `${line} L${x(pts.length - 1)} ${m.t + ph} L${x(0)} ${m.t + ph} Z`,
        fill: 'url(#areaFill)'
      }));
      svg.appendChild(el('path', {
        d: line, fill: 'none', stroke: cfg.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));

      pts.forEach((p, i) => {
        const last = i === pts.length - 1;
        svg.appendChild(el('circle', {
          cx: x(i), cy: y(p.value), r: last ? 5 : 3.2,
          fill: p.derived ? css('--surface') : cfg.color,
          stroke: p.derived ? cfg.color : css('--surface'), 'stroke-width': 2
        }));
        if (i % 2 === 0 || last) {
          const lab = el('text', { class: 'ax-text', x: x(i), y: m.t + ph + 20, 'text-anchor': 'middle' });
          lab.textContent = p.label;
          svg.appendChild(lab);
        }
      });

      // etiqueta directa en el extremo
      const lastP = pts[pts.length - 1];
      const endLab = el('text', {
        class: 'val-text', x: x(pts.length - 1) + 10, y: y(lastP.value) + 4
      });
      endLab.textContent = Fmt.axis(lastP.value);
      svg.appendChild(endLab);

      // retícula de seguimiento
      const cross = el('line', {
        class: 'ax-line', y1: m.t - 6, y2: m.t + ph, stroke: css('--line-strong'), opacity: 0
      });
      svg.appendChild(cross);
      const halo = el('circle', { r: 7, fill: 'none', stroke: cfg.color, 'stroke-width': 2, opacity: 0 });
      svg.appendChild(halo);

      const hit = el('rect', { x: m.l, y: m.t - 10, width: pw, height: ph + 16, fill: 'transparent' });
      hit.addEventListener('pointermove', e => {
        const rect = node.getBoundingClientRect();
        const i = Math.max(0, Math.min(pts.length - 1,
          Math.round(((e.clientX - rect.left - m.l) / pw) * (pts.length - 1))));
        const p = pts[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
        halo.setAttribute('cx', x(i)); halo.setAttribute('cy', y(p.value)); halo.setAttribute('opacity', 1);
        showTip(
          `<b>${p.title}</b>${tipRow(cfg.color, 'Ingresos', Fmt.money(p.value))}` +
          (p.growth != null ? tipRow(null, 'Interanual', Fmt.pct(p.growth)) : '') +
          (p.derived ? `<div class="row"><em>Trimestre derivado del anual</em></div>` : ''),
          rect.left + x(i), rect.top + y(p.value));
      });
      hit.addEventListener('pointerleave', () => {
        hideTip(); cross.setAttribute('opacity', 0); halo.setAttribute('opacity', 0);
      });
      svg.appendChild(hit);

      return svg;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Anillo
  // ══════════════════════════════════════════════════════════════
  function donut(node, cfg) {
    mount(node, (w, h) => {
      const svg = el('svg', { width: w, height: h });
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 - 2;
      const r = R * 0.63;
      const total = cfg.items.reduce((a, b) => a + b.revenue, 0);
      const gap = 2 / ((R + r) / 2);           // separación de 2 px en superficie

      let start = -Math.PI / 2;
      cfg.items.forEach((it, i) => {
        const sweep = (it.revenue / total) * Math.PI * 2;
        const a0 = start + gap / 2;
        const a1 = start + sweep - gap / 2;
        start += sweep;
        if (a1 <= a0) return;
        const big = a1 - a0 > Math.PI ? 1 : 0;
        const p = (ang, rad) => `${cx + Math.cos(ang) * rad} ${cy + Math.sin(ang) * rad}`;
        const path = el('path', {
          d: `M${p(a0, R)}A${R} ${R} 0 ${big} 1 ${p(a1, R)}L${p(a1, r)}A${r} ${r} 0 ${big} 0 ${p(a0, r)}Z`,
          fill: it.color, style: 'cursor:pointer;transition:opacity .15s'
        });
        path.addEventListener('pointerenter', e => {
          path.style.opacity = .82;
          showTip(`<b>${it.label}</b>${tipRow(it.color, 'Ingresos', Fmt.money(it.revenue))}` +
            tipRow(null, 'Peso', Fmt.pctPlain(it.share)), e.clientX, e.clientY);
        });
        path.addEventListener('pointerleave', () => { path.style.opacity = 1; hideTip(); });
        svg.appendChild(path);
      });

      const top = el('text', {
        x: cx, y: cy - 4, 'text-anchor': 'middle',
        style: `fill:${css('--ink')};font:680 19px var(--font, sans-serif)`
      });
      top.textContent = Fmt.axis(total);
      svg.appendChild(top);
      const sub = el('text', {
        x: cx, y: cy + 15, 'text-anchor': 'middle',
        style: `fill:${css('--ink-3')};font:560 11px var(--font, sans-serif)`
      });
      sub.textContent = cfg.centerLabel;
      svg.appendChild(sub);
      return svg;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Dispersión con área proporcional
  // ══════════════════════════════════════════════════════════════
  function bubble(node, cfg) {
    mount(node, (w, h) => {
      const svg = el('svg', { width: w, height: h });
      const m = { t: 22, r: 30, b: 46, l: 58 };
      const pw = w - m.l - m.r;
      const ph = h - m.t - m.b;
      const pts = cfg.points;

      const xs = niceScale(Math.max(...pts.map(p => p.x)) + 8, Math.min(0, Math.min(...pts.map(p => p.x)) - 6));
      const ys = niceScale(Math.max(...pts.map(p => p.y)) + 8, Math.min(0, Math.min(...pts.map(p => p.y)) - 4));
      const X = v => m.l + ((v - xs.lo) / (xs.hi - xs.lo)) * pw;
      const Y = v => m.t + ph - ((v - ys.lo) / (ys.hi - ys.lo)) * ph;
      const maxR = Math.max(...pts.map(p => p.size));
      const R = v => 9 + Math.sqrt(v / maxR) * 24;

      ys.ticks.forEach(t => {
        svg.appendChild(el('line', { class: 'ax-line', x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t) }));
        const lab = el('text', { class: 'ax-text', x: m.l - 10, y: Y(t) + 4, 'text-anchor': 'end' });
        lab.textContent = `${Fmt.int0.format(t)} %`;
        svg.appendChild(lab);
      });
      xs.ticks.forEach(t => {
        const lab = el('text', { class: 'ax-text', x: X(t), y: m.t + ph + 20, 'text-anchor': 'middle' });
        lab.textContent = `${Fmt.int0.format(t)} %`;
        svg.appendChild(lab);
      });
      if (xs.lo < 0 && xs.hi > 0) {
        svg.appendChild(el('line', {
          x1: X(0), x2: X(0), y1: m.t, y2: m.t + ph,
          stroke: css('--line-strong'), 'stroke-width': 1
        }));
      }

      const xl = el('text', { class: 'ax-text', x: m.l + pw / 2, y: h - 8, 'text-anchor': 'middle' });
      xl.textContent = 'Crecimiento de ingresos';
      svg.appendChild(xl);
      const yl = el('text', {
        class: 'ax-text', x: 0, y: 0, 'text-anchor': 'middle',
        transform: `translate(14 ${m.t + ph / 2}) rotate(-90)`
      });
      yl.textContent = 'Margen operativo';
      svg.appendChild(yl);

      pts.forEach(p => {
        const sel = p.key === cfg.selected;
        const g = el('g', { style: 'cursor:pointer' });
        g.appendChild(el('circle', {
          cx: X(p.x), cy: Y(p.y), r: R(p.size),
          fill: cfg.color, 'fill-opacity': sel ? .34 : .16,
          stroke: cfg.color, 'stroke-width': 2
        }));
        const lab = el('text', {
          x: X(p.x), y: Y(p.y) + 4, 'text-anchor': 'middle',
          style: `fill:${css('--ink')};font:640 11px var(--font, sans-serif)`
        });
        lab.textContent = p.key;
        g.appendChild(lab);
        g.addEventListener('pointerenter', e => showTip(
          `<b>${p.label}</b>${tipRow(cfg.color, 'Crecimiento', Fmt.pct(p.x))}` +
          tipRow(null, 'Margen operativo', Fmt.pctPlain(p.y)) +
          tipRow(null, 'Ingresos', Fmt.money(p.size)),
          e.clientX, e.clientY));
        g.addEventListener('pointerleave', hideTip);
        g.addEventListener('click', () => cfg.onSelect && cfg.onSelect(p.key));
        svg.appendChild(g);
      });

      return svg;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Sparkline de tile
  // ══════════════════════════════════════════════════════════════
  function spark(values, color, w = 96, h = 30) {
    const svg = el('svg', { class: 'tile__spark', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });
    const min = Math.min(...values), max = Math.max(...values);
    const x = i => (w * i) / (values.length - 1);
    const y = v => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
    svg.appendChild(el('path', {
      d, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke'
    }));
    svg.appendChild(el('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.6, fill: color }));
    return svg;
  }

  return { column, area, donut, bubble, spark, hideTip };
})();
