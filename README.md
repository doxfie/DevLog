# DevLog — дневник учёбы

**О проекте:** личный веб-дневник учебных сессий — учёт времени, заметки, цели по неделям, дашборд с графиками. Один пользователь, авторизация по логину/паролю, деплой на VPS через Docker. Стек: Node.js, Express, SQLite, vanilla JS, Chart.js.

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
- `npm run backup:telegram` — отправить SQLite-бэкап в Telegram вручную
- `npm run import-excel "путь к .xlsm"` — импорт сессий из Excel


## Бэкапы в Telegram

Поддерживается автоматическая и ручная отправка SQLite-бэкапа в Telegram-чат.

Быстрый запуск (4 шага):

1. Создай Telegram-бота через `@BotFather` и получи токен.
2. Узнай `chat_id` чата/группы, куда слать бэкапы.
3. Заполни в `.env` минимум:
   `TELEGRAM_BOT_TOKEN=...`
   `TELEGRAM_BACKUP_CHAT_ID=...`
4. Проверь отправку вручную: `npm run backup:telegram`.

Обязательные переменные окружения:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BACKUP_CHAT_ID`

Опциональные переменные окружения:

- `TELEGRAM_BACKUP_THREAD_ID`
- `BACKUP_TELEGRAM_ENABLED=true|false`
- `BACKUP_TELEGRAM_AUTORUN=true|false`
- `BACKUP_TELEGRAM_HOUR=4`
- `BACKUP_TELEGRAM_MINUTE=10`
- `BACKUP_TELEGRAM_KEEP_FILES=14`
- `BACKUP_TELEGRAM_DIR=./backups`
- `APP_TIMEZONE=Asia/Omsk`

Ручной запуск:

```bash
npm run backup:telegram
```

При включенном автозапуске сервер проверяет время и отправляет один бэкап в день в заданные час/минуту.

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
backup-telegram.js     Telegram-бэкап: создание/отправка бэкапа и планировщик
backup-telegram-cli.js Ручной запуск Telegram-бэкапа
import-from-excel.js   Утилита импорта из Excel
Dockerfile             Node 20 Bookworm Slim (glibc → быстрая сборка без компиляции better-sqlite3)
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

## Первая установка на VPS (Ubuntu 22.04 / 24.04)

Цель: DevLog доступен по https://devlog.doxfie.top/login; контейнер слушает только 127.0.0.1:3000; Nginx на 443 + редирект 80→443; rate-limit на POST /login; UFW: SSH (порт 9720), 80, 443.

### 1. Подготовка сервера

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx certbot python3-certbot-nginx
```

**Docker:** если ещё не установлен:

```bash
curl -fsSL https://get.docker.com | sh
```

Если Docker уже есть (например после Remnawave node) — шаг выше пропустить.

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Клонирование репозитория (приватная репа → SSH Deploy Key)

На VPS создаётся отдельный ключ только для git (Deploy Key), не для входа на сервер.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/devlog_deploy -N ""
chmod 700 ~/.ssh
chmod 600 ~/.ssh/devlog_deploy ~/.ssh/devlog_deploy.pub
cat ~/.ssh/devlog_deploy.pub
```

**GitHub:** Repo → **Settings** → **Deploy keys** → **Add deploy key**. Вставить вывод `cat ~/.ssh/devlog_deploy.pub`. Read-only, без «Allow write access».

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  User git
  IdentityFile ~/.ssh/devlog_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
# При первом: yes (host key в ~/.ssh/known_hosts). Ожидай: "Hi doxfie/DevLog! ..."
```

```bash
sudo mkdir -p /opt/devlog
sudo chown $USER:$USER /opt/devlog
cd /opt/devlog
git clone git@github.com:doxfie/DevLog.git .
```

### 3. .env и bcrypt

```bash
cd /opt/devlog
openssl rand -hex 32
# Сохрани вывод — это SESSION_SECRET
```

Собрать образ и сгенерировать пароль + bcrypt-хеш (через devlog-app, не node:20-alpine):

```bash
docker compose build
PASS="$(openssl rand -base64 24)"
echo "Пароль для входа (сохрани): $PASS"
docker run --rm -e PASS="$PASS" devlog-app \
  node -e "import('bcrypt').then(b=>b.default.hash(process.env.PASS,12).then(console.log))"
# Сохрани вывод — это хеш для AUTH_PASS_HASH
```

Создать `.env`. **Важно:** в значении `AUTH_PASS_HASH` каждый символ `$` в хеше записать как `$$` (иначе docker compose выдаёт «variable is not set» и пароль пустой).

```bash
nano .env
# Содержимое (подставь свои значения, в хеше — $$ вместо $):
# PORT=3000
# SESSION_SECRET=вывод_openssl_rand_hex_32
# AUTH_USER=admin
# AUTH_PASS_HASH=$$2b$$12$$...  (каждый $ в хеше два раза)
# DB_PATH=/app/data/devlog.db

chmod 600 .env
ls -la .env
# .env — скрытый файл (ls -la покажет)
```

### 4. Запуск контейнера

```bash
cd /opt/devlog
mkdir -p data
docker compose up -d --build
curl -I http://127.0.0.1:3000/login
# Ожидай: HTTP/1.1 200 OK
```

### 5. Закрыть порт 3000 снаружи

В проекте уже задано `127.0.0.1:3000:3000` в `docker-compose.yml`. Если менял — верни и перезапусти:

```bash
cd /opt/devlog
docker compose up -d
ss -ltnp | grep :3000
# Должно быть 127.0.0.1:3000, не 0.0.0.0:3000
```

### 6. Nginx + HTTPS

Если каталога `/etc/nginx` нет — nginx не установлен: `sudo apt install -y nginx certbot python3-certbot-nginx`.

**UFW** (если включён): открыть 80 и 443, SSH на кастомном порту 9720:

```bash
sudo ufw allow 9720/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
sudo ufw enable
```

**Rate-limit только для POST /login** (5 req/min, burst 5). Создать файл зоны:

```bash
sudo tee /etc/nginx/conf.d/devlog_rate_limit.conf << 'EOF'
map $request_method $devlog_limit_key {
    default "";
    POST $binary_remote_addr;
}
limit_req_zone $devlog_limit_key zone=devlog_login:10m rate=5r/m;
EOF
```

**Временный конфиг для выпуска сертификата:**

```bash
sudo tee /etc/nginx/sites-available/devlog << 'EOF'
server {
    listen 80;
    server_name devlog.doxfie.top;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/devlog /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d devlog.doxfie.top
```

**Финальный конфиг (443, редирект 80→443, rate-limit только на POST /login):**

```bash
sudo tee /etc/nginx/sites-available/devlog << 'EOF'
server {
    listen 80;
    server_name devlog.doxfie.top;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name devlog.doxfie.top;

    ssl_certificate     /etc/letsencrypt/live/devlog.doxfie.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/devlog.doxfie.top/privkey.pem;

    location = /login {
        limit_req zone=devlog_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

Проверка: `curl -I https://devlog.doxfie.top/login` — ожидай 200 OK. Лимит 5 req/min считает только POST на /login (GET не учитывается благодаря map в `devlog_rate_limit.conf`).

### 7. Автодеплой (GitHub Actions)

Используются **два разных ключа**:

| Назначение | Ключ | Где хранится |
|------------|------|----------------|
| Git clone приватной репы на VPS | Deploy Key `devlog_deploy` | VPS: `~/.ssh/devlog_deploy`, GitHub: Repo → Settings → Deploy keys |
| Вход GitHub Actions на VPS | Отдельный SSH-ключ | GitHub: Secrets (приватный ключ), VPS: `~/.ssh/authorized_keys` (публичный) |

**Secrets** в репозитории (Settings → Secrets and variables → Actions):

| Secret | Значение |
|--------|----------|
| `VPS_HOST` | IP или домен VPS (например doxfie.top или 1.2.3.4) |
| `VPS_USER` | Пользователь SSH (например doxfie) |
| `VPS_PORT` | Порт SSH (например 9720) |
| `VPS_SSH_KEY` | Приватный ключ целиком (содержимое id_ed25519 **без** .pub) |

На VPS в `~/.ssh/authorized_keys` должен быть добавлен **публичный** ключ того ключа, приватная часть которого лежит в `VPS_SSH_KEY`.

Workflow при push в `main`: подключается по SSH (порт из `VPS_PORT`), в каталоге `/opt/devlog` выполняет `git pull origin main` и `docker compose up -d --build`.

### 8. Типовые проблемы

- **bcrypt: «variable is not set», пустой пароль** — в `.env` каждый `$` в хеше заменить на `$$`.
- **«no configuration file provided»** — выполнять команды docker compose из каталога проекта: `cd /opt/devlog`.
- **Порт 3000 виден снаружи** — в `docker-compose.yml` должно быть `127.0.0.1:3000:3000`; проверить: `ss -ltnp | grep :3000`.
- **Нет /etc/nginx** — nginx не установлен: `sudo apt install -y nginx certbot python3-certbot-nginx`.

---

## Релизы и «About» на GitHub

### Краткое описание репозитория (About)

В правом столбце страницы репозитория нажми **About** (шестерёнка) и укажи:

- **Description:** `Личный веб-дневник учебных сессий: учёт времени, заметки, дашборд. Node, Express, SQLite, Docker.`
- **Website:** URL приложения (если уже задеплоено).
- При желании: Topics — `nodejs`, `express`, `sqlite`, `docker`, `study-log`.

### Как сделать релиз (Release) на GitHub

1. Закоммить и запушь все изменения (в т.ч. удаление лишних файлов и обновление `.gitignore`).
2. На GitHub открой репозиторий → вкладка **Releases** → **Create a new release**.
3. **Choose a tag:** введи тег, например `v0.9.0` → **Create new tag: v0.9.0** (релиз с этого коммита).
4. **Release title:** например `v0.9.0 — первый релиз, готовность к деплою`.
5. В описание вставь содержимое из [CHANGELOG.md](CHANGELOG.md) для этой версии (или кратко: авторизация, Docker, CI/CD, инструкция по VPS).
6. Поставь галку **Set as the latest release**.
7. Нажми **Publish release**.

Дальше для новых версий: правишь `version` в `package.json`, дополняешь `CHANGELOG.md`, коммитишь, создаёшь тег (например `v0.10.0`) и новый Release с описанием из CHANGELOG.
