# Group Locator & Real-Time Chat

A modern, full-stack, real-time geolocation tracking and communications platform built using a monorepo workspace. It enables group members to share live coordinates on an interactive map, message each other in real-time, coordinate shared meeting points, compute active routes/ETAs, and trigger emergency SOS alarms.

---

## 🌟 Key Features

* **Interactive Map Visualization:** Shows real-time locations of active members on a map using Leaflet.
* **Live Chatting:** Low-latency group chats powered by WebSockets.
* **Shared Meeting Points:** Allows members to pin destination coordinates with active distance/duration (ETA) calculations.
* **SOS Emergency System:** Quick-action alarms categorization (Medical 🏥, Fire 🔥, Police 🚓) sending instant coordinates to all members.
* **Network & Connection Sync:** Automatic reconnection monitoring to prevent state mismatches during temporary network dropouts.

---

## 📂 Project Directory Structure

This project uses a modular `pnpm` monorepo workspace. The file structure is organized as follows:

```
Group-Locator-Chat/
├── artifacts/                  # Core applications
│   ├── group-tracker/          # React/Vite front-end application
│   │   ├── src/
│   │   │   ├── components/     # UI components (Radix, Leaflet Maps, Sidebar)
│   │   │   ├── pages/          # Pages (HomePage, GroupPage)
│   │   │   ├── App.tsx         # Router and layout configuration
│   │   │   └── main.tsx        # React mounting entry point
│   ├── api-server/             # Express back-end server
│   │   ├── src/
│   │   │   ├── routes/         # Express router & endpoints
│   │   │   ├── app.ts          # Express application configuration
│   │   │   └── index.ts        # Node.js http and websocket startup file
│   └── mockup-sandbox/         # Mockup test and sandbox environment
│
├── lib/                        # Shared workspace libraries
│   ├── db/                     # Drizzle ORM configuration and MySQL schema
│   ├── api-spec/               # Shared API schema specs
│   ├── api-client-react/       # Generated API client query hooks (Orval)
│   └── api-zod/                # Auto-generated Zod schemas
│
├── scripts/                    # Development workspace helpers and hooks
├── package.json                # Root package configuration
├── pnpm-workspace.yaml         # PNPM workspace packages definition
├── pnpm-lock.yaml              # Strict dependency lockfile
├── setup-db.mjs                # Script to initialize the MySQL database tables
└── tsconfig.json               # TypeScript base configurations
```

---

## 🛠️ Tech Stack & Key Libraries

### Front-end (`artifacts/group-tracker`)
* **Core:** React 19, Vite, TypeScript
* **Maps & Geo:** `leaflet` & `@types/leaflet`
* **Styling & UI:** Tailwind CSS, Radix UI Primitives, Lucide Icons, Framer Motion
* **Routing & Queries:** Wouter, TanStack React Query (`@tanstack/react-query`)
* **Forms & Validation:** React Hook Form, Zod

### Back-end (`artifacts/api-server`)
* **Framework:** Express 5 (HTTP endpoints)
* **Real-time Engine:** WebSockets (`ws`)
* **Logging:** Pino & Pino-HTTP
* **Database Driver:** `mysql2`

### Database Engine (`lib/db`)
* **Dialect:** MySQL
* **ORM:** Drizzle ORM
* **Migrations/Push:** Drizzle-kit

---

## ⚙️ Setup & Local Installation

### Prerequisites
* **Node.js** (v24 or later recommended)
* **pnpm** (v9+ recommended)
* **MySQL Server** (listening on port 3306)

### 1. Clone & Install Dependencies
From the repository root, install workspace dependencies:
```bash
pnpm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory (or configure your terminal environment):
```env
DATABASE_URL=mysql://root:password@127.0.0.1:3306/group_locator
PORT=5000
```
*(Make sure to replace `root` and `password` with your MySQL server credentials, and verify the database name `group_locator` matches your MySQL database).*

### 3. Initialize the Database
Ensure your MySQL server is running, then execute the setup script to drop and recreate the necessary schema tables:
```bash
node setup-db.mjs
```

### 4. Build & Run
Compile all TypeScript packages:
```bash
pnpm run build
```
Run the backend server in development mode:
```bash
pnpm --filter @workspace/api-server run dev
```

The server will initialize on port `5000` (or your configured `PORT`), and serve API routes at `/api` and WebSockets on the same port.

---

## 🌐 Production Hosting Guide

When deploying this project to hosting services (such as Railway, Render, Heroku, AWS, or DigitalOcean):

### 🚫 Folders to Ignore / Exclude
You do **not** need to upload local caching or development files. The project contains a `.gitignore` file that automatically excludes these:
* `node_modules/` (All dependencies are installed fresh by the server build agent)
* `.local/` (Contains local `pnpm` store caches)
* `.git/` (Git history metadata)
* `*.tsbuildinfo` (TypeScript build cache)

### 📦 Build & Deploy Pipeline
Ensure your hosting platform runs the following lifecycle scripts during deployment:

1. **Install command:**
   ```bash
   pnpm install
   ```
2. **Build command:**
   ```bash
   pnpm run build
   ```
3. **Start command:**
   ```bash
   pnpm --filter @workspace/api-server run start
   ```

### 🔑 Environment Configuration
Make sure to configure the production environment variables inside your hosting provider's dashboard:
* `DATABASE_URL`: Production MySQL connection URL.
* `PORT`: Port exposed by the host.
* `NODE_ENV`: Set to `production`.
