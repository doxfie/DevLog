# DevLog — дневник учёбы

Веб-приложение для учёта учебных сессий на Skillbox. Бэкенд Node + Express + SQLite, фронтенд — ванильный JS (ES-модули) + Chart.js.

## Возможности

- **Учёт сессий** — дата, начало/конец, перерывы, заметки. Автоподстановка даты и времени (Asia/Omsk).
- **Таймер паузы** — встроенный таймер перерыва с сохранением состояния.
- **Итоги и цели** — недельные итоги, цели на следующую неделю с чекбоксами, итоги месяца.
- **Дашборд** — графики «часы по неделям» и «часы по месяцам» (Chart.js), кастомные тултипы, пороги целей.
- **Настройки** — пороги часов для графиков (неделя/месяц).
- **Черновик формы** — данные сохраняются в localStorage, не теряются при перезагрузке.
- **Удаление с откатом** — toast с кнопкой «Отменить» после удаления сессии.
- **Авторизация** — однопользовательский режим (логин/пароль через `.env`).

## Требования

Node.js 20+ (https://nodejs.org/).

## Локальный запуск

```bash
cp .env.example .env
# Отредактируй .env — задай пароль (см. ниже)
npm install
npm run dev
```

Открыть http://localhost:3000

## Скрипты

- `npm start` — запуск сервера
- `npm run dev` — сервер с автоперезапуском (--watch)
- `npm run import-excel "путь к .xlsm"` — импорт сессий из Excel

## Настройка авторизации

Сгенерировать хеш пароля:

```bash
node -e "import('bcrypt').then(b=>b.default.hash('ТВОЙ_ПАРОЛЬ',12).then(console.log))"
```

Записать в `.env`:

```
AUTH_USER=admin
AUTH_PASS_HASH=$2b$12$...полученный_хеш...
SESSION_SECRET=случайная-строка-32+символов
```

Если `AUTH_PASS_HASH` пуст — авторизация отключена (dev mode).

## Структура проекта

```
server.js              Express-сервер, API, авторизация, статика
db.js                  SQLite: схема, CRUD сессий и заметок
import-from-excel.js   Утилита импорта из Excel
Dockerfile             Multi-stage build (Node 20 Alpine)
docker-compose.yml     Docker Compose конфигурация
public/
  index.html           SPA: разметка трёх вкладок
  login.html           Страница авторизации
  css/style.css        Стили (тёмная тема, Linear-inspired)
  js/
    app.js             Главный модуль: инициализация, рендеринг, форма
    utils.js           Утилиты: форматирование, даты, DOM-хелперы
    api.js             Fetch-обёртки для всех API-эндпоинтов
    storage.js         localStorage: черновик формы, пауза, настройки
    chart.js           Дашборд: Chart.js, агрегации, тултипы
```

## Стек

- **Бэкенд:** Node.js, Express, better-sqlite3, express-session, bcrypt
- **Фронтенд:** HTML + CSS + JS (ES-модули, без бандлера)
- **Графики:** Chart.js 4.x (CDN)
- **Хранение:** SQLite (сервер), localStorage (клиент)
- **Деплой:** Docker, GitHub Actions, Nginx

---

## Деплой на VPS (Ubuntu 24.04)

### 1. Подготовка сервера

```bash
# Обновить систему
sudo apt update && sudo apt upgrade -y

# Установить Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Перелогиниться, чтобы применить группу

# Установить Nginx и Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Установить Git
sudo apt install -y git
```

### 2. Клонировать репозиторий

```bash
sudo mkdir -p /opt/devlog
sudo chown $USER:$USER /opt/devlog
cd /opt/devlog
git clone https://github.com/ТВОЙ_ЮЗЕР/DevLog.git .
```

### 3. Создать `.env` на сервере

```bash
cd /opt/devlog

# Сгенерировать SESSION_SECRET
openssl rand -hex 32

# Сгенерировать AUTH_PASS_HASH (нужен Node.js или Docker)
docker run --rm node:20-alpine \
  node -e "import('bcrypt').then(b=>b.default.hash('ТВОЙ_ПАРОЛЬ',12).then(console.log))"
```

```bash
cat > .env << 'EOF'
PORT=3000
SESSION_SECRET=сгенерированный_секрет
AUTH_USER=admin
AUTH_PASS_HASH=сгенерированный_хеш
DB_PATH=/app/data/devlog.db
EOF
```

### 4. Первый запуск

```bash
mkdir -p data
docker compose up -d --build
# Проверить: docker compose logs -f
```

### 5. Настройка Nginx (reverse proxy + SSL)

```bash
sudo nano /etc/nginx/sites-available/devlog
```

```nginx
server {
    listen 80;
    server_name ТВОЙ_ДОМЕН;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/devlog /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6. SSL-сертификат (Let's Encrypt)

```bash
sudo certbot --nginx -d ТВОЙ_ДОМЕН
# Certbot автоматически обновит nginx-конфиг для HTTPS
```

### 7. GitHub Actions Secrets

В репозитории GitHub: **Settings → Secrets and variables → Actions** — добавить:

| Secret | Значение |
|--------|----------|
| `VPS_HOST` | IP-адрес или домен VPS |
| `VPS_USER` | SSH-пользователь (напр. `deploy`) |
| `VPS_SSH_KEY` | Приватный SSH-ключ (содержимое `~/.ssh/id_ed25519`) |

На VPS — добавить публичный ключ в `~/.ssh/authorized_keys`.

### Обновление

После push в `main` GitHub Actions автоматически:
1. Подключается по SSH к VPS
2. Выполняет `git pull`
3. Пересобирает и перезапускает Docker-контейнер
