/**
 * UI layer. Reads the controls, hands plain numbers to the engine, and writes
 * the results back out. No financial arithmetic happens in this file — if you
 * find yourself doing math here, it belongs in calc.js.
 */

import {
  ASSUMPTIONS_2026 as A,
  PRESETS,
  simulate,
} from './calc.js';

import {
  createComparisonChart,
  createPayFlowChart,
  renderComparisonTable,
  renderPayFlowList,
} from './charts.js';

import { money, moneyCompact, percent, multiple, plainEnglishAmount } from './format.js';

const $ = (id) => document.getElementById(id);

/* --------------------------------------------------------------------- *
 * State
 * --------------------------------------------------------------------- */

/** Deep copy so the preset objects are never mutated by editing. */
const clonePreset = (p) => JSON.parse(JSON.stringify(p));

let state = clonePreset(PRESETS.teen);

const SLIDERS = ['age', 'wage', 'hours', 'growth'];
const ALLOC_SLIDERS = ['rothIRA', 'savings', 'housing', 'groceries', 'charity'];

/* --------------------------------------------------------------------- *
 * Charts
 * --------------------------------------------------------------------- */

const drawComparison = createComparisonChart($('comparison-chart'));
const drawPayFlow = createPayFlowChart($('payflow-chart'));

/* --------------------------------------------------------------------- *
 * Control <-> state sync
 * --------------------------------------------------------------------- */

/** Pushes state into the DOM controls (used by presets and reset). */
function stateToControls() {
  $('age').value = state.currentAge;
  $('wage').value = state.hourlyWage;
  $('hours').value = state.hoursPerWeek;
  $('growth').value = (state.wageGrowth * 100).toFixed(2);

  for (const key of ALLOC_SLIDERS) {
    const value = key === 'rothIRA' ? state.allocations.rothPercent : state.allocations[key];
    $(key).value = (value * 100).toFixed(1);
  }

  // The engine works in dollars per year; this control is dollars per month.
  $('rothFlat').value = Math.round(state.allocations.rothFlat / 12);
  setRothMode(state.allocations.rothMode, { silent: true });
}

/** Pulls the DOM controls into state. */
function controlsToState() {
  state.currentAge = Number($('age').value);
  state.hourlyWage = Number($('wage').value);
  state.hoursPerWeek = Number($('hours').value);
  state.wageGrowth = Number($('growth').value) / 100;

  for (const key of ALLOC_SLIDERS) {
    const fraction = Number($(key).value) / 100;
    if (key === 'rothIRA') state.allocations.rothPercent = fraction;
    else state.allocations[key] = fraction;
  }

  state.allocations.rothFlat = (Number($('rothFlat').value) || 0) * 12;
}

/* --------------------------------------------------------------------- *
 * Roth mode toggle (% of pay  <->  flat dollars)
 * --------------------------------------------------------------------- */

function setRothMode(mode, { silent = false } = {}) {
  state.allocations.rothMode = mode;
  const isFlat = mode === 'flat';

  $('roth-flat-wrap').hidden = !isFlat;
  $('rothIRA').closest('.slider-wrap').hidden = isFlat;
  $('rothIRA-rec').hidden = isFlat;

  const toggle = $('roth-mode-toggle');
  toggle.textContent = isFlat ? 'Use a percentage instead' : 'Use dollars instead';
  toggle.setAttribute('aria-pressed', String(isFlat));

  if (!silent) render();
}

/* --------------------------------------------------------------------- *
 * Slider recommendation markers
 * --------------------------------------------------------------------- */

function placeRecommendationMarkers() {
  for (const key of ALLOC_SLIDERS) {
    const input = $(key);
    const wrap = input.closest('.slider-wrap');
    if (!wrap) continue;

    const recommended = A.recommendedAllocations[key] * 100;
    const max = Number(input.max);
    wrap.style.setProperty('--marker', String(Math.min(1, recommended / max)));

    const rec = $(`${key}-rec`);
    if (rec) rec.textContent = `Recommended: ${A.recommendedLabels[key]}`;
  }
}

/* --------------------------------------------------------------------- *
 * Render
 * --------------------------------------------------------------------- */

function render() {
  const result = simulate(state);
  const { pay, allocations, flow, projection } = result;

  /* --- Step 2 readouts --- */
  $('age-out').textContent = state.currentAge;
  $('wage-out').textContent = `$${state.hourlyWage.toFixed(2)}`;
  $('hours-out').textContent = state.hoursPerWeek;
  $('growth-out').textContent = percent(state.wageGrowth, 1);

  $('pay-summary').innerHTML = pay.gross > 0
    ? `That's <strong>${money(pay.gross)}</strong> a year before taxes — ` +
      `<strong>${money(pay.net)}</strong> after, or about ` +
      `<strong>${money(pay.net / 12)}</strong> a month to work with. ` +
      (pay.federalTax === 0 && pay.stateTax === 0
        ? `At this income you owe <strong>no income tax at all</strong> — just Social Security and Medicare.`
        : `Taxes take <strong>${percent(pay.effectiveTaxRate, 1)}</strong>.`)
    : `Set your hours above zero to see your pay.`;

  /* --- Step 3 readouts --- monthly, because that is how a budget is lived */
  for (const key of ALLOC_SLIDERS) {
    const dollars = allocations[key];
    const share = pay.net > 0 ? dollars / pay.net : 0;
    $(`${key}-out`).textContent =
      `${percent(share, share < 0.1 && share > 0 ? 1 : 0)} · ${money(dollars / 12)}/mo`;
  }

  // Roth cap explanations — say which ceiling was hit, in plain words.
  const capNotice = $('roth-cap-notice');
  if (allocations.rothCappedByLimit) {
    capNotice.hidden = false;
    capNotice.removeAttribute('data-tone');
    capNotice.textContent =
      `The most anyone under 50 can put into a Roth IRA in 2026 is ` +
      `${money(A.rothIRALimit / 12)} a month — ${money(A.rothIRALimit)} a year — ` +
      `so that's what we used.`;
  } else if (allocations.rothCappedByNet) {
    capNotice.hidden = false;
    capNotice.setAttribute('data-tone', 'critical');
    capNotice.textContent =
      `You can't contribute more than you take home. Capped at ${money(pay.net / 12)} a month.`;
  } else {
    capNotice.hidden = true;
  }

  // Both units, because the $7,500 annual cap is the figure worth remembering
  // even though this control is set in months.
  $('roth-flat-note').textContent =
    `Up to ${money(A.rothIRALimit / 12)}/mo — that's the ${money(A.rothIRALimit)} yearly limit.`;

  /* --- Fun money --- */
  const funEl = $('fun-money');
  funEl.classList.toggle('is-negative', allocations.overAllocated);
  $('fun-out').innerHTML = `${money(allocations.funMoney / 12)}<span class="per">/mo</span>`;
  $('fun-sub').textContent = allocations.overAllocated
    ? `You've assigned more than you earn — pull a slider back by ` +
      `${money(-allocations.funMoney / 12)} a month.`
    : `That adds up to ${money(allocations.funMoney)} over a year.`;

  /* --- Hero --- */
  const h = projection.headline;
  const hasGap = h && h.gap > 0.5;

  $('hero-gap').textContent = hasGap ? money(h.gap) : '$0';
  $('hero-sub').textContent = hasGap
    ? `more in your retirement account by age ${h.age} — ${plainEnglishAmount(h.gap)}, in today's money.`
    : `Move the Roth IRA slider above 0% to see what starting early is worth.`;

  $('stat-extra').textContent = hasGap ? money(h.extraContributed) : '$0';
  $('stat-multiple').textContent = hasGap ? multiple(h.multiplier) : '—';

  $('insight').innerHTML = hasGap
    ? `You only put in <strong>${money(h.extraContributed)}</strong> more — but you end ` +
      `up with <strong>${money(h.gap)}</strong> more. That difference isn't your ` +
      `money. It's time doing the work.`
    : `Right now you're not contributing anything, so both paths end up the same. ` +
      `Try moving the Roth IRA slider — even 5% changes the picture.`;

  $('sticky-value').textContent = hasGap ? money(h.gap) : '$0';

  /* --- Charts + readouts --- */
  drawComparison({ checkpoints: projection.checkpoints, delayYears: A.delayYears });
  renderComparisonTable($('comparison-table'), projection.checkpoints);

  // A Sankey cannot honestly draw outflows larger than their source, so when the
  // sliders overspend we say so plainly instead of rendering broken geometry.
  const flowNote = $('flow-note');
  $('payflow-chart').hidden = allocations.overAllocated;
  flowNote.hidden = !allocations.overAllocated;
  if (allocations.overAllocated) {
    flowNote.textContent =
      `Your plan spends ${money(-allocations.funMoney)} a year more than you take ` +
      `home, so there's no flow left to draw. Pull a slider back and it'll come back.`;
  } else {
    drawPayFlow(flow);
  }
  renderPayFlowList($('payflow-list'), flow);
}

/* --------------------------------------------------------------------- *
 * Assumption notes — generated from the constants so they can never drift
 * --------------------------------------------------------------------- */

function renderAssumptionNotes() {
  const fedTop = A.federalBrackets[0];
  const mnTop = A.mnBrackets[0];

  const notes = [
    `<strong>Federal income tax</strong> uses the 2026 single-filer brackets ` +
      `(${percent(fedTop.rate)} to ${percent(A.federalBrackets.at(-1).rate)}) with the ` +
      `<strong>${money(A.federalStandardDeduction)}</strong> standard deduction.`,
    `<strong>Minnesota income tax</strong> uses the 2026 brackets ` +
      `(${percent(mnTop.rate, 2)} to ${percent(A.mnBrackets.at(-1).rate, 2)}) with the ` +
      `<strong>${money(A.mnStandardDeduction)}</strong> state standard deduction.`,
    `<strong>FICA</strong> is a flat <strong>${percent(A.ficaRate, 2)}</strong> ` +
      `(${percent(0.062, 1)} Social Security + ${percent(0.0145, 2)} Medicare).`,
    `<strong>Roth IRA</strong> contributions are capped at ` +
      `<strong>${money(A.rothIRALimit)}</strong> a year, the 2026 limit for under-50s.`,
    `Money grows at <strong>${percent(A.realReturnRate)} a year after inflation</strong>. ` +
      `That's why the totals look reasonable instead of enormous — every number is ` +
      `in <em>today's</em> dollars, so you can picture what it actually buys.`,
    `Contributions are counted at the <em>end</em> of each year, and pay stops ` +
      `growing once it reaches <strong>$${A.hourlyRateCap}/hr</strong>.`,
    `Both people in the comparison earn exactly the same money. The only ` +
      `difference is that one starts contributing <strong>${A.delayYears} years</strong> later.`,
  ];

  $('assumption-notes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
}

/* --------------------------------------------------------------------- *
 * Events
 * --------------------------------------------------------------------- */

function clearPresetSelection() {
  document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

function applyPreset(name) {
  state = clonePreset(PRESETS[name]);
  stateToControls();
  document.querySelectorAll('.preset').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.preset === name));
  });
  render();
}

function wireEvents() {
  for (const id of [...SLIDERS, ...ALLOC_SLIDERS, 'rothFlat']) {
    $(id).addEventListener('input', () => {
      controlsToState();
      clearPresetSelection();
      render();
    });
  }

  document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  $('roth-mode-toggle').addEventListener('click', () => {
    setRothMode(state.allocations.rothMode === 'flat' ? 'percent' : 'flat');
  });

  $('reset').addEventListener('click', () => applyPreset('teen'));

  // The floating summary exists so you can watch the headline number move while
  // dragging a slider. So it appears only when that is actually the situation:
  // the sliders are on screen AND the hero figure is not. Scroll past the
  // controls to read the results and it gets out of the way.
  const summary = $('sticky-summary');
  const visible = { hero: true, controls: false };

  const update = () => {
    const show = !visible.hero && visible.controls;
    summary.classList.toggle('is-visible', show);
    summary.setAttribute('aria-hidden', String(!show));
  };

  const watch = (el, key, options) => {
    new IntersectionObserver(([entry]) => {
      visible[key] = entry.isIntersecting;
      update();
    }, options).observe(el);
  };

  watch($('hero-gap'), 'hero', { rootMargin: '-60px 0px 0px 0px' });
  watch(document.querySelector('.controls'), 'controls', {});
}

/* --------------------------------------------------------------------- *
 * Boot
 * --------------------------------------------------------------------- */

$('rothFlat').max = String(Math.round(A.rothIRALimit / 12));
$('age').min = String(A.minAge);
$('age').max = String(A.maxAge);
$('wage').max = String(A.hourlyRateCap);
$('hours').max = String(A.hoursPerWeekCap);
$('growth').max = String(A.wageGrowthCap * 100);

placeRecommendationMarkers();
renderAssumptionNotes();
wireEvents();
stateToControls();
render();
