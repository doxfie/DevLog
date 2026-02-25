# Changelog

## [1.0.0] — 2026-02-25

Первый стабильный релиз. Дневник учёбы с авторизацией и деплоем на VPS.

### Возможности

- Учёт сессий (дата, время, перерывы, заметки), черновик формы, удаление с откатом
- Дашборд: графики по неделям/месяцам, KPI-карточки, пороги целей
- Итоги и цели по неделям, итоги месяца
- Настройки: пороги на графиках, блок «О приложении» (версия, статистика)
- Авторизация: один пользователь, логин/пароль из `.env`, сессии (express-session + bcrypt)
- Docker: образ Node 20 Bookworm Slim, порт только на 127.0.0.1
- CI/CD: GitHub Actions — fetch + reset --hard, docker compose up --build
- Документация: первая установка на VPS (Ubuntu 22.04/24.04), Nginx, HTTPS, rate-limit на POST /login, UFW, два ключа (Deploy Key и SSH для Actions)

### Технические требования

- Node.js 20+
- Продакшен: Docker, Nginx, домен для SSL

[1.0.0]: https://github.com/doxfie/DevLog/releases/tag/v1.0.0

---

## [0.9.0] — 2026-02-23

Предрелиз: авторизация, Docker, CI/CD, базовая инструкция по VPS.

[0.9.0]: https://github.com/doxfie/DevLog/releases/tag/v0.9.0
