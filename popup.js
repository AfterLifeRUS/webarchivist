/**
 * Обрезает имя файла, если оно превышает максимальную длину.
 * @param {string} filename - Исходное имя файла.
 * @param {number} [maxLength=100] - Максимальная допустимая длина.
 * @returns {string} - Обрезанное или исходное имя файла.
 */
function truncateFilename(filename, maxLength = 100) {
  // Уменьшаем maxLength на 4 для учета расширения и "..."
  const maxBaseLength = maxLength - 4;
  if (filename.length > maxLength) {
    const extensionMatch = filename.match(/\.[^.]+$/);
    const extension = extensionMatch ? extensionMatch[0] : '';
    const baseName = filename.substring(0, filename.length - extension.length);
    if (baseName.length > maxBaseLength) {
      return baseName.substring(0, maxBaseLength - 3) + "..." + extension;
    }
  }
  return filename;
}

/**
 * Получает текущую активную вкладку.
 * @returns {Promise<chrome.tabs.Tab>} - Промис, который разрешается с объектом активной вкладки.
 * @throws {Error} - Если активная вкладка не найдена или произошла ошибка API.
 */
async function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Ошибка при запросе вкладки: ${chrome.runtime.lastError.message}`));
      } else if (!tabs || tabs.length === 0 || !tabs[0]) {
        reject(new Error("Активная вкладка не найдена"));
      } else {
        resolve(tabs[0]);
      }
    });
  });
}

/**
 * Обертка для chrome.tabs.sendMessage, возвращающая Promise.
 * @param {number} tabId - ID вкладки для отправки сообщения.
 * @param {any} message - Отправляемое сообщение.
 * @returns {Promise<any>} - Промис, разрешающийся с ответом от content script.
 * @throws {Error} - Если произошла ошибка во время отправки или получения ответа.
 */
async function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Ошибка отправки/получения сообщения: ${chrome.runtime.lastError.message}`));
      } else if (!response) {
        // Иногда ответ может быть undefined без ошибки, обрабатываем как возможную проблему
        reject(new Error("Получен пустой ответ от content script."));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Обертка для chrome.downloads.download, возвращающая Promise.
 * @param {chrome.downloads.DownloadOptions} options - Параметры загрузки.
 * @returns {Promise<number|undefined>} - Промис, разрешающийся с ID загрузки или undefined в случае ошибки.
 */
async function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Ошибка скачивания: ${chrome.runtime.lastError.message}`));
      } else if (downloadId === undefined) {
        // Ошибка, если API не вернуло ID (но без lastError)
        reject(new Error("API скачивания не вернуло ID загрузки."));
      } else {
        resolve(downloadId);
      }
    });
  });
}

/**
 * Извлекает ID лота из URL страницы Госкаталог.рф.
 * @param {string} url - URL страницы.
 * @returns {string|null} - ID лота или null, если ID не найден.
 */
function extractLotIdFromUrl(url) {
  try {
    console.log(`Извлечение ID лота из URL: ${url}`);
    const urlObj = new URL(url);
    const hash = urlObj.hash || '';
    console.log(`Хэш-часть URL: ${hash}`);

    // Ожидаемый формат: #/collections?id=12085455
    const paramsPart = hash.split('?')[1] || '';
    console.log(`Параметры хэша: ${paramsPart}`);

    const hashParams = new URLSearchParams(paramsPart);
    const lotId = hashParams.get('id');
    console.log(`Извлечённый ID лота: ${lotId}`);

    if (!lotId) {
      console.warn(`ID лота не найден в URL: ${url}`);
      return null;
    }

    return lotId;
  } catch (error) {
    console.error(`Ошибка извлечения ID лота из URL ${url}:`, error);
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // --- Получение элементов DOM ---
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadLotBtn = document.getElementById("downloadLotBtn");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const downloadRangeBtn = document.getElementById("downloadRangeBtn");
  const downloadPageBtn = document.getElementById("downloadPageBtn");
  const startInput = document.getElementById("startPage");
  const endInput = document.getElementById("endPage");
  const zipCheckbox = document.getElementById("zipMode");
  const messageList = document.getElementById("messageList");
  const header = document.getElementById("popupHeader");
  const rangeInputContainer = document.querySelector('.range-input'); // Контейнер для полей диапазона

  // --- Элементы управления для Яндекс.Архива ---
  const YAControls = [
    downloadBtn, downloadAllBtn, downloadRangeBtn,
    startInput, endInput, zipCheckbox?.parentElement, rangeInputContainer
  ].filter(Boolean); // Фильтруем null/undefined на случай отсутствия элементов

  // --- Проверка наличия ключевых элементов ---
  // Проверяем только те, что *всегда* должны быть
  if (!messageList || !header || !downloadLotBtn) {
    console.error("Не найдены базовые элементы popup:", { messageList, header, downloadLotBtn });
    // Можно показать сообщение об ошибке пользователю
    if (header) header.textContent = "Ошибка инициализации";
    return;
  }
  // Проверяем элементы Яндекс.Архива отдельно, если они нам нужны
  const yaElementsFound = YAControls.length >= 6; // Примерная проверка
  if (!yaElementsFound) {
    console.warn("Не найдены все элементы управления для Яндекс.Архива.");
    // Не прерываем выполнение, т.к. может быть открыт Госкаталог
  }

  // --- Утилиты для UI ---
  /** Устанавливает текст статуса */
function setStatus(text, isError = false) {
  let statusLi = document.getElementById('status');
  if (!statusLi) {
    messageList.innerHTML = ''; // Очищаем предыдущие сообщения
    statusLi = document.createElement('li');
    statusLi.id = 'status';
    messageList.appendChild(statusLi);
  }

  // Проверяем, нужно ли вставить список сайтов
  if (text === 'SUPPORTED_SITES') {
    const sites = [
      { url: "https://yandex.ru/archive/", name: "yandex.ru/archive" },
      { url: "https://goskatalog.ru/portal/", name: "goskatalog.ru/portal" },
      { url: "https://www.prlib.ru/", name: "prlib.ru" }
    ];
    const links = sites.map(site =>
      `<li><a href="${site.url}" target="_blank">${site.name}</a></li>`
    ).join('');
    statusLi.innerHTML = `<span style="color: ${isError ? 'red' : 'inherit'}">Откройте поддерживаемый сайт:</span><ul>${links}</ul>`;
  } else {
    statusLi.textContent = text;
    statusLi.style.color = isError ? 'red' : '';
  }

  console.log(`Status: ${text}${isError ? ' (ERROR)' : ''}`);
}

  /** Очищает сообщение статуса */
  function clearStatus() {
    const statusLi = document.getElementById('status');
    if (statusLi) statusLi.remove();
  }

  /** Включает/выключает элементы управления */
  function setControlsEnabled(enabled) {
    // Блокируем все потенциально активные контролы
    const allControls = [...YAControls, downloadLotBtn].filter(el => el && typeof el.disabled === 'boolean');
    allControls.forEach(el => { el.disabled = !enabled; });
    console.log(`Controls ${enabled ? 'enabled' : 'disabled'}`);
  }

  // --- Инициализация расширения ---
  async function initializePopup() {
    clearStatus();
    setControlsEnabled(false); // Выключаем контролы на время инициализации
    setStatus("Инициализация...");

    try {
      const tab = await getActiveTab();
      console.log("Активная вкладка:", tab);

      const url = tab.url || "";
      const isYandexArchive = /^https:\/\/(ya\.ru|yandex\.ru)\/archive/.test(url);
      const isGoskatalog = /^https:\/\/goskatalog\.ru\/portal/.test(url);
	  const isPrlib = /^https:\/\/www\.prlib\.ru\/item/.test(url);
	  
      console.log("Яндекс.Архив:", isYandexArchive);
      console.log("Госкаталог:", isGoskatalog);
      console.log("Президентская библиотека:", isPrlib);	  

      // 1) Устанавливаем заголовок и видимость контролов
      if (isYandexArchive) {
        header.textContent = "Яндекс.Архив";
        YAControls.forEach(el => { el.style.display = ""; }); // Показываем контролы ЯА
		zipMode.style.display = "";
        downloadLotBtn.style.display = "none"; // Скрываем кнопку ГК
        if (!yaElementsFound) {
          setStatus("Ошибка: Не все элементы для Я.Архива найдены!", true);
          return; // Прерываем, если элементы ЯА нужны, но не найдены
        }
        // Запрашиваем инфо для Я.Архива, чтобы узнать кол-во страниц
        try {
          const allInfo = await requestAllInfo();
          if (allInfo.totalPages === "unknown") {
            if (downloadAllBtn) downloadAllBtn.disabled = true;
            setStatus("Общее количество страниц неизвестно.");
          } else {
            setStatus(`Документ: ${allInfo.totalPages} стр.`); // Показываем кол-во стр
          }
        } catch (infoError) {
          setStatus("Не удалось получить инфо о документе.", true);
          // Не блокируем всё, возможно скачивание текущей стр. сработает
        }
      } else if (isGoskatalog) {
        header.textContent = "Госкаталог.рф";
        downloadLotBtn.style.display = ""; // Показываем кнопку ГК
        setStatus("Готово к скачиванию лота.");
            } else 
				if (isPrlib) {
                header.textContent = "Президентская библиотека";
                if (downloadPageBtn) {
                    downloadPageBtn.style.display = "";
                    downloadPageBtn.disabled = true;
                } else {
                    console.error("Кнопка downloadPageBtn не найдена");
                }
				
				rangeInputContainer.style.display = "";
				downloadRangeBtn.display = "none";
				zipMode.display = "none";
				document.querySelector('label[for="zipMode"]').style.display = "none";
				
				
				
                setStatus("Получение данных документа...");

                try {
                    if (tab.status !== 'complete') {
                        await new Promise((resolve) => {
                            const listener = (tabId, changeInfo) => {
                                if (tabId === tab.id && changeInfo.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(listener);
                                    resolve();
                                }
                            };
                            chrome.tabs.onUpdated.addListener(listener);
                        });
                    }

                    const docResponse = await sendMessageToTab(tab.id, { type: "getDocumentInfo" });
                    const totalPages = await fetchTotalPages(tab.id);

                    if (docResponse.status === 'success' && docResponse.data) {
                        const { documentKey, documentNumber } = docResponse.data;
                        console.log('Извлеченный documentKey:', documentKey);
                        let statusMessage = `Ключ документа: ${documentKey}\nНомер документа: ${documentNumber}`;
                        if (totalPages !== null) {
                            statusMessage += `\nКоличество страниц: ${totalPages}`;
                        } else {
                            statusMessage += `\nКоличество страниц: неизвестно (проверьте, загрузилась ли страница полностью)`;
                        }
                        setStatus(statusMessage);
                        if (downloadPageBtn) downloadPageBtn.disabled = false;
                    } else {
                        setStatus("Не удалось извлечь информацию о документе.", true);
                    }
                } catch (error) {
                    console.error("Ошибка получения данных документа:", error);
                    setStatus(`Ошибка получения данных документа: ${error.message}`, true);
                }
            } else {
        header.textContent = "Неподдерживаемый сайт";
        setStatus('SUPPORTED_SITES', true);
        return; // Больше ничего не делаем
      }

      // 2) Добавляем обработчики событий
		setupEventListeners(isYandexArchive, isGoskatalog, isPrlib);

      setControlsEnabled(true); // Включаем контролы после инициализации
      // Статус уже установлен выше в зависимости от сайта
    } catch (error) {
      console.error("Ошибка инициализации popup:", error);
      header.textContent = "Ошибка инициализации";
      setStatus(error.message || "Неизвестная ошибка.", true);
      setControlsEnabled(false); // Оставляем контролы выключенными при ошибке
    }
  }

  // --- Установка обработчиков событий ---
  function setupEventListeners(isYandexArchive, isGoskatalog, isPrlib) {
    if (isYandexArchive) {
      if (downloadBtn) downloadBtn.addEventListener("click", handleDownloadCurrent);
      if (downloadAllBtn) downloadAllBtn.addEventListener("click", handleDownloadAll);
      if (downloadRangeBtn) downloadRangeBtn.addEventListener("click", handleDownloadRange);
    }

    if (isGoskatalog) {
      if (downloadLotBtn) downloadLotBtn.addEventListener("click", handleDownloadLot);
    }
	
	        if (isPrlib) {
            if (downloadPageBtn) downloadPageBtn.addEventListener("click", handleDownloadPage);
        }
  }


  // --- Функции запроса данных ---
  async function requestPageInfo() {
    setStatus("Получение данных страницы...");
    setControlsEnabled(false);
    try {
      const tab = await getActiveTab();
      const res = await sendMessageToTab(tab.id, { type: "getPageInfo" });
      if (!res || !res.data) {
        throw new Error("Не удалось получить данные страницы (пустой ответ).");
      }
      setStatus("Данные страницы получены.");
      setControlsEnabled(true);
      return res.data; // { title, pageNumber, totalPages }
    } catch (error) {
      console.error("Ошибка requestPageInfo:", error);
      setStatus(`Ошибка: ${error.message}`, true);
      setControlsEnabled(true);
      throw error; // Передаем ошибку дальше
    }
  }

  async function requestAllInfo() {
    setStatus("Получение данных документа...");
    setControlsEnabled(false);
    try {
      const tab = await getActiveTab();
      const res = await sendMessageToTab(tab.id, { type: "getAllPageInfo" });
      if (!res || !res.data) {
        throw new Error("Не удалось получить данные документа (пустой ответ).");
      }
      setStatus("Данные документа получены.");
      setControlsEnabled(true);
      return res.data; // { title, totalPages, baseUrl }
    } catch (error) {
      console.error("Ошибка requestAllInfo:", error);
      setStatus(`Ошибка: ${error.message}`, true);
      setControlsEnabled(true);
      throw error;
    }
  }




  // --- Логика скачивания ---

  /** Обработчик скачивания лота (Госкаталог) */
  async function handleDownloadLot() {
    clearStatus();
    setControlsEnabled(false);
    setStatus("Получаем данные лота…");

    try {
      const tab = await getActiveTab();
      console.log("Активная вкладка в handleDownloadLot:", tab);

      // 1) Извлекаем ID лота из URL
      const lotId = extractLotIdFromUrl(tab.url);
      if (!lotId) {
        throw new Error("Не удалось извлечь ID лота из URL.");
      }
      console.log(`Извлечённый ID лота: ${lotId}`);

      // 2) Запрашиваем данные лота у contentScript
      const res = await sendMessageToTab(tab.id, { type: "getLotInfo" });
      console.log("Ответ от contentScript:", res);

      if (!res || !res.data) {
        throw new Error("Не удалось получить данные лота (пустой ответ).");
      }

      const { imageUrls } = res.data;
      if (!imageUrls || imageUrls.length === 0) {
        throw new Error("Не удалось получить URL-адреса изображений.");
      }

      setStatus(`Найдено изображений: ${imageUrls.length}. Скачиваем…`);

      // 3) Скачиваем каждое изображение
      let downloadedCount = 0;
      let failedCount = 0;

      for (let index = 0; index < imageUrls.length; index++) {
        const imageUrl = imageUrls[index];
        // Формируем имя файла: {lotId}_{index + 1}.jpg
        const filename = truncateFilename(`${lotId}_${index + 1}.jpg`);

        try {
          // Строим полный URL, если он относительный
          const fullImageUrl = new URL(imageUrl, tab.url).toString();
          console.log(`Скачиваю изображение ${index + 1}: ${fullImageUrl} как ${filename}`);

          // Используем downloadFile для скачивания
          const downloadId = await downloadFile({ url: fullImageUrl, filename });

          if (downloadId) {
            downloadedCount++;
            setStatus(`Скачано ${downloadedCount} из ${imageUrls.length} изображений.`);
          } else {
            throw new Error("Скачивание не вернуло ID.");
          }
        } catch (imageError) {
          console.error(`Ошибка скачивания изображения ${index + 1}:`, imageError);
          failedCount++;
          setStatus(`Ошибка при скачивании изображения ${index + 1}: ${imageError.message}`, true);
        }
      }

      // 4) Итоговый статус
      if (downloadedCount === imageUrls.length) {
        setStatus("Все изображения лота успешно скачаны!");
        showNotification("Скачивание лота", "Все изображения успешно скачаны!");
      } else {
        setStatus(`Скачано ${downloadedCount} из ${imageUrls.length} изображений. Ошибок: ${failedCount}.`, failedCount > 0);
      }
    } catch (error) {
      console.error("Ошибка скачивания лота:", error);
      setStatus(`Ошибка: ${error.message}`, true);
    } finally {
      setControlsEnabled(true);
    }
  }

  /** Обработчик скачивания текущей страницы (Яндекс.Архив) */
  async function handleDownloadCurrent() {
    clearStatus();
    setControlsEnabled(false);

    try {
      // Шаг 1: Получаем информацию о странице (title, pageNumber, totalPages)
      const pageInfo = await requestPageInfo();
      setStatus("Поиск изображения...");

      // Шаг 2: Запрашиваем URL изображения
      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "getImageUrl" }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(`Ошибка runtime.sendMessage: ${chrome.runtime.lastError.message}`));
          } else if (!response) {
            reject(new Error("Получен пустой ответ от обработчика getImageUrl."));
          } else if (response.status === 'success' && response.data?.url) {
            resolve(response);
          } else {
            reject(new Error(response.error || "Обработчик getImageUrl не вернул успешный статус или URL."));
          }
        });
      });

      // Шаг 3: Обрабатываем полученный URL и скачиваем файл
      const url = resp.data.url;
      let baseFn = `${pageInfo.title} - ${pageInfo.pageNumber}`;
      if (pageInfo.totalPages !== 'unknown') {
        baseFn += ` из ${pageInfo.totalPages}`;
      }
      const filename = truncateFilename(baseFn + ".jpeg");

      setStatus("Скачиваю...");
      const downloadId = await downloadFile({ url, filename });

      if (downloadId) {
        setStatus("Готово.");
        showNotification("Скачивание", "Текущая страница скачана успешно!");
      } else {
        throw new Error("Скачивание не удалось (нет ID).");
      }
    } catch (error) {
      console.error("Ошибка скачивания текущей страницы:", error);
      setStatus(`Ошибка: ${error.message}`, true);
    } finally {
      setControlsEnabled(true);
    }
  }

  /** Обработчик скачивания всего документа (Яндекс.Архив) */
  async function handleDownloadAll() {
    clearStatus();
    setControlsEnabled(false);
    setStatus("Подготовка ZIP всего документа…");

    try {
      // Получаем инфо о документе
      const { title, totalPages, baseUrl } = await requestAllInfo();
      const total = parseInt(totalPages, 10);
      if (totalPages === "unknown" || isNaN(total)) {
        throw new Error("Общее количество страниц неизвестно или некорректно.");
      }

      // Принудительно используем ZIP для всего диапазона
      const startPage = 1;
      const endPage = total;
      await zipDownload({ title, startPage, endPage, baseUrl });

      // При успешном завершении zipDownload сам выведет статус и уведомление
    } catch (error) {
      console.error("Ошибка при скачивании всего документа:", error);
      setStatus(`Ошибка: ${error.message}`, true);
    } finally {
      setControlsEnabled(true);
    }
  }

  /** Обработчик скачивания диапазона (Яндекс.Архив) */
  async function handleDownloadRange() {
    console.log("Нажата кнопка 'Скачать диапазон'");
    clearStatus();
    setControlsEnabled(false);

    const startValue = startInput?.value;
    const endValue = endInput?.value;

    const startPage = parseInt(startValue, 10);
    const endPage = parseInt(endValue, 10);

    // Проверка ввода
    if (isNaN(startPage) || isNaN(endPage) || startPage < 1 || endPage < startPage) {
      setStatus("Ошибка: Некорректный диапазон страниц.", true);
      setControlsEnabled(true);
      return;
    }

    try {
      const allInfo = await requestAllInfo(); // { title, totalPages, baseUrl }
      const total = parseInt(allInfo.totalPages, 10);

      if (allInfo.totalPages !== "unknown" && !isNaN(total) && endPage > total) {
        setStatus(`Ошибка: Конечная страница (${endPage}) больше общего числа страниц (${total}).`, true);
        setControlsEnabled(true);
        return;
      }

      await processDownloadRange(startPage, endPage, allInfo);
    } catch (error) {
      console.error("Ошибка подготовки скачивания диапазона:", error);
      setStatus(`Ошибка: ${error.message}`, true);
      setControlsEnabled(true);
    }
  }

  
    // --- Получение данных из info.json ---
	async function fetchImageInfo(documentKey, documentNumber, documentFileGroup) {
        console.log('Формирование ссылки info.json для documentKey:', documentKey);
        const infoUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?IIIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}.tiff/info.json`;
        
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'fetchJson', url: infoUrl }, (response) => {
                if (response.status !== 'success') {
                    return reject(new Error(`Ошибка загрузки info.json: ${response.error || 'Неизвестная ошибка'}`));
                }
                const { width, height } = response.data;
                if (!width || !height) {
                    return reject(new Error('Некорректные данные в info.json: width или height отсутствуют'));
                }
                console.log('Получены размеры изображения:', { width, height });
                resolve({ width, height });
            });
        });
    }


    // --- Проверка доступности JTL уровня ---
    async function findMaxJtlLevel(documentKey, documentNumber, documentFileGroup) {
        const baseUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?FIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}.tiff&JTL=`;
        
        for (let level = 10; level >= 1; level--) {
            const testUrl = `${baseUrl}${level},0`;
            console.log(`Проверка JTL уровня ${level}: ${testUrl}`);
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ type: 'fetchTile', url: testUrl }, (response) => {
                        if (response.status === 'success' && response.contentType && response.contentType.startsWith('image/')) {
                            resolve(response);
                        } else {
                            reject(new Error(response.error || `JTL уровень ${level} не возвращает изображение`));
                        }
                    });
                });
                console.log(`JTL уровень ${level} возвращает изображение (Content-Type: ${response.contentType})`);
                return level;
            } catch (error) {
                console.log(`JTL уровень ${level} недоступен: ${error.message}`);
            }
        }
        
        throw new Error('Не найден доступный JTL уровень, возвращающий изображение');
    }

async function fetchTotalPages(tabId) {
    try {
        const response = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { type: "getTotalPagesPr" }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
        if (response.status === 'success') {
            console.log('Количество страниц:', response.data);
            return response.data;
        } else {
            throw new Error(response.error || 'Не удалось получить количество страниц');
        }
    } catch (error) {
        console.error('Ошибка получения количества страниц:', error);
        return null;
    }
}	
  
  
     // --- Функция загрузки изображения из тайлов ---
    async function downloadTiledImage(documentKey, documentNumber, documentFileGroup) {
        console.log('Используемый documentKey:', documentKey);
        console.log('Используемый documentNumber:', documentNumber);
        // Получаем размеры изображения из info.json
        setStatus("Получение размеров изображения...");
        const { width, height } = await fetchImageInfo(documentKey, documentNumber, documentFileGroup);
		
		// Находим наибольший доступный JTL уровень
        setStatus("Поиск оптимального JTL уровня...");
        const jtlLevel = await findMaxJtlLevel(documentKey, documentNumber, documentFileGroup);
        console.log(`Используется JTL уровень: ${jtlLevel}`);

        // Предполагаемый размер тайла (можно уточнить, если известен)
        const tileSize = 256; // Стандартный размер тайла для IIIF
        const cols = Math.ceil(width / tileSize);
        const rows = Math.ceil(height / tileSize);
        const totalTiles = cols * rows;

        console.log(`Вычисленные параметры: cols=${cols}, rows=${rows}, totalTiles=${totalTiles}`);

        const baseUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?FIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}.tiff&JTL=${jtlLevel},`;

        return new Promise((resolve, reject) => {
            setStatus("Загрузка первого тайла для определения размеров...");
            
            chrome.runtime.sendMessage({ type: 'fetchTile', url: baseUrl + '0' }, (response) => {
                if (response.status !== 'success') {
                    return reject(new Error("Ошибка загрузки первого тайла"));
                }

                const firstTile = new Image();
                firstTile.onload = function() {
                    const tileWidth = firstTile.width;
                    const tileHeight = firstTile.height;

                    setStatus(`Создание canvas (${width}x${height})...`);
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');

                    let loadedTiles = 0;

                    for (let i = 0; i < totalTiles; i++) {
                        chrome.runtime.sendMessage({ type: 'fetchTile', url: baseUrl + i }, (tileResponse) => {
                            if (tileResponse.status !== 'success') {
                                return reject(new Error(`Ошибка загрузки тайла ${i}`));
                            }

                            const tileImg = new Image();
                            tileImg.onload = function() {
                                const row = Math.floor(i / cols);
                                const col = i % cols;
                                ctx.drawImage(tileImg, col * tileWidth, row * tileHeight);
                                loadedTiles++;
                                setStatus(`Загружено ${loadedTiles}/${totalTiles} тайлов...`);

                                if (loadedTiles === totalTiles) {
                                    setStatus("Сохранение изображения...");
                                    const dataUrl = canvas.toDataURL('image/jpeg');
                                    const filename = truncateFilename(`${documentKey}_${documentNumber}.jpg`);
                                    
                                    chrome.downloads.download({
                                        url: dataUrl,
                                        filename: filename
                                    }, (downloadId) => {
                                        if (chrome.runtime.lastError) {
                                            reject(new Error(`Ошибка скачивания: ${chrome.runtime.lastError.message}`));
                                        } else if (downloadId) {
                                            setStatus("Изображение успешно скачано!");
                                            resolve(downloadId);
                                        } else {
                                            reject(new Error("Скачивание не удалось."));
                                        }
                                    });
                                }
                            };
                            tileImg.onerror = function() {
                                reject(new Error(`Ошибка загрузки тайла ${i}`));
                            };
                            tileImg.src = tileResponse.data;
                        });
                    }
                };
                firstTile.onerror = function() {
                    reject(new Error("Ошибка загрузки первого тайла"));
                };
                firstTile.src = response.data;
            });
        });
    }
  
    // --- Обработчик скачивания страницы ---
async function handleDownloadPage() {
    clearStatus();
    if (downloadPageBtn) downloadPageBtn.disabled = true;
    setStatus("Получение данных документа...");

    try {
        // Получаем активную вкладку и информацию о документе
        const tab = await getActiveTab();
        const response = await sendMessageToTab(tab.id, { type: "getDocumentInfo" });

        if (response.status !== 'success' || !response.data) {
            throw new Error("Не удалось получить данные документа.");
        }

        const documentKey = response.data.documentKey;
        const documentNumberStr = response.data.documentNumber;
        const documentFileGroup = response.data.fileGroup;		
        // documentNumberStr, например, "5079094_doc1_92E47A28-07FB-4D3D-BFBC-3C50E07A3330"

        // Разделяем на числовую часть и суффикс
        const parts = documentNumberStr.match(/^(\d+)(.*)$/);
        if (!parts) {
            throw new Error(`Неверный формат documentNumber: ${documentNumberStr}`);
        }
        const baseNumberStr = parts[1];       // "5079094"
        const suffix        = parts[2];       // "_doc1_92E47A28-07FB-4D3D-BFBC-3C50E07A3330"
        const baseNumber    = parseInt(baseNumberStr, 10);
        if (isNaN(baseNumber)) {
            throw new Error(`Неверный номер документа: ${baseNumberStr}`);
        }

        setStatus(
            `Ключ документа: ${documentKey}\n` +
            `Исходный идентификатор: ${documentNumberStr}`
        );

        // Читаем диапазон страниц из полей ввода
        const startInput = document.querySelector('#startPage');
        const endInput   = document.querySelector('#endPage');
        const startPage = startInput ? parseInt(startInput.value, 10) : 1;
        const endPage   = endInput   ? parseInt(endInput.value,   10) : startPage;

        if (
            isNaN(startPage) || isNaN(endPage) ||
            startPage < 1 || endPage < startPage
        ) {
            throw new Error("Неверный диапазон страниц.");
        }

        setStatus(`Скачиваем страницы ${startPage}–${endPage}...`);

        // Итеративно скачиваем каждую страницу
        for (let page = startPage; page <= endPage; page++) {
            const computedNumber    = baseNumber + (page - 1);
            const docNumWithSuffix  = `${computedNumber}${suffix}`;
            setStatus(`Скачивание страницы ${page} (номер ${docNumWithSuffix})...`);
            await downloadTiledImage(documentKey, docNumWithSuffix, documentFileGroup);
        }

        showNotification(
            "Скачивание завершено",
            `Страницы ${startPage}–${endPage} успешно скачаны!`
        );
    } catch (error) {
        console.error("Ошибка скачивания изображения:", error);
        setStatus(`Ошибка: ${error.message}`, true);
    } finally {
        if (downloadPageBtn) downloadPageBtn.disabled = false;
    }
}

  
  /**
   * Обрабатывает скачивание диапазона страниц (как ZIP или по отдельности).
   * @param {number} startPage - Начальная страница.
   * @param {number} endPage - Конечная страница.
   * @param {object} docInfo - Информация о документе { title, totalPages, baseUrl }.
   */
  async function processDownloadRange(startPage, endPage, docInfo) {
    setStatus(`Подготовка диапазона ${startPage}-${endPage}...`);
    const useZip = zipCheckbox?.checked ?? false; // Проверяем, нужен ли ZIP

    try {
      if (useZip) {
        await zipDownload({ ...docInfo, startPage, endPage });
      } else {
        // Логика для скачивания отдельных файлов
        setStatus(`Отправка запроса на скачивание стр. ${startPage}-${endPage} по отдельности...`);
        const res = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "downloadRangeImages",
              data: { ...docInfo, startPage, endPage }
            },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response?.status === 'success') {
                resolve(response);
              } else {
                reject(new Error(response?.error || 'Неизвестная ошибка от background script'));
              }
            }
          );
        });

        setStatus("Запрос на скачивание отправлен.");
        showNotification("Скачивание", `Запущено скачивание страниц ${startPage}-${endPage}.`);
      }
    } catch (error) {
      console.error(`Ошибка при обработке диапазона ${startPage}-${endPage}:`, error);
      setStatus(`Ошибка: ${error.message}`, true);
      throw error;
    } finally {
      setControlsEnabled(true);
    }
  }

  /**
   * Создает новую вкладку, переходит по URL и ждет её загрузки.
   * @param {string} url - URL для открытия.
   * @returns {Promise<number>} - Промис, разрешающийся с ID созданной и загруженной вкладки.
   */
  async function navigateToPageAndWait(url) {
    console.log(`Открываю временную вкладку с URL: ${url}`);
    const tab = await chrome.tabs.create({ url, active: false });
    console.log(`Вкладка ${tab.id} создана, ждем загрузки...`);

    return new Promise((resolve, reject) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id) {
          console.log(`Вкладка ${tabId}, статус: ${changeInfo.status}`);
          if (changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => {
              console.log(`Вкладка ${tabId} полностью загружена.`);
              resolve(tabId);
            }, 500);
          } else if (changeInfo.status === 'error') {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.remove(tabId).catch(e => console.warn(`Не удалось закрыть вкладку ${tabId} после ошибки: ${e}`));
            reject(new Error(`Ошибка загрузки вкладки ${tabId}`));
          }
        }
      };

      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tab.id).catch(e => console.warn(`Не удалось закрыть вкладку ${tab.id} по таймауту: ${e}`));
        reject(new Error(`Таймаут загрузки вкладки ${tab.id} (${url})`));
      }, 30000);

      chrome.tabs.onUpdated.addListener(listener);

      if (chrome.runtime.lastError) {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(`Ошибка создания вкладки: ${chrome.runtime.lastError.message}`));
      }
    });
  }

  /**
   * Скачивает диапазон страниц и упаковывает в ZIP.
   * @param {object} params - Параметры: { title, startPage, endPage, baseUrl }.
   */
  async function zipDownload({ title, startPage, endPage, baseUrl }) {
    if (typeof JSZip !== 'function') {
      throw new Error('Библиотека JSZip не найдена.');
    }

    setStatus(`Подготовка ZIP (${startPage}-${endPage})...`);
    const zip = new JSZip();
    const collectedUrls = new Set();
    let currentPageTabId = null;

    console.log(`ZIP: Начинаю обработку диапазона ${startPage}-${endPage}, baseUrl: ${baseUrl}`);

    try {
      for (let page = startPage; page <= endPage; page++) {
        const pageUrl = `${baseUrl}/${page}`;
        console.log(`ZIP: Обработка стр. ${page}, URL: ${pageUrl}`);
        setStatus(`Стр. ${page}/${endPage}: Открываю...`);

        try {
          currentPageTabId = await navigateToPageAndWait(pageUrl);
          console.log(`ZIP: Вкладка для стр. ${page} открыта, ID: ${currentPageTabId}`);

          setStatus(`Стр. ${page}/${endPage}: Ожидаю URL изображения...`);
          const imageUrl = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { type: "fetchNextImage", data: { tabId: currentPageTabId, pageNumber: page } },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response?.status === "success" && response.data?.url) {
                  resolve(response.data.url);
                } else {
                  resolve(null);
                }
              }
            );
          });
          if (!imageUrl) {
            throw new Error(`URL картинки не найден на стр. ${page}`);
          }
          console.log(`ZIP: Получен URL для стр. ${page}: ${imageUrl}`);

          if (collectedUrls.has(imageUrl)) {
            console.warn(`ZIP: Дубликат URL (${imageUrl}) для стр. ${page}, пропускаю`);
            setStatus(`Стр. ${page}/${endPage}: Дубликат URL, пропускаю`);
            continue;
          }
          collectedUrls.add(imageUrl);
          console.log(`ZIP: Уникальный URL для стр. ${page}: ${imageUrl}`);

          setStatus(`Стр. ${page}/${endPage}: Скачиваю картинку...`);
          const blobResp = await new Promise((resolve, reject) => {
            console.log(`zipDownload: Запрашиваю Blob для URL: ${imageUrl}`);
            chrome.runtime.sendMessage({ type: "fetchImageBlob", data: { url: imageUrl } }, response => {
              console.log(`zipDownload: Ответ fetchImageBlob:`, response);
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          });
          console.log(`ZIP: Ответ background для стр. ${page}:`, blobResp);

          if (blobResp.status !== 'success' || !blobResp.data?.blob) {
            throw new Error(blobResp?.error || `Не удалось получить Blob для стр. ${page}`);
          }

          const blob = new Blob([new Uint8Array(blobResp.data.blob)], { type: "image/jpeg" });
          console.log(`ZIP: Blob для стр. ${page}, размер: ${blob.size} байт`);

          if (blob.size === 0) {
            console.warn(`ZIP: Изображение для стр. ${page} пустое`);
            setStatus(`Стр. ${page}/${endPage}: Изображение пустое, пропускаю`);
            continue;
          }

          const filenameInZip = truncateFilename(`${title} - ${page}.jpeg`, 90);
          zip.file(filenameInZip, blob);
          console.log(`ZIP: Файл ${filenameInZip} добавлен для стр. ${page}`);
          setStatus(`Стр. ${page}/${endPage}: Добавлено в ZIP.`);

        } catch (pageError) {
          console.error(`ZIP: Ошибка на стр. ${page}:`, pageError);
          setStatus(`Стр. ${page}/${endPage}: Ошибка (${pageError.message.substring(0, 30)}...), пропускаю`, true);
        } finally {
          if (currentPageTabId) {
            console.log(`ZIP: Закрываю вкладку ${currentPageTabId} для стр. ${page}`);
            await chrome.tabs.remove(currentPageTabId).catch(e => console.warn(`ZIP: Не удалось закрыть вкладку ${currentPageTabId}: ${e}`));
            currentPageTabId = null;
          }
        }
      }

      const fileCount = Object.keys(zip.files).length;
      console.log(`ZIP: Всего добавлено файлов: ${fileCount}`);
      if (fileCount === 0) {
        throw new Error("Не удалось добавить ни одного файла в ZIP.");
      }

      setStatus("Формирую ZIP-файл...");
      const zipBlob = await zip.generateAsync(
        { type: 'blob' },
        (metadata) => {
          const percent = Math.round(metadata.percent);
          if (percent % 10 === 0) {
            console.log(`ZIP: Прогресс: ${percent}%`);
            setStatus(`Формирую ZIP: ${percent}%`);
          }
        }
      );
      console.log(`ZIP: ZIP Blob создан, размер: ${zipBlob.size} байт`);

      const zipName = truncateFilename(`${title} (Стр. ${startPage}-${endPage}).zip`);
      const zipUrl = URL.createObjectURL(zipBlob);

      setStatus("Скачиваю ZIP...");
      await downloadFile({ url: zipUrl, filename: zipName });
      URL.revokeObjectURL(zipUrl);

      console.log(`ZIP: Успешно скачан ${zipName}`);
      setStatus("ZIP скачан успешно!");
      showNotification("Скачивание ZIP", `Файл "${zipName}" скачан.`);

    } catch (zipError) {
      console.error(`ZIP: Ошибка:`, zipError);
      setStatus(`Ошибка ZIP: ${zipError.message}`, true);
      throw zipError;
    }
  }

  // --- Уведомления ---
  function showNotification(title, message) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: title,
      message: message
    });
  }
  
 /** Проверяет, актуальна ли версия расширения, по GitHub */
async function checkVersionFromUpdatesXml() {
  const updatesUrl = 'https://AfterLifeRUS.github.io/webarchivist/updates.xml';
  const listEl = document.getElementById('messageList');

  try {
    const response = await fetch(updatesUrl);
    if (!response.ok) {
      throw new Error(`Ошибка загрузки updates.xml: ${response.status}`);
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "application/xml");

    const updatecheck = xmlDoc.querySelector("updatecheck");
    if (!updatecheck) {
      throw new Error("updatecheck не найден в updates.xml");
    }

    const latestVersion = updatecheck.getAttribute("version");
    if (!latestVersion) {
      throw new Error("Атрибут version отсутствует в updates.xml");
    }

    const currentVersion = chrome.runtime.getManifest().version;

    console.log(`Текущая версия расширения: ${currentVersion}`);
    console.log(`Последняя версия из updates.xml: ${latestVersion}`);

    function isNewerVersion(current, latest) {
      const currentParts = current.split('.').map(Number);
      const latestParts = latest.split('.').map(Number);

      for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const currentPart = currentParts[i] || 0;
        const latestPart = latestParts[i] || 0;
        if (latestPart > currentPart) return true;
        if (latestPart < currentPart) return false;
      }
      return false;
    }

    const statusLi = document.createElement('li');
    if (isNewerVersion(currentVersion, latestVersion)) {
      statusLi.textContent = `Доступна новая версия: ${latestVersion} (у вас ${currentVersion})`;
      statusLi.style.color = 'orange';

      const updateButton = document.createElement('button');
      updateButton.textContent = "Обновить";
      updateButton.style.marginTop = '10px';
      updateButton.addEventListener('click', () => {
        alert("Загрузите новую версию в репозитории на GitHub");
        chrome.tabs.create({ url: "https://github.com/AfterLifeRUS/webarchivist" });
      });
      listEl.appendChild(updateButton);
    } else {
      statusLi.textContent = `Версия актуальная: ${currentVersion}`;
      statusLi.style.color = 'green';
    }

    if (listEl) {
      listEl.appendChild(statusLi);
    }

  } catch (error) {
    console.error("Ошибка проверки версии через updates.xml:", error);
    const statusLi = document.createElement('li');
    statusLi.textContent = "Не удалось проверить обновления.";
    statusLi.style.color = 'red';
    listEl.appendChild(statusLi);
  }
}




  // --- Запуск инициализации ---
  initializePopup();
  checkVersionFromUpdatesXml();
});