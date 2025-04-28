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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    const img = document.querySelector('img[data-zoom-image], img[ng-src]');
    const rawSrc = img
      ? (img.getAttribute('data-zoom-image') || img.getAttribute('ng-src') || img.src)
      : null;
    const hash = window.location.hash;
    const query = hash.includes('?') ? hash.split('?')[1] : "";
    const params = new URLSearchParams(query);
    const lotId = params.get('id') || "";

    if (rawSrc && lotId) {
      sendResponse({ status: "success", url: rawSrc, id: lotId });
    } else {
      sendResponse({
        status: "fail",
        error: !rawSrc ? "Изображение не найдено" : "lotId не найден"
      });
    }
    return true; // Асинхронный ответ
  }
});