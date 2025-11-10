# API Documentation

## Основные модули

### VaultReader
Модуль для работы с файловой системой и чтения .md файлов из хранилища Obsidian.

#### Методы

##### `getMarkdownFiles(vaultPath)`
Получает список всех markdown файлов в хранилище.

**Параметры:**
- `vaultPath` (string): Путь к хранилищу Obsidian

**Возвращает:**
- `Promise<Array<string>>`: Массив путей к файлам

##### `readFile(filePath)`
Читает и парсит markdown файл.

**Параметры:**
- `filePath` (string): Путь к файлу

**Возвращает:**
- `Promise<Object>`: Объект с данными файла
  - `path` (string): Путь к файлу
  - `name` (string): Имя файла без расширения
  - `content` (string): Содержимое файла
  - `textContent` (string): Текстовое содержимое (без markdown разметки)
  - `size` (number): Размер файла в байтах
  - `modified` (Date): Дата последнего изменения

##### `getFileMetadata(filePath)`
Получает метаданные файла для кэширования.

**Параметры:**
- `filePath` (string): Путь к файлу

**Возвращает:**
- `Promise<Object>`: Метаданные файла
  - `path` (string): Путь к файлу
  - `size` (number): Размер файла в байтах
  - `modified` (number): Время последнего изменения в миллисекундах

### NLPProcessor
Модуль для обработки естественного языка и извлечения эмбеддингов.

#### Методы

##### `extractEmbeddings(text, fileMetadata)`
Извлекает эмбеддинги из текста с использованием кэширования.

**Параметры:**
- `text` (string): Входной текст
- `fileMetadata` (Object, опционально): Метаданные файла для кэширования

**Возвращает:**
- `Promise<Array<number>>`: Вектор эмбеддингов

##### `calculateSimilarity(text1, text2)`
Вычисляет схожесть между двумя текстами.

**Параметры:**
- `text1` (string): Первый текст
- `text2` (string): Второй текст

**Возвращает:**
- `Promise<number>`: Коэффициент схожести (0-1)

##### `cosineSimilarity(vec1, vec2)`
Вычисляет косинусное сходство между двумя векторами.

**Параметры:**
- `vec1` (Array<number>): Первый вектор
- `vec2` (Array<number>): Второй вектор

**Возвращает:**
- `number`: Косинусное сходство (0-1)

##### `batchExtractEmbeddings(texts, fileMetadataList)`
Пакетная обработка текстов для извлечения эмбеддингов.

**Параметры:**
- `texts` (Array<string>): Массив текстов
- `fileMetadataList` (Array<Object>, опционально): Массив метаданных файлов

**Возвращает:**
- `Promise<Array<Array<number>>>`: Массив векторов эмбеддингов

### LinkFinder
Модуль для поиска концептуальных связей между заметками.

#### Методы

##### `findLinks(notes, options)`
Находит концептуальные связи между заметками.

**Параметры:**
- `notes` (Array<Object>): Массив объектов заметок
- `options` (Object, опционально): Опции поиска
  - `threshold` (number): Порог схожести (по умолчанию: 0.5)
  - `maxLinksPerNote` (number): Максимум связей на заметку (по умолчанию: 10)

**Возвращает:**
- `Promise<Array<Object>>`: Массив связей
  - `source` (string): Имя исходной заметки
  - `target` (string): Имя целевой заметки
  - `similarity` (number): Коэффициент схожести
  - `sourcePath` (string): Путь к исходной заметке
  - `targetPath` (string): Путь к целевой заметке

##### `findLinksForNote(sourceNote, allNotes, options)`
Находит связи для конкретной заметки.

**Параметры:**
- `sourceNote` (Object): Исходная заметка
- `allNotes` (Array<Object>): Все заметки для сравнения
- `options` (Object, опционально): Опции поиска

**Возвращает:**
- `Promise<Array<Object>>`: Массив связей

##### `setSimilarityThreshold(threshold)`
Устанавливает порог схожести.

**Параметры:**
- `threshold` (number): Порог схожести (0-1)

##### `setMaxLinksPerNote(maxLinks)`
Устанавливает максимальное количество связей на заметку.

**Параметры:**
- `maxLinks` (number): Максимум связей на заметку

### CacheManager
Модуль для управления кэшированием данных.

#### Методы

##### `initialize()`
Инициализирует менеджер кэша.

**Возвращает:**
- `Promise<void>`

##### `isCacheValid(filePath, currentStats)`
Проверяет валидность кэша для файла.

**Параметры:**
- `filePath` (string): Путь к файлу
- `currentStats` (Object): Текущие метаданные файла

**Возвращает:**
- `boolean`: Валидность кэша

##### `getCachedEmbeddings(filePath)`
Получает кэшированные эмбеддинги для файла.

**Параметры:**
- `filePath` (string): Путь к файлу

**Возвращает:**
- `Promise<Array<number>|null>`: Эмбеддинги или null

##### `cacheEmbeddings(filePath, embeddings, fileStats)`
Кэширует эмбеддинги для файла.

**Параметры:**
- `filePath` (string): Путь к файлу
- `embeddings` (Array<number>): Эмбеддинги
- `fileStats` (Object): Метаданные файла

##### `clearCache()`
Очищает весь кэш.

**Возвращает:**
- `Promise<void>`

##### `getCacheStats()`
Получает статистику кэша.

**Возвращает:**
- `Object`: Статистика кэша
  - `memoryCacheSize` (number): Размер кэша в памяти
  - `diskCacheSize` (number): Размер кэша на диске
  - `cacheDir` (string): Директория кэша

### LinkInserter
Модуль для вставки найденных концептуальных связей в файлы заметок Obsidian.

#### Методы

##### `insertLinks(resultsPath, options)`
Вставляет концептуальные связи в файлы заметок на основе результатов анализа.

**Параметры:**
- `resultsPath` (string): Путь к файлу с результатами анализа (JSON)
- `options` (Object, опционально): Опции вставки
  - `sectionTitle` (string): Заголовок для раздела связей (по умолчанию: "Связанные заметки")
  - `groupBy` (string): Критерий группировки связей (по умолчанию: "file")
  - `limit` (number): Ограничение количества связей на файл

**Возвращает:**
- `Promise<void>`

##### `removeInsertedLinks(resultsPath)`
Удаляет вставленные связи из файлов заметок.

**Параметры:**
- `resultsPath` (string): Путь к файлу с результатами анализа (JSON)

**Возвращает:**
- `Promise<void>`