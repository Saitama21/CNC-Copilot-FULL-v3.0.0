const material = (code, name, iso, machinability, aliases = [], note = '') => ({
  code, name, iso, machinability, aliases, note,
});

export const MATERIALS = [
  material('S235JR', 'Сталь конструкционная S235JR', 'P', 1.10, ['Ст3', 'St3', '1.0038']),
  material('S355J2', 'Сталь конструкционная S355J2', 'P', 1.00, ['09Г2С', 'S355', '1.0577']),
  material('C22', 'Углеродистая сталь C22', 'P', 1.08, ['Сталь 20', '20', '1.0402']),
  material('C35', 'Углеродистая сталь C35', 'P', 1.02, ['Сталь 35', '35', '1.0501']),
  material('C45', 'Углеродистая сталь C45', 'P', 0.95, ['Сталь 45', '45', '1.0503', '1045']),
  material('C55', 'Углеродистая сталь C55', 'P', 0.88, ['Сталь 55', '55', '1.0535']),
  material('16MnCr5', 'Цементуемая сталь 16MnCr5', 'P', 0.92, ['16ХГ', '1.7131']),
  material('20MnCr5', 'Цементуемая сталь 20MnCr5', 'P', 0.88, ['20ХГ', '1.7147']),
  material('41Cr4', 'Легированная сталь 41Cr4', 'P', 0.86, ['40Х', '5140', '1.7035']),
  material('42CrMo4', 'Легированная сталь 42CrMo4', 'P', 0.78, ['40ХМ', '4140', '1.7225']),
  material('34CrNiMo6', 'Высокопрочная сталь 34CrNiMo6', 'P', 0.68, ['38ХН3МФА', '1.6582']),
  material('100Cr6', 'Подшипниковая сталь 100Cr6', 'P', 0.65, ['ШХ15', '52100', '1.3505']),
  material('11SMn30', 'Автоматная сталь 11SMn30', 'P', 1.45, ['А12', '1.0715']),
  material('AISI1018', 'Низкоуглеродистая сталь AISI 1018', 'P', 1.15, ['1018', 'C15']),
  material('AISI1045', 'Среднеуглеродистая сталь AISI 1045', 'P', 0.95, ['1045', 'C45']),
  material('AISI4140', 'Хромомолибденовая сталь AISI 4140', 'P', 0.78, ['4140', '42CrMo4']),
  material('AISI4340', 'Никель-хром-молибден AISI 4340', 'P', 0.67, ['4340', '34CrNiMo6']),
  material('C15', 'Низкоуглеродистая сталь C15', 'P', 1.13, ['Сталь 15', '15', '1.0401']),
  material('C60', 'Высокоуглеродистая сталь C60', 'P', 0.82, ['Сталь 60', '60', '1.0601']),
  material('65G', 'Рессорно-пружинная сталь 65Г', 'P', 0.72, ['65Г', '65Mn']),
  material('30CrMo', 'Легированная сталь 30CrMo', 'P', 0.80, ['30ХМ', '1.7216']),
  material('X12CrMoV12', 'Инструментальная сталь X12CrMoV12', 'P', 0.58, ['Х12МФ', 'D2', '1.2379']),
  material('HS6-5-2', 'Быстрорежущая сталь HS6-5-2', 'P', 0.48, ['Р6М5', 'M2', '1.3343']),

  material('AISI304', 'Нержавеющая сталь AISI 304', 'M', 0.78, ['304', '08Х18Н10', '1.4301']),
  material('AISI304L', 'Нержавеющая сталь AISI 304L', 'M', 0.80, ['304L', '03Х18Н11', '1.4307']),
  material('AISI316', 'Нержавеющая сталь AISI 316', 'M', 0.70, ['316', '08Х17Н13М2', '1.4401']),
  material('AISI316L', 'Нержавеющая сталь AISI 316L', 'M', 0.72, ['316L', '03Х17Н14М2', '1.4404']),
  material('AISI321', 'Нержавеющая сталь AISI 321', 'M', 0.72, ['321', '12Х18Н10Т', '1.4541']),
  material('AISI347', 'Нержавеющая сталь AISI 347', 'M', 0.70, ['347', '08Х18Н12Б', '1.4550']),
  material('AISI410', 'Мартенситная нержавеющая AISI 410', 'M', 0.82, ['410', '12Х13', '1.4006']),
  material('AISI420', 'Мартенситная нержавеющая AISI 420', 'M', 0.70, ['420', '20Х13', '1.4021']),
  material('AISI430', 'Ферритная нержавеющая AISI 430', 'M', 0.90, ['430', '08Х17', '1.4016']),
  material('17-4PH', 'Нержавеющая 17-4PH', 'M', 0.60, ['AISI 630', '1.4542', '07Х16Н6']),
  material('DUPLEX2205', 'Дуплексная нержавеющая 2205', 'M', 0.52, ['1.4462', 'S31803']),
  material('AISI201', 'Нержавеющая сталь AISI 201', 'M', 0.77, ['201', '12Х15Г9НД']),
  material('AISI310S', 'Жаростойкая нержавеющая AISI 310S', 'M', 0.55, ['310S', '20Х23Н18', '1.4845']),
  material('AISI904L', 'Супераустенитная нержавеющая AISI 904L', 'M', 0.46, ['904L', '1.4539']),
  material('DUPLEX2507', 'Супердуплексная нержавеющая 2507', 'M', 0.42, ['S32750', '1.4410']),

  material('GG20', 'Серый чугун EN-GJL-200', 'K', 1.05, ['СЧ20', 'GG20', 'GJL200']),
  material('GG25', 'Серый чугун EN-GJL-250', 'K', 1.00, ['СЧ25', 'GG25', 'GJL250']),
  material('GGG40', 'Высокопрочный чугун EN-GJS-400', 'K', 0.90, ['ВЧ40', 'GGG40', 'GJS400']),
  material('GGG50', 'Высокопрочный чугун EN-GJS-500', 'K', 0.82, ['ВЧ50', 'GGG50', 'GJS500']),
  material('ADI900', 'Аустемперированный чугун ADI 900', 'K', 0.55, ['ADI']),
  material('GJL300', 'Серый чугун EN-GJL-300', 'K', 0.88, ['СЧ30', 'GG30']),
  material('GJS600', 'Высокопрочный чугун EN-GJS-600', 'K', 0.70, ['ВЧ60', 'GGG60']),
  material('CGI450', 'Чугун с вермикулярным графитом CGI 450', 'K', 0.66, ['GJV450']),

  material('ENAW1050', 'Алюминий 1050', 'N', 1.30, ['АД0', '1050']),
  material('ENAW2024', 'Алюминиевый сплав 2024', 'N', 1.05, ['Д16', '2024']),
  material('ENAW5052', 'Алюминиевый сплав 5052', 'N', 1.10, ['АМг2', '5052']),
  material('ENAW5083', 'Алюминиевый сплав 5083', 'N', 0.95, ['АМг6', '5083']),
  material('ENAW6061', 'Алюминиевый сплав 6061', 'N', 1.15, ['6061', 'АД33']),
  material('ENAW6082', 'Алюминиевый сплав 6082', 'N', 1.10, ['6082']),
  material('ENAW7075', 'Алюминиевый сплав 7075', 'N', 0.95, ['В95', '7075']),
  material('CuETP', 'Медь Cu-ETP', 'N', 0.85, ['М1', 'C110']),
  material('CuCrZr', 'Медь CuCrZr', 'N', 0.90, ['CuCr1Zr']),
  material('CuZn39Pb3', 'Латунь автоматная CuZn39Pb3', 'N', 1.45, ['ЛС59-1', 'CW614N']),
  material('CuZn40', 'Латунь CuZn40', 'N', 1.25, ['Л63']),
  material('CuSn12', 'Бронза оловянная CuSn12', 'N', 1.00, ['БрО12']),
  material('CuAl10Ni5Fe4', 'Алюминиевая бронза', 'N', 0.72, ['БрАЖН10-4-4']),
  material('POM', 'Полиацеталь POM', 'N', 1.60, ['Delrin', 'ацеталь']),
  material('PA6', 'Полиамид PA6', 'N', 1.50, ['Капролон', 'нейлон 6']),
  material('PTFE', 'Фторопласт PTFE', 'N', 1.70, ['Фторопласт-4', 'тефлон']),
  material('PEEK', 'Пластик PEEK', 'N', 1.10, ['PEEK']),
  material('ENAW2017', 'Алюминиевый сплав 2017', 'N', 1.06, ['Д1', '2017']),
  material('ENAW5754', 'Алюминиевый сплав 5754', 'N', 1.05, ['АМг3', '5754']),
  material('CuZn37', 'Латунь CuZn37', 'N', 1.18, ['Л63', 'CW508L']),
  material('CuSn10', 'Бронза оловянная CuSn10', 'N', 0.98, ['БрО10Ф1', 'CC480K']),
  material('PVC-U', 'Поливинилхлорид PVC-U', 'N', 1.45, ['ПВХ', 'PVC']),
  material('UHMWPE', 'Сверхвысокомолекулярный полиэтилен', 'N', 1.65, ['PE1000', 'СВМПЭ']),

  material('TiGrade2', 'Титан Grade 2', 'S', 1.00, ['ВТ1-0', 'Grade 2']),
  material('Ti6Al4V', 'Титан Ti-6Al-4V', 'S', 0.65, ['ВТ6', 'Grade 5']),
  material('Inconel625', 'Inconel 625', 'S', 0.48, ['Alloy 625']),
  material('Inconel718', 'Inconel 718', 'S', 0.40, ['Alloy 718']),
  material('HastelloyC276', 'Hastelloy C-276', 'S', 0.38, ['C276']),
  material('Monel400', 'Monel 400', 'S', 0.62, ['Alloy 400']),
  material('TiGrade5', 'Титан Grade 5', 'S', 0.65, ['Ti-6Al-4V', 'ВТ6']),
  material('TiGrade9', 'Титан Grade 9', 'S', 0.72, ['Ti-3Al-2.5V']),
  material('Inconel600', 'Inconel 600', 'S', 0.52, ['Alloy 600']),
  material('Incoloy825', 'Incoloy 825', 'S', 0.47, ['Alloy 825']),
  material('Waspaloy', 'Никелевый суперсплав Waspaloy', 'S', 0.34, ['Waspaloy']),

  material('HRC45', 'Закалённая сталь ~45 HRC', 'H', 1.00, ['45 HRC'], 'Уточните фактическую твёрдость.'),
  material('HRC50', 'Закалённая сталь ~50 HRC', 'H', 0.88, ['50 HRC'], 'Уточните фактическую твёрдость.'),
  material('HRC55', 'Закалённая сталь ~55 HRC', 'H', 0.75, ['55 HRC'], 'Уточните фактическую твёрдость.'),
  material('HRC60', 'Закалённая сталь ~60 HRC', 'H', 0.60, ['60 HRC'], 'Требуется инструмент для твёрдого точения.'),
  material('HRC65', 'Закалённая сталь ~65 HRC', 'H', 0.45, ['65 HRC'], 'Требуется CBN/керамика по рекомендации производителя.'),

  material('ISO-P-CUSTOM', 'Другой материал ISO P (сталь)', 'P', 1.00, ['другая сталь']),
  material('ISO-M-CUSTOM', 'Другой материал ISO M (нержавеющая)', 'M', 1.00, ['другая нержавейка']),
  material('ISO-K-CUSTOM', 'Другой материал ISO K (чугун)', 'K', 1.00, ['другой чугун']),
  material('ISO-N-CUSTOM', 'Другой материал ISO N (цветной / пластик)', 'N', 1.00, ['другой цветной']),
  material('ISO-S-CUSTOM', 'Другой материал ISO S (титан / жаропрочный)', 'S', 1.00, ['другой жаропрочный']),
  material('ISO-H-CUSTOM', 'Другой материал ISO H (закалённый)', 'H', 1.00, ['другой закалённый']),
];

export const ISO_GROUPS = {
  P: { label: 'P · Стали', color: '#2788ff', textColor: '#ffffff' },
  M: { label: 'M · Нержавеющие', color: '#f3cc28', textColor: '#17202b' },
  K: { label: 'K · Чугуны', color: '#e94b4b', textColor: '#ffffff' },
  N: { label: 'N · Цветные / пластики', color: '#39b95a', textColor: '#ffffff' },
  S: { label: 'S · Жаропрочные / титан', color: '#c77a3a', textColor: '#ffffff' },
  H: { label: 'H · Закалённые', color: '#9ba3ad', textColor: '#17202b' },
};

export function findMaterial(code) {
  return MATERIALS.find((m) => m.code.toLowerCase() === String(code).toLowerCase());
}

function normalizedDesignation(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '');
}

export function matchMaterialCandidate(candidates) {
  const values = (Array.isArray(candidates) ? candidates : [candidates])
    .map(normalizedDesignation)
    .filter(Boolean);
  if (!values.length) return null;
  for (const material of MATERIALS) {
    const designations = [material.code, ...material.aliases].map(normalizedDesignation);
    if (values.some((value) => designations.includes(value))) return material;
  }
  for (const material of MATERIALS) {
    const designations = [material.code, ...material.aliases].map(normalizedDesignation).filter((value) => value.length >= 5);
    if (values.some((value) => value.length >= 5 && designations.some((designation) => designation.includes(value) || value.includes(designation)))) {
      return material;
    }
  }
  return null;
}
