import assert from 'node:assert/strict';
import {
  barHeightsFromLevel,
  dbfsToBarPercent,
  dbfsToNormalized,
  formatDbfsLabel,
  METER_DBFS_MAX,
  METER_DBFS_MIN,
} from './voiceMeterLevel.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('dbfs: silence maps near zero', () => {
  assert.equal(dbfsToNormalized(-160), 0);
  assert.equal(dbfsToNormalized(undefined), 0);
  assert.equal(dbfsToNormalized(null), 0);
});

test('dbfs: loud signal maps near one', () => {
  assert.ok(dbfsToNormalized(0) > 0.95);
  assert.equal(dbfsToNormalized(METER_DBFS_MAX), dbfsToNormalized(0));
});

test('dbfs: monotonic in speech range', () => {
  const quiet = dbfsToNormalized(-56);
  const loud = dbfsToNormalized(-20);
  assert.ok(quiet > 0.05);
  assert.ok(loud > quiet);
});

test('dbfs: clamps out of range', () => {
  assert.equal(dbfsToNormalized(-200), dbfsToNormalized(METER_DBFS_MIN));
  assert.equal(dbfsToNormalized(5), dbfsToNormalized(METER_DBFS_MAX));
});

test('bar percent: linear -160 to 0 maps 0 to 100', () => {
  assert.equal(dbfsToBarPercent(-160), 0);
  assert.equal(dbfsToBarPercent(0), 100);
  assert.equal(dbfsToBarPercent(-80), 50);
});

test('formatDbfsLabel', () => {
  assert.equal(formatDbfsLabel(-52.4), '-52 dB');
  assert.equal(formatDbfsLabel(null), '— dB');
});

test('bar heights: count and bounds', () => {
  const heights = barHeightsFromLevel(0.5, 5, 1000);
  assert.equal(heights.length, 5);
  for (const h of heights) {
    assert.ok(h >= 0.1 && h <= 1);
  }
});

test('hero bar count export', () => {
  const heights = barHeightsFromLevel(0.8);
  assert.ok(heights.length >= 20);
});
