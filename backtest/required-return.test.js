import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requiredPhaseReturns,
  formatRequiredPhaseReturns,
  REQUIRED_RETURN_LABEL
} from './retirement.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function plan(over = {}) {
  return {
    currentAge: 40,
    retireAge: 50,
    endAge: 70,
    currentSavings: 100000,
    monthlyContribution: 1000,
    annualSpending: 24000,
    otherIncome: 0,
    otherIncomeAge: 65,
    inflationMode: 'fixed',
    inflationRate: 0,
    feeRate: 0,
    ...over
  };
}

test('required return stays the real solution when inflation is zero', () => {
  const nestEgg = 2e9;
  const phases = requiredPhaseReturns(plan({
    monthlyContribution: 0,
    currentSavings: 1e9,
    annualSpending: nestEgg / 20
  }), { nestEgg });
  const real = 2 ** (1 / 10) - 1;
  assert.ok(Math.abs(phases.accumulationAnnual - real) < 1e-8);
  assert.ok(Math.abs(phases.withdrawalAnnual) < 1e-8);
  assert.equal(phases.flags.accumulation, null);
  assert.equal(phases.flags.withdrawal, null);
});

test('both phases convert real to nominal with the plan inflation rate', () => {
  const real = requiredPhaseReturns(plan(), { nestEgg: 400000 });
  const nominal = requiredPhaseReturns(plan({ inflationRate: 2.5 }), { nestEgg: 400000 });
  const fisher = rate => (1 + rate) * 1.025 - 1;
  assert.ok(Math.abs(nominal.accumulationAnnual - fisher(real.accumulationAnnual)) < 1e-9);
  assert.ok(Math.abs(nominal.withdrawalAnnual - fisher(real.withdrawalAnnual)) < 1e-9);
  assert.deepEqual(nominal.flags, real.flags);
});

test('CPI mode uses the same plan inflation rate and does not invent another', () => {
  const nestEgg = 1e9;
  const flat = {
    monthlyContribution: 0,
    currentSavings: nestEgg,
    annualSpending: nestEgg / 20,
    inflationRate: 2.5
  };
  const fixed = requiredPhaseReturns(plan({ ...flat, inflationMode: 'fixed' }), { nestEgg });
  const cpi = requiredPhaseReturns(plan({ ...flat, inflationMode: 'cpi' }), { nestEgg });
  assert.ok(Math.abs(fixed.accumulationAnnual - 0.025) < 1e-8);
  assert.ok(Math.abs(fixed.withdrawalAnnual - 0.025) < 1e-8);
  assert.equal(cpi.accumulationAnnual, fixed.accumulationAnnual);
  assert.equal(cpi.withdrawalAnnual, fixed.withdrawalAnnual);
});

test('label marks both phase numbers as nominal', () => {
  assert.equal(REQUIRED_RETURN_LABEL, '所需報酬（名目）');
  const phases = requiredPhaseReturns(plan({ inflationRate: 2.5, monthlyContribution: 0, currentSavings: 100 }), { nestEgg: 100 });
  const text = formatRequiredPhaseReturns(phases);
  assert.equal(text.startsWith('所需報酬（名目）：'), true);
  assert.match(text, /至退休 /);
  assert.match(text, /退休後 /);
  assert.equal(text.includes('實質'), false);
});

test('dashboard and chatbot copy use the nominal label', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const dashboard = readFileSync(join(root, 'js', 'dashboard.js'), 'utf8');
  const context = readFileSync(join(root, 'js', 'context.js'), 'utf8');
  assert.ok(html.includes(REQUIRED_RETURN_LABEL));
  assert.ok(dashboard.includes('REQUIRED_RETURN_LABEL'));
  assert.equal(dashboard.includes('實質報酬。'), false);
  assert.ok(context.includes('formatRequiredPhaseReturns'));
});
