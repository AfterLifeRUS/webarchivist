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
const waitForElements = (selector, timeout = 10000) => {
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
  // Список селекторов для поиска изображений
  const selectors = [
    'tr td[ng-repeat="image in collectionItem.images"] img[ng-src*="/muzfo-imaginator/rest/images/original/"]', // Оригинальный селектор
    'img[ng-src*="/muzfo-imaginator/rest/images/"]', // Более общий селектор с ng-src
    'img[src*="/muzfo-imaginator/rest/images/"]', // Селектор с src
    '.collection-item img, .lot-details img, [id*="collection"] img' // Общий селектор для контейнеров лота
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

  // Извлекаем URL-адреса
  const imageUrls = Array.from(imageElements)
    .map((element, index) => {
      let imageUrl = element.getAttribute('ng-src') || element.getAttribute('src');
      if (imageUrl && !imageUrl.startsWith('http')) {
        // Если URL относительный, добавляем домен
        imageUrl = 'https://goskatalog.ru' + imageUrl;
      }
      console.log(`Извлечённый URL изображения ${index + 1}: ${imageUrl}`);
      return imageUrl;
    })
    .filter(url => url && typeof url === 'string' && url.includes('/muzfo-imaginator/rest/images/')); // Фильтруем только нужные URL

  console.log(`Всего извлечено изображений: ${imageUrls.length}`, imageUrls);

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