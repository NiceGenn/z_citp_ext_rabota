// Автоопределение версии браузера:
// — поддерживает chrome.sidePanel → открываем как боковую панель
// — не поддерживает              → открываем как окно у правого края

if (chrome.sidePanel) {
  // Современный Chromium 114+ — нативная боковая панель
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);
} else {
  // Старая версия (Яндекс Браузер и др.) — плавающее окно справа
  chrome.action.onClicked.addListener(() => {
    const W = 460, H = 720;
    chrome.windows.getCurrent(win => {
      chrome.windows.create({
        url:    chrome.runtime.getURL('popup.html'),
        type:   'popup',
        width:  W,
        height: H,
        left:   Math.max(0, win.left + win.width - W - 8),
        top:    Math.max(0, win.top + 60),
      });
    });
  });
}
