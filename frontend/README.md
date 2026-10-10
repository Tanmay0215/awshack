# Sortline frontend

Next.js (App Router, TS, Tailwind) static export (`output: 'export'`, `trailingSlash: true`).

## Commands
- `npm install`
- `npm run dev` - dev server
- `npm run build` - static site in `out/` (upload to S3 / serve via CloudFront)

## API base
`NEXT_PUBLIC_API_BASE` (build-time, default empty).
- Empty (production): calls same-origin `/api/detect` and `/api/health` (CloudFront routes `/api/*` to the backend).
- Non-empty (dev): calls `${BASE}/detect` and `${BASE}/health` with the `/api` prefix stripped, because the backend serves routes without it.

Dev example:
```
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```
The backend needs CORS enabled for `http://localhost:3000`.
