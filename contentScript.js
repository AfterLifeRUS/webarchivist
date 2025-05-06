function getTotalPagesPr() {
    const numPagesElement = document.querySelector('#diva-1-num-pages');
    
    if (!numPagesElement) {
        console.log('Элемент с id="diva-1-num-pages" не найден');
        // Проверяем альтернативные элементы
        const altElements = document.querySelectorAll('[id*="num-pages"]');
        if (altElements.length > 0) {
            console.log('Найдены альтернативные элементы с "num-pages" в id:', altElements.length);
            for (const el of altElements) {
                const text = el.textContent.trim();
                const num = parseInt(text, 10);
                if (!isNaN(num) && num > 0) {
                    console.log(`Извлечено количество страниц из ${el.id}: ${num}`);
                    return num;
                }
                console.log(`Содержимое ${el.id}: ${text} (не число)`);
            }
        }
        return null;
    }

    const numPagesText = numPagesElement.textContent.trim();
    console.log('Содержимое элемента diva-1-num-pages:', numPagesText);

    const numPages = parseInt(numPagesText, 10);

    if (isNaN(numPages) || numPages <= 0) {
        console.log('Некорректное количество страниц:', numPagesText);
        return null;
    }

    console.log('Извлеченное количество страниц:', numPages);
    return numPages;
}



// Функция для извлечения URL JSON-а (objectData) из Drupal.settings.diva
function extractDocumentInfo() {
  const scriptTags = Array.from(document.querySelectorAll('script'));
  let settingsText = null;

  for (const s of scriptTags) {
    if (s.textContent.includes('Drupal.settings') && s.textContent.includes('diva')) {
      settingsText = s.textContent;
      break;
    }
  }

  if (!settingsText) {
    console.error('Скрипт с Drupal.settings.diva не найден');
    return null;
  }

  const jsonMatch = settingsText.match(/jQuery\.extend\(Drupal\.settings,\s*(\{[\s\S]*?\})\);/);
  if (!jsonMatch) {
    console.error('Не удалось распарсить объект Drupal.settings');
    return null;
  }

  let settings;
  try {
    settings = JSON.parse(jsonMatch[1]);
  } catch (e) {
    console.error('JSON.parse failed:', e);
    return null;
  }

  const diva = settings.diva;
  const instance = diva && (diva['1'] || diva[1]);
  const objectDataUrl = instance?.options?.objectData || null;
  if (!objectDataUrl) {
    console.error('diva.options.objectData не найден');
    return null;
  }

  // Извлекаем fileGroup из URL: число между двумя GUID-частями
  // Пример URL:
  // https://.../public/2EF2B24D-EBAA-434A-8F39-87C883AD1567/5079093/2EF2B24D-EBAA-434A-8F39-87C883AD1567.json
  const fgMatch = objectDataUrl.match(/\/public\/[^\/]+\/(\d+)\/[^\/]+\.json$/);
  const fileGroup = fgMatch ? fgMatch[1] : null;
  if (!fileGroup) {
    console.warn('Не удалось извлечь fileGroup из objectDataUrl');
  }

  return {
    objectDataUrl,
    fileGroup
  };
}


// Функция для загрузки JSON-а и извлечения метаданных
async function getDocumentMetadata(objectDataUrl) {
  const resp = await fetch(objectDataUrl, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Ошибка загрузки JSON: ${resp.status}`);
  const data = await resp.json();

  const itemTitle = data.item_title;
  const pgs = Array.isArray(data.pgs) ? data.pgs : [];
  const pageCount = pgs.length;
  const files = pgs.map(pg => pg.f);

  return { itemTitle, pageCount, files };
}

// Обработка сообщений от popup или background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Получено сообщение в contentScript.js:', message);

  if (message.type === 'getDocumentInfo') {
    // Пытаемся сразу извлечь URL JSON-а
    const info = extractDocumentInfo();
if (info) {
  // Если есть URL — загружаем JSON и отдаем вместе с метаданными и fileGroup
  getDocumentMetadata(info.objectDataUrl)
    .then(meta => {
      sendResponse({
        status: 'success',
        data: {
          objectDataUrl: info.objectDataUrl,
          fileGroup:     info.fileGroup,
          itemTitle:     meta.itemTitle,
          pageCount:     meta.pageCount,
          files:         meta.files
        }
      });
    })
    .catch(err => {
      console.error('Ошибка при getDocumentMetadata:', err);
      sendResponse({ status: 'error', error: err.message });
    });
} else {
      // Если скрипт ещё не вставлен — следим за DOM
      const observer = new MutationObserver(() => {
        const newInfo = extractDocumentInfo();
        if (newInfo) {
          observer.disconnect();
          getDocumentMetadata(newInfo.objectDataUrl)
            .then(meta => {
              sendResponse({
                status: 'success',
                data: {
                  objectDataUrl: newInfo.objectDataUrl,
                  itemTitle:   meta.itemTitle,
                  pageCount:   meta.pageCount,
                  files:       meta.files
                }
              });
            })
            .catch(err => {
              console.error('Ошибка при getDocumentMetadata:', err);
              sendResponse({ status: 'error', error: err.message });
            });
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    }
    // Говорим Chrome, что ответ будет асинхронным
    return true;

  } else if (message.type === 'getTotalPagesPr') {
    const totalPages = getTotalPagesPr();
    if (totalPages !== null) {
      sendResponse({ status: 'success', data: totalPages });
    } else {
      sendResponse({ status: 'error', error: 'Не удалось извлечь количество страниц' });
    }
  }
});

// Функция для извлечения заголовка
function getTitle() {
  const rawTitle = document.title.split(" — ")[0]?.trim() || document.title.trim();
  const invalidChars = /[\\\/:*?"<>|]/g;
  return rawTitle.replace(invalidChars, '_');
}

// Функция для извлечения номера страницы
function getPageNumber() {
  const url = window.location.href;
  const urlParts = url.split('/');
  const pageNumber = urlParts[urlParts.length - 1];
  return !isNaN(pageNumber) && isFinite(pageNumber) ? pageNumber : "unknown";
}

// Функция для извлечения общего количества страниц
function getTotalPages() {
  const paginationElement = document.querySelector('.ShortPagination_ShortPagination__08e_C');
  if (!paginationElement) return "unknown";
  const parts = paginationElement.textContent.split('/');
  return parts.length > 1 ? parts[1].trim() : "unknown";
}

// Функция для извлечения базового URL
function getBaseUrl() {
  const urlParts = window.location.href.split('/');
  urlParts.pop(); // Убираем номер страницы
  return urlParts.join('/');
}

// Функция для ожидания элементов на странице
const waitForElements = (selector, timeout = 5000) => {
  console.log(`Ожидаю элементы по селектору: ${selector}`);
  return new Promise((resolve) => {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.log(`Найдено элементов сразу: ${elements.length} по селектору ${selector}`);
      return resolve(elements);
    }

    const observer = new MutationObserver(() => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`Найдено элементов после ожидания: ${elements.length} по селектору ${selector}`);
        observer.disconnect();
        resolve(elements);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      console.warn(`Тайм-аут: Элементы не найдены: ${selector}`);
      resolve([]);
    }, timeout);
  });
};

// Функция для извлечения URL-адресов изображений лота
const extractImageUrls = async () => {
  // Список селекторов для поиска изображений (приоритет у успешного селектора)
  const selectors = [
    'img[ng-src*="/muzfo-imaginator/rest/images/"]', // Успешный селектор на первом месте
    'tr td[ng-repeat="image in collectionItem.images"] img[ng-src*="/muzfo-imaginator/rest/images/original/"]',
    'img[src*="/muzfo-imaginator/rest/images/"]',
    '.collection-item img, .lot-details img, [id*="collection"] img'
  ];

  let imageElements = [];
  for (const selector of selectors) {
    imageElements = await waitForElements(selector);
    if (imageElements.length > 0) {
      console.log(`Использован селектор: ${selector}`);
      break;
    }
  }

  if (imageElements.length === 0) {
    throw new Error("Не удалось найти изображения лота на странице.");
  }

  // Извлекаем URL-адреса и проверяем на дубли
  const seenOriginalNames = new Set();
  const imageUrls = [];

  Array.from(imageElements).forEach((element, index) => {
    let imageUrl = element.getAttribute('ng-src') || element.getAttribute('src');
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = 'https://goskatalog.ru' + imageUrl;
    }

    if (!imageUrl || !imageUrl.includes('/muzfo-imaginator/rest/images/')) {
      return;
    }

    // Извлекаем originalName из URL
    const urlParams = new URLSearchParams(new URL(imageUrl).search);
    const originalName = urlParams.get('originalName') || imageUrl;

    if (seenOriginalNames.has(originalName)) {
      console.log(`Дубликат изображения ${index + 1}: ${imageUrl} (originalName: ${originalName})`);
      return;
    }

    seenOriginalNames.add(originalName);
    imageUrls.push(imageUrl);
    console.log(`Извлечённый URL изображения ${imageUrls.length}: ${imageUrl} (originalName: ${originalName})`);
  });

  console.log(`Всего извлечено уникальных изображений: ${imageUrls.length}`, imageUrls);

  if (imageUrls.length === 0) {
    throw new Error("Извлечены пустые или некорректные URL-адреса изображений.");
  }

  return imageUrls;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Получено сообщение в contentScript:", message);

  if (message.type === "getPageInfo") {
    sendResponse({
      data: {
        title: getTitle(),
        pageNumber: getPageNumber(),
        totalPages: getTotalPages()
      }
    });
  } else if (message.type === "getAllPageInfo") {
    sendResponse({
      data: {
        title: getTitle(),
        totalPages: getTotalPages(),
        baseUrl: getBaseUrl()
      }
    });
  } else if (message.type === "getLotInfo") {
    extractImageUrls()
      .then(imageUrls => {
        sendResponse({
          data: { imageUrls }
        });
      })
      .catch(error => {
        console.error("Ошибка извлечения изображений:", error);
        sendResponse({
          data: null,
          error: error.message
        });
      });
    return true; // Указываем, что ответ асинхронный
  }
});