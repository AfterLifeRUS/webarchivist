// background.js
// Динамическая загрузка JSZip
try {
  importScripts('jszip.min.js');
  if (typeof JSZip !== 'function') throw new Error('JSZip не загружен');
} catch (err) {
  console.error('Ошибка загрузки JSZip:', err);
  throw new Error('Не удалось загрузить JSZip');
}

const imageUrls = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of imageUrls.keys()) {
    if (key.startsWith(`${tabId}-`)) imageUrls.delete(key);
  }
});

chrome.webRequest.onCompleted.addListener(
  details => {
    if (!details.url.includes("type=original")) return;
    let page = "last";
    try {
      const u = new URL(details.url);
      page = u.searchParams.get("page") || "last";
      console.log(`Перехвачен URL для вкладки ${details.tabId}, страница ${page}: ${details.url}`);
    } catch (e) {
      console.error(`Ошибка разбора URL: ${e.message}`);
    }
    // Сохраняем URL как для конкретной страницы, так и как запасной
    imageUrls.set(`${details.tabId}-${page}`, details.url);
    imageUrls.set(`${details.tabId}-last`, details.url);
  },
  {
    urls: [
      "https://ya.ru/archive/api/image*",
      "https://yandex.ru/archive/api/image*"
    ]
  }
);

// Функция для получения следующего изображения
function fetchNextImage(tabId, pageNumber, timeoutMs = 10000) {
  console.log(`Ожидаю URL для вкладки ${tabId}, страница ${pageNumber}`);
  
  // Проверяем наличие запасного URL
  const fallbackKey = `${tabId}-last`;
  const fallbackUrl = imageUrls.get(fallbackKey);
  if (fallbackUrl) {
    console.log(`Использую запасной URL: ${fallbackUrl}`);
    return Promise.resolve(fallbackUrl);
  }
  
  // Если запасного URL нет, ждем перехвата
  return new Promise(resolve => {
    let done = false;
    const listener = details => {
      if (done || details.tabId !== tabId || !details.url.includes("type=original")) return;
      try {
        const u = new URL(details.url);
        const urlPage = u.searchParams.get("page") || "last";
        console.log(`Получен URL: ${details.url}, страница ${urlPage}`);
        if (String(urlPage) === String(pageNumber) || urlPage === "last") {
          done = true;
          chrome.webRequest.onCompleted.removeListener(listener);
          resolve(details.url);
        }
      } catch (e) {
        console.error(`Ошибка разбора URL в fetchNextImage: ${e.message}`);
      }
    };
    chrome.webRequest.onCompleted.addListener(
      listener,
      {
        urls: [
          "https://ya.ru/archive/api/image*",
          "https://yandex.ru/archive/api/image*"
        ]
      }
    );
    setTimeout(() => {
      if (!done) {
        done = true;
        chrome.webRequest.onCompleted.removeListener(listener);
        console.warn(`Тайм-аут: URL для вкладки ${tabId}, страница ${pageNumber} не найден`);
        resolve(null);
      }
    }, timeoutMs);
  });
}

async function navigateToPage(tabId, url) {
  console.log(`Открываю вкладку с URL: ${url}`);
  const downloadTab = await chrome.tabs.create({ url, active: false });
  await new Promise(r => {
    const onUpd = (id, info) => {
      if (id === downloadTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpd);
        console.log(`Вкладка ${downloadTab.id} загружена`);
        r();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpd);
  });
  return downloadTab.id;
}

async function downloadPages(tabId, title, startPage, endPage, baseUrl, sendResponse) {
  let downloaded = 0;

  for (const key of imageUrls.keys()) {
    if (key.startsWith(`${tabId}-`)) imageUrls.delete(key);
  }

  for (let page = startPage; page <= endPage; page++) {
    const downloadTabId = await navigateToPage(tabId, `${baseUrl}/${page}`);

    let imageUrl = await fetchNextImage(downloadTabId, page);
    if (!imageUrl) {
      const key = `${downloadTabId}-${page}`;
      imageUrl = imageUrls.get(key) || imageUrls.get(`${downloadTabId}-last`);
    }
    if (!imageUrl) {
      console.warn(`Страница ${page}: URL не найден`);
      chrome.tabs.remove(downloadTabId);
      continue;
    }

    let filename = `${title} - ${page}.jpeg`;
    if (filename.length > 100) filename = filename.substring(0, 97) + "...";

    const downloadId = await new Promise(resolve =>
      chrome.downloads.download(
        { url: imageUrl, filename },
        id => resolve(id)
      )
    );
    if (!downloadId) {
      console.error(`Ошибка скачивания страницы ${page}`);
      chrome.tabs.remove(downloadTabId);
      continue;
    }

    downloaded++;
    chrome.tabs.remove(downloadTabId);
  }

  sendResponse({ status: downloaded > 0 ? "success" : "fail" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getImageUrl") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab || !/^https:\/\/(ya\.ru|yandex\.ru)\/archive/.test(tab.url)) {
        sendResponse({ status: "fail", data: null });
      } else {
        const pn = tab.url.split('/').pop().split('?')[0];
        const key = `${tab.id}-${pn}`;
        const url = imageUrls.get(key) || imageUrls.get(`${tab.id}-last`);
        sendResponse(url
          ? { status: "success", data: { url } }
          : { status: "fail", data: null }
        );
      }
    });
    return true;
  }

  if (message.type === "fetchNextImage") {
    const { pageNumber, tabId } = message.data;
    if (!tabId) {
      console.error("Не указан tabId");
      sendResponse({ status: "fail", data: null });
      return true;
    }
    fetchNextImage(tabId, pageNumber).then(url => {
      sendResponse(url
        ? { status: "success", data: { url } }
        : { status: "fail", data: null }
      );
    });
    return true;
  }

  if (message.type === "fetchImageBlob") {
    const { url } = message.data;
    (async () => {
      try {
        console.log(`fetchImageBlob: Начинаю загрузку: ${url}`);
        const response = await fetch(url);
        console.log(`fetchImageBlob: HTTP статус: ${response.status}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        console.log(`fetchImageBlob: Размер blob: ${blob.size} байт`);
        if (blob.size === 0) throw new Error('Пустое изображение');
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        sendResponse({ status: "success", data: { blob: Array.from(bytes) } });
      } catch (err) {
        console.error(`fetchImageBlob: Ошибка: ${err.message}`);
        sendResponse({ status: "fail", error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "downloadRangeImages") {
    const { title, startPage, endPage, baseUrl } = message.data;
    const start = parseInt(startPage, 10);
    const end = parseInt(endPage, 10);
    if (isNaN(start) || isNaN(end) || end < start) {
      sendResponse({ status: "fail", error: "Некорректный диапазон" });
      return true;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ status: "fail", error: "Нет активной вкладки" });
      } else {
        downloadPages(tab.id, title, start, end, baseUrl, sendResponse);
      }
    });
    return true;
  }

  return false;
});