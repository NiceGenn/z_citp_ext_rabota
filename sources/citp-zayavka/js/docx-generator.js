import { state } from './state.js';

function escapeXml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function makeDataRowXml(values, notFound = false) {
  const cellDefs = [
    { w:'799', span:'1', align:'left'   },
    { w:'745', span:'1', align:'left'   },
    { w:'697', span:'1', align:'left'   },
    { w:'796', span:'2', align:'left'   },
    { w:'695', span:'3', align:'left'   },
    { w:'660', span:'2', align:'center' },
    { w:'608', span:'1', align:'center' },
  ];
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const shdXml = notFound ? `<w:shd w:val="clear" w:color="auto" w:fill="FECACA"/>` : '';
  let xml = `<w:tr xmlns:w="${W}"><w:trPr><w:trHeight w:val="400"/></w:trPr>`;
  cellDefs.forEach((def, i) => {
    const esc     = escapeXml(values[i] || '');
    const spanXml = def.span !== '1' ? `<w:gridSpan w:val="${def.span}"/>` : '';
    const jcXml   = def.align === 'center' ? '<w:jc w:val="center"/>' : '';
    xml += `<w:tc>
      <w:tcPr><w:tcW w:w="${def.w}" w:type="pct"/>${spanXml}
        <w:tcBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        </w:tcBorders>
        <w:vAlign w:val="center"/>${shdXml}
      </w:tcPr>
      <w:p><w:pPr><w:spacing w:after="0"/>${jcXml}
        <w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr>
        <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
          <w:t xml:space="preserve">${esc}</w:t></w:r></w:p>
    </w:tc>`;
  });
  xml += '</w:tr>';
  return xml;
}

export async function fillDocxTemplate(entries, action) {
  const buf    = await state.templateFile.arrayBuffer();
  const zip    = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXml, 'application/xml');
  const W      = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  const tbl0 = xmlDoc.querySelectorAll('tbl')[0];
  if (!tbl0) throw new Error('Таблица не найдена в шаблоне');

  const allRows = tbl0.querySelectorAll('tr');

  const todayStr = new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
  
  // Умный поиск строки с датой
  let dateRow = null;
  for (let i = 0; i < Math.min(20, allRows.length); i++) {
    const txt = allRows[i].textContent || '';
    if (txt.includes('«___»') || txt.includes('20__') || txt.includes('202_') || (txt.includes('г.') && txt.length < 50)) {
      dateRow = allRows[i];
      break;
    }
  }
  if (!dateRow) dateRow = allRows[8]; // Fallback

  if (dateRow) {
    const dateCells = dateRow.querySelectorAll('tc');
    const targetCell = dateCells[2] || dateCells[dateCells.length - 1]; // Fallback to last cell
    if (targetCell) {
      const datePara = targetCell.querySelector('p');
      if (datePara) {
        datePara.querySelectorAll('r').forEach(r => r.remove());
        const runEl   = xmlDoc.createElementNS(W, 'w:r');
        const rpEl    = xmlDoc.createElementNS(W, 'w:rPr');
        const fontsEl = xmlDoc.createElementNS(W, 'w:rFonts');
        fontsEl.setAttributeNS(W, 'w:ascii', 'Times New Roman');
        fontsEl.setAttributeNS(W, 'w:hAnsi', 'Times New Roman');
        rpEl.appendChild(fontsEl);
        rpEl.appendChild(xmlDoc.createElementNS(W, 'w:b'));
        const szEl = xmlDoc.createElementNS(W, 'w:sz');
        szEl.setAttributeNS(W, 'w:val', '20');
        rpEl.appendChild(szEl);
        runEl.appendChild(rpEl);
        const tEl = xmlDoc.createElementNS(W, 'w:t');
        tEl.textContent = todayStr;
        runEl.appendChild(tEl);
        datePara.appendChild(runEl);
      }
    }
  }

  // Умный поиск заголовка таблицы
  let headerIndex = -1;
  for (let i = 0; i < allRows.length; i++) {
    const txt = allRows[i].textContent || '';
    if (txt.includes('Роль субъекта') || txt.includes('Серийный номер') || txt.includes('ФИО')) {
      headerIndex = i;
      break;
    }
  }

  const insertBeforeNode = (headerIndex !== -1 && allRows[headerIndex + 1]) ? allRows[headerIndex + 1] : allRows[12];

  // Сохраняем ссылки на строки-заглушки ДО вставки новых строк
  const stubRows = headerIndex !== -1
    ? Array.from(allRows).slice(headerIndex + 1)
    : [allRows[12], allRows[13]].filter(Boolean);

  entries.forEach(e => {
    const isNotFound = e.username === '*** НЕ НАЙДЕН ***';
    const rowXml = makeDataRowXml([e.subjectEP, e.role, e.system, e.serial, e.fileName, e.username, action], isNotFound);
    const tmp    = parser.parseFromString(`<root xmlns:w="${W}">${rowXml}</root>`, 'application/xml');
    tbl0.insertBefore(xmlDoc.importNode(tmp.documentElement.firstChild, true), insertBeforeNode);
  });

  // Удаляем заглушки (по сохранённым ссылкам, не по индексам — индексы сдвинулись после вставки)
  stubRows.forEach(row => {
    if (row && row.parentNode === tbl0) tbl0.removeChild(row);
  });

  zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

