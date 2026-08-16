window.CNC_DATA = (() => {
  const materials = [
    {id:'aisi304',name:'AISI 304 / 08Х18Н10',short:'AISI 304',iso:'M',hb:180,kc:2400,note:'Аустенитная нержавеющая сталь. Склонна к наклёпу; не тереть кромкой и не держать слишком малую подачу.',ranges:{rough:{vc:[95,135,175],f:[.16,.26,.38],ap:[.8,2.0,3.5]},finish:{vc:[115,165,205],f:[.06,.12,.20],ap:[.15,.45,.9]},face:{vc:[100,145,185],f:[.10,.20,.30],ap:[.4,1.2,2.5]},bore:{vc:[90,130,165],f:[.10,.18,.28],ap:[.35,1.0,2.2]},groove:{vc:[60,90,120],f:[.05,.10,.16],ap:[.4,1.0,2.0]},part:{vc:[50,75,100],f:[.04,.08,.13],ap:[.5,1.0,2.0]},drill:{vc:[35,55,80],f:[.04,.09,.16],ap:[1,1,1]},center:{vc:[30,45,65],f:[.03,.06,.10],ap:[.3,.6,1]},thread:{vc:[35,55,75],f:[1,1,1],ap:[.08,.16,.28]}}},
    {id:'aisi316',name:'AISI 316L',short:'AISI 316L',iso:'M',hb:150,kc:2500,note:'Аустенитная нержавейка с высокой вязкостью. Стабильная СОЖ и жёсткая установка особенно важны.',ranges:{rough:{vc:[85,125,165],f:[.16,.25,.36],ap:[.8,1.8,3.2]},finish:{vc:[105,150,190],f:[.06,.12,.19],ap:[.15,.4,.8]},face:{vc:[90,135,175],f:[.10,.19,.29],ap:[.4,1.1,2.3]},bore:{vc:[80,120,155],f:[.10,.17,.26],ap:[.35,.9,2]},groove:{vc:[55,85,110],f:[.05,.09,.15],ap:[.4,.9,1.8]},part:{vc:[45,70,95],f:[.04,.08,.12],ap:[.5,1,2]},drill:{vc:[30,50,70],f:[.04,.08,.15],ap:[1,1,1]},center:{vc:[28,42,60],f:[.03,.06,.10],ap:[.3,.6,1]},thread:{vc:[30,50,70],f:[1,1,1],ap:[.08,.15,.26]}}},
    {id:'c45',name:'Сталь 45 / C45 / AISI 1045',short:'C45',iso:'P',hb:195,kc:1800,note:'Среднеуглеродистая конструкционная сталь. Хорошая база для универсальных P-пластин.',ranges:{rough:{vc:[150,210,285],f:[.18,.30,.45],ap:[1,2.5,4.5]},finish:{vc:[190,260,340],f:[.06,.14,.24],ap:[.15,.5,1]},face:{vc:[160,225,300],f:[.12,.23,.34],ap:[.5,1.5,3]},bore:{vc:[140,195,260],f:[.10,.20,.32],ap:[.4,1.2,2.5]},groove:{vc:[95,135,180],f:[.05,.11,.18],ap:[.5,1.2,2.5]},part:{vc:[80,115,155],f:[.05,.10,.16],ap:[.5,1.2,2.5]},drill:{vc:[60,90,125],f:[.06,.12,.22],ap:[1,1,1]},center:{vc:[45,70,95],f:[.04,.08,.13],ap:[.3,.7,1.2]},thread:{vc:[55,80,110],f:[1,1,1],ap:[.08,.18,.32]}}},
    {id:'40x',name:'40Х / 41Cr4',short:'40Х',iso:'P',hb:230,kc:2050,note:'Легированная конструкционная сталь. При повышенной твёрдости снижай верхнюю границу Vc.',ranges:{rough:{vc:[125,175,235],f:[.18,.28,.40],ap:[.8,2.2,4]},finish:{vc:[155,215,280],f:[.06,.13,.22],ap:[.15,.45,.9]},face:{vc:[135,190,250],f:[.11,.22,.32],ap:[.45,1.4,2.8]},bore:{vc:[115,165,220],f:[.10,.19,.30],ap:[.4,1.1,2.3]},groove:{vc:[80,115,150],f:[.05,.10,.16],ap:[.5,1.1,2.2]},part:{vc:[70,100,135],f:[.05,.09,.14],ap:[.5,1,2]},drill:{vc:[50,75,105],f:[.05,.11,.20],ap:[1,1,1]},center:{vc:[40,60,85],f:[.04,.07,.12],ap:[.3,.7,1.1]},thread:{vc:[45,70,95],f:[1,1,1],ap:[.08,.17,.3]}}},
    {id:'s235',name:'S235 / Ст3',short:'S235',iso:'P',hb:140,kc:1500,note:'Низкоуглеродистая сталь. Возможен нарост на кромке при слишком низкой скорости.',ranges:{rough:{vc:[170,240,320],f:[.18,.32,.48],ap:[1,2.8,5]},finish:{vc:[210,290,370],f:[.06,.15,.25],ap:[.15,.55,1.1]},face:{vc:[180,250,330],f:[.12,.24,.36],ap:[.5,1.6,3.2]},bore:{vc:[155,215,285],f:[.10,.21,.34],ap:[.4,1.3,2.7]},groove:{vc:[105,150,195],f:[.05,.12,.19],ap:[.5,1.3,2.7]},part:{vc:[90,125,165],f:[.05,.11,.17],ap:[.5,1.2,2.5]},drill:{vc:[65,100,140],f:[.06,.13,.24],ap:[1,1,1]},center:{vc:[50,75,105],f:[.04,.08,.14],ap:[.3,.7,1.2]},thread:{vc:[60,90,120],f:[1,1,1],ap:[.08,.2,.35]}}},
    {id:'al6061',name:'Al 6061 / АД31',short:'Al 6061',iso:'N',hb:95,kc:700,note:'Алюминий. Для хорошей поверхности важна острая положительная геометрия и отсутствие налипания.',ranges:{rough:{vc:[250,420,650],f:[.18,.35,.55],ap:[1,3,6]},finish:{vc:[350,550,850],f:[.05,.14,.28],ap:[.1,.5,1.2]},face:{vc:[280,450,700],f:[.10,.25,.42],ap:[.4,1.8,3.5]},bore:{vc:[230,380,600],f:[.08,.20,.35],ap:[.3,1.2,2.8]},groove:{vc:[180,300,480],f:[.05,.13,.23],ap:[.4,1.2,2.5]},part:{vc:[160,260,420],f:[.05,.12,.20],ap:[.4,1.2,2.5]},drill:{vc:[120,220,360],f:[.06,.16,.30],ap:[1,1,1]},center:{vc:[90,160,260],f:[.04,.10,.18],ap:[.3,.8,1.3]},thread:{vc:[100,180,280],f:[1,1,1],ap:[.08,.18,.32]}}},
    {id:'brass',name:'Латунь ЛС59 / CW614N',short:'Латунь',iso:'N',hb:100,kc:850,note:'Латунь хорошо режется. Для склонных к самозатягиванию операций избегай чрезмерно положительной геометрии сверла.',ranges:{rough:{vc:[180,300,480],f:[.16,.30,.48],ap:[.8,2.5,5]},finish:{vc:[250,400,620],f:[.05,.13,.24],ap:[.1,.45,1]},face:{vc:[200,330,520],f:[.10,.23,.36],ap:[.4,1.5,3]},bore:{vc:[170,280,450],f:[.08,.18,.30],ap:[.3,1,2.5]},groove:{vc:[130,220,350],f:[.05,.11,.19],ap:[.4,1.1,2.4]},part:{vc:[110,190,300],f:[.05,.10,.17],ap:[.4,1.1,2.4]},drill:{vc:[80,140,220],f:[.06,.14,.25],ap:[1,1,1]},center:{vc:[65,110,170],f:[.04,.09,.15],ap:[.3,.7,1.2]},thread:{vc:[80,130,210],f:[1,1,1],ap:[.08,.18,.32]}}},
    {id:'pa6',name:'Полиамид PA6',short:'PA6',iso:'N',hb:25,kc:120,note:'Пластик. Следи за нагревом, острым инструментом и эвакуацией длинной стружки.',ranges:{rough:{vc:[150,250,380],f:[.18,.35,.55],ap:[1,3,6]},finish:{vc:[180,300,450],f:[.06,.16,.30],ap:[.15,.6,1.5]},face:{vc:[160,270,410],f:[.10,.25,.42],ap:[.5,2,4]},bore:{vc:[130,220,350],f:[.08,.20,.36],ap:[.4,1.5,3]},groove:{vc:[100,170,280],f:[.05,.13,.24],ap:[.5,1.5,3]},part:{vc:[90,150,240],f:[.05,.12,.22],ap:[.5,1.5,3]},drill:{vc:[70,120,190],f:[.06,.16,.30],ap:[1,1,1]},center:{vc:[55,90,150],f:[.04,.10,.18],ap:[.3,.8,1.5]},thread:{vc:[60,100,160],f:[1,1,1],ap:[.08,.18,.32]}}},
    {id:'pom',name:'POM-C / Ацеталь',short:'POM-C',iso:'N',hb:20,kc:90,note:'Стабильный инженерный пластик. Хорошо работает острый полированный инструмент.',ranges:{rough:{vc:[180,300,450],f:[.18,.38,.60],ap:[1,3.5,7]},finish:{vc:[220,360,520],f:[.05,.15,.28],ap:[.12,.55,1.4]},face:{vc:[190,320,470],f:[.10,.26,.44],ap:[.5,2,4.5]},bore:{vc:[160,270,410],f:[.08,.21,.38],ap:[.4,1.6,3.2]},groove:{vc:[120,200,320],f:[.05,.14,.25],ap:[.5,1.6,3.2]},part:{vc:[110,180,290],f:[.05,.13,.23],ap:[.5,1.5,3]},drill:{vc:[80,140,220],f:[.06,.17,.32],ap:[1,1,1]},center:{vc:[60,100,165],f:[.04,.11,.19],ap:[.3,.8,1.5]},thread:{vc:[70,115,180],f:[1,1,1],ap:[.08,.18,.32]}}}
  ];

  const operations = [
    {id:'face',name:'Торцовка',icon:'⊙',supportsPass:true,defaultPass:'both',toolOps:['face'],description:'Выравнивание торца заготовки.',shopturn:'Точение → торцевание / снятие припуска; подача обычно G95, для постоянной скорости — G96 с лимитом оборотов.'},
    {id:'od',name:'Наружное точение',icon:'◒',supportsPass:true,defaultPass:'both',toolOps:['od','rough','finish'],description:'Наружный диаметр, ступени и цилиндрические поверхности.',shopturn:'Точение → снятие припуска / контурное точение. Проверь X как диаметр, Z относительно нуля детали.'},
    {id:'bore',name:'Внутренняя расточка',icon:'◎',supportsPass:true,defaultPass:'both',toolOps:['bore','finish'],description:'Обработка внутреннего диаметра.',shopturn:'Точение → снятие припуска / внутреннее контурное точение. Обязательно проверь безопасный X при подводе.'},
    {id:'groove',name:'Канавка',icon:'⌗',supportsPass:false,defaultPass:'single',toolOps:['groove'],description:'Наружная или внутренняя канавка.',shopturn:'Точение → канавка. Укажи ширину резца/канавки, глубину и безопасный отвод.'},
    {id:'part',name:'Отрезка',icon:'╱',supportsPass:false,defaultPass:'single',toolOps:['part'],description:'Отрезка детали от прутка.',shopturn:'Точение → отрезка. Нужны корректные X/Z, ширина пластины и стабильная СОЖ.'},
    {id:'center',name:'Центровка',icon:'⌾',supportsPass:false,defaultPass:'single',toolOps:['center','drill'],description:'Центровочное отверстие перед задней бабкой или сверлением.',shopturn:'Сверление → центровка. Подготовь центр до подключения задней бабки.'},
    {id:'drill',name:'Сверление',icon:'⇣',supportsPass:false,defaultPass:'single',toolOps:['drill'],description:'Осевое сверление.',shopturn:'Сверление → осевое сверление. Укажи глубину, подачу на оборот и стратегию стружколомания.'},
    {id:'thread_ext',name:'Наружная резьба',icon:'≋',supportsPass:false,defaultPass:'single',toolOps:['thread_ext','thread'],description:'Наружная метрическая резьба.',shopturn:'Точение → резьба. Подача синхронна шагу резьбы; вводи шаг P и безопасное число проходов.'},
    {id:'thread_int',name:'Внутренняя резьба',icon:'≣',supportsPass:false,defaultPass:'single',toolOps:['thread_int','thread'],description:'Внутренняя метрическая резьба.',shopturn:'Точение → внутренняя резьба. Проверь диаметр отверстия и безопасный выход резца.'}
  ];

  const tools = [
    {id:'wnmg-m-2025',holder:'MWLNR2525M08',insert:'WNMG 080408-MM',grade:'2025',breaker:'MM',nose:.8,iso:['M'],ops:['face','od','rough'],passes:['rough'],source:'Каталожный профиль',verified:true,art:{shape:'wnmg',tone:'gold'}},
    {id:'wnmg-p-4405',holder:'MWLNR2525M08',insert:'WNMG 080408-PM',grade:'4405',breaker:'PM',nose:.8,iso:['P'],ops:['face','od','rough'],passes:['rough'],source:'Каталожный профиль',verified:true,art:{shape:'wnmg',tone:'bronze'}},
    {id:'wnmg-generic',holder:'MWLNR2525M08',insert:'WNMG 080408',grade:'не задан',breaker:'—',nose:.8,iso:['M','P'],ops:['face','od','rough'],passes:['rough'],source:'Локальный консервативный профиль',verified:false,art:{shape:'wnmg',tone:'steel'}},
    {id:'ccmt-m',holder:'SCLCR2020K09 / расточная оправка',insert:'CCMT 09T304',grade:'ISO M',breaker:'MF',nose:.4,iso:['M','P'],ops:['finish','face','od','bore'],passes:['finish'],source:'Локальный финишный профиль',verified:false,art:{shape:'ccmt',tone:'gold'}},
    {id:'dcmt-n',holder:'SDJCR2020K11',insert:'DCMT 11T304',grade:'ISO N/P/M',breaker:'F',nose:.4,iso:['N','P','M'],ops:['finish','face','od','bore'],passes:['finish'],source:'Локальный финишный профиль',verified:false,art:{shape:'dcmt',tone:'silver'}},
    {id:'mgmn3',holder:'MGEHR2525-3T20',insert:'MGMN 300',grade:'универсальный',breaker:'groove',nose:.2,iso:['M','P','N'],ops:['groove','part'],passes:['single'],source:'Локальный профиль канавки/отрезки',verified:false,art:{shape:'mgmn',tone:'gold'}},
    {id:'drill12',holder:'Осевой инструмент / ER25',insert:'Твердосплавное сверло Ø12',grade:'универсальный',breaker:'—',nose:0,iso:['M','P','N'],ops:['drill'],passes:['single'],source:'Локальный профиль сверления',verified:false,diameter:12,art:{shape:'drill',tone:'steel'}},
    {id:'centerA',holder:'Осевой инструмент / ER25',insert:'Центровочное сверло A',grade:'HSS/Carbide',breaker:'—',nose:0,iso:['M','P','N'],ops:['center'],passes:['single'],source:'Локальный профиль центровки',verified:false,diameter:4,art:{shape:'drill',tone:'silver'}},
    {id:'thread16er',holder:'SER2525M16',insert:'16ER AG60',grade:'ISO M/P',breaker:'60°',nose:.1,iso:['M','P','N'],ops:['thread_ext','thread'],passes:['single'],source:'Локальный профиль резьбы',verified:false,art:{shape:'thread',tone:'gold'}},
    {id:'thread16ir',holder:'SIR20Q16',insert:'16IR AG60',grade:'ISO M/P',breaker:'60°',nose:.1,iso:['M','P','N'],ops:['thread_int','thread'],passes:['single'],source:'Локальный профиль резьбы',verified:false,art:{shape:'thread',tone:'gold'}}
  ];

  const threads = [
    ['M1',.25],['M1.2',.25],['M1.4',.3],['M1.6',.35],['M1.8',.35],['M2',.4],['M2.5',.45],
    ['M3',.5],['M3.5',.6],['M4',.7],['M5',.8],['M6',1],['M7',1],['M8',1.25],['M10',1.5],['M12',1.75],
    ['M14',2],['M16',2],['M18',2.5],['M20',2.5],['M22',2.5],['M24',3],['M27',3],['M30',3.5],['M33',3.5],
    ['M36',4],['M39',4],['M42',4.5],['M45',4.5],['M48',5],['M52',5],['M56',5.5],['M60',5.5],['M64',6],
    ['M68',6],['M72',6],['M76',6],['M80',6],['M85',6],['M90',6],['M95',6],['M100',6]
  ];

  const fitPresets = [
    {name:'H6/h5 · высокая точность, скольжение',hole:'H',holeGrade:6,shaft:'h',shaftGrade:5},
    {name:'H6/g5 · высокая точность, малый зазор',hole:'H',holeGrade:6,shaft:'g',shaftGrade:5},
    {name:'H7/h6 · точная скользящая',hole:'H',holeGrade:7,shaft:'h',shaftGrade:6},
    {name:'H7/g6 · лёгкое скольжение',hole:'H',holeGrade:7,shaft:'g',shaftGrade:6},
    {name:'H7/f7 · ходовая',hole:'H',holeGrade:7,shaft:'f',shaftGrade:7},
    {name:'H7/k6 · переходная',hole:'H',holeGrade:7,shaft:'k',shaftGrade:6},
    {name:'H7/p6 · натяг',hole:'H',holeGrade:7,shaft:'p',shaftGrade:6},
    {name:'H8/h7 · общая скользящая',hole:'H',holeGrade:8,shaft:'h',shaftGrade:7},
    {name:'H8/f7 · свободная ходовая',hole:'H',holeGrade:8,shaft:'f',shaftGrade:7},
    {name:'H8/p7 · посадка с натягом',hole:'H',holeGrade:8,shaft:'p',shaftGrade:7}
  ];

  const feedbackRules = {
    good:{label:'Всё отлично',icon:'✓',severity:'ok',reason:'Режим подтверждён реальным проходом. Сохраняем его как проверенный для этой операции.',mult:{rpm:1,f:1,ap:1}},
    vibration:{label:'Вибрация / дрожание',icon:'⌁',severity:'warn',reason:'Снижаем возбуждение системы: скорость и глубину уменьшаем, подачу слегка разгружаем.',mult:{rpm:.88,f:.92,ap:.76}},
    squeal:{label:'Свист / шум',icon:'◖',severity:'warn',reason:'Уводим систему из резонанса: немного снижаем обороты, подачу не занижаем слишком сильно.',mult:{rpm:.90,f:1.03,ap:.88}},
    chips:{label:'Стружка не ломается',icon:'↝',severity:'info',reason:'Поднимаем подачу в допустимом диапазоне, чтобы стружколом начал работать. Проверяем направление и СОЖ.',mult:{rpm:.98,f:1.12,ap:1.03}},
    heat:{label:'Перегрев / дым',icon:'♨',severity:'danger',reason:'Снижаем скорость резания и нагрузку. Отдельно проверь подачу СОЖ и состояние кромки.',mult:{rpm:.84,f:.94,ap:.88}},
    surface:{label:'Плохая поверхность',icon:'⌁',severity:'warn',reason:'Снижаем подачу и глубину. Проверь биение, вылет, радиус вершины и жёсткость.',mult:{rpm:.96,f:.82,ap:.78}},
    wear:{label:'Быстрый износ пластины',icon:'◇',severity:'warn',reason:'Снижаем Vc и тепловую нагрузку. Если износ по кромке — проверь марку сплава и СОЖ.',mult:{rpm:.88,f:.96,ap:.92}},
    load:{label:'Большая нагрузка шпинделя',icon:'⚡',severity:'danger',reason:'Сначала уменьшаем глубину, затем подачу. Обороты меняем минимально.',mult:{rpm:.97,f:.90,ap:.72}}
  };

  return {
    version:'3.0.5 FULL',
    author:{name:'Ерошов Иван',email:'eroshovivan@gmail.com'},
    machineDefault:{id:'ck52pty',name:'Tengyue CK52PT-Y',control:'SINUMERIK 828D / ShopTurn',maxRpm:4000,spindleKw:11,efficiency:.85,spindle:'A2-6',bore:61,turret:'15 позиций · BMT40 / ER25',axes:'X / Z / Y / C',tailstock:true,setupMaxRpm:null,tailstockMExtend:'',tailstockMRetract:''},
    materials, operations, tools, threads, fitPresets, feedbackRules
  };
})();
