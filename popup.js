/**
 * popup.js - Скрипт для всплывающего окна расширения браузера.
 * Управляет пользовательским интерфейсом, взаимодействует с контентными/фоновыми скриптами и обрабатывает загрузки.
 */

// --- Константы ---
const MAX_FILENAME_LENGTH = 100; // Максимальная длина имени файла
const FILENAME_TRUNCATE_SUFFIX = "..."; // Суффикс для обрезанных имен файлов
const FILENAME_TRUNCATE_KEEP_CHARS = 4; // Количество символов, сохраняемых для расширения и суффикса
const PRILIB_TILE_SIZE = 256; // Размер тайла для Президентской библиотеки
const GITHUB_MANIFEST_URL = 'https://afterliferus.github.io/webarchivist/manifest.json'; // URL манифеста на GitHub
const GITHUB_REPO_URL = 'https://github.com/AfterLifeRUS/webarchivist/'; // URL репозитория на GitHub

// Конфигурация поддерживаемых сайтов
const SITES = {
    YANDEX_ARCHIVE: {
        regex: /^https:\/\/(ya\.ru|yandex\.ru)\/archive/,
        name: "Яндекс.Архив",
        elements: ['downloadBtn', 'downloadAllBtn', 'downloadRangeBtn', 'startPage', 'endPage', 'zipModeContainer', 'rangeInputContainer']
    },
    GOSKATALOG: {
        regex: /^https:\/\/goskatalog\.ru\/portal/,
        name: "Госкаталог.рф",
        elements: ['downloadLotBtn']
    },
    PRLIB: {
        regex: /^https:\/\/www\.prlib\.ru\/item/,
        name: "Президентская библиотека",
        elements: ['downloadPageBtn', 'startPage', 'endPage', 'rangeInputContainer', 'zipModeContainer']
    }
};

// Сообщения для пользователя
const MESSAGES = {
    INIT: "Инициализация...",
    INIT_ERROR: "Ошибка инициализации",
    UNSUPPORTED_SITE: "Неподдерживаемый сайт",
    SUPPORTED_SITES_INFO: "SUPPORTED_SITES", // Специальный ключ для setStatus для отображения списка сайтов
    PAGE_DATA_REQUEST: "Получение данных страницы...",
    PAGE_DATA_SUCCESS: "Данные страницы получены.",
    DOC_DATA_REQUEST: "Получение данных документа...",
    DOC_DATA_SUCCESS: "Данные документа получены.",
    LOT_DATA_REQUEST: "Получаем данные лота…",
    LOT_IMAGES_FOUND: (count) => `Найдено изображений: ${count}. Скачиваем…`,
    LOT_DOWNLOAD_PROGRESS: (downloaded, total) => `Скачано ${downloaded} из ${total} изображений.`,
    LOT_DOWNLOAD_SUCCESS: "Все изображения лота успешно скачаны!",
    LOT_DOWNLOAD_PARTIAL: (downloaded, total, failed) => `Скачано ${downloaded} из ${total} изображений. Ошибок: ${failed}.`,
    CURRENT_PAGE_IMAGE_SEARCH: "Поиск изображения...",
    DOWNLOADING: "Скачиваю...",
    DOWNLOAD_COMPLETE: "Готово.",
    ZIP_PREPARING: (range) => `Подготовка ZIP ${range && range.start ? `(стр. ${range.start}-${range.end})` : 'всего документа'}…`,
    ZIP_REQUEST_SENT: (start, end) => `Отправка запроса на скачивание стр. ${start}-${end} по отдельности...`,
    ZIP_REQUEST_CONFIRMED: "Запрос на скачивание отправлен.",
    ZIP_PAGE_OPENING: (current, total) => `Стр. ${current}/${total}: Открываю...`,
    ZIP_PAGE_IMAGE_URL_WAIT: (current, total) => `Стр. ${current}/${total}: Ожидаю URL изображения...`,
    ZIP_PAGE_IMAGE_DOWNLOADING: (current, total) => `Стр. ${current}/${total}: Скачиваю картинку...`,
    ZIP_PAGE_EMPTY_IMAGE: (current, total) => `Стр. ${current}/${total}: Изображение пустое, пропускаю`,
    ZIP_PAGE_DUPLICATE_URL: (current, total) => `Стр. ${current}/${total}: Дубликат URL, пропускаю`,
    ZIP_PAGE_ADDED: (current, total) => `Стр. ${current}/${total}: Добавлено в ZIP.`,
    ZIP_GENERATING: "Формирую ZIP-файл...",
    ZIP_GENERATING_PROGRESS: (percent) => `Формирую ZIP: ${percent}%`,
    ZIP_DOWNLOADING: "Скачиваю ZIP…",
    ZIP_DOWNLOAD_SUCCESS: "ZIP скачан успешно!",
    PRLIB_GETTING_SIZES: "Получение размеров изображения...",
    PRLIB_FINDING_JTL: "Поиск оптимального JTL‑уровня...",
    PRLIB_FIRST_TILE: "Загрузка первого тайла для определения размеров...",
    PRLIB_OTHER_TILES: (count) => `Загрузка остальных ${count} тайлов...`,
    PRLIB_TILE_PROGRESS: (current, total) => `Тайлы: ${current}/${total}`,
    PRLIB_JPEG_GENERATING: "Формирование итогового JPEG...",
    PRLIB_COLLECTING_ZIP: (start, end) => `Собираем ZIP для страниц ${start}–${end}…`,
    PRLIB_PAGE_PROCESSING_ZIP: (current, total) => `Страница ${current}/${total}: формируем изображение…`,
    PRLIB_PAGE_ADDED_ZIP: (current, total) => `Страница ${current}/${total}: добавлена в ZIP.`,
    PRLIB_DOWNLOADING_PAGES: (start, end) => `Скачиваем страницы ${start}–${end}…`,
    PRLIB_PAGE_DOWNLOADING: (current, total) => `Страница ${current}/${total}: скачиваем…`,
    VERSION_CHECK_ERROR: "Не удалось проверить обновления.",
    VERSION_LATEST: (version) => `Версия актуальна: ${version}`,
    VERSION_NEW_AVAILABLE: (latest, current) => `Доступна новая версия: ${latest} (у вас ${current})`,
    UNKNOWN_ERROR: "Неизвестная ошибка.",
    PRLIB_DOC_DATA_REQUEST: "Получение данных документа (Президентская библиотека)...",
    PRLIB_DOC_DATA_SUCCESS: "Данные получены, готово к скачиванию (Президентская библиотека).",
    PRLIB_DOC_DATA_ERROR: "Не удалось извлечь информацию о документе (Президентская библиотека).",
    PRLIB_WAIT_TAB_LOAD: "Ожидание полной загрузки страницы (Президентская библиотека)...",
};

// --- Глобальное состояние (специфично для Президентской библиотеки) ---
let prlibCurrentDocumentInfo = null; // Информация о текущем документе Президентской библиотеки

// --- Кэш DOM-элементов ---
const domElements = {}; // Объект для хранения ссылок на DOM-элементы

/**
 * Кэширует часто используемые DOM-элементы.
 */
function cacheDOMElements() {
    const ids = [
        "downloadBtn", "downloadLotBtn", "downloadAllBtn", "downloadRangeBtn", "downloadPageBtn",
        "startPage", "endPage", "zipMode", "messageList", "popupHeader"
    ];
    ids.forEach(id => domElements[id] = document.getElementById(id));
    domElements.rangeInputContainer = document.querySelector('.range-input'); // Контейнер для ввода диапазона страниц
    domElements.zipModeContainer = domElements.zipMode ? domElements.zipMode.closest('label') || domElements.zipMode.parentElement : null; // Контейнер для чекбокса ZIP-режима
    domElements.zipModeLabel = document.querySelector('label[for="zipMode"]'); // Метка для чекбокса ZIP-режима (специфично для PrLib)
    console.log("DOM-элементы кэшированы:", domElements);
}

// --- Вспомогательные функции ---

/**
 * Обрезает имя файла, если оно превышает maxLength.
 * @param {string} filename - Исходное имя файла.
 * @param {number} [maxLength=MAX_FILENAME_LENGTH] - Максимально допустимая длина.
 * @returns {string} - Обрезанное или исходное имя файла.
 */
function truncateFilename(filename, maxLength = MAX_FILENAME_LENGTH) {
    if (filename.length <= maxLength) {
        return filename;
    }
    // Учитываем длину суффикса и символов для расширения
    const maxBaseLength = maxLength - (FILENAME_TRUNCATE_SUFFIX.length + FILENAME_TRUNCATE_KEEP_CHARS);
    const extensionMatch = filename.match(/\.[^.]+$/);
    const extension = extensionMatch ? extensionMatch[0] : '';
    const baseName = filename.substring(0, filename.length - extension.length);

    if (baseName.length > maxBaseLength) {
        return baseName.substring(0, maxBaseLength) + FILENAME_TRUNCATE_SUFFIX + extension;
    }
    return filename; // Теоретически не должно сюда попадать, если filename.length > maxLength
}

// --- Обертки для Chrome API (промисифицированные) ---

/**
 * Получает текущую активную вкладку.
 * @returns {Promise<chrome.tabs.Tab>} - Промис, который разрешается с объектом активной вкладки.
 * @throws {Error} - Если вкладка не найдена или произошла ошибка API.
 */
async function getActiveTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка API запроса вкладки: ${chrome.runtime.lastError.message}`));
            } else if (!tabs || tabs.length === 0 || !tabs[0]) {
                reject(new Error("Активная вкладка не найдена."));
            } else {
                resolve(tabs[0]);
            }
        });
    });
}

/**
 * Отправляет сообщение в указанную вкладку и возвращает Промис для ответа.
 * @param {number} tabId - ID вкладки.
 * @param {any} message - Сообщение для отправки.
 * @returns {Promise<any>} - Промис, который разрешается с ответом.
 * @throws {Error} - Если произошла ошибка при отправке/получении или ответ пустой/содержит ошибку.
 */
async function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка отправки/получения сообщения (вкладка ${tabId}, тип: ${message.type}): ${chrome.runtime.lastError.message}`));
            } else if (response === undefined && message.type !== "fetchNextImage") {
                // fetchNextImage может вернуть undefined, если изображение не найдено, и это не ошибка
                if (response && response.status === 'error') {
                     reject(new Error(response.error || "Получен пустой ответ от content script с ошибкой."));
                } else if (!response && message.type === "fetchNextImage"){
                     resolve(null); // Специально для fetchNextImage, который может не найти изображение
                } else {
                    reject(new Error(`Получен пустой ответ от content script для сообщения типа: ${message.type}.`));
                }
            } else if (response && response.status === 'error') {
                reject(new Error(response.error || `Content script вернул ошибку для сообщения типа: ${message.type}.`));
            }
            else {
                resolve(response);
            }
        });
    });
}

/**
 * Отправляет сообщение фоновому скрипту и возвращает Промис для ответа.
 * @param {any} message - Сообщение для отправки.
 * @returns {Promise<any>} - Промис, который разрешается с ответом.
 * @throws {Error} - Если произошла ошибка при отправке/получении или ответ пустой/содержит ошибку.
 */
async function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка runtime.sendMessage (тип: ${message.type}): ${chrome.runtime.lastError.message}`));
            } else if (!response && message.type !== "fetchNextImage") { // fetchNextImage может вернуть undefined
                 reject(new Error(`Получен пустой ответ от background для сообщения типа: ${message.type}.`));
            } else if (response && response.status === 'error') {
                reject(new Error(response.error || `Background script вернул ошибку для сообщения типа: ${message.type}.`));
            }
             else {
                resolve(response);
            }
        });
    });
}


/**
 * Инициирует загрузку файла с помощью chrome.downloads.download.
 * @param {chrome.downloads.DownloadOptions} options - Опции загрузки.
 * @returns {Promise<number|undefined>} - Промис, разрешающийся с ID загрузки или undefined при ошибке.
 */
async function downloadFile(options) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download(options, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка скачивания файла "${options.filename}": ${chrome.runtime.lastError.message}`));
            } else if (downloadId === undefined) {
                // Это может произойти, если расширение не имеет прав 'downloads' или URL некорректен
                reject(new Error(`API скачивания не вернуло ID загрузки для файла "${options.filename}". Проверьте URL и права расширения.`));
            } else {
                resolve(downloadId);
            }
        });
    });
}

// --- Вспомогательные функции для UI ---

/**
 * Устанавливает сообщение о статусе во всплывающем окне.
 * @param {string} text - Текст сообщения или специальный ключ 'SUPPORTED_SITES'.
 * @param {boolean} [isError=false] - True, если сообщение является ошибкой.
 */
function setStatus(text, isError = false) {
    let statusLi = document.getElementById('status');
    if (!statusLi) {
        domElements.messageList.innerHTML = ''; // Очищаем предыдущие сообщения
        statusLi = document.createElement('li');
        statusLi.id = 'status';
        domElements.messageList.appendChild(statusLi);
    }

    if (text === MESSAGES.SUPPORTED_SITES_INFO) {
        const siteLinks = [
            { url: "https://yandex.ru/archive/", name: "yandex.ru/archive" },
            { url: "https://goskatalog.ru/portal/", name: "goskatalog.ru/portal" },
            { url: "https://www.prlib.ru/", name: "prlib.ru" }
        ];
        const linksHtml = siteLinks.map(site =>
            `<li><a href="${site.url}" target="_blank" rel="noopener noreferrer">${site.name}</a></li>`
        ).join('');
        statusLi.innerHTML = `<span style="color: ${isError ? 'red' : 'inherit'}">Откройте поддерживаемый сайт:</span><ul>${linksHtml}</ul>`;
    } else {
        statusLi.textContent = text;
        statusLi.style.color = isError ? 'red' : (text.includes("Доступна новая версия") ? 'orange' : (text.includes("Версия актуальна") ? 'green' : ''));
    }
    console.log(`Статус: ${text}${isError ? ' (ОШИБКА)' : ''}`);
}

/** Очищает сообщение о статусе. */
function clearStatus() {
    const statusLi = document.getElementById('status');
    if (statusLi) statusLi.remove();
}

/**
 * Включает или отключает элементы управления UI.
 * @param {boolean} enabled - True для включения, false для отключения.
 */
function setControlsEnabled(enabled) {
    const allControls = [
        domElements.downloadBtn, domElements.downloadAllBtn, domElements.downloadRangeBtn,
        domElements.startPage, domElements.endPage, domElements.zipMode, domElements.downloadLotBtn, domElements.downloadPageBtn
    ].filter(el => el && typeof el.disabled === 'boolean'); // Фильтруем, чтобы избежать ошибок с отсутствующими элементами

    allControls.forEach(el => { el.disabled = !enabled; });
    console.log(`Элементы управления ${enabled ? 'включены' : 'отключены'}`);
}

/**
 * Показывает уведомление браузера.
 * @param {string} title - Заголовок уведомления.
 * @param {string} message - Текст уведомления.
 */
function showNotification(title, message) {
    chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png", // Убедитесь, что icon.png находится в корне расширения
        title: title,
        message: message
    });
}

// --- Логика, специфичная для сайтов ---

/**
 * Извлекает ID лота из URL Госкаталога.
 * @param {string} urlString - URL-адрес.
 * @returns {string|null} ID лота или null.
 */
function extractLotIdFromUrl(urlString) {
    try {
        const urlObj = new URL(urlString);
        const hash = urlObj.hash || ''; // Пример: #/public_items?id=12345
        const paramsPart = hash.split('?')[1] || ''; // Получаем 'id=12345'
        const hashParams = new URLSearchParams(paramsPart);
        const lotId = hashParams.get('id');
        if (!lotId) {
            console.warn(`ID лота не найден в URL: ${urlString}`);
            return null;
        }
        return lotId;
    } catch (error) {
        console.error(`Ошибка извлечения ID лота из URL "${urlString}":`, error);
        return null;
    }
}


// --- Функции запроса данных ---

/**
 * Запрашивает информацию о странице из content script (Яндекс.Архив).
 * @returns {Promise<object>} - Данные с информацией о странице.
 */
async function requestPageInfoYA() {
    setStatus(MESSAGES.PAGE_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();
        const res = await sendMessageToTab(tab.id, { type: "getPageInfo" });
        if (!res || !res.data) throw new Error("Не удалось получить данные страницы (Яндекс.Архив, пустой ответ).");
        setStatus(MESSAGES.PAGE_DATA_SUCCESS);
        return res.data;
    } catch (error) {
        console.error("Ошибка в requestPageInfoYA:", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
        throw error; // Перебрасываем ошибку для обработки выше
    } finally {
        setControlsEnabled(true);
    }
}

/**
 * Запрашивает информацию обо всем документе из content script (Яндекс.Архив).
 * @returns {Promise<object>} - Данные с информацией о документе.
 */
async function requestAllInfoYA() {
    setStatus(MESSAGES.DOC_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();
        const res = await sendMessageToTab(tab.id, { type: "getAllPageInfo" });
        if (!res || !res.data) throw new Error("Не удалось получить данные документа (Яндекс.Архив, пустой ответ).");
        setStatus(MESSAGES.DOC_DATA_SUCCESS);
        return res.data;
    } catch (error) {
        console.error("Ошибка в requestAllInfoYA:", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
        throw error;
    } finally {
        setControlsEnabled(true);
    }
}

/**
 * Запрашивает информацию о документе из content script (Президентская библиотека).
 * @returns {Promise<object>} - Данные с информацией о документе.
 */
async function requestDocumentInfoPrLib() {
    setStatus(MESSAGES.PRLIB_DOC_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();

        // Ожидаем полной загрузки вкладки, если она еще не загружена
        if (tab.status !== 'complete') {
            setStatus(MESSAGES.PRLIB_WAIT_TAB_LOAD);
            await new Promise((resolve) => {
                const listener = (tabIdUpdate, changeInfo) => {
                    if (tabIdUpdate === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
             console.log("Вкладка Президентской библиотеки полностью загружена.");
        }


        const res = await sendMessageToTab(tab.id, { type: "getDocumentInfo" });
        if (!res || res.status !== 'success' || !res.data) {
            throw new Error(res?.error || MESSAGES.PRLIB_DOC_DATA_ERROR);
        }
        prlibCurrentDocumentInfo = res.data; // Сохраняем глобально

        let statusMessage = `Название: ${prlibCurrentDocumentInfo.itemTitle || '(неизвестно)'}`;
        if (typeof prlibCurrentDocumentInfo.pageCount === 'number') {
             statusMessage += `\nСтраниц: ${prlibCurrentDocumentInfo.pageCount}`;
        } else if (prlibCurrentDocumentInfo.files && Array.isArray(prlibCurrentDocumentInfo.files)) {
            statusMessage += `\nСтраниц (файлов): ${prlibCurrentDocumentInfo.files.length}`;
        } else {
            statusMessage += `\nСтраниц: (неизвестно)`;
        }

        setStatus(statusMessage);
        console.log("Информация о документе (Президентская библиотека):", prlibCurrentDocumentInfo);

        return prlibCurrentDocumentInfo;
    } catch (error) {
        console.error("Ошибка в requestDocumentInfoPrLib:", error);
        setStatus(`Ошибка (ПБ): ${error.message}`, true);
        prlibCurrentDocumentInfo = null; // Сбрасываем при ошибке
        throw error;
    } finally {
        setControlsEnabled(true);
    }
}


// --- Обработка тайловых изображений (Президентская библиотека) ---

/**
 * Загружает метаданные изображения (ширина, высота) из info.json.
 * @param {string} documentKey - Ключ документа (itemTitle).
 * @param {string} documentNumber - Номер документа/файла на сервере (fileNameOnServer).
 * @param {string} documentFileGroup - Группа файлов документа.
 * @returns {Promise<{width: number, height: number}>} - Объект с шириной и высотой.
 */
async function fetchImageMetadataPrLib(documentKey, documentNumber, documentFileGroup) {
    // URL для info.json зависит от структуры на сервере prlib
    const infoUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?IIIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}/info.json`;
    console.log(`Запрос info.json: ${infoUrl}`);
    const response = await sendMessageToBackground({ type: 'fetchJson', url: infoUrl });

    if (!response || response.status !== 'success' || !response.data) {
        throw new Error(`Ошибка загрузки info.json для ${documentNumber}: ${response?.error || 'Неизвестная ошибка от background'}`);
    }
    const { width, height } = response.data;
    if (!width || !height) {
        throw new Error(`Некорректные данные в info.json для ${documentNumber}: width или height отсутствуют.`);
    }
    return { width, height };
}

/**
 * Находит максимальный доступный уровень JTL (JPEG Tile Level).
 * @param {string} documentKey - Ключ документа.
 * @param {string} documentNumber - Номер документа/файла.
 * @param {string} documentFileGroup - Группа файлов.
 * @returns {Promise<number>} - Максимальный JTL уровень.
 */
async function findMaxJtlLevelPrLib(documentKey, documentNumber, documentFileGroup) {
    const baseUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?FIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}&JTL=`;
    // Начинаем с высокого уровня и идем вниз, так как более высокие уровни дают лучшее качество
    for (let level = 10; level >= 0; level--) { // Некоторые изображения могут иметь только уровень 0
        const testUrl = `${baseUrl}${level},0`; // Пробуем загрузить первый тайл (индекс 0) на этом уровне
        try {
            const response = await sendMessageToBackground({ type: 'fetchTile', url: testUrl });
            // Проверяем, что ответ - это изображение
            if (response.status === 'success' && response.contentType && response.contentType.startsWith('image/')) {
                console.log(`Найден доступный JTL уровень ${level} для ${documentNumber}`);
                return level;
            }
        } catch (error) {
            // Ошибка при запросе этого уровня, пробуем следующий
            console.debug(`JTL уровень ${level} для ${documentNumber} недоступен или вернул не изображение: ${error.message}`);
        }
    }
    throw new Error(`Не найден доступный JTL уровень для ${documentNumber}, возвращающий изображение.`);
}

/**
 * Собирает полное изображение из тайлов (Президентская библиотека).
 * @param {string} documentKey - Ключ документа (itemTitle).
 * @param {string} documentNumber - Номер документа/файла на сервере (fileNameOnServer).
 * @param {string} fileGroup - Группа файлов документа.
 * @param {boolean} [forZip=false] - Если true, подавляет некоторые сообщения о статусе для ZIP-сборки.
 * @returns {Promise<Blob>} - Blob собранного изображения.
 */
async function assembleTiledImagePrLib(documentKey, documentNumber, fileGroup, forZip = false) {
    if (!forZip) setStatus(MESSAGES.PRLIB_GETTING_SIZES);
    const { width, height } = await fetchImageMetadataPrLib(documentKey, documentNumber, fileGroup);

    if (!forZip) setStatus(MESSAGES.PRLIB_FINDING_JTL);
    const jtlLevel = await findMaxJtlLevelPrLib(documentKey, documentNumber, fileGroup);

    const cols = Math.ceil(width / PRILIB_TILE_SIZE);
    const rows = Math.ceil(height / PRILIB_TILE_SIZE);
    const totalTiles = cols * rows;
    const tileBaseUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?FIF=/var/data/scans/public/${documentKey}/${fileGroup}/${documentNumber}&JTL=${jtlLevel},`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    console.log(`Сборка изображения: ${documentNumber}, Размеры: ${width}x${height}, Тайлов: ${totalTiles} (${cols}x${rows}), JTL: ${jtlLevel}`);

    if (!forZip) setStatus(MESSAGES.PRLIB_FIRST_TILE);
    const firstTileResponse = await sendMessageToBackground({ type: 'fetchTile', url: tileBaseUrl + '0' });
    if (firstTileResponse.status !== 'success' || !firstTileResponse.data) {
        throw new Error(`Первый тайл для ${documentNumber} не загружен: ${firstTileResponse.error || 'нет данных от background'}`);
    }

    // Загружаем первый тайл, чтобы определить фактический размер тайлов (может отличаться от PRILIB_TILE_SIZE)
    const firstImg = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error(`Ошибка загрузки первого тайла ${documentNumber} в Image: ${e.type}`));
        img.src = firstTileResponse.data; // data - это base64 строка от background
    });

    const actualTileWidth = firstImg.width;
    const actualTileHeight = firstImg.height;
    ctx.drawImage(firstImg, 0, 0);
    console.log(`Фактический размер тайла (${documentNumber}): ${actualTileWidth}x${actualTileHeight}`);


    if (totalTiles > 1) {
        if (!forZip) setStatus(MESSAGES.PRLIB_OTHER_TILES(totalTiles - 1));
        const tilePromises = [];
        for (let idx = 1; idx < totalTiles; idx++) { // Начинаем с 1, так как 0-й уже загружен
            tilePromises.push((async () => {
                const tileUrl = tileBaseUrl + idx;
                const tileResponse = await sendMessageToBackground({ type: 'fetchTile', url: tileUrl });
                 if (tileResponse.status !== 'success' || !tileResponse.data) {
                    console.warn(`Тайл ${idx} для ${documentNumber} не загружен: ${tileResponse.error || 'нет данных'}. Пропускаем.`);
                    return; // Пропускаем этот тайл при ошибке, чтобы позволить другим завершиться
                }
                await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        const r = Math.floor(idx / cols); // Строка тайла
                        const c = idx % cols;           // Колонка тайла
                        ctx.drawImage(img, c * actualTileWidth, r * actualTileHeight);
                        resolve();
                    };
                    img.onerror = (e) => {
                        console.warn(`Ошибка загрузки тайла ${idx} для ${documentNumber} в Image: ${e.type}. Пропускаем.`);
                        resolve(); // Разрешаем, чтобы не сломать Promise.all
                    };
                    img.src = tileResponse.data;
                });
                if (!forZip && (idx + 1) % Math.ceil(totalTiles / 10) === 0) { // Обновляем статус примерно каждые 10%
                     setStatus(MESSAGES.PRLIB_TILE_PROGRESS(idx + 1, totalTiles));
                }
            })());
        }
        await Promise.all(tilePromises);
    }

    if (!forZip) setStatus(MESSAGES.PRLIB_JPEG_GENERATING);
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) return reject(new Error(`Не удалось создать Blob из canvas для ${documentNumber}.`));
            resolve(blob);
        }, 'image/jpeg', 0.92); // Качество JPEG (0.0 - 1.0)
    });
}


// --- Обработчики загрузок ---

/** Обработчик для скачивания лота Госкаталога. */
async function handleDownloadLotGoskatalog() {
    clearStatus();
    setControlsEnabled(false);
    setStatus(MESSAGES.LOT_DATA_REQUEST);

    try {
        const tab = await getActiveTab();
        const lotId = extractLotIdFromUrl(tab.url);
        if (!lotId) throw new Error("Не удалось извлечь ID лота из URL (Госкаталог).");

        const res = await sendMessageToTab(tab.id, { type: "getLotInfo" }); // Запрос к content script
        if (!res || !res.data || !res.data.imageUrls || res.data.imageUrls.length === 0) {
            throw new Error("Не удалось получить URL-адреса изображений лота (Госкаталог).");
        }
        const { imageUrls, documentTitle } = res.data;
        const baseFilename = documentTitle ? documentTitle.replace(/[<>:"/\\|?*]+/g, '_') : lotId;

        setStatus(MESSAGES.LOT_IMAGES_FOUND(imageUrls.length));

        let downloadedCount = 0;
        let failedCount = 0;
        for (let i = 0; i < imageUrls.length; i++) {
            const imageUrl = imageUrls[i];
            // Формируем имя файла: IDлота_порядковыйНомер.расширение или НазваниеДокумента_номер.расширение
            const originalFilename = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
            const extension = originalFilename.includes('.') ? originalFilename.substring(originalFilename.lastIndexOf('.')) : '.jpg';
            const filename = truncateFilename(`${baseFilename}_${i + 1}${extension}`);

            try {
                // Убеждаемся, что URL полный
                const fullImageUrl = new URL(imageUrl, tab.url).toString();
                await downloadFile({ url: fullImageUrl, filename });
                downloadedCount++;
                setStatus(MESSAGES.LOT_DOWNLOAD_PROGRESS(downloadedCount, imageUrls.length));
            } catch (imgError) {
                console.error(`Ошибка скачивания изображения ${i + 1} (${imageUrl}) для Госкаталога:`, imgError);
                failedCount++;
                // Показываем краткое сообщение об ошибке, чтобы не перегружать UI
                setStatus(`Ошибка при скачивании изображения ${i + 1}: ${imgError.message.substring(0, 60)}...`, true);
            }
        }

        if (failedCount === 0) {
            setStatus(MESSAGES.LOT_DOWNLOAD_SUCCESS);
            showNotification("Скачивание лота (Госкаталог)", "Все изображения успешно скачаны!");
        } else {
            setStatus(MESSAGES.LOT_DOWNLOAD_PARTIAL(downloadedCount, imageUrls.length, failedCount), true);
            showNotification("Скачивание лота (Госкаталог)", `Скачано ${downloadedCount} из ${imageUrls.length}. Ошибок: ${failedCount}.`);
        }
    } catch (error) {
        console.error("Ошибка скачивания лота (Госкаталог):", error);
        setStatus(`Ошибка (Госкаталог): ${error.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}

/** Обработчик для скачивания текущей страницы Яндекс.Архива. */
async function handleDownloadCurrentYA() {
    clearStatus();
    setControlsEnabled(false);
    try {
        const pageInfo = await requestPageInfoYA(); // Получаем title, pageNumber, totalPages
        setStatus(MESSAGES.CURRENT_PAGE_IMAGE_SEARCH);

        // Запрашиваем URL изображения через background script, так как content script мог его не найти
        const resp = await sendMessageToBackground({ type: "getImageUrl" });
        if (!resp || resp.status !== 'success' || !resp.data?.url) {
            throw new Error(resp?.error || "Обработчик getImageUrl в background не вернул URL.");
        }
        const imageUrl = resp.data.url;

        let baseFn = `${pageInfo.title} - ${pageInfo.pageNumber}`;
        if (pageInfo.totalPages !== 'unknown' && pageInfo.totalPages) { // Убедимся, что totalPages не пустая строка
            baseFn += ` из ${pageInfo.totalPages}`;
        }
        const filename = truncateFilename(baseFn + ".jpeg"); // Яндекс.Архив обычно отдает jpeg

        setStatus(MESSAGES.DOWNLOADING);
        await downloadFile({ url: imageUrl, filename });
        setStatus(MESSAGES.DOWNLOAD_COMPLETE);
        showNotification("Скачивание (Яндекс.Архив)", `Текущая страница "${filename}" скачана!`);
    } catch (error) {
        console.error("Ошибка скачивания текущей страницы (Яндекс.Архив):", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}

/** Обработчик для скачивания всех страниц Яндекс.Архива (в ZIP). */
async function handleDownloadAllYA() {
    clearStatus();
    setControlsEnabled(false);
    setStatus(MESSAGES.ZIP_PREPARING({})); // Общее сообщение для всех страниц

    try {
        const { title, totalPages, baseUrl } = await requestAllInfoYA();
        const total = parseInt(totalPages, 10);
        if (totalPages === "unknown" || isNaN(total) || total <= 0) {
            throw new Error("Общее количество страниц для Яндекс.Архива неизвестно или некорректно.");
        }
        await processZipDownloadYA({ title, startPage: 1, endPage: total, baseUrl });
    } catch (error) {
        console.error("Ошибка при скачивании всего документа (Яндекс.Архив):", error);
        setStatus(`Ошибка ZIP (Я.Архив): ${error.message}`, true);
        // setControlsEnabled(true) вызывается в finally processZipDownloadYA
    }
    // finally { setControlsEnabled(true); } // Не нужно здесь, т.к. processZipDownloadYA имеет свой finally
}

/** Обработчик для скачивания диапазона страниц Яндекс.Архива. */
async function handleDownloadRangeYA() {
    clearStatus();
    setControlsEnabled(false);

    const startPage = parseInt(domElements.startPage.value, 10);
    const endPage = parseInt(domElements.endPage.value, 10);

    if (isNaN(startPage) || isNaN(endPage) || startPage < 1 || endPage < startPage) {
        setStatus("Ошибка: Некорректный диапазон страниц для Яндекс.Архива.", true);
        setControlsEnabled(true);
        return;
    }

    try {
        const docInfo = await requestAllInfoYA(); // Получаем title, totalPages, baseUrl
        const total = parseInt(docInfo.totalPages, 10);

        if (docInfo.totalPages !== "unknown" && !isNaN(total) && endPage > total) {
            setStatus(`Ошибка: Конечная страница (${endPage}) больше общего числа страниц (${total}) для Яндекс.Архива.`, true);
            setControlsEnabled(true);
            return;
        }

        const useZip = domElements.zipMode.checked;
        setStatus(MESSAGES.ZIP_PREPARING({ start: startPage, end: endPage }));

        if (useZip) {
            await processZipDownloadYA({ ...docInfo, startPage, endPage });
        } else {
            // Скачивание по отдельности через background script
            setStatus(MESSAGES.ZIP_REQUEST_SENT(startPage, endPage));
            await sendMessageToBackground({
                type: "downloadRangeImages", // Сообщение для background.js
                data: { ...docInfo, startPage, endPage }
            });
            // Background script должен сам уведомлять о прогрессе/завершении
            setStatus(MESSAGES.ZIP_REQUEST_CONFIRMED);
            showNotification("Скачивание диапазона (Яндекс.Архив)", `Запущено скачивание страниц ${startPage}-${endPage}.`);
        }
    } catch (error) {
        console.error("Ошибка подготовки скачивания диапазона (Яндекс.Архив):", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
    } finally {
        // processZipDownloadYA сам включает контролы, здесь нужно только если не ZIP
        if (!domElements.zipMode.checked) {
            setControlsEnabled(true);
        }
    }
}

/** Обработчик для скачивания страниц Президентской библиотеки. */
async function handleDownloadPagesPrLib() {
    clearStatus();
    setControlsEnabled(false);
    setStatus("Начало процесса загрузки (Президентская библиотека)...");

    try {
        if (!prlibCurrentDocumentInfo || !prlibCurrentDocumentInfo.files) {
            // Попытка повторно загрузить информацию, если она отсутствует
            setStatus("Данные документа отсутствуют, пытаюсь загрузить снова...");
            await requestDocumentInfoPrLib(); // Эта функция вызовет setStatus и setControlsEnabled
            if (!prlibCurrentDocumentInfo || !prlibCurrentDocumentInfo.files) {
                 throw new Error("Данные документа (Президентская библиотека) не загружены. Попробуйте перезапустить расширение на странице.");
            }
        }

        const { itemTitle, files, fileGroup, pageCount } = prlibCurrentDocumentInfo;
        // `files` - это массив имен файлов на сервере, например ["12345_doc1.tiff", "12345_doc2.tiff"]
        // `pageCount` - общее количество страниц, может совпадать с files.length
        const totalAvailablePages = (files && Array.isArray(files)) ? files.length : (typeof pageCount === 'number' ? pageCount : 0);

        if (totalAvailablePages === 0) {
            throw new Error("Нет доступных файлов/страниц для загрузки (Президентская библиотека).");
        }

        let start = parseInt(domElements.startPage.value, 10) || 1;
        let end = parseInt(domElements.endPage.value, 10) || start; // Если не указано, то только start

        if (start < 1 || end < start || end > totalAvailablePages) {
            throw new Error(`Неверный диапазон страниц. Доступно: 1-${totalAvailablePages}. Запрошено: ${start}-${end}.`);
        }

        const zipModeChecked = domElements.zipMode.checked;

        if (zipModeChecked) {
            if (typeof JSZip !== 'function') throw new Error("Библиотека JSZip не подключена для Президентской библиотеки.");
            setStatus(MESSAGES.PRLIB_COLLECTING_ZIP(start, end));
            const zip = new JSZip();

            for (let i = start; i <= end; i++) {
                // Индекс в массиве `files` на 1 меньше, чем номер страницы
                const pageIndexInFilesArray = i - 1;
                if (!files || !files[pageIndexInFilesArray]) {
                     console.warn(`Файл для страницы ${i} не найден в массиве files. Пропуск.`);
                     setStatus(`Страница ${i}: файл не найден, пропускаю.`, true);
                     continue;
                }
                const fileNameOnServer = files[pageIndexInFilesArray];
                setStatus(MESSAGES.PRLIB_PAGE_PROCESSING_ZIP(i, end));

                const blob = await assembleTiledImagePrLib(itemTitle, fileNameOnServer, fileGroup, true); // true forZip
                const inZipName = truncateFilename(`${itemTitle}-${i}.jpeg`);
                zip.file(inZipName, blob);
                setStatus(MESSAGES.PRLIB_PAGE_ADDED_ZIP(i, end));
            }

            if (Object.keys(zip.files).length === 0) {
                throw new Error("Не удалось добавить ни одного файла в ZIP (Президентская библиотека).");
            }

            setStatus(MESSAGES.ZIP_GENERATING);
            const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
                 if (metadata.percent) setStatus(MESSAGES.ZIP_GENERATING_PROGRESS(Math.round(metadata.percent)));
            });
            const zipUrl = URL.createObjectURL(zipBlob);
            const zipName = truncateFilename(`${itemTitle} (Стр. ${start}-${end}).zip`);

            setStatus(MESSAGES.ZIP_DOWNLOADING);
            await downloadFile({ url: zipUrl, filename: zipName });
            URL.revokeObjectURL(zipUrl);

            setStatus(MESSAGES.ZIP_DOWNLOAD_SUCCESS);
            showNotification("ZIP скачан (Президентская библиотека)", `Файл "${zipName}" успешно загружен!`);
        } else {
            // Скачивание отдельных файлов
            setStatus(MESSAGES.PRLIB_DOWNLOADING_PAGES(start, end));
            for (let i = start; i <= end; i++) {
                const pageIndexInFilesArray = i - 1;
                 if (!files || !files[pageIndexInFilesArray]) {
                     console.warn(`Файл для страницы ${i} не найден в массиве files. Пропуск.`);
                     setStatus(`Страница ${i}: файл не найден, пропускаю.`, true);
                     continue;
                }
                const fileNameOnServer = files[pageIndexInFilesArray];
                setStatus(MESSAGES.PRLIB_PAGE_DOWNLOADING(i, end));
                const blob = await assembleTiledImagePrLib(itemTitle, fileNameOnServer, fileGroup);
                const filename = truncateFilename(`${itemTitle}-${i}.jpeg`);
                const blobUrl = URL.createObjectURL(blob);
                await downloadFile({ url: blobUrl, filename: filename });
                URL.revokeObjectURL(blobUrl); // Освобождаем память
            }
            setStatus("Все запрошенные изображения (Президентская библиотека) успешно скачаны.");
            showNotification("Скачивание завершено (Президентская библиотека)", `Страницы ${start}–${end} скачаны.`);
        }

    } catch (err) {
        console.error("Ошибка при загрузке (Президентская библиотека):", err);
        setStatus(`Ошибка (ПБ): ${err.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}


// --- Логика ZIP-загрузки (специфично для Яндекс.Архива) ---

/**
 * Открывает URL в новой неактивной вкладке и ждет ее полной загрузки (Яндекс.Архив).
 * @param {string} url - URL для открытия.
 * @param {string} [pageNumForLog=''] - Номер страницы для логирования.
 * @returns {Promise<number>} - ID загруженной вкладки.
 */
async function navigateToPageAndWaitYA(url, pageNumForLog = '') {
    console.log(`Я.Архив ZIP: Открываю временную вкладку ${pageNumForLog} с URL: ${url}`);
    const tab = await chrome.tabs.create({ url, active: false }); // Открываем в неактивной вкладке
    console.log(`Я.Архив ZIP: Вкладка ${tab.id} создана, ждем загрузки...`);

    return new Promise((resolve, reject) => {
        const timeoutDuration = 35000; // 35 секунд таймаут на загрузку страницы
        let timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.remove(tab.id).catch(e => console.warn(`Я.Архив ZIP: Не удалось закрыть вкладку ${tab.id} по таймауту: ${e}`));
            reject(new Error(`Таймаут загрузки вкладки ${tab.id} (${url}) для Я.Архива.`));
        }, timeoutDuration);

        const listener = (tabId, changeInfo) => {
            if (tabId === tab.id) {
                console.debug(`Я.Архив ZIP: Вкладка ${tabId}, статус: ${changeInfo.status}`);
                if (changeInfo.status === 'complete') {
                    clearTimeout(timeoutId);
                    chrome.tabs.onUpdated.removeListener(listener);
                    // Небольшая задержка, чтобы убедиться, что скрипты на странице выполнились (особенно для получения URL картинки)
                    setTimeout(() => {
                        console.log(`Я.Архив ZIP: Вкладка ${tabId} полностью загружена.`);
                        resolve(tabId);
                    }, 1000); // Увеличил задержку
                } else if (changeInfo.status === 'error' || (changeInfo.error && changeInfo.status !== 'loading')) {
                    clearTimeout(timeoutId);
                    chrome.tabs.onUpdated.removeListener(listener);
                    chrome.tabs.remove(tabId).catch(e => console.warn(`Я.Архив ZIP: Не удалось закрыть вкладку ${tabId} после ошибки: ${e}`));
                    reject(new Error(`Ошибка загрузки вкладки ${tabId} для Я.Архива: ${changeInfo.error || 'статус error'}`));
                }
            }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Проверка на немедленную ошибку создания вкладки
        if (chrome.runtime.lastError) {
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error(`Я.Архив ZIP: Ошибка создания вкладки: ${chrome.runtime.lastError.message}`));
        }
    });
}

/**
 * Обрабатывает скачивание ZIP-архива для Яндекс.Архива.
 * @param {object} params - Параметры: title, startPage, endPage, baseUrl.
 */
async function processZipDownloadYA({ title, startPage, endPage, baseUrl }) {
    if (typeof JSZip !== 'function') {
        throw new Error('Библиотека JSZip не найдена для Яндекс.Архива.');
    }
    setControlsEnabled(false); // Убедимся, что контролы отключены
    setStatus(MESSAGES.ZIP_PREPARING({ start: startPage, end: endPage }));
    const zip = new JSZip();
    const collectedUrls = new Set(); // Для отслеживания дубликатов URL
    let tempTabId = null; // ID временной вкладки

    try {
        for (let page = startPage; page <= endPage; page++) {
            const pageUrl = `${baseUrl}/${page}`;
            setStatus(MESSAGES.ZIP_PAGE_OPENING(page, endPage));
            try {
                tempTabId = await navigateToPageAndWaitYA(pageUrl, `${page}/${endPage}`);
                setStatus(MESSAGES.ZIP_PAGE_IMAGE_URL_WAIT(page, endPage));

                // Запрос URL изображения через background script, передавая ID вкладки
                const imageResponse = await sendMessageToBackground({
                    type: "fetchNextImage",
                    data: { tabId: tempTabId, pageNumber: page }
                });

                if (!imageResponse || imageResponse.status !== 'success' || !imageResponse.data?.url) {
                   console.warn(`Я.Архив ZIP: URL картинки не найден на стр. ${page}. Ответ:`, imageResponse);
                   setStatus(MESSAGES.ZIP_PAGE_EMPTY_IMAGE(page, endPage), true); // Или другое сообщение об ошибке
                   continue; // Пропускаем страницу
                }
                const imageUrl = imageResponse.data.url;

                if (collectedUrls.has(imageUrl)) {
                    console.warn(`Я.Архив ZIP: Дубликат URL (${imageUrl}) для стр. ${page}, пропускаю.`);
                    setStatus(MESSAGES.ZIP_PAGE_DUPLICATE_URL(page, endPage));
                    continue;
                }
                collectedUrls.add(imageUrl);

                setStatus(MESSAGES.ZIP_PAGE_IMAGE_DOWNLOADING(page, endPage));
                const blobResp = await sendMessageToBackground({ type: "fetchImageBlob", data: { url: imageUrl } });

                if (blobResp.status !== 'success' || !blobResp.data?.blob) {
                    throw new Error(blobResp?.error || `Не удалось получить Blob для стр. ${page} (Яндекс.Архив).`);
                }
                // Данные blob приходят как объект {0: байт, 1: байт ... length: N}
                // Преобразуем его в Uint8Array, а затем в Blob
                const blobData = blobResp.data.blob;
                const uint8Array = new Uint8Array(Object.values(blobData));
                const actualBlob = new Blob([uint8Array], { type: blobResp.data.contentType || "image/jpeg" });


                if (actualBlob.size === 0) {
                    console.warn(`Я.Архив ZIP: Изображение для стр. ${page} пустое (0 байт).`);
                    setStatus(MESSAGES.ZIP_PAGE_EMPTY_IMAGE(page, endPage));
                    continue;
                }

                const filenameInZip = truncateFilename(`${title} - ${page}.jpeg`, 90); // Имя файла внутри ZIP
                zip.file(filenameInZip, actualBlob);
                setStatus(MESSAGES.ZIP_PAGE_ADDED(page, endPage));

            } catch (pageError) {
                console.error(`Я.Архив ZIP: Ошибка на стр. ${page}:`, pageError);
                // Показываем краткое сообщение об ошибке
                setStatus(`Стр. ${page}/${endPage}: Ошибка (${pageError.message.substring(0, 30)}...), пропускаю.`, true);
            } finally {
                if (tempTabId) {
                    await chrome.tabs.remove(tempTabId).catch(e => console.warn(`Я.Архив ZIP: Не удалось закрыть вкладку ${tempTabId}: ${e}`));
                    tempTabId = null;
                }
            }
        }

        if (Object.keys(zip.files).length === 0) {
            throw new Error("Не удалось добавить ни одного файла в ZIP (Яндекс.Архив). Возможно, все страницы вернули ошибки.");
        }

        setStatus(MESSAGES.ZIP_GENERATING);
        const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
            const percent = Math.round(metadata.percent);
            if (percent % 5 === 0 || percent === 100) { // Обновляем статус чаще или при 100%
                setStatus(MESSAGES.ZIP_GENERATING_PROGRESS(percent));
            }
        });

        const zipName = truncateFilename(`${title} (Стр. ${startPage}-${endPage}).zip`);
        const zipUrl = URL.createObjectURL(zipBlob);

        setStatus(MESSAGES.ZIP_DOWNLOADING);
        await downloadFile({ url: zipUrl, filename: zipName });
        URL.revokeObjectURL(zipUrl); // Освобождаем память

        setStatus(MESSAGES.ZIP_DOWNLOAD_SUCCESS);
        showNotification("Скачивание ZIP (Яндекс.Архив)", `Файл "${zipName}" успешно скачан.`);
    } catch (zipError) {
        console.error(`Я.Архив ZIP: Общая ошибка процесса:`, zipError);
        setStatus(`Ошибка ZIP (Яндекс.Архив): ${zipError.message}`, true);
        // Не перебрасываем ошибку, чтобы finally отработал и включил контролы
    } finally {
        setControlsEnabled(true); // Включаем контролы в любом случае
    }
}


// --- Проверка версии ---
/** Проверяет наличие обновлений расширения. */
async function checkExtensionVersion() {
    const messageList = domElements.messageList;
    if (!messageList) {
        console.warn("Элемент messageList не найден, проверка версии отменена.");
        return;
    }

    try {
        const response = await fetch(GITHUB_MANIFEST_URL, { cache: "no-cache" }); // Запрос без кэширования
        if (!response.ok) throw new Error(`Ошибка загрузки manifest.json с GitHub: ${response.status} ${response.statusText}`);
        const remoteManifest = await response.json();
        const latestVersion = remoteManifest.version;
        if (!latestVersion) throw new Error("Поле 'version' отсутствует в удаленном manifest.json");

        const currentVersion = chrome.runtime.getManifest().version;
        console.log(`Проверка версии: Текущая: ${currentVersion}, Последняя с GitHub: ${latestVersion}`);

        // Функция для сравнения версий (v2 > v1)
        const isNewerVersion = (v1, v2) => {
            const s1 = v1.split('.').map(Number);
            const s2 = v2.split('.').map(Number);
            for (let i = 0; i < Math.max(s1.length, s2.length); i++) {
                const n1 = s1[i] || 0; // Если сегмента нет, считаем его 0
                const n2 = s2[i] || 0;
                if (n2 > n1) return true;
                if (n2 < n1) return false;
            }
            return false; // Версии равны
        };

        let versionLi = document.getElementById('version-status');
        if (!versionLi) {
            versionLi = document.createElement('li');
            versionLi.id = 'version-status';
            // Вставляем сообщение о версии перед другими сообщениями или в конец, если список пуст
            if (messageList.firstChild) {
                messageList.insertBefore(versionLi, messageList.firstChild);
            } else {
                messageList.appendChild(versionLi);
            }
        }


        if (isNewerVersion(currentVersion, latestVersion)) {
            versionLi.textContent = MESSAGES.VERSION_NEW_AVAILABLE(latestVersion, currentVersion);
            versionLi.style.color = 'orange';

            let updateButton = document.getElementById('updateExtensionBtn');
            if (!updateButton) {
                updateButton = document.createElement('button');
                updateButton.id = 'updateExtensionBtn';
                updateButton.textContent = "Обновить";
                updateButton.style.marginTop = '5px';
                updateButton.style.display = 'block'; // Для лучшего расположения
                updateButton.addEventListener('click', () => chrome.tabs.create({ url: GITHUB_REPO_URL }));
                versionLi.appendChild(updateButton); // Добавляем кнопку как дочерний элемент li
            }
        } else {
            versionLi.textContent = MESSAGES.VERSION_LATEST(currentVersion);
            versionLi.style.color = 'green';
            // Удаляем кнопку "Обновить", если она есть и версия актуальна
            let existingButton = document.getElementById('updateExtensionBtn');
            if (existingButton) existingButton.remove();
        }

    } catch (error) {
        console.error("Ошибка проверки версии расширения:", error);
        let errorLi = document.getElementById('version-status-error');
        if(!errorLi){
            errorLi = document.createElement('li');
            errorLi.id = 'version-status-error';
            if (messageList.firstChild) {
                messageList.insertBefore(errorLi, messageList.firstChild);
            } else {
                messageList.appendChild(errorLi);
            }
        }
        errorLi.textContent = MESSAGES.VERSION_CHECK_ERROR;
        errorLi.style.color = 'red';
    }
}


// --- Инициализация ---

/**
 * Устанавливает обработчики событий в зависимости от типа сайта.
 * @param {string|null} siteName - Имя активного сайта (из SITES.name) или null.
 */
function setupEventListeners(siteName) {
    // Удаляем предыдущие обработчики, клонируя и заменяя узлы (чтобы избежать дублирования)
    const reCacheAndListen = (elementKey, event, handler) => {
        if (domElements[elementKey]) {
            const oldElement = domElements[elementKey];
            const newElement = oldElement.cloneNode(true);
            oldElement.parentNode.replaceChild(newElement, oldElement);
            domElements[elementKey] = newElement; // Обновляем ссылку в кэше
            domElements[elementKey].addEventListener(event, handler);
        }
    };

    if (siteName === SITES.YANDEX_ARCHIVE.name) {
        reCacheAndListen('downloadBtn', "click", handleDownloadCurrentYA);
        reCacheAndListen('downloadAllBtn', "click", handleDownloadAllYA);
        reCacheAndListen('downloadRangeBtn', "click", handleDownloadRangeYA);
    } else if (siteName === SITES.GOSKATALOG.name) {
        reCacheAndListen('downloadLotBtn', "click", handleDownloadLotGoskatalog);
    } else if (siteName === SITES.PRLIB.name) {
        // Для PrLib кнопка downloadPageBtn, но обработчик handleDownloadPagesPrLib
        reCacheAndListen('downloadPageBtn', "click", handleDownloadPagesPrLib);
    }
    console.log(`Обработчики событий установлены для: ${siteName || 'Нет активного сайта'}`);
}

/**
 * Обновляет видимость элементов UI в зависимости от активного сайта.
 * @param {object|null} activeSite - Объект активного сайта из SITES или null.
 */
function updateUIVisibility(activeSite) {
    // Сначала скрываем все элементы, специфичные для сайтов
    Object.values(SITES).forEach(siteConfig => {
        siteConfig.elements.forEach(elId => {
            if (domElements[elId]) domElements[elId].style.display = "none";
        });
    });
    // Также скрываем элементы, которые могут быть общими, но контекстно скрыты (например, метка для zipMode)
    if (domElements.zipModeLabel) domElements.zipModeLabel.style.display = "none";

    if (activeSite) {
        domElements.popupHeader.textContent = activeSite.name;
        // Показываем элементы для активного сайта
        activeSite.elements.forEach(elId => {
            if (domElements[elId]) {
                // Для контейнеров (например, 'zipModeContainer', 'rangeInputContainer')
                // может потребоваться display: 'flex' или 'block', а не просто ''
                if (elId.endsWith('Container') || elId === 'rangeInputContainer') {
                     domElements[elId].style.display = ""; // Или "flex" / "block", если CSS это предполагает
                } else {
                     domElements[elId].style.display = ""; // По умолчанию display: '' восстановит исходное значение
                }
            } else {
                console.warn(`Элемент UI с ID "${elId}" для сайта "${activeSite.name}" не найден в DOM.`);
            }
        });
        // Особый случай для метки zipMode в Президентской библиотеке
        if (activeSite === SITES.PRLIB && domElements.zipModeLabel) {
            domElements.zipModeLabel.style.display = ""; // Восстанавливаем видимость
        }

    } else {
        domElements.popupHeader.textContent = MESSAGES.UNSUPPORTED_SITE;
        setStatus(MESSAGES.SUPPORTED_SITES_INFO, true); // Показываем список поддерживаемых сайтов
    }
    console.log(`Видимость UI обновлена для: ${activeSite ? activeSite.name : 'Неподдерживаемый сайт'}`);
}


/** Основная функция инициализации всплывающего окна. */
async function initializePopup() {
    cacheDOMElements(); // Кэшируем элементы в первую очередь
    clearStatus();
    setControlsEnabled(false); // Отключаем контролы на время инициализации
    setStatus(MESSAGES.INIT);

    // Базовая проверка наличия ключевых DOM-элементов
    if (!domElements.messageList || !domElements.popupHeader) {
        console.error("Критическая ошибка: Ключевые элементы UI (messageList, popupHeader) не найдены!");
        if (domElements.popupHeader) domElements.popupHeader.textContent = MESSAGES.INIT_ERROR;
        setStatus("Критическая ошибка: отсутствуют элементы UI.", true);
        return; // Дальнейшая работа невозможна
    }


    try {
        const tab = await getActiveTab();
        const url = tab.url || ""; // Убедимся, что url не undefined
        let activeSite = null;

        // Определяем активный сайт
        if (SITES.YANDEX_ARCHIVE.regex.test(url)) activeSite = SITES.YANDEX_ARCHIVE;
        else if (SITES.GOSKATALOG.regex.test(url)) activeSite = SITES.GOSKATALOG;
        else if (SITES.PRLIB.regex.test(url)) activeSite = SITES.PRLIB;

        updateUIVisibility(activeSite); // Обновляем видимость элементов UI

        if (activeSite) {
            // Проверка наличия всех ожидаемых элементов для активного сайта
            const siteElementsFound = activeSite.elements.every(elId => domElements[elId]);
            if (!siteElementsFound) {
                 setStatus(`Ошибка: Не все элементы для сайта "${activeSite.name}" найдены в DOM! Функциональность может быть нарушена.`, true);
                 console.error(`Отсутствуют некоторые DOM-элементы для сайта "${activeSite.name}". Ожидались:`, activeSite.elements);
                 // Можно решить не продолжать, если критичные элементы отсутствуют, или позволить частичную работу
                 // return;
            }

            // Специфичная для сайта инициализация
            if (activeSite === SITES.YANDEX_ARCHIVE) {
                try {
                    const allInfo = await requestAllInfoYA(); // Загружаем title, totalPages, baseUrl
                    if (allInfo.totalPages === "unknown" || parseInt(allInfo.totalPages, 10) <= 0) {
                        if (domElements.downloadAllBtn) domElements.downloadAllBtn.disabled = true; // Отключаем кнопку "Скачать все"
                        setStatus(`Я.Архив: Общее кол-во страниц неизвестно. Скачивание всего документа недоступно.`);
                    } else {
                        setStatus(`Документ (Я.Архив): ${allInfo.title || 'Без названия'}, ${allInfo.totalPages} стр.`);
                    }
                } catch (infoError) {
                    setStatus(`Не удалось получить инфо о документе (Я.Архив): ${infoError.message.substring(0,100)}...`, true);
                    // Не отключаем все контролы, скачивание текущей страницы может все еще работать
                }
            } else if (activeSite === SITES.GOSKATALOG) {
                setStatus("Госкаталог.рф: Готово к скачиванию изображений лота.");
            } else if (activeSite === SITES.PRLIB) {
                if (domElements.downloadPageBtn) domElements.downloadPageBtn.disabled = true; // Отключаем до загрузки инфо
                await requestDocumentInfoPrLib(); // Загружает и отображает инфо, включает кнопку при успехе
                // Кнопка будет включена внутри requestDocumentInfoPrLib или здесь, если данные уже есть
                if (domElements.downloadPageBtn && prlibCurrentDocumentInfo) {
                     domElements.downloadPageBtn.disabled = false;
                } else if (domElements.downloadPageBtn) {
                    // Если prlibCurrentDocumentInfo все еще null после запроса, значит была ошибка
                    domElements.downloadPageBtn.disabled = true;
                }
            }

            setupEventListeners(activeSite.name); // Устанавливаем обработчики событий
            setControlsEnabled(true); // Включаем контролы после успешной инициализации для сайта
            // Сообщение о статусе уже установлено специфической логикой сайта или updateUIVisibility

        } else {
            // Неподдерживаемый сайт, сообщение уже установлено updateUIVisibility
            console.log("Открыт неподдерживаемый сайт.");
            return; // Дальнейшая настройка не требуется
        }

    } catch (error) {
        console.error("Ошибка инициализации всплывающего окна:", error);
        if (domElements.popupHeader) domElements.popupHeader.textContent = MESSAGES.INIT_ERROR;
        setStatus(error.message || MESSAGES.UNKNOWN_ERROR, true);
        setControlsEnabled(false); // Отключаем все контролы при общей ошибке инициализации
    }
}

// --- Точка входа ---
document.addEventListener('DOMContentLoaded', () => {
    initializePopup(); // Основная инициализация
    checkExtensionVersion(); // Проверка обновлений после основной инициализации
});