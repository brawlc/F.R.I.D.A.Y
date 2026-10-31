import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, variants } from '../experiments/aero-sensitivity.mjs';

test('force scales with density and speed squared; drag power scales with speed cubed', () => {
  const base = evaluate({ density: 1, speed: 30, floorLoss: 0.1 });
  const dense = evaluate({ density: 2, speed: 30, floorLoss: 0.1 });
  const fast = evaluate({ density: 1, speed: 60, floorLoss: 0.1 });
  assert.equal(dense.downforceN, 2 * base.downforceN);
  assert.equal(fast.dragN, 4 * base.dragN);
  assert.equal(fast.dragPowerKW, 8 * base.dragPowerKW);
  assert.equal(fast.coolingMassFlowProxyKgS, 2 * base.coolingMassFlowProxyKgS);
});
test('platform benefit vanishes with no floor loss; zero speed means zero force', () => {
  const inputs = { density: 0.95, speed: 75, floorLoss: 0 };
  assert.equal(evaluate(inputs, variants[3]).downforceN, evaluate(inputs).downforceN);
  assert.ok(evaluate(inputs, variants[3]).dragN > evaluate(inputs).dragN);
  const stopped = evaluate({ ...inputs, speed: 0 });
  assert.ok(Object.values(stopped).every(x => x === 0));
  assert.throws(() => evaluate({ density: -1, speed: 75, floorLoss: 0.1 }));
});
