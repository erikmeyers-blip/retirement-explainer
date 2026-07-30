/**
 * Financial Literacy Simulator — calculation engine.
 *
 * Pure functions only. No DOM, no globals, no side effects — so this module can
 * be tested on its own (see test/calc.test.js) and reused anywhere.
 *
 * Every tunable assumption lives in ASSUMPTIONS_2026 below. Nothing in the
 * calculation logic hardcodes a rate, bracket, cap, or limit inline: updating
 * any assumption is a one-line change in that object.
 */

/* ------------------------------------------------------------------------- *
 * Constants — the single lookup table
 * ------------------------------------------------------------------------- */

export const ASSUMPTIONS_2026 = {
  // --- Federal income tax (tax year 2026, single filer) --------------------
  // Source: IRS Rev. Proc. 2025-32.
  federalStandardDeduction: 16100,
  federalBrackets: [
    { rate: 0.10, upTo: 12400 },
    { rate: 0.12, upTo: 50400 },
    { rate: 0.22, upTo: 105700 },
    { rate: 0.24, upTo: 201775 },
    { rate: 0.32, upTo: 256225 },
    { rate: 0.35, upTo: 640600 },
    { rate: 0.37, upTo: Infinity },
  ],

  // --- Minnesota income tax (tax year 2026, single filer) ------------------
  // Source: MN Dept. of Revenue, 2025-12-16 bracket announcement.
  mnStandardDeduction: 15300,
  mnBrackets: [
    { rate: 0.0535, upTo: 33310 },
    { rate: 0.0680, upTo: 109430 },
    { rate: 0.0785, upTo: 203150 },
    { rate: 0.0985, upTo: Infinity },
  ],

  // --- Payroll tax ---------------------------------------------------------
  // Flat 7.65% = 6.2% Social Security + 1.45% Medicare. Modeled as flat because
  // the Social Security wage base (~$184,500 in 2026) sits above the highest
  // income this tool can produce ($50/hr x 60 hrs x 52 = $156,000).
  ficaRate: 0.0765,

  // --- Retirement account --------------------------------------------------
  rothIRALimit: 7500,          // 2026 IRA contribution limit, under age 50
  realReturnRate: 0.07,        // real (inflation-adjusted) annual return

  // --- Input bounds --------------------------------------------------------
  hourlyRateCap: 50,
  hoursPerWeekCap: 60,
  weeksPerYear: 52,
  minAge: 14,
  maxAge: 40,

  // --- Projection ----------------------------------------------------------
  delayYears: 5,                          // the "what if I wait" comparison
  checkpointAges: [62, 65, 67, 70, 72],
  headlineCheckpointAge: 67,              // drives the hero figure

  // --- Recommended allocations (share of net pay) --------------------------
  recommendedAllocations: {
    charity: 0.10,
    savings: 0.125,   // midpoint of 10-15%
    rothIRA: 0.15,
    housing: 0.30,    // upper bound
    groceries: 0.11,  // midpoint of 10-12%
  },

  // How each recommendation is described in the UI. Kept beside the numbers so
  // a changed recommendation and its label never drift apart.
  recommendedLabels: {
    charity: '10%',
    savings: '10-15%',
    rothIRA: '15%',
    housing: '30% or less',
    groceries: '10-12%',
  },

  // Wage growth is expressed in REAL terms (raises above inflation), to stay
  // consistent with the real return rate above.
  defaultWageGrowth: 0.02,
  wageGrowthCap: 0.06,
};

/**
 * Preset scenarios. These pre-fill the inputs; every value stays editable.
 */
export const PRESETS = {
  teen: {
    label: 'Part-time teen job',
    hint: 'About 15 hours a week after school, living at home.',
    currentAge: 16,
    hourlyWage: 13,
    hoursPerWeek: 15,
    wageGrowth: 0.02,
    allocations: {
      charity: 0.10,
      savings: 0.15,
      housing: 0.00,
      groceries: 0.05,
      rothMode: 'percent',
      rothPercent: 0.15,
      rothFlat: 1000,
    },
  },
  career: {
    label: 'Full-time career',
    hint: 'Forty hours a week, paying your own rent and groceries.',
    currentAge: 22,
    hourlyWage: 22,
    hoursPerWeek: 40,
    wageGrowth: 0.02,
    allocations: {
      charity: 0.10,
      savings: 0.125,
      housing: 0.30,
      groceries: 0.11,
      rothMode: 'percent',
      rothPercent: 0.15,
      rothFlat: 7500,
    },
  },
};

/** The five allocation categories, in the order they are shown everywhere. */
export const ALLOCATION_KEYS = ['rothIRA', 'savings', 'housing', 'groceries', 'charity'];

export const ALLOCATION_LABELS = {
  rothIRA: 'Roth IRA',
  savings: 'Emergency savings',
  housing: 'Housing',
  groceries: 'Groceries',
  charity: 'Charity',
};

/* ------------------------------------------------------------------------- *
 * Tax math
 * ------------------------------------------------------------------------- */

/**
 * Progressive tax on an already-deducted (taxable) income.
 * @param {number} taxableIncome
 * @param {{rate:number, upTo:number}[]} brackets ascending, last upTo Infinity
 * @returns {number}
 */
export function progressiveTax(taxableIncome, brackets) {
  if (!(taxableIncome > 0)) return 0;
  let tax = 0;
  let lower = 0;
  for (const { rate, upTo } of brackets) {
    if (taxableIncome <= lower) break;
    tax += (Math.min(taxableIncome, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

export function federalIncomeTax(gross, a = ASSUMPTIONS_2026) {
  return progressiveTax(gross - a.federalStandardDeduction, a.federalBrackets);
}

export function minnesotaIncomeTax(gross, a = ASSUMPTIONS_2026) {
  return progressiveTax(gross - a.mnStandardDeduction, a.mnBrackets);
}

export function ficaTax(gross, a = ASSUMPTIONS_2026) {
  return Math.max(0, gross) * a.ficaRate;
}

/**
 * Steps 1-5 of the pipeline: gross pay through net pay.
 * @param {{hourlyWage:number, hoursPerWeek:number}} input
 * @returns {{hourlyWage:number, gross:number, federalTax:number, stateTax:number,
 *            fica:number, totalTax:number, net:number, effectiveTaxRate:number}}
 */
export function computePay({ hourlyWage, hoursPerWeek }, a = ASSUMPTIONS_2026) {
  const wage = Math.min(Math.max(0, hourlyWage), a.hourlyRateCap);
  const hours = Math.max(0, hoursPerWeek);
  const gross = wage * hours * a.weeksPerYear;

  const federalTax = federalIncomeTax(gross, a);
  const stateTax = minnesotaIncomeTax(gross, a);
  const fica = ficaTax(gross, a);
  const totalTax = federalTax + stateTax + fica;

  return {
    hourlyWage: wage,
    gross,
    federalTax,
    stateTax,
    fica,
    totalTax,
    net: gross - totalTax,
    effectiveTaxRate: gross > 0 ? totalTax / gross : 0,
  };
}

/* ------------------------------------------------------------------------- *
 * Allocations
 * ------------------------------------------------------------------------- */

/**
 * Step 6: split net pay across the allocation categories; the remainder is fun
 * money. Fun money may come out NEGATIVE when the sliders sum past 100% — that
 * is surfaced rather than clamped, because it is the whole point of the slider.
 *
 * @param {number} net
 * @param {{charity:number, savings:number, housing:number, groceries:number,
 *          rothMode:'percent'|'flat', rothPercent:number, rothFlat:number}} alloc
 * @returns {{rothIRA:number, savings:number, housing:number, groceries:number,
 *            charity:number, funMoney:number, allocated:number,
 *            rothCappedByLimit:boolean, rothCappedByNet:boolean, overAllocated:boolean}}
 */
export function computeAllocations(net, alloc, a = ASSUMPTIONS_2026) {
  const safeNet = Math.max(0, net);

  const rothRequested = alloc.rothMode === 'flat'
    ? Math.max(0, alloc.rothFlat)
    : safeNet * Math.max(0, alloc.rothPercent);

  // Two separate ceilings, reported separately so the UI can explain which bit.
  const rothIRA = Math.min(rothRequested, a.rothIRALimit, safeNet);

  const charity = safeNet * alloc.charity;
  const savings = safeNet * alloc.savings;
  const housing = safeNet * alloc.housing;
  const groceries = safeNet * alloc.groceries;

  const allocated = rothIRA + savings + housing + groceries + charity;

  return {
    rothIRA,
    savings,
    housing,
    groceries,
    charity,
    allocated,
    funMoney: safeNet - allocated,
    rothCappedByLimit: rothRequested > a.rothIRALimit + 1e-9,
    rothCappedByNet: rothRequested > safeNet + 1e-9 && safeNet < a.rothIRALimit,
    overAllocated: allocated > safeNet + 1e-9,
  };
}

/* ------------------------------------------------------------------------- *
 * Pay flow
 * ------------------------------------------------------------------------- */

/**
 * The same breakdown expressed as a flow graph, for the Sankey view.
 *
 * Three columns: gross pay -> (take-home + the three taxes) -> where the
 * take-home actually goes. Node order within each column is the order they
 * stack top-to-bottom, and link order matches, so the ribbons never cross.
 *
 * Take-home leads its column deliberately: it keeps the main channel running
 * straight across the diagram, with the taxes peeling off below it.
 */
export function buildPayFlow(pay, allocations) {
  const taxes = [
    { key: 'federalTax', label: 'Federal income tax', value: pay.federalTax },
    { key: 'stateTax', label: 'Minnesota state tax', value: pay.stateTax },
    { key: 'fica', label: 'Social Security + Medicare', value: pay.fica },
  ];

  const spending = [
    ...ALLOCATION_KEYS.map((key) => ({
      key,
      label: ALLOCATION_LABELS[key],
      value: allocations[key],
    })),
    { key: 'funMoney', label: 'Fun money', value: allocations.funMoney },
  ];

  const nodes = [
    { key: 'gross', label: 'Gross pay', value: pay.gross, column: 0, tone: 'anchor' },
    { key: 'net', label: 'Take-home pay', value: pay.net, column: 1, tone: 'anchor' },
    ...taxes.map((t) => ({ ...t, column: 1, tone: 'tax' })),
    ...spending.map((s) => ({ ...s, column: 2, tone: s.key })),
  ];

  const links = [
    { source: 'gross', target: 'net', value: pay.net },
    ...taxes.map((t) => ({ source: 'gross', target: t.key, value: t.value })),
    // Fun money is clamped at zero: a negative flow has no meaning in a Sankey,
    // and `overAllocated` is what the view uses to explain that state instead.
    ...spending.map((s) => ({ source: 'net', target: s.key, value: Math.max(0, s.value) })),
  ];

  return { nodes, links, overAllocated: allocations.overAllocated, shortfall: Math.min(0, allocations.funMoney) };
}

/* ------------------------------------------------------------------------- *
 * Projection
 * ------------------------------------------------------------------------- */

/**
 * Hourly wage after `yearIndex` years of real raises, capped.
 */
export function wageAtYear(baseWage, growthRate, yearIndex, a = ASSUMPTIONS_2026) {
  return Math.min(baseWage * Math.pow(1 + growthRate, yearIndex), a.hourlyRateCap);
}

/**
 * Step 7: year-by-year Roth IRA projection.
 *
 * Contributions are treated as made at the END of each year, so a year's own
 * contribution earns no return in that year — the conservative convention.
 * Balance is compounded at the REAL return rate, so every dollar reported is in
 * today's purchasing power.
 *
 * `contributionStartAge` is what separates the two scenarios: both people earn
 * exactly the same wage on exactly the same schedule; one simply starts putting
 * money in later.
 *
 * @returns {{age:number, wage:number, gross:number, net:number,
 *            contribution:number, balance:number, totalContributed:number}[]}
 *          One row per year; `age` is the age at which that balance is reached.
 */
export function projectRothBalance(inputs, contributionStartAge, a = ASSUMPTIONS_2026) {
  const { currentAge, hourlyWage, hoursPerWeek, wageGrowth, allocations } = inputs;
  const finalAge = a.checkpointAges[a.checkpointAges.length - 1];

  const rows = [];
  let balance = 0;
  let totalContributed = 0;

  for (let age = currentAge; age < finalAge; age++) {
    const wage = wageAtYear(hourlyWage, wageGrowth, age - currentAge, a);
    const pay = computePay({ hourlyWage: wage, hoursPerWeek }, a);
    const split = computeAllocations(pay.net, allocations, a);
    const contribution = age >= contributionStartAge ? split.rothIRA : 0;

    balance = balance * (1 + a.realReturnRate) + contribution;
    totalContributed += contribution;

    rows.push({
      age: age + 1,
      wage,
      gross: pay.gross,
      net: pay.net,
      contribution,
      balance,
      totalContributed,
    });
  }

  return rows;
}

/**
 * The headline comparison: start now vs. wait `delayYears`.
 *
 * @returns {{startNow:object[], delayed:object[], checkpoints:object[], headline:object}}
 */
export function compareScenarios(inputs, a = ASSUMPTIONS_2026) {
  const startNow = projectRothBalance(inputs, inputs.currentAge, a);
  const delayed = projectRothBalance(inputs, inputs.currentAge + a.delayYears, a);

  const at = (rows, age) => rows.find((r) => r.age === age);

  const checkpoints = a.checkpointAges
    .filter((age) => age > inputs.currentAge)
    .map((age) => {
      const s = at(startNow, age);
      const d = at(delayed, age);
      return {
        age,
        startNow: s ? s.balance : 0,
        delayed: d ? d.balance : 0,
        gap: (s ? s.balance : 0) - (d ? d.balance : 0),
        startNowContributed: s ? s.totalContributed : 0,
        delayedContributed: d ? d.totalContributed : 0,
      };
    });

  // Prefer the configured headline age; fall back to the last checkpoint still
  // ahead of the user (someone who enters age 68 still gets a sensible hero).
  const headlineCp =
    checkpoints.find((c) => c.age === a.headlineCheckpointAge) ||
    checkpoints[checkpoints.length - 1] ||
    null;

  const extraContributed = headlineCp
    ? headlineCp.startNowContributed - headlineCp.delayedContributed
    : 0;

  return {
    startNow,
    delayed,
    checkpoints,
    headline: headlineCp && {
      age: headlineCp.age,
      startNow: headlineCp.startNow,
      delayed: headlineCp.delayed,
      gap: headlineCp.gap,
      extraContributed,
      // "Every $1 you put in during those first five years became $N."
      multiplier: extraContributed > 0 ? headlineCp.gap / extraContributed : 0,
    },
  };
}

/**
 * One call that produces everything the UI renders, so the view layer never
 * does arithmetic of its own.
 */
export function simulate(inputs, a = ASSUMPTIONS_2026) {
  const pay = computePay(inputs, a);
  const allocations = computeAllocations(pay.net, inputs.allocations, a);
  return {
    pay,
    allocations,
    flow: buildPayFlow(pay, allocations),
    projection: compareScenarios(inputs, a),
  };
}
