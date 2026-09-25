/* Formateo numérico en español. Todas las cifras monetarias se expresan en
   millones de dólares, la misma unidad en la que la SEC publica los estados. */

const Fmt = (() => {
  const int0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const dec1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dec2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Dólares absolutos → millones, con separador de miles. */
  const millions = v => (v == null ? '—' : int0.format(Math.round(v / 1e6)));

  /** Millones con sufijo de unidad, para tooltips y tiles. */
  const money = v => (v == null ? '—' : `${millions(v)} M$`);

  /** Etiquetas de eje y de marca: la misma unidad que el resto del panel
      (millones de $), para no obligar a reescalar mentalmente. */
  const axis = v => int0.format(Math.round(v / 1e6));

  const pct = (v, digits = 1) =>
    (v == null ? '—' : `${v > 0 ? '+' : ''}${(digits ? dec1 : int0).format(v)} %`);

  const pctPlain = (v, digits = 1) =>
    (v == null ? '—' : `${(digits ? dec1 : int0).format(v)} %`);

  const eps = v => (v == null ? '—' : `${dec2.format(v)} $`);

  /** Etiqueta corta de trimestre fiscal: 2026 · 2T */
  const quarter = q => `${q.fy} · ${q.q}T`;

  return { millions, money, axis, pct, pctPlain, eps, quarter, int0, dec1 };
})();
