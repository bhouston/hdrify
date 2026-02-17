# HDRify Website

A browser-based EXR and HDR image viewer built with TanStack Start, Tailwind CSS, and ShadCN UI. This is the official website for the HDRify monorepo.

## Features

- Drag-and-drop EXR or HDR files
- Click to browse and select files
- Real-time exposure adjustment slider
- Reinhard tone mapping for HDR display on LDR screens

## Getting Started

From the monorepo root:

```bash
pnpm install
cd packages/website
pnpm run dev
```

Or from this directory:

```bash
pnpm install
pnpm run dev
```

Open http://localhost:3000 and drag-and-drop EXR or HDR files.

## Building for Production

```bash
pnpm run build
pnpm run preview
```

## Tech Stack

- [TanStack Start](https://tanstack.com/start/latest) – Full-stack React framework
- [TanStack Router](https://tanstack.com/router/latest) – Type-safe routing
- [Tailwind CSS](https://tailwindcss.com/) – Styling
- [ShadCN UI](https://ui.shadcn.com/) – Accessible components
- [hdrify](https://www.npmjs.com/package/hdrify) – HDR/EXR parsing and conversion

## Learn More

See the main [hdrify README](../../README.md) for the library API and usage.
