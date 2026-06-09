# Safe Drop

Safe Drop is a secure file-sharing web app built with React, Node.js, Express, and PostgreSQL. It lets users create an account, upload files, encrypt them in the browser, manage their personal vault, and generate share links for other people to download files without needing an account.

Live demo: [safe-drop.me](https://safe-drop.me)

## Features

- User authentication with register and login flows.
- Browser-side AES-256 file encryption when the app is opened in a secure context.
- Multi-file uploads with drag-and-drop support.
- Per-user storage tracking with a 5 GB default quota.
- File management actions including download, rename, delete, search, and sort.
- Share links with optional expiration times.
- Public download page for shared files.
- Encrypted share support using a key stored in the URL hash.
- API hardening with Helmet, CORS, and rate limiting.

## Tech Stack

- Frontend: React, Vite, React Router, Axios
- Backend: Node.js, Express, Multer, JWT, bcryptjs, express-validator
- Database: PostgreSQL
- Deployment: Docker, Docker Compose, Nginx

## How It Works

1. Users register or log in to receive a JWT.
2. The dashboard loads the user’s file list from the backend.
3. Files can be encrypted in the browser before upload.
4. Uploaded files are stored on the server under generated UUID filenames.
5. Owners can rename, delete, download, and share files from the dashboard.
6. Shared files can be downloaded from a public link, with optional expiry.

## Getting Started

### Prerequisites

- Node.js 24 or newer
- npm
- PostgreSQL 16 or Docker Desktop if you want the full containerized setup

### Run with Docker Compose

1. Create `backend/.env` with the required environment variables.
2. Start the stack:

```bash
docker compose up --build
```

3. Open the app in your browser at the exposed frontend URL.

Production is also hosted on an EC2 instance and available at [safe-drop.me](https://safe-drop.me).

The compose setup includes:

- `db`: PostgreSQL seeded with `backend/src/db/schema.sql`
- `backend`: Express API on port `4000`
- `frontend`: Nginx-served React build
- `nginx`: reverse proxy for production-style routing

### Local Development

Run the backend and frontend separately:

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://localhost:4000`.

## Environment Variables

### Backend

Create `backend/.env` with values similar to these:

```env
DATABASE_URL=postgresql://fileshare:secret@localhost:5432/fileshare
JWT_SECRET=replace-with-a-long-random-secret
FRONTEND_URL=http://localhost:5173
PORT=4000
UPLOAD_DIR=/app/uploads
```

## Database Schema

The database stores:

- `users`: account data, password hashes, and storage usage
- `files`: file metadata, share tokens, encryption IVs, and expiry timestamps

## Project Structure

```text
safe-drop/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   ├── middleware/
│   │   └── routes/
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── assets/
│   │   └── utils/
│   └── Dockerfile
├── nginx/
└── docker-compose.yml
```

## Security Notes

- Passwords are hashed with bcrypt.
- API requests require JWT authentication.
- File uploads are restricted by size and MIME type.
- Share links can expire.
- Browser encryption is only available in secure contexts.

## License

This project is currently distributed without a published license.