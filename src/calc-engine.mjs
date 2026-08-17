import { findMaterial } from './materials.mjs';

export const OPERATIONS = {
  turning: { label: 'Наружное точение', vc: 1.00, feed: 1.00, ap: 1.00, icon: 'turning' },
  facing: { label: 'Торцевание', vc: 0.95, feed: 0.90, ap: 0.85, icon: 'facing' },
  boring: { label: 'Расточка', vc: 0.85, feed: 0.72, ap: 0.65, icon: 'boring' },
  parting: { label: 'Отрезка', vc: 0.55, feed: 0.34, ap: 0.35, icon: 'parting' },
  groove_external: { label: 'Наружная канавка', vc: 0.62, feed: 0.42, ap: 0.45, icon: 'groove' },
  groove_internal: { label: 'Внутренняя канавка', vc: 0.55, feed: 0.36, ap: 0.35, icon: 'groove' },
  thread_external: { label: 'Наружная резьба', vc: 0.42, feed: 1.00, ap: 0.28, threading: true, icon: 'thread' },
  thread_internal: { label: 'Внутренняя резьба', vc: 0.36, feed: 1.00, ap: 0.24, threading: true, icon: 'thread' },
  drilling: { label: 'Сверление', vc: 0.50, feed: 0.52, ap: 1.00, drilling: true, icon: 'drill' },
  center_drilling: { label: 'Центровочное сверление', vc: 0.40, feed: 0.28, ap: 0.50, drilling: true, icon: 'center' },
  countersinking: { label: 'Зенкерование', vc: 0.45, feed: 0.45, ap: 0.45, drilling: true, icon: 'countersink' },
  reaming: { label: 'Развёртывание', vc: 0.32, feed: 0.65, ap: 0.18, drilling: true, icon: 'ream' },
  chamfer: { label: 'Фаска / кромка', vc: 0.78, feed: 0.48, ap: 0.35, icon: 'chamfer' },
  profiling: { label: 'Профильное точение', vc: 0.78, feed: 0.65, ap: 0.55, icon: 'profile' },
};

const ISO_BASE = {
  P: { vc: [130, 190, 240], f: [0.12, 0.24, 0.36], ap: [0.6, 1.8, 3.2] },
  M: { vc: [75, 115, 155], f: [0.09, 0.18, 0.28], ap: [0.5, 1.4, 2.5] },
  K: { vc: [150, 220, 285], f: [0.14, 0.27, 0.42], ap: [0.7, 2.0, 3.8] },
  N: { vc: [260, 430, 650], f: [0.10, 0.22, 0.38], ap: [0.7, 2.0, 4.0] },
  S: { vc: [30, 48, 70], f: [0.07, 0.14, 0.22], ap: [0.35, 0.9, 1.8] },
  H: { vc: [55, 85, 120], f: [0.04, 0.09, 0.15], ap: [0.15, 0.35, 0.7] },
};

// Approximate specific cutting force for a first-pass spindle load estimate.
// It is intentionally conservative and never replaces insert-manufacturer data.
const ISO_KC = { P: 1800, M: 2250, K: 1350, N: 700, S: 2700, H: 3100 };

const MODE_INDEX = { reliable: 0, normal: 1, productive: 2 };
const CUT_TYPE = {
  rough: { vc: 0.90, feed: 1.22, ap: 1.30, label: 'Черновая' },
  semi: { vc: 1.00, feed: 1.00, ap: 1.00, label: 'Получистовая' },
  finish: { vc: 1.06, feed: 0.58, ap: 0.48, label: 'Чистовая' },
};

function finitePositive(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function midpoint(min, max, fallback) {
  const a = finitePositive(min);
  const b = finitePositive(max);
  if (a && b) return (a + b) / 2;
  return a || b || fallback;
}

function interpolateRange(min, max, modeIndex, fallback) {
  const a = finitePositive(min);
  const b = finitePositive(max);
  if (a && b) return [a, (a + b) / 2, b][modeIndex];
  return a || b || fallback;
}

export function calculateMachining(input) {
  const material = findMaterial(input.materialCode);
  if (!material) throw new Error('Материал не найден');
  const op = OPERATIONS[input.operation];
  if (!op) throw new Error('Операция не найдена');

  const diameter = finitePositive(input.diameterMm);
  if (!diameter) throw new Error('Укажите диаметр больше 0 мм');

  const mode = MODE_INDEX[input.mode] ?? 1;
  const cutType = CUT_TYPE[input.cutType] || CUT_TYPE.semi;
  const base = ISO_BASE[material.iso];
  const tool = input.tool || {};

  const genericVc = base.vc[mode] * material.machinability * op.vc;
  const genericFeed = base.f[mode] * op.feed;
  const genericAp = base.ap[mode] * op.ap;

  const toolVc = interpolateRange(tool.vc_min, tool.vc_max, mode, null);
  const toolFeed = interpolateRange(tool.feed_min, tool.feed_max, mode, null);
  const toolAp = interpolateRange(tool.ap_min, tool.ap_max, mode, null);

  let vc = (toolVc ? toolVc * op.vc : genericVc) * cutType.vc;
  let feedPerRev = (toolFeed ? toolFeed * op.feed : genericFeed) * cutType.feed;
  let ap = (toolAp ? toolAp * op.ap : genericAp) * cutType.ap;

  if (op.threading) {
    const pitch = finitePositive(input.threadPitchMm);
    if (!pitch) throw new Error('Для резьбы укажите шаг резьбы');
    feedPerRev = pitch;
    ap = finitePositive(input.threadDepthMm, ap);
  }

  if (op.drilling) {
    const drillDiameter = finitePositive(input.toolDiameterMm, finitePositive(tool.diameter_mm, diameter));
    // Diameter-aware conservative adjustment for drilling-like operations.
    const diameterFactor = Math.min(1.45, Math.max(0.55, Math.sqrt(drillDiameter / 10)));
    feedPerRev *= diameterFactor;
  }

  if (input.customVc) vc = finitePositive(input.customVc, vc);
  if (input.customFeed) feedPerRev = finitePositive(input.customFeed, feedPerRev);
  if (input.customAp) ap = finitePositive(input.customAp, ap);

  let rpm = (vc * 1000) / (Math.PI * diameter);
  const rpmConstraints = [
    { key: 'machine', label: 'лимит станка', value: finitePositive(input.machineMaxRpm, finitePositive(input.maxRpm, 4000)) },
    { key: 'hydraulic', label: input.hydraulicCylinderModel ? `гидроцилиндр ${input.hydraulicCylinderModel}` : 'гидроцилиндр', value: finitePositive(input.hydraulicCylinderMaxRpm) },
    { key: 'motor', label: input.motorModel ? `двигатель ${input.motorModel}` : 'двигатель', value: finitePositive(input.motorMaxRpm) },
    { key: 'setup', label: 'текущий патрон/кулачки', value: finitePositive(input.setupMaxRpm) },
  ].filter(x => x.value).sort((a, b) => a.value - b.value);
  const rpmLimiter = rpmConstraints[0] || { key: 'machine', label: 'лимит станка', value: 4000 };
  const maxRpm = rpmLimiter.value;
  const rpmLimited = rpm > maxRpm;
  rpm = Math.min(rpm, maxRpm);
  const feedMmMin = rpm * feedPerRev;
  const actualVc = (Math.PI * diameter * rpm) / 1000;
  const cutLength = finitePositive(input.cutLengthMm);
  const passes = Math.min(1000, Math.max(1, Math.round(finitePositive(input.passes, 1))));
  const cuttingTimeMin = cutLength ? (cutLength / Math.max(feedMmMin, 0.001)) * passes : null;
  const powerApplicable = !op.threading && !op.drilling;
  const cuttingForceN = powerApplicable ? ISO_KC[material.iso] * ap * feedPerRev : null;
  const cuttingPowerKw = cuttingForceN ? (cuttingForceN * actualVc) / 60_000 : null;
  const requiredSpindlePowerKw = cuttingPowerKw ? cuttingPowerKw / 0.82 : null;
  const machinePowerKw = finitePositive(input.machinePowerKw);
  const powerLoadPercent = machinePowerKw && requiredSpindlePowerKw ? (requiredSpindlePowerKw / machinePowerKw) * 100 : null;

  const source = toolVc || toolFeed || toolAp ? 'tool+material' : 'generic-material';
  const warnings = [];
  if (rpmLimited) warnings.push(`Обороты ограничены: ${rpmLimiter.label} · ${Math.round(maxRpm)} rpm.`);
  if (source === 'generic-material') warnings.push('Использованы общие стартовые режимы ISO-группы. Перед обработкой сверяйте данные производителя инструмента.');
  if (material.note) warnings.push(material.note);
  const toolGroups = Array.isArray(tool.iso_groups) ? tool.iso_groups : [];
  if (toolGroups.length && !toolGroups.includes(material.iso)) warnings.push(`Выбранный инструмент не отмечен для ISO ${material.iso}. Проверьте применимость grade/геометрии.`);
  const toolOperations = Array.isArray(tool.operations) ? tool.operations : [];
  if (toolOperations.length && !toolOperations.includes(input.operation)) warnings.push('Выбранный инструмент не отмечен для этой операции. Проверьте геометрию и державку.');
  if (input.operation === 'parting' && !finitePositive(tool.width_mm) && !finitePositive(input.partingWidthMm)) {
    warnings.push('Для точной отрезки добавьте ширину пластины/лезвия в библиотеке инструмента.');
  }
  if (powerLoadPercent && powerLoadPercent > 85) warnings.push(`Расчётная нагрузка шпинделя около ${Math.round(powerLoadPercent)}%. Уменьшите ap/F или проверьте мощность станка.`);

  const materialOverride = String(input.materialCode).startsWith('ISO-') && input.materialOverride && typeof input.materialOverride === 'object'
    ? {
        code: String(input.materialOverride.code || material.code).slice(0, 80),
        name: String(input.materialOverride.name || material.name).slice(0, 160),
        iso: material.iso,
      }
    : null;

  return {
    material: materialOverride || { code: material.code, name: material.name, iso: material.iso },
    operation: { code: input.operation, label: op.label },
    mode: input.mode || 'normal',
    cutType: { code: input.cutType || 'semi', label: cutType.label },
    diameterMm: Number(diameter.toFixed(3)),
    vcRecommended: Number(vc.toFixed(1)),
    vcActual: Number(actualVc.toFixed(1)),
    spindleRpm: Math.max(1, Math.round(rpm)),
    feedMmRev: Number(feedPerRev.toFixed(3)),
    feedMmMin: Number(feedMmMin.toFixed(1)),
    apMm: Number(ap.toFixed(2)),
    cuttingTimeMin: cuttingTimeMin == null ? null : Number(cuttingTimeMin.toFixed(2)),
    passes,
    cuttingPowerKw: cuttingPowerKw == null ? null : Number(cuttingPowerKw.toFixed(2)),
    requiredSpindlePowerKw: requiredSpindlePowerKw == null ? null : Number(requiredSpindlePowerKw.toFixed(2)),
    powerLoadPercent: powerLoadPercent == null ? null : Number(powerLoadPercent.toFixed(0)),
    rpmLimited,
    maxRpm: Math.round(maxRpm),
    rpmLimitSource: { key: rpmLimiter.key, label: rpmLimiter.label },
    rpmConstraints: rpmConstraints.map(x => ({ key:x.key, label:x.label, value:Math.round(x.value) })),
    source,
    machineInput: {
      feedMode: 'G95',
      fixedRpm: `S${Math.max(1, Math.round(rpm))}`,
      feedPerRev: `F${Number(feedPerRev.toFixed(3))}`,
      constantSurface: `G96 S${Math.round(vc)} LIMS=${Math.round(maxRpm)}`,
      summary: `F ${Number(feedPerRev.toFixed(3))} mm/rev · S ${Math.max(1, Math.round(rpm))} rpm`,
    },
    warnings,
    disclaimer: 'Стартовые технологические значения. Ответственность за проверку устойчивости установки, зажима, инструмента и ограничений станка несёт оператор.'
  };
}
