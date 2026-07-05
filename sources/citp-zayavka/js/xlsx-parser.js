import { state } from './state.js';

// Приводим краткие названия к каноническому виду
const SYSTEM_ALIASES = {
  'финансы':          'АЦК-Финансы',
  'ацк-финансы':      'АЦК-Финансы',
  'планирование':     'АЦК-Планирования',
  'планирования':     'АЦК-Планирования',
  'ацк-планирования': 'АЦК-Планирования',
};
export function normalizeSystem(s) {
  if (!s) return '';
  return SYSTEM_ALIASES[s.toLowerCase().trim()] || s.trim();
}

// Буква столбца из ссылки ячейки ("C2" → 2 для A→0). OOXML пропускает пустые
// ячейки, поэтому читать их по порядковому индексу нельзя — только по столбцу.
function colToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

export async function loadDatabase(file) {
  try {
    const zip = await JSZip.loadAsync(file);
    const db  = [];

    const strings = [];
    const ssFile  = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
      const ssDoc = new DOMParser().parseFromString(await ssFile.async('string'), 'application/xml');
      ssDoc.querySelectorAll('si').forEach(si => strings.push(si.textContent));
    }

    const wbFile  = zip.file('xl/workbook.xml');
    const relFile = zip.file('xl/_rels/workbook.xml.rels');
    if (!wbFile || !relFile) return;

    const p      = new DOMParser();
    const wbDoc  = p.parseFromString(await wbFile.async('string'), 'application/xml');
    const relDoc = p.parseFromString(await relFile.async('string'), 'application/xml');

    let sheetTarget = null;
    for (const sheet of wbDoc.querySelectorAll('sheet')) {
      if (sheet.getAttribute('name')?.trim().toLowerCase() === 'ацк') {
        const rId = sheet.getAttribute('r:id');
        for (const rel of relDoc.querySelectorAll('Relationship')) {
          if (rel.getAttribute('Id') === rId) { sheetTarget = rel.getAttribute('Target'); break; }
        }
        break;
      }
    }
    if (!sheetTarget) {
      document.getElementById('db-count').textContent = 'лист «АЦК» не найден';
      return;
    }

    const shPath = sheetTarget.startsWith('/') ? sheetTarget.slice(1) : 'xl/' + sheetTarget;
    const shFile = zip.file(shPath);
    if (!shFile) return;

    const shDoc = p.parseFromString(await shFile.async('string'), 'application/xml');
    let first = true;

    shDoc.querySelectorAll('sheetData > row').forEach(row => {
      if (first) { first = false; return; }
      // Раскладываем ячейки по буквенному индексу столбца (A→0, B→1, …):
      // позиционный индекс ломается, если в строке пропущены пустые ячейки.
      const byCol = {};
      row.querySelectorAll('c').forEach(c => {
        const m = (c.getAttribute('r') || '').match(/^([A-Z]+)/);
        if (m) byCol[colToIndex(m[1])] = c;
      });
      const getVal = c => {
        if (!c) return '';
        // Инлайн-строка: текст лежит в <is>, а не в <v>.
        if (c.getAttribute('t') === 'inlineStr') {
          const is = c.querySelector('is');
          return is ? is.textContent : '';
        }
        const v = c.querySelector('v');
        if (!v) return '';
        return c.getAttribute('t') === 's' ? (strings[parseInt(v.textContent)] || '') : v.textContent;
      };
      const colB = getVal(byCol[1]);
      const colC = getVal(byCol[2]);
      const colD = getVal(byCol[3]);
      const colE = getVal(byCol[4]);
      if (colC && colB) db.push({
        fio:    colC.trim(),
        login:  colB.trim(),
        role:   colD.trim(),
        system: normalizeSystem(colE),
      });
    });

    state.dbData = db;
    const normFn = s => s.replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    state.dbNormalized = db.map(r => ({ ...r, normFio: normFn(r.fio) }));
    const count = db.length;
    document.getElementById('db-count').textContent = `${count} записей`;
  } catch(e) {
    console.error("Ошибка загрузки БД:", e);
    document.getElementById('db-count').textContent = 'ошибка';
  }
}

