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



// Функция для извлечения данных из мета-тега и параметра data-filegroup
function extractDocumentInfo() {
    // 1. Извлекаем URL изображения из meta[property="og:image"]
    const metaTag = document.querySelector('meta[property="og:image"]');
    if (!metaTag) {
        console.log('Мета-тег og:image не найден');
        return null;
    }
    const content = metaTag.getAttribute('content');
    if (!content) {
        console.log('Атрибут content пустой');
        return null;
    }
    console.log('Найден content:', content);

    // 2. Извлекаем ключ (папку) между /book_preview/ и следующим /
    const keyMatch = content.match(/\/book_preview\/([^\/]+)\//);
    if (!keyMatch) {
        console.log('Не удалось извлечь documentKey из content:', content);
        return null;
    }
    const documentKey = keyMatch[1].toUpperCase();

    // 3. Извлекаем имя файла (всё после последнего / и до .jpg)
    const fileMatch = content.match(/\/([^\/]+)\.jpg$/);
    if (!fileMatch) {
        console.log('Не удалось извлечь documentNumber из content:', content);
        return null;
    }
    const documentNumber = fileMatch[1];  // например "5079094_doc1_..."

    // 4. Находим элемент с data-filegroup и забираем его значение
    //    Ищем <div id="bookmark-modal-... " data-filegroup="...">
    const bookmarkDiv = document.querySelector('div[id^="bookmark-modal-"][data-filegroup]');
    let fileGroup = null;
    if (bookmarkDiv) {
        fileGroup = bookmarkDiv.getAttribute('data-filegroup');  // например "5079093"
        console.log('Найден data-filegroup:', fileGroup);
    } else {
        console.warn('Элемент с data-filegroup не найден');
    }

    // 5. Возвращаем все три значения
    return {
        documentKey,
        documentNumber,
        fileGroup
    };
}


// Обработка сообщений от popup или background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Получено сообщение в contentScript.js:', message);
    
    if (message.type === 'getDocumentInfo') {
        const result = extractDocumentInfo();
        
        if (result) {
            sendResponse({ status: 'success', data: result });
        } else {
            const observer = new MutationObserver(() => {
                const newResult = extractDocumentInfo();
                if (newResult) {
                    observer.disconnect();
                    sendResponse({ status: 'success', data: newResult });
                }
            });

            observer.observe(document, { childList: true, subtree: true });
            return true;
        }
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