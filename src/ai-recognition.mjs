import OpenAI from 'openai';
import { MATERIALS, matchMaterialCandidate } from './materials.mjs';
import { OPERATIONS } from './calc-engine.mjs';

const MATERIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recognized', 'confidence', 'subject_type', 'code', 'name', 'iso_group', 'aliases', 'detected_tool_type', 'detected_tool_code', 'detected_tool_grade', 'evidence', 'notes', 'needs_confirmation'],
  properties: {
    recognized: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    subject_type: { type: 'string', enum: ['workpiece_material', 'tool_insert', 'tool_holder', 'unknown'] },
    code: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    iso_group: { anyOf: [{ type: 'string', enum: ['P', 'M', 'K', 'N', 'S', 'H'] }, { type: 'null' }] },
    aliases: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    detected_tool_type: { anyOf: [{ type: 'string', enum: ['insert', 'holder'] }, { type: 'null' }] },
    detected_tool_code: { type: ['string', 'null'] },
    detected_tool_grade: { type: ['string', 'null'] },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    notes: { type: 'string' },
    needs_confirmation: { type: 'boolean' },
  },
};

const TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recognized', 'confidence', 'manufacturer', 'code', 'grade', 'name', 'tool_type',
    'nose_radius', 'width_mm', 'diameter_mm', 'handedness', 'shank_size', 'compatible_codes', 'operations', 'iso_groups',
    'vc_min', 'vc_max', 'feed_min', 'feed_max', 'ap_min', 'ap_max',
    'evidence', 'notes', 'needs_confirmation',
  ],
  properties: {
    recognized: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    manufacturer: { type: ['string', 'null'] },
    code: { type: ['string', 'null'] },
    grade: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    tool_type: { anyOf: [{ type: 'string', enum: ['insert', 'holder', 'drill', 'mill', 'tap', 'other'] }, { type: 'null' }] },
    nose_radius: { type: ['number', 'null'] },
    width_mm: { type: ['number', 'null'] },
    diameter_mm: { type: ['number', 'null'] },
    handedness: { type: ['string', 'null'] },
    shank_size: { type: ['string', 'null'] },
    compatible_codes: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    operations: { type: 'array', items: { type: 'string', enum: Object.keys(OPERATIONS) } },
    iso_groups: { type: 'array', items: { type: 'string', enum: ['P', 'M', 'K', 'N', 'S', 'H'] } },
    vc_min: { type: ['number', 'null'] },
    vc_max: { type: ['number', 'null'] },
    feed_min: { type: ['number', 'null'] },
    feed_max: { type: ['number', 'null'] },
    ap_min: { type: ['number', 'null'] },
    ap_max: { type: ['number', 'null'] },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    notes: { type: 'string' },
    needs_confirmation: { type: 'boolean' },
  },
};

let client;

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('ИИ-распознавание не настроено: добавьте OPENAI_API_KEY в переменные Railway.');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }
  client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function promptFor(kind, note = '') {
  if (kind === 'material') {
    return [
      'Ты технический OCR-инспектор материалов для токарной обработки CNC.',
      'Прочитай только то, что реально видно на бирке, сертификате или маркировке ЗАГОТОВКИ.',
      'Сначала классифицируй объект. Коробки сменных пластин (CCGT, CNMG, DNMG и т.п.) и маркировки державок НЕ являются материалом заготовки.',
      'Для пластины верни subject_type=tool_insert, для державки subject_type=tool_holder, recognized=false и заполни detected_tool_*.',
      'Только для марки материала заготовки верни subject_type=workpiece_material и recognized=true.',
      'Определи обозначение материала и ISO-группу P/M/K/N/S/H. Не выдумывай марку по одному цвету или внешнему виду.',
      'Если точная марка не читается, recognized=false, confidence низкая, а неизвестные поля null.',
      'needs_confirmation всегда true: оператор обязан подтвердить результат.',
      note ? `Комментарий оператора: ${note}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    'Ты технический OCR-инспектор токарного инструмента и сменных пластин.',
    'Прочитай коробку, этикетку и лазерную маркировку. Сначала различи сменную пластину и державку.',
    'tool_type=insert для пластин CCGT/CNMG/DNMG и подобных; tool_type=holder для державок и расточных оправок.',
    'Для державки прочитай направление, размер хвостовика и совместимые коды пластин, только если они видны.',
    'Числовые диапазоны Vc/F/ap возвращай только если они явно напечатаны на изображении. Иначе ставь null.',
    'Не угадывай радиус, ширину, диаметр или применимость по ISO, если надпись неразборчива.',
    'needs_confirmation всегда true: оператор проверяет все поля перед сохранением.',
    note ? `Комментарий оператора: ${note}` : '',
  ].filter(Boolean).join('\n');
}

export function validateImageDataUrl(value) {
  const image = String(value || '');
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(image);
  if (!match) throw new Error('Поддерживаются изображения PNG, JPEG и WEBP.');
  const approximateBytes = Math.floor(match[2].length * 0.75);
  if (approximateBytes < 256) throw new Error('Изображение слишком маленькое.');
  if (approximateBytes > 10 * 1024 * 1024) throw new Error('Изображение должно быть не больше 10 МБ.');
  return image;
}

function cleanText(value, max = 200) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function cleanNumber(value, min = 0, max = 100000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function sanitizeMaterial(result) {
  const subjectType = ['workpiece_material', 'tool_insert', 'tool_holder', 'unknown'].includes(result.subject_type) ? result.subject_type : 'unknown';
  const isMaterial = subjectType === 'workpiece_material';
  const code = cleanText(result.code, 80);
  const aliases = Array.isArray(result.aliases) ? result.aliases.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 8) : [];
  const catalogMatch = isMaterial ? matchMaterialCandidate([code, result.name, ...aliases].filter(Boolean)) : null;
  return {
    recognized: isMaterial && Boolean(result.recognized),
    subjectType,
    redirectToTool: subjectType === 'tool_insert' || subjectType === 'tool_holder',
    confidence: Math.min(1, Math.max(0, Number(result.confidence) || 0)),
    code,
    name: cleanText(result.name, 160),
    isoGroup: ['P', 'M', 'K', 'N', 'S', 'H'].includes(result.iso_group) ? result.iso_group : null,
    aliases,
    evidence: Array.isArray(result.evidence) ? result.evidence.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 8) : [],
    notes: cleanText(result.notes, 600) || '',
    needsConfirmation: true,
    detectedTool: subjectType === 'tool_insert' || subjectType === 'tool_holder' ? {
      toolType: result.detected_tool_type || (subjectType === 'tool_holder' ? 'holder' : 'insert'),
      code: cleanText(result.detected_tool_code, 120),
      grade: cleanText(result.detected_tool_grade, 100),
    } : null,
    catalogMatch: catalogMatch ? {
      code: catalogMatch.code,
      name: catalogMatch.name,
      iso: catalogMatch.iso,
      aliases: catalogMatch.aliases,
    } : null,
  };
}

export function sanitizeTool(result) {
  const operations = Array.isArray(result.operations) ? result.operations.filter((value) => OPERATIONS[value]) : [];
  const isoGroups = Array.isArray(result.iso_groups) ? result.iso_groups.filter((value) => ['P', 'M', 'K', 'N', 'S', 'H'].includes(value)) : [];
  return {
    recognized: Boolean(result.recognized),
    confidence: Math.min(1, Math.max(0, Number(result.confidence) || 0)),
    manufacturer: cleanText(result.manufacturer, 100),
    code: cleanText(result.code, 120),
    grade: cleanText(result.grade, 100),
    name: cleanText(result.name, 140) || cleanText(result.code, 120) || 'Распознанный инструмент',
    toolType: ['insert', 'holder', 'drill', 'mill', 'tap', 'other'].includes(result.tool_type) ? result.tool_type : 'other',
    noseRadius: cleanNumber(result.nose_radius, 0.01, 100),
    widthMm: cleanNumber(result.width_mm, 0.01, 500),
    diameterMm: cleanNumber(result.diameter_mm, 0.01, 1000),
    handedness: cleanText(result.handedness, 40),
    shankSize: cleanText(result.shank_size, 80),
    compatibleCodes: Array.isArray(result.compatible_codes) ? result.compatible_codes.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 12) : [],
    operations: [...new Set(operations)],
    isoGroups: [...new Set(isoGroups)],
    vcMin: cleanNumber(result.vc_min, 0.1, 5000),
    vcMax: cleanNumber(result.vc_max, 0.1, 5000),
    feedMin: cleanNumber(result.feed_min, 0.001, 20),
    feedMax: cleanNumber(result.feed_max, 0.001, 20),
    apMin: cleanNumber(result.ap_min, 0.01, 100),
    apMax: cleanNumber(result.ap_max, 0.01, 100),
    evidence: Array.isArray(result.evidence) ? result.evidence.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 12) : [],
    notes: cleanText(result.notes, 800) || '',
    needsConfirmation: true,
  };
}

function outputText(response) {
  if (response.output_text) return response.output_text;
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type === 'refusal') throw new Error(part.refusal || 'ИИ отказался анализировать изображение.');
      if (part.type === 'output_text' && part.text) return part.text;
    }
  }
  throw new Error('ИИ не вернул результат распознавания.');
}

export function aiStatus() {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_VISION_MODEL || 'gpt-5.6-luna',
  };
}

export async function recognizeCncImage({ kind, imageDataUrl, imageDataUrls, note }) {
  if (!['material', 'tool'].includes(kind)) throw new Error('Неизвестный тип распознавания.');
  const sourceImages = Array.isArray(imageDataUrls) && imageDataUrls.length ? imageDataUrls : [imageDataUrl];
  const images = sourceImages.slice(0, 4).map(validateImageDataUrl);
  const schema = kind === 'material' ? MATERIAL_SCHEMA : TOOL_SCHEMA;
  const model = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-luna';
  const response = await getClient().responses.create({
    model,
    store: false,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: promptFor(kind, cleanText(note, 500) || '') },
        ...images.map((image) => ({ type: 'input_image', image_url: image, detail: kind === 'tool' ? 'original' : 'high' })),
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: `cnc_${kind}_recognition`,
        strict: true,
        schema,
      },
    },
    max_output_tokens: 1400,
  });
  const parsed = JSON.parse(outputText(response));
  return {
    kind,
    model,
    recognition: kind === 'material' ? sanitizeMaterial(parsed) : sanitizeTool(parsed),
    catalogSize: kind === 'material' ? MATERIALS.length : undefined,
  };
}
