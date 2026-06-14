# CMS Web UAT

Frontend application built with `Vite + React + TypeScript`.

## Install

```powershell
npm.cmd install
```

## Run In Development

```powershell
npm.cmd run dev
```

Development URL:

```text
http://localhost:5173
```

## Create Production Build

```powershell
npm.cmd run build
```

This generates the production output in:

```text
dist/
```

## Test Production Build Locally

```powershell
npm.cmd run preview -- --host 0.0.0.0 --port 4173
```

Preview URL:

```text
http://localhost:4173
```

## Serve Production Build With Django Proxy

Use this instead of `npx http-server dist -p 3000 --proxy ...` when testing
the built app against the local Django API:

```powershell
npm.cmd run build
npm.cmd run serve:dist
```

This serves `dist/` on `http://0.0.0.0:3000` and forwards `/api` and `/media`
to `http://127.0.0.1:8000`. If Django is elsewhere, set `BACKEND_URL`:

```powershell
$env:BACKEND_URL = "http://127.0.0.1:8000"
npm.cmd run serve:dist
```

## Useful Commands

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format
```

## Notes

- Use `npm.cmd` on Windows PowerShell.
- Production build was verified with `npm.cmd run build`.
- Local production preview should be checked on `http://localhost:4173` before deploying to the server.
