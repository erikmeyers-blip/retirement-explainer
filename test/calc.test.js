/**
 * Engine tests — run with:  node --test
 *
 * These exercise the calculation module directly, with no DOM and no UI.
 * Hand-computed expected values are shown in the comments so a failure tells
 * you which assumption moved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSUMPTIONS_2026,
  PRESETS,
  progressiveTax,
  federalIncomeTax,
  minnesotaIncomeTax,
  ficaTax,
  computePay,
  computeAllocations,
  buildPayFlow,
  wageAtYear,
  projectRothBalance,
  compareScenarios,
  simulate,
} from '../js/calc.js';

const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

/* --------------------------------------------------------------------- *
 * Bracket math
 * --------------------------------------------------------------------- */

test('progressiveTax returns 0 at or below zero taxable income', () => {
  assert.equal(progressiveTax(0, ASSUMPTIONS_2026.federalBrackets), 0);
  assert.equal(progressiveTax(-5000, ASSUMPTIONS_2026.federalBrackets), 0);
});

test('progressiveTax taxes only the slice inside each bracket', () => {
  // Entirely inside the 10% bracket.
  near(progressiveTax(10000, ASSUMPTIONS_2026.federalBrackets), 1000);
  // Exactly at the top of the 10% bracket.
  near(progressiveTax(12400, ASSUMPTIONS_2026.federalBrackets), 1240);
  // One bracket up: 12,400 @ 10% + 7,600 @ 12%.
  near(progressiveTax(20000, ASSUMPTIONS_2026.federalBrackets), 1240 + 912);
});

test('progressiveTax reaches the top bracket without falling off the end', () => {
  // Above 640,600 the last bracket has upTo: Infinity; the loop must terminate.
  const tax = progressiveTax(1_000_000, ASSUMPTIONS_2026.federalBrackets);
  assert.ok(Number.isFinite(tax));
  assert.ok(tax > 0);
});

test('federal tax applies the standard deduction first', () => {
  // 60,000 - 16,100 = 43,900 taxable
  //   12,400 @ 10% = 1,240
  //   31,500 @ 12% = 3,780
  near(federalIncomeTax(60000), 5020);
});

test('Minnesota tax applies its own standard deduction', () => {
  // 60,000 - 15,300 = 44,700 taxable
  //   33,310 @ 5.35% = 1,782.085
  //   11,390 @ 6.80% =   774.520
  near(minnesotaIncomeTax(60000), 2556.605);
});

test('FICA is flat on gross, with no deduction', () => {
  near(ficaTax(60000), 4590);
  near(ficaTax(10000), 765);
});

/* --------------------------------------------------------------------- *
 * Pay pipeline
 * --------------------------------------------------------------------- */

test('computePay runs gross through to net', () => {
  const pay = computePay({ hourlyWage: 30, hoursPerWeek: 38.4615 }); // ~60,000/yr
  near(pay.gross, 60000, 1);
  near(pay.federalTax, 5020, 1);
  near(pay.stateTax, 2556.605, 1);
  near(pay.fica, 4590, 1);
  near(pay.net, 60000 - 5020 - 2556.605 - 4590, 2);
});

test('a part-time teen owes no income tax at all — only FICA', () => {
  // 13/hr x 15 hrs x 52 = 10,140 gross, under both standard deductions.
  const pay = computePay({ hourlyWage: 13, hoursPerWeek: 15 });
  near(pay.gross, 10140);
  assert.equal(pay.federalTax, 0);
  assert.equal(pay.stateTax, 0);
  near(pay.fica, 775.71);
  near(pay.net, 9364.29);
});

test('computePay caps the hourly wage at the assumption ceiling', () => {
  const capped = computePay({ hourlyWage: 500, hoursPerWeek: 40 });
  const atCap = computePay({ hourlyWage: ASSUMPTIONS_2026.hourlyRateCap, hoursPerWeek: 40 });
  assert.equal(capped.gross, atCap.gross);
  assert.equal(capped.hourlyWage, ASSUMPTIONS_2026.hourlyRateCap);
});

test('zero hours produces a clean zero, not NaN', () => {
  const pay = computePay({ hourlyWage: 20, hoursPerWeek: 0 });
  assert.equal(pay.gross, 0);
  assert.equal(pay.net, 0);
  assert.equal(pay.effectiveTaxRate, 0);
});

test('FICA stays flat across the whole reachable income range', () => {
  // The flat-rate simplification is only safe because the tool cannot generate
  // income above the Social Security wage base. Guard that invariant.
  const maxGross =
    ASSUMPTIONS_2026.hourlyRateCap *
    ASSUMPTIONS_2026.hoursPerWeekCap *
    ASSUMPTIONS_2026.weeksPerYear;
  assert.ok(maxGross < 184500, `max reachable gross ${maxGross} exceeds the SS wage base`);
});

/* --------------------------------------------------------------------- *
 * Allocations
 * --------------------------------------------------------------------- */

const baseAlloc = {
  charity: 0.10,
  savings: 0.10,
  housing: 0.30,
  groceries: 0.10,
  rothMode: 'percent',
  rothPercent: 0.15,
  rothFlat: 0,
};

test('allocations split net pay and leave the remainder as fun money', () => {
  const split = computeAllocations(10000, baseAlloc);
  near(split.charity, 1000);
  near(split.savings, 1000);
  near(split.housing, 3000);
  near(split.groceries, 1000);
  near(split.rothIRA, 1500);
  near(split.funMoney, 2500); // 100% - 75%
  assert.equal(split.overAllocated, false);
});

test('fun money goes negative when the sliders sum past 100%', () => {
  const split = computeAllocations(10000, { ...baseAlloc, housing: 0.60 });
  near(split.funMoney, -500);
  assert.equal(split.overAllocated, true);
});

test('Roth contribution is capped at the annual limit', () => {
  // 15% of 200,000 would be 30,000.
  const split = computeAllocations(200000, baseAlloc);
  near(split.rothIRA, ASSUMPTIONS_2026.rothIRALimit);
  assert.equal(split.rothCappedByLimit, true);
});

test('flat-dollar Roth mode is honoured and still capped', () => {
  const under = computeAllocations(50000, { ...baseAlloc, rothMode: 'flat', rothFlat: 2000 });
  near(under.rothIRA, 2000);
  assert.equal(under.rothCappedByLimit, false);

  const over = computeAllocations(50000, { ...baseAlloc, rothMode: 'flat', rothFlat: 99999 });
  near(over.rothIRA, ASSUMPTIONS_2026.rothIRALimit);
  assert.equal(over.rothCappedByLimit, true);
});

test('no reachable input can push a contribution past the annual limit', () => {
  // A property test rather than a spot check: the cap is the one guarantee this
  // tool makes about a legal limit, so sweep the whole input domain instead of
  // trusting that every future caller remembers to clamp.
  const LIMIT = ASSUMPTIONS_2026.rothIRALimit;
  let checks = 0;
  let worst = 0;

  for (let wage = 7.25; wage <= ASSUMPTIONS_2026.hourlyRateCap; wage += 1.5) {
    for (let hours = 0; hours <= ASSUMPTIONS_2026.hoursPerWeekCap; hours += 10) {
      const pay = computePay({ hourlyWage: wage, hoursPerWeek: hours });
      const cases = [
        { rothMode: 'percent', rothPercent: 0.5, rothFlat: 0 },
        { rothMode: 'percent', rothPercent: 1.0, rothFlat: 0 },
        { rothMode: 'flat', rothPercent: 0, rothFlat: LIMIT + 1 },
        { rothMode: 'flat', rothPercent: 0, rothFlat: 999_999 },
      ];
      for (const c of cases) {
        const split = computeAllocations(pay.net, { ...baseAlloc, ...c });
        checks++;
        worst = Math.max(worst, split.rothIRA);
        assert.ok(split.rothIRA <= LIMIT + 1e-9,
          `contributed ${split.rothIRA} at $${wage}/hr x ${hours}h (${c.rothMode})`);
        // The second ceiling: you cannot contribute money you never took home.
        assert.ok(split.rothIRA <= pay.net + 1e-9,
          `contributed ${split.rothIRA} against net ${pay.net}`);
      }
    }
  }

  assert.ok(checks > 200, 'sweep did not actually run');
  assert.equal(Math.round(worst), LIMIT, 'the cap should be reachable, not just respected');
});

test('the cap holds in every year of a full projection, not just year one', () => {
  // Wage growth raises net pay every year, so the clamp has to be re-applied
  // annually — a cap checked only at the current age would leak later.
  const LIMIT = ASSUMPTIONS_2026.rothIRALimit;
  let years = 0;

  for (const growth of [0, 0.02, 0.06]) {
    for (const wage of [7.25, 22, 50]) {
      const rows = projectRothBalance(
        {
          currentAge: 16,
          hourlyWage: wage,
          hoursPerWeek: 60,
          wageGrowth: growth,
          allocations: { ...baseAlloc, rothMode: 'percent', rothPercent: 0.5 },
        },
        16,
      );
      for (const row of rows) {
        years++;
        assert.ok(row.contribution <= LIMIT + 1e-9,
          `year at age ${row.age} contributed ${row.contribution} (growth ${growth})`);
      }
    }
  }

  assert.ok(years > 100, 'projection sweep did not actually run');
});

test('Roth contribution can never exceed take-home pay', () => {
  const split = computeAllocations(1200, { ...baseAlloc, rothMode: 'flat', rothFlat: 5000 });
  near(split.rothIRA, 1200);
  assert.equal(split.rothCappedByNet, true);
});

/* --------------------------------------------------------------------- *
 * Pay flow (Sankey)
 * --------------------------------------------------------------------- */

test('pay flow conserves money at every split', () => {
  const pay = computePay({ hourlyWage: 22, hoursPerWeek: 40 });
  const split = computeAllocations(pay.net, baseAlloc);
  const flow = buildPayFlow(pay, split);

  const out = (source) => flow.links
    .filter((l) => l.source === source)
    .reduce((sum, l) => sum + l.value, 0);

  // Everything leaving gross pay adds back up to gross pay.
  near(out('gross'), pay.gross, 0.01);
  // Everything leaving take-home adds back up to take-home.
  near(out('net'), pay.net, 0.01);
});

test('pay flow columns and ordering drive the stacking, so ribbons never cross', () => {
  const pay = computePay({ hourlyWage: 22, hoursPerWeek: 40 });
  const flow = buildPayFlow(pay, computeAllocations(pay.net, baseAlloc));

  const col = (n) => flow.nodes.filter((x) => x.column === n).map((x) => x.key);
  assert.deepEqual(col(0), ['gross']);
  // Take-home leads column 1 so the main channel runs straight down the left.
  assert.deepEqual(col(1), ['net', 'federalTax', 'stateTax', 'fica']);
  assert.deepEqual(col(2), ['rothIRA', 'savings', 'housing', 'groceries', 'charity', 'funMoney']);

  // Link order must match the column order it feeds, or the ribbons tangle.
  const targets = (source) => flow.links.filter((l) => l.source === source).map((l) => l.target);
  assert.deepEqual(targets('gross'), col(1));
  assert.deepEqual(targets('net'), col(2));
});

test('every flow node carries a colour tone the renderer knows', () => {
  const pay = computePay({ hourlyWage: 22, hoursPerWeek: 40 });
  const flow = buildPayFlow(pay, computeAllocations(pay.net, baseAlloc));
  const known = new Set([
    'anchor', 'tax', 'rothIRA', 'savings', 'housing', 'groceries', 'charity', 'funMoney',
  ]);
  for (const node of flow.nodes) {
    assert.ok(known.has(node.tone), `${node.key} has unmapped tone "${node.tone}"`);
    assert.ok(node.label && typeof node.label === 'string', `${node.key} has no label`);
  }
});

test('over-allocating clamps the fun-money ribbon and raises the flag', () => {
  const pay = computePay({ hourlyWage: 22, hoursPerWeek: 40 });
  const split = computeAllocations(pay.net, { ...baseAlloc, housing: 0.80 });
  const flow = buildPayFlow(pay, split);

  assert.equal(flow.overAllocated, true);
  assert.ok(flow.shortfall < 0, 'shortfall should be negative when overspent');

  // No link may be negative — a Sankey cannot draw one.
  for (const link of flow.links) {
    assert.ok(link.value >= 0, `${link.source}->${link.target} is negative`);
  }
  // The node keeps the true (negative) figure so the list can still show it.
  const funNode = flow.nodes.find((n) => n.key === 'funMoney');
  assert.ok(funNode.value < 0);
});

test('a teen with no income tax still produces a valid flow', () => {
  const pay = computePay({ hourlyWage: 13, hoursPerWeek: 15 });
  const flow = buildPayFlow(pay, computeAllocations(pay.net, baseAlloc));

  const fed = flow.nodes.find((n) => n.key === 'federalTax');
  const state = flow.nodes.find((n) => n.key === 'stateTax');
  assert.equal(fed.value, 0);
  assert.equal(state.value, 0);
  // Zero-value nodes stay in the data — the list shows them, the diagram skips
  // them — and the flow still balances.
  const outOfGross = flow.links
    .filter((l) => l.source === 'gross')
    .reduce((sum, l) => sum + l.value, 0);
  near(outOfGross, pay.gross, 0.01);
});

/* --------------------------------------------------------------------- *
 * Wage escalator
 * --------------------------------------------------------------------- */

test('wageAtYear compounds raises and respects the cap', () => {
  near(wageAtYear(20, 0.02, 0), 20);
  near(wageAtYear(20, 0.02, 1), 20.4);
  near(wageAtYear(20, 0.02, 10), 20 * Math.pow(1.02, 10));
  // 200 years of raises still stops at the ceiling.
  assert.equal(wageAtYear(20, 0.02, 200), ASSUMPTIONS_2026.hourlyRateCap);
});

/* --------------------------------------------------------------------- *
 * Projection & compounding
 * --------------------------------------------------------------------- */

test('projectRothBalance compounds end-of-year contributions correctly', () => {
  // Two years, 10% return, flat $100/yr, so the arithmetic is checkable by hand:
  //   year 1 (age 18):   0 * 1.1 + 100 = 100
  //   year 2 (age 19): 100 * 1.1 + 100 = 210
  const a = { ...ASSUMPTIONS_2026, checkpointAges: [20], realReturnRate: 0.10 };
  const rows = projectRothBalance(
    {
      currentAge: 18,
      hourlyWage: 20,
      hoursPerWeek: 40,
      wageGrowth: 0.02,
      allocations: { ...baseAlloc, rothMode: 'flat', rothFlat: 100 },
    },
    18,
    a,
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.age), [19, 20]);
  near(rows[0].balance, 100);
  near(rows[1].balance, 210);
  near(rows[1].totalContributed, 200);
});

test('delaying contributions produces the expected smaller balance', () => {
  const a = { ...ASSUMPTIONS_2026, checkpointAges: [20], realReturnRate: 0.10, delayYears: 1 };
  const inputs = {
    currentAge: 18,
    hourlyWage: 20,
    hoursPerWeek: 40,
    wageGrowth: 0.02,
    allocations: { ...baseAlloc, rothMode: 'flat', rothFlat: 100 },
  };

  const { checkpoints, headline } = compareScenarios(inputs, a);
  assert.equal(checkpoints.length, 1);

  const cp = checkpoints[0];
  near(cp.startNow, 210);
  near(cp.delayed, 100); // one skipped year: 0 * 1.1 + 100
  near(cp.gap, 110);

  // Falls back to the last checkpoint when age 67 is not in the list.
  assert.equal(headline.age, 20);
  near(headline.extraContributed, 100);
  near(headline.multiplier, 1.1);
});

test('starting early always beats waiting, across every preset', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const { checkpoints } = compareScenarios(preset);
    assert.ok(checkpoints.length > 0, `${name} produced no checkpoints`);
    for (const cp of checkpoints) {
      assert.ok(cp.gap > 0, `${name}: no gap at age ${cp.age}`);
      assert.ok(cp.startNow > cp.delayed, `${name}: delayed caught up at age ${cp.age}`);
    }
  }
});

test('the early starter puts in more but gains far more than the difference', () => {
  // The core lesson: a modest amount of extra contribution, made early, is
  // worth a multiple of itself at retirement.
  const { headline } = compareScenarios(PRESETS.teen);
  assert.ok(headline.extraContributed > 0);
  assert.ok(
    headline.multiplier > 5,
    `expected early dollars to multiply well past 5x, got ${headline.multiplier.toFixed(2)}x`,
  );
});

test('checkpoints already behind the user are dropped', () => {
  const { checkpoints } = compareScenarios({ ...PRESETS.career, currentAge: 66 });
  assert.deepEqual(checkpoints.map((c) => c.age), [67, 70, 72]);
});

test('a zero-contribution scenario projects to zero rather than NaN', () => {
  const { checkpoints } = compareScenarios({
    ...PRESETS.teen,
    allocations: { ...PRESETS.teen.allocations, rothMode: 'percent', rothPercent: 0 },
  });
  for (const cp of checkpoints) {
    assert.equal(cp.startNow, 0);
    assert.equal(cp.gap, 0);
  }
});

/* --------------------------------------------------------------------- *
 * Top-level
 * --------------------------------------------------------------------- */

test('simulate returns every piece the UI needs, all finite', () => {
  const result = simulate(PRESETS.career);
  assert.ok(result.pay && result.allocations && result.flow && result.projection);
  assert.ok(Number.isFinite(result.pay.net));
  assert.ok(Number.isFinite(result.allocations.funMoney));
  assert.ok(result.flow.nodes.every((n) => Number.isFinite(n.value)));
  assert.ok(result.flow.links.every((l) => Number.isFinite(l.value)));
  assert.ok(result.projection.checkpoints.every((c) => Number.isFinite(c.gap)));
  assert.ok(Number.isFinite(result.projection.headline.multiplier));
});
