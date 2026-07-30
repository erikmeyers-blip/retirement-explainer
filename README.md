# Financial Literacy Simulator

An interactive explainer for teens and young adults. It answers one question as
concretely as possible:

> **What is starting five years earlier actually worth?**

Same job, same paycheck, same habits — the only variable is the start date. With
the default part-time-teen scenario, contributing **$7,310 more** over five years
ends up being worth **$188,431 more** by age 67. Every dollar put in early comes
back about **26x**.

This is a teaching tool, not a financial planner. Every design decision serves
the compounding lesson.

## Running it

It's a static site — no build step, no dependencies.

Because it uses ES modules, it needs to be served over HTTP (opening
`index.html` directly with `file://` will be blocked by CORS). Any static server
works:

```bash
npx --yes serve .
```

Deploying to GitHub Pages needs no configuration: push the repo and point Pages
at the branch root.

## Running the tests

The calculation engine has no DOM dependencies, so it tests under plain Node
with no test framework to install:

```bash
node --test
```

25 tests cover the bracket math, the standard deductions, the Roth cap, the
over-allocation case, the wage escalator, and the compounding arithmetic
(hand-computed expected values are in the comments).

## How it's put together

| File | Role |
|---|---|
| `js/calc.js` | The engine. Pure functions, no DOM. All assumptions live in one object at the top. |
| `js/charts.js` | Hand-built SVG for both charts — a grouped bar chart and a vertical Sankey. No chart library. |
| `js/format.js` | Number formatting — dollars, compact dollars, plain English. |
| `js/ui.js` | Reads controls, calls the engine, writes results back. Does no arithmetic. |
| `test/calc.test.js` | Engine tests. |

### Changing an assumption

Every tunable number is in `ASSUMPTIONS_2026` at the top of `js/calc.js` —
brackets, standard deductions, FICA rate, Roth limit, wage cap, return rate, and
the recommended allocation percentages. Nothing is hardcoded inline anywhere
else, so updating a tax year is a one-line edit. The "What's behind the math"
section on the page is generated from that same object, so the explanation can
never drift from the arithmetic.

## The numbers behind it

Tax year **2026**, single filer, Minnesota resident.

| Assumption | Value | Source |
|---|---|---|
| Federal standard deduction | $16,100 | IRS Rev. Proc. 2025-32 |
| Federal brackets | 10% → 37%, breaking at $12,400 / $50,400 / $105,700 / $201,775 / $256,225 / $640,600 | IRS Rev. Proc. 2025-32 |
| MN standard deduction | $15,300 | MN Dept. of Revenue |
| MN brackets | 5.35% / 6.80% / 7.85% / 9.85%, breaking at $33,310 / $109,430 / $203,150 | MN Dept. of Revenue |
| FICA | flat 7.65% (6.2% SS + 1.45% Medicare) | — |
| Roth IRA annual limit | $7,500 (under 50) | IRS, 2026 |
| Assumed return | 7% **real** (after inflation) | — |

### Three deliberate choices

**Returns are real, not nominal.** Every dollar shown is in today's purchasing
power. A nominal 10% return would produce far more dramatic numbers, but they'd
be misleading — $2M in 2077 is not $2M today. The point is to be visceral and
honest at the same time.

**Wage growth is also real.** The raise slider means raises *above inflation*.
Mixing a nominal wage curve with a real return would quietly overstate the
result.

**FICA is modeled flat.** There's no Social Security wage-base cutoff because the
tool can't generate income high enough to reach it ($50/hr × 60 hrs × 52 =
$156,000, against a 2026 wage base near $184,500). A test enforces that
invariant, so raising the wage cap will fail loudly rather than silently
producing wrong tax.

## Notes on two spec deviations

- **Roth IRA limit is $7,500, not $7,000.** The spec's $7,000 was the 2024/2025
  figure; the 2026 limit is $7,500. One line in `ASSUMPTIONS_2026` reverts it.
- **A Minnesota standard deduction was added.** The spec's constants table only
  had a federal one. Without the state deduction, a teen earning $10,140 would
  be shown owing MN income tax they don't actually owe.

## Deliberately out of scope

401(k) and employer matching · Social Security · multi-year tax tables ·
side-by-side scenario comparison · earned-income enforcement on the Roth cap
(the $7,000/$7,500 limit is treated as a flat cap).

## Design notes

**The Sankey runs top-to-bottom, not left-to-right.** A horizontal Sankey needs
a label gutter on both sides, and that space does not exist at 375px — which is
where most of the intended audience will open this. Flowing downward gives every
stage the full width, so one diagram serves phone through desktop with no
separate mobile version. The diagram carries proportion and colour; the list
underneath carries names and exact amounts. Neither has to do the other's job,
so no label ever gets squeezed into a 12px segment.

**Zero rows are kept, not hidden.** "Federal income tax — $0" is the single most
surprising line on the page for a teenager earning $10,140, so the list shows it
greyed rather than dropping it. The diagram skips zero-width nodes because they
cannot be drawn.

**Over-allocating hides the diagram instead of faking it.** A Sankey cannot
honestly draw outflows larger than their source, so when the sliders overspend
the chart is replaced by a line saying exactly how much to pull back.

## Accessibility

Every value is reachable without hovering: the comparison chart has a table
view, and the pay flow's amounts are in an always-visible list rather than
locked behind tooltips. Data points are keyboard-focusable and show the same
content on focus as on hover, and both charts carry `aria-label` summaries.
Touch targets grow under `@media (pointer: coarse)`.

The colour palette was validated for colour-vision deficiency with a
contrast/ΔE checker rather than by eye. The headline chart uses emphasis form
(one accent hue plus a de-emphasis gray) rather than two competing colours, and
identity is never carried by colour alone.

---

*Not financial advice. It leaves out a lot of real life on purpose, so that one
idea — that time matters more than amount — comes through clearly.*
