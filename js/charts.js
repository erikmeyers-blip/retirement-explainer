/**
 * SVG chart rendering. No dependencies — everything is hand-built so the site
 * stays a drop-in static deploy.
 *
 * Both charts re-render at the container's real pixel width (via
 * ResizeObserver) rather than being scaled by a viewBox, so label text is
 * always at its true size and never shrinks to nothing on a phone.
 */

import { money, moneyCompact } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* --------------------------------------------------------------------- *
 * Tiny SVG helpers
 * --------------------------------------------------------------------- */

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

function text(str, attrs = {}) {
  const node = svgEl('text', attrs);
  node.textContent = str;
  return node;
}

/** Reads a CSS custom property off an element, so charts follow the theme. */
function token(el, name, fallback = '#000') {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * A bar with its data-end rounded and its baseline-end square.
 * `side` says which edge is the data end: 'top' | 'right'.
 */
function barPath(x, y, w, h, r, side) {
  if (w <= 0 || h <= 0) return '';
  const radius = Math.max(0, Math.min(r, side === 'top' ? w / 2 : h / 2, side === 'top' ? h : w));
  if (radius === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;

  if (side === 'top') {
    return `M${x},${y + h}V${y + radius}a${radius},${radius} 0 0 1 ${radius},${-radius}` +
           `h${w - 2 * radius}a${radius},${radius} 0 0 1 ${radius},${radius}V${y + h}Z`;
  }
  return `M${x},${y}h${w - radius}a${radius},${radius} 0 0 1 ${radius},${radius}` +
         `v${h - 2 * radius}a${radius},${radius} 0 0 1 ${-radius},${radius}H${x}Z`;
}

/** Nice round axis ticks — 0, 500K, 1.0M — never raw maxima. */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const rawStep = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) || magnitude * 10;
  const ticks = [];
  for (let v = 0; v <= max * 1.0001; v += step) ticks.push(v);
  return ticks;
}

/* --------------------------------------------------------------------- *
 * Shared tooltip
 * --------------------------------------------------------------------- */

function attachTooltip(container) {
  let tip = container.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    container.appendChild(tip);
  }

  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const bounds = container.getBoundingClientRect();
      const width = tip.offsetWidth;
      // Keep the tooltip inside the card rather than letting it clip.
      const left = Math.max(4, Math.min(x - width / 2, bounds.width - width - 4));
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

/** Wires hover, focus and touch to the same tooltip content. */
function bindTip(node, tooltip, render) {
  const show = () => render();
  node.addEventListener('mouseenter', show);
  node.addEventListener('focus', show);
  node.addEventListener('touchstart', show, { passive: true });
  node.addEventListener('mouseleave', tooltip.hide);
  node.addEventListener('blur', tooltip.hide);
}

/**
 * Re-renders `draw` whenever the container's width changes. Returns a function
 * that re-runs the draw with fresh data.
 */
function responsive(container, draw) {
  let latest = null;
  let lastPainted = 0;

  // Always measure at paint time rather than trusting a cached width. If a
  // resize notification is ever missed, the next render — moving any slider —
  // corrects the scale instead of redrawing at a stale size and staying wrong.
  const paint = () => {
    const width = Math.round(container.getBoundingClientRect().width);
    if (latest === null || width === 0) return;
    lastPainted = width;
    const svg = container.querySelector('svg');
    if (svg) svg.remove();
    container.insertBefore(draw(latest, width), container.firstChild);
  };

  new ResizeObserver(() => {
    if (Math.round(container.getBoundingClientRect().width) !== lastPainted) paint();
  }).observe(container);

  return (data) => {
    latest = data;
    paint();
  };
}

/* --------------------------------------------------------------------- *
 * Headline chart — start now vs. wait five years
 * --------------------------------------------------------------------- */

/**
 * Grouped columns at each retirement checkpoint.
 *
 * Emphasis form: "Start now" carries the accent hue and is the only series
 * direct-labelled; "Waited 5 years" recedes into gray. The story is one series,
 * so the chart says so.
 */
export function createComparisonChart(container) {
  const tooltip = attachTooltip(container);

  const draw = (data, width) => {
    const { checkpoints, delayYears } = data;
    const isNarrow = width < 480;

    const pad = {
      top: 28,
      right: isNarrow ? 6 : 12,
      bottom: 46,
      left: isNarrow ? 44 : 56,
    };
    const height = isNarrow ? 250 : 320;
    const plotW = Math.max(10, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;

    const colorStart = token(container, '--series-start', '#2a78d6');
    const colorWait = token(container, '--series-wait', '#8d8a82');
    const inkMuted = token(container, '--text-muted', '#898781');
    const inkPrimary = token(container, '--text-primary', '#0b0b0b');
    const grid = token(container, '--gridline', '#e1e0d9');
    const axis = token(container, '--axis', '#c3c2b7');

    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label':
        `Roth IRA balance at ages ${checkpoints.map((c) => c.age).join(', ')}, ` +
        `comparing starting now against waiting ${delayYears} years. ` +
        checkpoints
          .map((c) => `At ${c.age}: ${money(c.startNow)} versus ${money(c.delayed)}`)
          .join('. '),
    });

    const maxValue = Math.max(...checkpoints.map((c) => c.startNow), 1);
    const ticks = niceTicks(maxValue);
    const scaleMax = ticks[ticks.length - 1] || 1;
    const y = (v) => pad.top + plotH - (v / scaleMax) * plotH;

    for (const t of ticks) {
      const ty = y(t);
      svg.appendChild(svgEl('line', {
        x1: pad.left, x2: pad.left + plotW, y1: ty, y2: ty,
        stroke: t === 0 ? axis : grid, 'stroke-width': 1,
      }));
      svg.appendChild(text(moneyCompact(t), {
        x: pad.left - 8, y: ty + 4, 'text-anchor': 'end',
        class: 'chart-tick', fill: inkMuted,
      }));
    }

    const bandW = plotW / checkpoints.length;
    const gap = 2;                                   // surface gap between the pair
    const barW = Math.min(24, (bandW - 28 - gap) / 2);

    checkpoints.forEach((cp, i) => {
      const bandCenter = pad.left + bandW * i + bandW / 2;
      const pairLeft = bandCenter - barW - gap / 2;

      const bars = [
        { value: cp.startNow, color: colorStart, x: pairLeft },
        { value: cp.delayed, color: colorWait, x: pairLeft + barW + gap },
      ];

      for (const bar of bars) {
        const barTop = y(bar.value);
        svg.appendChild(svgEl('path', {
          d: barPath(bar.x, barTop, barW, pad.top + plotH - barTop, 4, 'top'),
          fill: bar.color,
        }));
      }

      // Direct-label only the series the story is about.
      svg.appendChild(text(moneyCompact(cp.startNow), {
        x: bars[0].x + barW / 2,
        y: y(cp.startNow) - 8,
        'text-anchor': 'middle',
        class: 'chart-value',
        fill: inkPrimary,
      }));

      svg.appendChild(text(String(cp.age), {
        x: bandCenter, y: pad.top + plotH + 20,
        'text-anchor': 'middle', class: 'chart-tick', fill: inkMuted,
      }));

      const hit = svgEl('rect', {
        x: pad.left + bandW * i, y: pad.top,
        width: bandW, height: plotH,
        fill: 'transparent', class: 'chart-hit', tabindex: '0', role: 'button',
        'aria-label':
          `Age ${cp.age}: starting now ${money(cp.startNow)}, ` +
          `waiting ${delayYears} years ${money(cp.delayed)}, ` +
          `a difference of ${money(cp.gap)}`,
      });
      bindTip(hit, tooltip, () => tooltip.show(
        `<strong>At age ${cp.age}</strong>` +
        `<span class="tip-row"><i class="tip-dot" style="background:${colorStart}"></i>` +
        `Start now <b>${money(cp.startNow)}</b></span>` +
        `<span class="tip-row"><i class="tip-dot" style="background:${colorWait}"></i>` +
        `Wait ${delayYears} years <b>${money(cp.delayed)}</b></span>` +
        `<span class="tip-gap">Difference: ${money(cp.gap)}</span>`,
        bandCenter,
        y(cp.startNow),
      ));
      svg.appendChild(hit);
    });

    svg.appendChild(text('Your age', {
      x: pad.left + plotW / 2, y: height - 8,
      'text-anchor': 'middle', class: 'chart-axis-title', fill: inkMuted,
    }));

    return svg;
  };

  return responsive(container, draw);
}

/* --------------------------------------------------------------------- *
 * Pay flow — a vertical Sankey
 * --------------------------------------------------------------------- */

const FLOW_TOKENS = {
  anchor: '--wf-anchor',
  tax: '--wf-tax',
  rothIRA: '--series-1',
  savings: '--series-2',
  housing: '--series-3',
  groceries: '--series-4',
  charity: '--series-5',
  funMoney: '--series-6',
};

export function flowColor(container, node) {
  return token(container, FLOW_TOKENS[node.tone] || '--series-1', '#2a78d6');
}

/**
 * The Sankey runs TOP TO BOTTOM rather than left to right.
 *
 * A horizontal Sankey needs a label gutter on both sides, which simply does not
 * exist at 375px — and a phone is where this gets used. Flowing downward means
 * every stage gets the full width, so the same diagram works from a phone up to
 * a desktop with no separate mobile version.
 *
 * The diagram carries proportion and colour; the list underneath carries the
 * names and exact amounts. Neither has to do the other's job, so no label ever
 * has to be squeezed into a 12px-wide segment.
 */
export function createPayFlowChart(container) {
  const tooltip = attachTooltip(container);

  const draw = (flow, width) => {
    const isNarrow = width < 470;
    const pad = { top: 4, right: 1, bottom: 4, left: 1 };
    const rowH = isNarrow ? 24 : 28;
    const ribbonH = isNarrow ? 52 : 66;
    const gap = 3;

    const height = pad.top + rowH * 3 + ribbonH * 2 + pad.bottom;
    const plotW = Math.max(10, width - pad.left - pad.right);

    const surface = token(container, '--surface-1', '#fff');
    const inkMuted = token(container, '--text-muted', '#898781');

    const svg = svgEl('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label':
        'Flow of a year of pay: ' +
        flow.nodes.map((n) => `${n.label} ${money(n.value)}`).join(', '),
    });

    const gross = flow.nodes.find((n) => n.key === 'gross');
    if (!gross || gross.value <= 0) {
      svg.appendChild(text('Set your hours above zero to see where your pay goes.', {
        x: width / 2, y: height / 2, 'text-anchor': 'middle',
        class: 'wf-label', fill: inkMuted,
      }));
      return svg;
    }

    // Rows keep the same dollars-per-pixel scale so the ribbons stay honest.
    const rows = [0, 1, 2].map((c) =>
      flow.nodes.filter((n) => n.column === c && n.value > 0.5));
    const ppd = Math.min(
      ...rows.map((row) => {
        const sum = row.reduce((a, n) => a + n.value, 0);
        return sum > 0 ? (plotW - (row.length - 1) * gap) / sum : Infinity;
      }),
    );

    // Row 1 leads with take-home pay and row 2 starts at the same left edge, so
    // the money you keep runs straight down the left while taxes peel off right.
    const pos = new Map();
    rows.forEach((row, ri) => {
      const y = pad.top + ri * (rowH + ribbonH);
      let x = pad.left;
      for (const node of row) {
        const w = Math.max(2, node.value * ppd);
        pos.set(node.key, { x, y, w, h: rowH, node });
        x += w + gap;
      }
    });

    // --- ribbons, drawn first so nodes and labels sit on top ---
    const outOffset = new Map();
    for (const link of flow.links) {
      const s = pos.get(link.source);
      const t = pos.get(link.target);
      if (!s || !t || link.value <= 0.5) continue;

      const w = link.value * ppd;
      const x0 = s.x + (outOffset.get(link.source) || 0);
      outOffset.set(link.source, (outOffset.get(link.source) || 0) + w);

      const yTop = s.y + s.h;
      const yBot = t.y;
      const cy = (yTop + yBot) / 2;
      const x1 = t.x;

      // The gross-to-take-home ribbon is ~90% of the width and would otherwise
      // read as a gray slab across the top. Keeping it faint lets the thing
      // that actually matters — the slice peeling off to tax — stay visible.
      svg.appendChild(svgEl('path', {
        d: `M${x0},${yTop} C${x0},${cy} ${x1},${cy} ${x1},${yBot} ` +
           `L${x1 + w},${yBot} C${x1 + w},${cy} ${x0 + w},${cy} ${x0 + w},${yTop} Z`,
        fill: flowColor(container, t.node),
        opacity: t.node.tone === 'anchor' ? 0.16 : 0.38,
      }));
    }

    // --- nodes ---
    for (const { x, y, w, h, node } of pos.values()) {
      svg.appendChild(svgEl('rect', {
        x, y, width: w, height: h, rx: 3,
        fill: flowColor(container, node),
      }));

      // Only the two anchors are ever wide enough to hold a label reliably.
      if (node.tone === 'anchor') {
        const label = `${node.label} · ${money(node.value)}`;
        const needed = label.length * (isNarrow ? 5.6 : 6.1) + 18;
        if (w >= needed) {
          svg.appendChild(text(label, {
            x: x + 9, y: y + h / 2 + 4,
            class: 'flow-inline', fill: surface,
          }));
        }
      }

      const hit = svgEl('rect', {
        x, y: y - 3, width: w, height: h + 6,
        fill: 'transparent', class: 'chart-hit', tabindex: '0', role: 'button',
        'aria-label': `${node.label}: ${money(node.value)} per year`,
      });
      bindTip(hit, tooltip, () => tooltip.show(
        `<strong>${node.label}</strong>` +
        `<span class="tip-row">${money(node.value)} per year</span>` +
        `<span class="tip-gap">${money(node.value / 12)} per month · ` +
        `${Math.round((node.value / gross.value) * 100)}% of gross pay</span>`,
        x + w / 2, y,
      ));
      svg.appendChild(hit);
    }

    return svg;
  };

  return responsive(container, draw);
}

/* --------------------------------------------------------------------- *
 * Readouts — always visible, so no value is locked behind a hover
 * --------------------------------------------------------------------- */

export function renderComparisonTable(tbody, checkpoints) {
  tbody.innerHTML = '';
  for (const cp of checkpoints) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<th scope="row">${cp.age}</th>` +
      `<td>${money(cp.startNow)}</td>` +
      `<td>${money(cp.delayed)}</td>` +
      `<td>${money(cp.gap)}</td>`;
    tbody.appendChild(tr);
  }
}

/**
 * The named, itemised twin of the Sankey. This is not a fallback — it is the
 * half of the chart that carries the words, and it is always on screen.
 */
export function renderPayFlowList(container, flow) {
  const groups = [
    {
      title: 'Taken out before you see it',
      nodes: flow.nodes.filter((n) => n.tone === 'tax'),
    },
    {
      title: 'What you do with the rest',
      nodes: flow.nodes.filter((n) => n.column === 2),
    },
  ];

  container.innerHTML = groups.map((group) => `
    <div class="flow-group">
      <h3 class="flow-group-title">${group.title}</h3>
      <ul class="flow-list">
        ${group.nodes.map((node) => {
          const zero = Math.abs(node.value) < 0.5;
          const negative = node.value < -0.5;
          return `<li class="flow-item${zero ? ' is-zero' : ''}${negative ? ' is-negative' : ''}">
            <span class="flow-dot" style="background:${flowColor(container, node)}"></span>
            <span class="flow-name">${node.label}</span>
            <span class="flow-year">${money(node.value)}</span>
            <span class="flow-month">${money(node.value / 12)}/mo</span>
          </li>`;
        }).join('')}
      </ul>
    </div>`).join('');
}
