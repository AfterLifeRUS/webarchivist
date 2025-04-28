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
      }
       else {
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
            }
             else {
                resolve(downloadId);
            }
        });
    });
}


document.addEventListener('DOMContentLoaded', () => {
  // --- Получение элементов DOM ---
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadLotBtn = document.getElementById("downloadLotBtn");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const downloadRangeBtn = document.getElementById("downloadRangeBtn");
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
    statusLi.textContent = text;
    statusLi.style.color = isError ? 'red' : ''; // Красный цвет для ошибок
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
      const isGoskatalog = /^https:\/\/goskatalog\.ru\/portal\/#\/collections/.test(url);
      console.log("Яндекс.Архив:", isYandexArchive);
      console.log("Госкаталог:", isGoskatalog);

      // 1) Устанавливаем заголовок и видимость контролов
      if (isYandexArchive) {
        header.textContent = "Яндекс.Архив";
        YAControls.forEach(el => { el.style.display = ""; }); // Показываем контролы ЯА
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
        YAControls.forEach(el => { el.style.display = "none"; }); // Скрываем контролы ЯА
        downloadLotBtn.style.display = ""; // Показываем кнопку ГК
        setStatus("Готово к скачиванию лота.");

      } else {
        header.textContent = "Неподдерживаемый сайт";
        YAControls.forEach(el => { el.style.display = "none"; });
        downloadLotBtn.style.display = "none";
        setStatus("Откройте поддерживаемый сайт.", true);
        return; // Больше ничего не делаем
      }

      // 2) Добавляем обработчики событий
      setupEventListeners(isYandexArchive, isGoskatalog);

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
  function setupEventListeners(isYandexArchive, isGoskatalog) {
     // Удаляем старые обработчики, чтобы избежать дублирования при повторной инициализации (если возможно)
     // Это более сложная задача, пока пропустим для простоты

    if (isYandexArchive) {
        if (downloadBtn) downloadBtn.addEventListener("click", handleDownloadCurrent);
        if (downloadAllBtn) downloadAllBtn.addEventListener("click", handleDownloadAll);
        if (downloadRangeBtn) downloadRangeBtn.addEventListener("click", handleDownloadRange);
    }

    if (isGoskatalog) {
        if (downloadLotBtn) downloadLotBtn.addEventListener("click", handleDownloadLot);
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
          // 1) Спрашиваем contentScript, где картинка и id
          const res = await sendMessageToTab(tab.id, { type: "getLotInfo" });

          if (!res || res.status !== "success" || !res.url || !res.id) {
              throw new Error(res?.error || "Не удалось получить URL/ID изображения.");
          }

          // 2) Строим полный URL картинки (если нужно) и имя файла
          // new URL() хорошо справляется и с абсолютными, и с относительными путями
          const imgUrl = new URL(res.url, tab.url).toString();
          const filename = `${res.id}.jpg`; // Просто ID + расширение

          setStatus("Скачиваем лот…");
          // 3) Запускаем загрузку
          const downloadId = await downloadFile({ url: imgUrl, filename: filename });

          if (downloadId) {
              setStatus("Лот успешно скачан!");
              showNotification("Скачивание лота", "Лот успешно скачан!");
          } else {
              // downloadFile должен был выбросить ошибку, но на всякий случай
              throw new Error("Скачивание лота не удалось (нет ID).");
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
        // Это по-прежнему делается через content script активной вкладки
        const pageInfo = await requestPageInfo();
        setStatus("Поиск изображения...");

        // Шаг 2: Запрашиваем URL изображения.
        // !!! ВАЖНО: Используем chrome.runtime.sendMessage, чтобы сообщение ушло
        //            в background script (или кто там его слушает), как в старой версии.
        const resp = await new Promise((resolve, reject) => {
             chrome.runtime.sendMessage({ type: "getImageUrl" }, (response) => {
                 if (chrome.runtime.lastError) {
                     reject(new Error(`Ошибка runtime.sendMessage: ${chrome.runtime.lastError.message}`));
                 } else if (!response) {
                     reject(new Error("Получен пустой ответ от обработчика getImageUrl."));
                 }
                 else {
                    // Проверяем структуру ответа от background/content script
                    if (response.status === 'success' && response.data?.url) {
                         resolve(response);
                    } else {
                         reject(new Error(response.error || "Обработчик getImageUrl не вернул успешный статус или URL."));
                    }
                 }
             });
        });

        // Шаг 3: Обрабатываем полученный URL и скачиваем файл
        const url = resp.data.url;
        let baseFn = `${pageInfo.title} - ${pageInfo.pageNumber}`;
        if (pageInfo.totalPages !== 'unknown') {
            baseFn += ` из ${pageInfo.totalPages}`;
        }
        const filename = truncateFilename(baseFn + ".jpeg"); // Используем хелпер

        setStatus("Скачиваю...");
        const downloadId = await downloadFile({ url, filename });

        if (downloadId) {
            setStatus("Готово.");
            showNotification("Скачивание", "Текущая страница скачана успешно!");
        } else {
             // downloadFile должен выбросить ошибку, но на всякий случай
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
    const endPage   = total;
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
           // Проверка totalPages === "unknown" не нужна здесь, т.к. пользователь ввел диапазон сам

          await processDownloadRange(startPage, endPage, allInfo);
      } catch (error) {
          console.error("Ошибка подготовки скачивания диапазона:", error);
          setStatus(`Ошибка: ${error.message}`, true);
          setControlsEnabled(true); // Включаем обратно при ошибке
      }
       // setControlsEnabled(true) будет вызван внутри processDownloadRange в finally
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
              // Логика для скачивания отдельных файлов (предполагаем, что это делает background)
              setStatus(`Отправка запроса на скачивание стр. ${startPage}-${endPage} по отдельности...`);
              const tab = await getActiveTab(); // Нужен ID для отправки в background? Или background сам знает?
              // Адаптируйте сообщение под ваш background script
               const res = await new Promise((resolve, reject) => {
                 chrome.runtime.sendMessage(
                    {
                        type: "downloadRangeImages", // Убедитесь, что background обрабатывает это
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
                     });
                });

              setStatus("Запрос на скачивание отправлен.");
              showNotification("Скачивание", `Запущено скачивание страниц ${startPage}-${endPage}.`);
              // Background должен сам обработать и показать уведомление о завершении
          }
      } catch (error) {
          console.error(`Ошибка при обработке диапазона ${startPage}-${endPage}:`, error);
          setStatus(`Ошибка: ${error.message}`, true);
          throw error; // Передаем ошибку для обработки в вызывающей функции
      } finally {
            // Этот блок выполнится даже если была ошибка выше
            setControlsEnabled(true); // Всегда включаем контролы после завершения операции
      }
  }

  // --- Логика скачивания ZIP ---

  /**
   * Создает новую вкладку, переходит по URL и ждет её загрузки.
   * @param {string} url - URL для открытия.
   * @returns {Promise<number>} - Промис, разрешающийся с ID созданной и загруженной вкладки.
   */
  async function navigateToPageAndWait(url) {
    console.log(`Открываю временную вкладку с URL: ${url}`);
    // Не делаем вкладку активной, чтобы не мешать пользователю
    const tab = await chrome.tabs.create({ url, active: false });
    console.log(`Вкладка ${tab.id} создана, ждем загрузки...`);

    return new Promise((resolve, reject) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id) {
             console.log(`Вкладка ${tabId}, статус: ${changeInfo.status}`);
          if (changeInfo.status === 'complete') {
            // Успешно загружено
            chrome.tabs.onUpdated.removeListener(listener);
             // Добавляем небольшую задержку, чтобы content script точно успел инициализироваться
             setTimeout(() => {
                 console.log(`Вкладка ${tabId} полностью загружена.`);
                 resolve(tabId);
             }, 500); // 500ms задержка, можно настроить
          } else if (changeInfo.status === 'error') { // Может не сработать, но стоит попробовать
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.remove(tabId).catch(e => console.warn(`Не удалось закрыть вкладку ${tabId} после ошибки: ${e}`));
            reject(new Error(`Ошибка загрузки вкладки ${tabId}`));
          }
        }
      };

       // Тайм-аут на случай, если вкладка зависнет
       const timeoutId = setTimeout(() => {
           chrome.tabs.onUpdated.removeListener(listener);
           chrome.tabs.remove(tab.id).catch(e => console.warn(`Не удалось закрыть вкладку ${tab.id} по таймауту: ${e}`));
           reject(new Error(`Таймаут загрузки вкладки ${tab.id} (${url})`));
       }, 30000); // 30 секунд таймаут

      chrome.tabs.onUpdated.addListener(listener);

      // Дополнительно проверим, нет ли ошибки сразу при создании вкладки
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
				
				
				/*const resp = await sendMessageToTab(currentPageTabId, { type: "getImageUrl" });
                console.log(`ZIP: Ответ content script для стр. ${page}:`, resp);

                if (!resp || resp.status !== 'success' || !resp.data?.url) {
                    throw new Error(resp?.error || `URL картинки не найден на стр. ${page}`);
                }
                const imageUrl = resp.data.url;*/

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
     // finally для setControlsEnabled находится в processDownloadRange
  }


  // --- Уведомления ---
  function showNotification(title, message) {
      chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Убедитесь, что иконка существует
          title: title,
          message: message
      });
  }

  // --- Запуск инициализации ---
  initializePopup();

}); // Конец addEventListener('DOMContentLoaded')