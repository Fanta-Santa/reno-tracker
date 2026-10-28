// Dashboard charts. One blue for spending, orange only for tools, and the status colours (green, amber, red)
// only for budget status, always with a symbol and words so colour is never the only clue.

import { html, useEffect, useRef, useState } from '../lib.js';
import { formatMoney } from '../format.js';
import { StatusBadge, STATUS_TEXT } from '../views/house.js';

export const SERIES = '#2a78d6'; // spending
export const SERIES_LIGHT = '#86b6ef'; // committed (accepted quotes)
export const TOOLS = '#eb6834';
export const CRITICAL = '#d03b3b';

const pct = (v, max) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`;

/** "$12.3K" style labels for axes. */
export function compactMoney(cents) {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 ? 1 : 0)}M`;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(d % 1000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `$${Math.round(d)}`;
}

// ---------- Budget by room: spent against budget ----------

/**
 * rows: [{ id, label, emoji, spent, committed, budget, status }]. onSelect(id) when a row is tapped.
 * Spent is blue; any part over budget is red; accepted quotes are light blue; the budget is a dark tick.
 */
export function BudgetBars({ rows, onSelect }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.spent + r.committed, r.budget || 0)));
  return html`<div class="bb">
    ${rows.map((r) => {
      const within = r.budget ? Math.min(r.spent, r.budget) : r.spent;
      const over = r.budget && r.spent > r.budget ? r.spent - r.budget : 0;
      let note;
      if (!r.budget) note = 'No budget set';
      else if (r.status === 'over') note = `Over by ${formatMoney(r.spent - r.budget, { whole: true })}`;
      else note = `${Math.round((r.spent / r.budget) * 100)}% used · ${formatMoney(r.budget - r.spent - r.committed, { whole: true })} left`;
      return html`<button class="bb-row" key=${r.id} onClick=${() => onSelect?.(r.id)}
        aria-label=${`${r.label}: spent ${formatMoney(r.spent)}${r.budget ? ` of ${formatMoney(r.budget)}` : ''}. ${STATUS_TEXT[r.status]}.`}>
        <span class="bb-head">
          <span class="bb-name"><span aria-hidden="true">${r.emoji}</span> ${r.label}</span>
          <span class="bb-value">${formatMoney(r.spent, { whole: true })}${r.budget ? html`<small> of ${formatMoney(r.budget, { whole: true })}</small>` : ''}</span>
        </span>
        <span class="bb-track">
          <span class="bb-fill" style=${`width:${pct(within, max)}`} />
          ${r.committed > 0 && html`<span class="bb-committed" style=${`left:calc(${pct(r.spent, max)} + 2px);width:${pct(r.committed, max)}`} />`}
          ${over > 0 && html`<span class="bb-over" style=${`left:calc(${pct(r.budget, max)} + 2px);width:calc(${pct(over, max)} - 2px)`} />`}
          ${r.budget > 0 && html`<span class="bb-budget" style=${`left:${pct(r.budget, max)}`} />`}
        </span>
        <span class="bb-note"><${StatusBadge} status=${r.status} />${note}${r.committed > 0 ? ` · ${formatMoney(r.committed, { whole: true })} in accepted quotes` : ''}</span>
      </button>`;
    })}
  </div>`;
}

// ---------- Simple horizontal bars (spending by category) ----------

/** rows: [{ id, label, value }], biggest first. One colour; the value sits at the end of each bar. */
export function Bars({ rows, onSelect }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return html`<div class="hb">
    ${rows.map((r) => html`<button class="hb-row" key=${r.id} onClick=${() => onSelect?.(r.id)}
      aria-label=${`${r.label}: ${formatMoney(r.value)}`}>
      <span class="hb-label">${r.label}</span>
      <span class="hb-bar"><span class="hb-fill" style=${`width:${pct(r.value, max)}`} /></span>
      <span class="hb-value">${formatMoney(r.value, { whole: true })}</span>
    </button>`)}
  </div>`;
}

// ---------- Part of a whole (tools vs everything else) ----------

/** parts: [{ label, value, color }]. A single stacked bar with a 2px gap, plus a legend with values. */
export function SplitBar({ parts }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  return html`<div class="split-bar">
    <div class="sb-track" role="img" aria-label=${parts.map((p) => `${p.label} ${formatMoney(p.value)}`).join(', ')}>
      ${shown.map((p) => html`<span style=${`flex:${p.value} 1 0;background:${p.color}`} />`)}
    </div>
    <div class="sb-legend">
      ${parts.map((p) => html`<span class="sb-item">
        <span class="sb-swatch" style=${`background:${p.color}`} />
        <span class="sb-text">${p.label}<strong>${formatMoney(p.value, { whole: true })}</strong><small>${Math.round((Math.max(0, p.value) / total) * 100)}%</small></span>
      </span>`)}
    </div>
  </div>`;
}

// ---------- Spend over time ----------

function niceStep(max, ticks = 4) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function useWidth() {
  const ref = useRef();
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth || 320);
    if (!('ResizeObserver' in window)) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Running total of spending, with the total budget as a reference line when it's in range.
 * series: { unit, points: [{ label, amount, cumulative }] }. budget: cents (0 for none).
 * Drag or tap across the chart to read any point.
 */
export function SpendOverTime({ series, budget }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pts = series.points;
  if (!pts.length) return null;
  const height = 180;
  const m = { l: 44, r: 16, t: 16, b: 26 };
  const last = pts[pts.length - 1].cumulative;
  const showBudget = budget > 0 && last >= budget * 0.2;
  const top = Math.max(last, showBudget ? budget : 0) * 1.08 || 100;
  const step = niceStep(top);
  const yMax = Math.ceil(top / step) * step;
  const iw = Math.max(10, width - m.l - m.r);
  const ih = height - m.t - m.b;
  const x = (i) => m.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => m.t + ih - (v / yMax) * ih;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [];
  for (let v = 0; v <= yMax + 1; v += step) ticks.push(v);
  const xLabels = pts.length > 4 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : pts.map((_, i) => i);
  const unitWord = series.unit === 'day' ? 'that day' : series.unit === 'week' ? 'that week' : 'that month';

  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round(((px - m.l) / iw) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, Number.isFinite(i) ? i : 0)));
  };
  const h = hover != null ? pts[hover] : null;

  return html`<div class="sot" ref=${ref}>
    <svg width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} role="img"
      aria-label=${`Running total of spending: ${formatMoney(last)} by ${pts[pts.length - 1].label}.`}
      onPointerDown=${pick} onPointerMove=${pick} onPointerLeave=${() => setHover(null)}>
      ${ticks.map((v) => html`<line x1=${m.l} x2=${width - m.r} y1=${y(v)} y2=${y(v)} class=${v === 0 ? 'sot-base' : 'sot-grid'} />
        <text x=${m.l - 8} y=${y(v) + 4} class="sot-tick" text-anchor="end">${compactMoney(v)}</text>`)}
      ${showBudget && html`<line x1=${m.l} x2=${width - m.r} y1=${y(budget)} y2=${y(budget)} class="sot-budget" />
        <text x=${m.l + 6} y=${y(budget) - 6} class="sot-budget-label">Budget ${compactMoney(budget)}</text>`}
      <path d=${area} fill=${SERIES} fill-opacity="0.1" />
      <path d=${line} fill="none" stroke=${SERIES} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${xLabels.map((i) => html`<text x=${x(i)} y=${height - 6} class="sot-tick"
        text-anchor=${i === 0 && pts.length > 1 ? 'start' : i === pts.length - 1 && pts.length > 1 ? 'end' : 'middle'}>${pts[i].label}</text>`)}
      ${h && html`<line x1=${x(hover)} x2=${x(hover)} y1=${m.t} y2=${y(0)} class="sot-cross" />`}
      <circle cx=${x(h ? hover : pts.length - 1)} cy=${y(h ? h.cumulative : last)} r="4" fill=${SERIES} stroke="#fff" stroke-width="2" />
    </svg>
    ${h ? html`<div class="sot-tip" style=${`left:${Math.min(Math.max(x(hover), 70), width - 70)}px`}>
        <strong>${formatMoney(h.cumulative, { whole: true })}</strong>
        <span>${h.label} · ${formatMoney(h.amount, { whole: true })} ${unitWord}</span>
      </div>`
      : html`<div class="sot-end" style=${`top:${!showBudget || y(last) - y(budget) > 30 ? Math.max(0, y(last) - 28) : y(last) + 8}px`}>${formatMoney(last, { whole: true })}</div>`}
    ${!showBudget && budget > 0 && html`<p class="chart-note">Budget ${formatMoney(budget, { whole: true })} is off the top of the chart for now.</p>`}
    <details class="chart-table">
      <summary>Show as a table</summary>
      <table>
        <thead><tr><th scope="col">${series.unit === 'day' ? 'Day' : series.unit === 'week' ? 'Week' : 'Month'}</th><th scope="col">Spent</th><th scope="col">Running total</th></tr></thead>
        <tbody>${pts.filter((p) => p.amount).map((p) => html`<tr><td>${p.label}</td><td>${formatMoney(p.amount)}</td><td>${formatMoney(p.cumulative)}</td></tr>`)}</tbody>
      </table>
    </details>
  </div>`;
}
