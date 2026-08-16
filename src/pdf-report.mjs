import fs from 'node:fs';
import PDFDocument from 'pdfkit';

const FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function value(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—';
}

export function formatMachineFeed(input) {
  const number = Number(input);
  return Number.isFinite(number) ? number.toFixed(3) : '—';
}

export function formatMachineRpm(input) {
  const number = Number(input);
  return Number.isFinite(number) ? String(Math.round(number)) : '—';
}

function addRow(doc, label, content, emphasize = false) {
  const x = 48;
  const y = doc.y;
  doc.fillColor('#65748a').font('Regular').fontSize(9).text(label, x, y, { width: 175 });
  doc.fillColor('#101828').font(emphasize ? 'Bold' : 'Regular').fontSize(emphasize ? 12 : 10)
    .text(String(content ?? '—'), x + 185, y, { width: 310 });
  doc.moveDown(emphasize ? 1.35 : 1.05);
  doc.moveTo(x, doc.y).lineTo(547, doc.y).strokeColor('#e4e9f0').lineWidth(0.5).stroke();
  doc.moveDown(0.55);
}

function section(doc, title) {
  doc.moveDown(0.8);
  doc.fillColor('#175cd3').font('Bold').fontSize(12).text(title);
  doc.moveDown(0.55);
}

export function streamCalculationPdf(res, calculation) {
  const result = calculation.results || {};
  const inputs = calculation.inputs || {};
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'CNC технологический расчёт', Author: 'CNC Calculator' } });
  if (fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD)) {
    doc.registerFont('Regular', FONT_REGULAR);
    doc.registerFont('Bold', FONT_BOLD);
  } else {
    doc.registerFont('Regular', 'Helvetica');
    doc.registerFont('Bold', 'Helvetica-Bold');
  }

  const day = new Date(calculation.created_at || Date.now()).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="cnc-calculation-${day}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);

  doc.roundedRect(40, 38, 515, 88, 18).fill('#071b33');
  doc.fillColor('#ffffff').font('Bold').fontSize(21).text('CNC технологический расчёт', 60, 58);
  doc.fillColor('#b8d6ff').font('Regular').fontSize(10)
    .text(new Date(calculation.created_at || Date.now()).toLocaleString('ru-RU'), 60, 91);
  doc.y = 145;

  section(doc, 'Исходные данные');
  addRow(doc, 'Материал', `${result.material?.code || calculation.material_code} · ${result.material?.name || ''}`);
  addRow(doc, 'ISO-группа', result.material?.iso || '—');
  addRow(doc, 'Операция', result.operation?.label || calculation.operation);
  addRow(doc, 'Инструмент', [calculation.tool_manufacturer, calculation.tool_code, calculation.tool_name].filter(Boolean).join(' · ') || 'Общие стартовые данные ISO');
  addRow(doc, 'Диаметр обработки', `Ø${value(result.diameterMm || calculation.diameter_mm, 3)} мм`);
  addRow(doc, 'Тип обработки', result.cutType?.label || inputs.cutType || '—');
  addRow(doc, 'Запас режима', ({ reliable: 'Надёжный', normal: 'Нормальный', productive: 'Производительный' })[result.mode] || result.mode || '—');

  section(doc, 'Ввод в станок');
  addRow(doc, 'Подача F', `${formatMachineFeed(result.feedMmRev)} mm/rev`, true);
  addRow(doc, 'Обороты S', `${formatMachineRpm(result.spindleRpm)} rpm`, true);

  if (result.warnings?.length) {
    section(doc, 'Предупреждения');
    for (const warning of result.warnings) {
      doc.fillColor('#9a3412').font('Regular').fontSize(9).text(`• ${warning}`, { width: 495 });
      doc.moveDown(0.4);
    }
  }

  doc.moveDown(0.8);
  doc.fillColor('#667085').font('Regular').fontSize(8)
    .text(result.disclaimer || 'Перед обработкой проверьте зажим, вылет, инструмент и ограничения станка.', { width: 500 });
  doc.end();
}
