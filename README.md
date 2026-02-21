# DevLog — дневник учёбы

Веб-дневник: сессии, расчёт времени, дашборд с графиками. Бэкенд Node + Express + SQLite, фронт на ванильном JS.

- **Время:** омское (Asia/Omsk), автоподстановка даты/времени при создании сессии.
- **Длительность:** реальная (конец сессии может быть на следующий день).

## Требования

Node.js LTS (https://nodejs.org/).

## Запуск

```bash
npm install
npm run dev
```

Открыть http://localhost:3000

## Скрипты

- `npm run dev` — сервер с автоперезапуском
- `npm run clear-db` — очистка БД
- `npm run import-excel "путь к .xlsm"` — импорт сессий и итогов из Excel

## Структура

- `server.js` — Express, API, статика
- `db.js` — SQLite, схема, сессии и недельные заметки
- `clear-db.js` — очистка БД
- `import-from-excel.js` — импорт из Excel
- `public/` — фронт (index.html, css/style.css, js/app.js)
