import { state } from './js/state.js';
import { parseCert } from './js/x509-parser.js';
import { loadDatabase } from './js/xlsx-parser.js';
import { findAllUsers } from './js/matcher.js';
import { normalizeSystem } from './js/xlsx-parser.js';
import { fillDocxTemplate } from './js/docx-generator.js';

// ── Инициализация при открытии попапа ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('header-ver').textContent = 'v' + chrome.runtime.getManifest().version;
  loadEmbeddedTemplate();
  document.getElementById('db-count').textContent = 'не загружена';
  initUI();
});

// ════════════════════════════════════════════════════════════
//  ВСТРОЕННЫЕ ФАЙЛЫ (из popup-data.js)
// ════════════════════════════════════════════════════════════

function b64ToFile(b64, name, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

function loadEmbeddedTemplate() {
  state.templateFile = b64ToFile(
    EMBEDDED_TEMPLATE_B64,
    'ЗаявкаЦИТП.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

// TODO: loadEmbeddedDb() — вернёмся к вшивке БазаАЦК.xlsx в новом формате (5 колонок) позже

// ════════════════════════════════════════════════════════════
//  UI — инициализация обработчиков
// ════════════════════════════════════════════════════════════

function initUI() {
  // Загрузка базы вручную
  document.getElementById('inp-db').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('lbl-db').classList.add('has-file');
    await loadDatabase(file);
    checkReady();
  });

  // Загрузка шаблона вручную
  document.getElementById('inp-template').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    state.templateFile = file;
    document.querySelector('label[title="Заменить встроенный шаблон"]').classList.add('has-file');
  });

  // Загрузка сертификатов
  const inpCert = document.getElementById('inp-cert');
  const dzCert  = document.getElementById('dz-cert');

  inpCert.addEventListener('change', e => addCerts(Array.from(e.target.files)));

  dzCert.addEventListener('dragover', e => { e.preventDefault(); dzCert.classList.add('drag-over'); });
  dzCert.addEventListener('dragleave', () => dzCert.classList.remove('drag-over'));
  dzCert.addEventListener('drop', e => {
    e.preventDefault();
    dzCert.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => /\.cer$/i.test(f.name));
    addCerts(files);
  });

  // Чекбоксы ЦИТП влияют на доступность кнопки
  document.querySelectorAll('[name="citp"]').forEach(cb => {
    cb.addEventListener('change', checkReady);
  });

  // Кнопка «Очистить всё»
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    state.certFiles = [];
    renderCertList();
    checkReady();
    setStatus('', '');
    const dlBtn = document.getElementById('btn-download');
    if (dlBtn.href?.startsWith('blob:')) URL.revokeObjectURL(dlBtn.href);
    dlBtn.style.display = 'none';
    document.getElementById('email-section').style.display = 'none';
  });

  // Кнопка «Сформировать заявку»
  document.getElementById('btn-run').addEventListener('click', runProcess);

  // Кнопка «Написать письмо» — открывает веб-форму почтового сервиса
  document.getElementById('btn-email').addEventListener('click', () => {
    const svc     = document.getElementById('fld-mail-svc').value;
    const emailTo = document.getElementById('fld-email').value.trim();
    if (!emailTo) { document.getElementById('fld-email').focus(); return; }
    const zipName = document.getElementById('btn-email').dataset.zipName || 'архив';
    const date    = document.getElementById('btn-email').dataset.date    || '';

    const subject = `Заявка на регистрацию в ЦИТП от ${date}`;
    const body    =
      `Добрый день,\n\nВо вложении направляем заявку на регистрацию в ЦИТП.\n` +
      `Файл: ${zipName}\n\n(Прикрепите файл вручную — ограничение браузерного расширения.)`;

    const s = encodeURIComponent(subject);
    const b = encodeURIComponent(body);
    const t = encodeURIComponent(emailTo);

    const urls = {
      yandex:  `https://mail.yandex.ru/compose?to=${t}&subject=${s}&body=${b}`,
      mailru:  `https://e.mail.ru/compose?To=${t}&subject=${s}&body=${b}`,
      gmail:   `https://mail.google.com/mail/?view=cm&to=${t}&su=${s}&body=${b}`,
      outlook: `https://outlook.live.com/owa/?path=/mail/action/compose&to=${t}&subject=${s}&body=${b}`,
    };

    window.open(urls[svc] || urls.yandex, '_blank');
  });

  // Сохранение настроек письма в localStorage
  const savedEmail = localStorage.getItem('citp-email');
  const savedSvc   = localStorage.getItem('citp-mail-svc');
  if (savedEmail) document.getElementById('fld-email').value = savedEmail;
  if (savedSvc)   document.getElementById('fld-mail-svc').value = savedSvc;

  document.getElementById('fld-email').addEventListener('change', e => {
    localStorage.setItem('citp-email', e.target.value.trim());
  });
  document.getElementById('fld-mail-svc').addEventListener('change', e => {
    localStorage.setItem('citp-mail-svc', e.target.value);
  });
}

function addCerts(files) {
  if (!files.length) return;
  // Дедупликация по имени
  for (const f of files) {
    if (!state.certFiles.find(c => c.name === f.name)) state.certFiles.push(f);
  }
  renderCertList();
  checkReady();
}

function renderCertList() {
  const list = document.getElementById('cert-list');
  const dz   = document.getElementById('dz-cert');
  list.innerHTML = '';
  const clearRow = document.getElementById('cert-clear-row');
  if (!state.certFiles.length) { dz.classList.remove('has-file'); clearRow.style.display = 'none'; return; }
  dz.classList.add('has-file');
  clearRow.style.display = '';
  for (const f of state.certFiles) {
    const div = document.createElement('div');
    div.className = 'cert-item';
    div.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    div.appendChild(document.createTextNode(' ' + f.name));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'cert-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Удалить';
    removeBtn.addEventListener('click', e => {
      e.preventDefault();
      state.certFiles = state.certFiles.filter(c => c !== f);
      renderCertList();
      checkReady();
    });
    div.appendChild(removeBtn);
    list.appendChild(div);
  }
}

function checkReady() {
  const citpOk = document.querySelectorAll('[name="citp"]:checked').length > 0;
  const ok = state.certFiles.length > 0 &&
             state.templateFile !== null &&
             state.dbData.length > 0 &&
             citpOk;
  document.getElementById('btn-run').disabled = !ok;
}

function setStatus(msg, type = 'info') {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
  bar.style.display = msg ? '' : 'none';
}

// ════════════════════════════════════════════════════════════

async function runProcess() {
  const btn    = document.getElementById('btn-run');
  const dlBtn  = document.getElementById('btn-download');
  btn.disabled = true;
  btn.classList.add('running');
  dlBtn.style.display = 'none';
  document.getElementById('email-section').style.display = 'none';
  setStatus('Обработка сертификатов…', 'info');

  const selectedSystems = [...document.querySelectorAll('[name="citp"]:checked')].map(cb => cb.value);
  const action = document.getElementById('fld-action').value;

  const optOneFile     = document.getElementById('opt-one-file').checked;
  const optSkipMissing = document.getElementById('opt-skip-missing').checked;
  const optNoRename    = document.getElementById('opt-no-rename').checked;

  try {
    const entries = [];
    let skippedCount = 0;
    const total = state.certFiles.length;

    for (let idx = 0; idx < total; idx++) {
      const cf = state.certFiles[idx];
      setStatus(`Обработка ${idx + 1} / ${total}…`, 'info');
      let info;
      try { info = await parseCert(cf); }
      catch(e) { setStatus(`Ошибка чтения ${cf.name}: ${e.message}`, 'err'); continue; }

      const safe         = info.fio.replace(/[<>:"/\\|?*]/g, '_');
      const certFileName = optNoRename ? cf.name : `${safe} ${info.ownerType} ${info.expiryMMYY}.cer`;
      const subjectEP = info.ownerType === 'ДЛ' ? info.fio : info.cn;
      const baseEntry = {
        cn: info.cn, fio: info.fio, subjectEP,
        ownerType: info.ownerType, expiryMMYY: info.expiryMMYY,
        serial: info.serial, fileName: certFileName,
        originalFile: cf,
      };

      // Все совпадения из базы, отфильтрованные по выбранным системам
      const allMatches = findAllUsers(info.fio);
      const filtered   = allMatches.filter(m => selectedSystems.includes(normalizeSystem(m.system)));

      if (!filtered.length) {
        if (optSkipMissing) { skippedCount++; continue; }
        // Не найден — система из галочек, роль пустая
        entries.push({ ...baseEntry, username: '*** НЕ НАЙДЕН ***', role: '', system: selectedSystems.join(' и ') });
        continue;
      }

      // Группируем по login+role: если одинаковый логин+роль в нескольких системах → объединяем
      const groups = {};
      for (const m of filtered) {
        const key = m.login + '|' + m.role;
        if (!groups[key]) groups[key] = { login: m.login, role: m.role, systems: [] };
        const sys = normalizeSystem(m.system);
        if (!groups[key].systems.includes(sys)) groups[key].systems.push(sys);
      }
      for (const g of Object.values(groups)) {
        entries.push({ ...baseEntry, username: g.login, role: g.role, system: g.systems.join(' и ') });
      }
    }

    if (!entries.length) {
      const msg = optSkipMissing
        ? 'Все сертификаты пропущены — не найдены в базе.'
        : 'Не удалось прочитать ни одного сертификата.';
      setStatus(msg, 'err');
      return;
    }

    const dateStr = new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
    const outZip  = new JSZip();

    if (optOneFile) {
      // Отдельный ZIP на каждый сертификат
      setStatus('Формируем отдельные файлы…', 'info');
      for (const e of entries) {
        const docxBlob = await fillDocxTemplate([e], action);
        const inner    = new JSZip();
        const safeName = (e.fio || e.cn).replace(/[<>:"/\\|?*]/g, '_');
        inner.file(`Заявка_${safeName}.docx`, docxBlob);
        inner.file(e.fileName, await e.originalFile.arrayBuffer());
        const innerBlob = await inner.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        outZip.file(`${safeName}.zip`, innerBlob);
      }
    } else {
      // Один общий DOCX со всеми сертификатами
      setStatus('Формируем DOCX…', 'info');
      const docxBlob = await fillDocxTemplate(entries, action);
      outZip.file(`Заявка_на_регистрацию_${dateStr}.docx`, docxBlob);
      for (const e of entries) {
        outZip.file(e.fileName, await e.originalFile.arrayBuffer());
      }
    }

    const zipBlob = await outZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    if (dlBtn.href?.startsWith('blob:')) URL.revokeObjectURL(dlBtn.href);
    const zipUrl  = URL.createObjectURL(zipBlob);

    const zipFileName = (!optOneFile && entries.length === 1)
      ? entries[0].fileName.replace(/\.cer$/i, '.zip')
      : `Заявка_на_регистрацию_${dateStr}.zip`;
    dlBtn.href     = zipUrl;
    dlBtn.download = zipFileName;
    dlBtn.style.display = '';

    // Показываем блок отправки письма
    const emailBtn = document.getElementById('btn-email');
    emailBtn.dataset.zipName = zipFileName;
    emailBtn.dataset.date    = dateStr;
    document.getElementById('email-section').style.display = '';

    const notFound = entries.filter(e => e.username === '*** НЕ НАЙДЕН ***').length;
    let msg = `Готово: ${entries.length} сертификат(ов)`;
    if (notFound)      msg += `, не найдено в базе: ${notFound}`;
    if (skippedCount)  msg += `, пропущено: ${skippedCount}`;
    setStatus(msg, notFound ? 'info' : 'ok');

  } catch(e) {
    setStatus('Ошибка: ' + e.message, 'err');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.classList.remove('running');
    checkReady();
  }
}
