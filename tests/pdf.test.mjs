import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { calculateMachining } from '../src/calc-engine.mjs';
import { formatMachineFeed, formatMachineRpm, streamCalculationPdf } from '../src/pdf-report.mjs';

test('formats values exactly like a machine screen', () => {
  assert.equal(formatMachineFeed(0.12), '0.120');
  assert.equal(formatMachineFeed(0.1584), '0.158');
  assert.equal(formatMachineRpm(699.7), '700');
});

test('creates a real PDF document', async () => {
  const chunks = [];
  const response = new PassThrough();
  const headers = {};
  response.setHeader = (name, value) => { headers[name.toLowerCase()] = value; };
  response.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => response.on('finish', resolve).on('error', reject));
  streamCalculationPdf(response, {
    id: 'test',
    created_at: new Date('2026-08-14T00:00:00Z'),
    material_code: 'C45',
    operation: 'turning',
    inputs: { cutLengthMm: 100, passes: 2 },
    results: calculateMachining({ materialCode: 'C45', operation: 'turning', diameterMm: 50, cutLengthMm: 100, passes: 2, machinePowerKw: 11 }),
  });
  await finished;
  const pdf = Buffer.concat(chunks);
  assert.equal(headers['content-type'], 'application/pdf');
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);
});
