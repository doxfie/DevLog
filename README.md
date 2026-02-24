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

**Приватный репозиторий:** при `git clone https://...` GitHub запросит Username/Password; пароль аккаунта не подойдёт. Используй SSH (Deploy Key без PAT).

**2.1. SSH Deploy Key на VPS**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/devlog_deploy -N ""
chmod 600 ~/.ssh/devlog_deploy ~/.ssh/devlog_deploy.pub
```

Добавь в `~/.ssh/config`:

```
Host github.com
  User git
  IdentityFile ~/.ssh/devlog_deploy
  IdentitiesOnly yes
```

**2.2. Добавить ключ на GitHub**

Репозиторий → **Settings** → **Deploy keys** → **Add deploy key**.  
Вставь содержимое `~/.ssh/devlog_deploy.pub`. Read-only, без галки «Allow write access».

**2.3. Проверка и клонирование**

```bash
ssh -T git@github.com
# При первом подключении: yes (host key попадёт в ~/.ssh/known_hosts)
# Ожидай: "Hi doxfie/DevLog! You've successfully authenticated..."
```

```bash
sudo mkdir -p /opt/devlog
sudo chown $USER:$USER /opt/devlog
cd /opt/devlog
git clone git@github.com:doxfie/DevLog.git .
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

Сборка занимает 1–2 минуты: образ на Debian (bookworm-slim), `better-sqlite3` ставится из пресобранного бинарника, без компиляции.

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
