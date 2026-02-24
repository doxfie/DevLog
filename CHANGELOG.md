# Changelog

## [0.9.0] — 2026-02-23

Первый публичный релиз. Готовность к деплою на VPS.

### Добавлено

- **Авторизация** — форма входа, сессии (express-session + bcrypt), защита API и статики
- **Docker** — multi-stage Dockerfile, docker-compose с volume для БД
- **CI/CD** — GitHub Actions: push в `main` → SSH на VPS, `git pull`, `docker compose up --build`
- **Документация** — инструкция по настройке VPS (Ubuntu 24.04, Nginx, Certbot, первый деплой)
- **UI** — страница логина в стиле dark-premium

### Технические изменения

- `db.js`: путь к БД настраивается через `DB_PATH`
- `.env.example` — шаблон переменных для авторизации и сессии
- `.gitignore` — исключены `.cursor/`, `.agents/`, `skills-lock.json`

### Требования

- Node.js 20+
- Для продакшена: Docker, Nginx, домен для SSL

[0.9.0]: https://github.com/doxfie/DevLog/releases/tag/v0.9.0
