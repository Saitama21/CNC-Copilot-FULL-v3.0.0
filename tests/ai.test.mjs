import test from 'node:test';
import assert from 'node:assert/strict';
import { aiStatus, sanitizeMaterial, sanitizeTool, validateImageDataUrl } from '../src/ai-recognition.mjs';

test('accepts supported image data URLs', () => {
  const payload = Buffer.alloc(512, 7).toString('base64');
  assert.match(validateImageDataUrl(`data:image/jpeg;base64,${payload}`), /^data:image\/jpeg/);
});

test('rejects unsupported image types', () => {
  assert.throws(() => validateImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPEG и WEBP/);
});

test('rejects tiny image payloads', () => {
  assert.throws(() => validateImageDataUrl('data:image/png;base64,AA=='), /слишком маленькое/);
});

test('AI status never exposes a key', () => {
  const status = aiStatus();
  assert.deepEqual(Object.keys(status).sort(), ['configured', 'model']);
});

test('tool packaging can never be confirmed as workpiece material', () => {
  const result = sanitizeMaterial({
    recognized: true,
    confidence: 0.99,
    subject_type: 'tool_insert',
    code: 'CCGT09T302-AL',
    name: 'Carbide insert',
    iso_group: 'N',
    aliases: [],
    detected_tool_type: 'insert',
    detected_tool_code: 'CCGT09T302-AL',
    detected_tool_grade: 'K15',
    evidence: ['CCGT09T302-AL K15'],
    notes: '',
  });
  assert.equal(result.recognized, false);
  assert.equal(result.redirectToTool, true);
  assert.equal(result.catalogMatch, null);
  assert.equal(result.detectedTool.toolType, 'insert');
});

test('tool sanitizer preserves holder compatibility fields', () => {
  const result = sanitizeTool({
    recognized: true, confidence: 0.9, tool_type: 'holder', name: 'SCLCR holder',
    handedness: 'R', shank_size: '20x20', compatible_codes: ['CCMT 09T3'],
    operations: ['turning'], iso_groups: ['P'], evidence: [], notes: '',
  });
  assert.equal(result.toolType, 'holder');
  assert.equal(result.handedness, 'R');
  assert.deepEqual(result.compatibleCodes, ['CCMT 09T3']);
});
