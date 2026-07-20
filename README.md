# size.fyi

Visualize and compare the real-world dimensions of objects side-by-side in 3D space. Whether you're curious about how a banana compares to a sheet of paper, or sizing up furniture, size.fyi renders accurate size comparisons with multiple viewing angles and toggleable units (metric and imperial).

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Base UI Combobox
- **3D Rendering:** three.js
- **Backend:** Cloudflare Worker (serverless runtime) + static assets
- **Build:** Vite, Node.js (catalog build and validation)
- **Tests:** Vitest (application + Worker tests)

## Getting Started

```sh
npm install
npm run dev      # Start local dev server (Vite)
npm test         # Run all tests
npm run validate # Validate the device catalog
npm run deploy   # Build and deploy to Cloudflare Workers
```

## Adding Catalog Devices

Catalog data lives in `data/devices/*.json`. Each file contains an array of device objects with dimensions in millimeters (height × width × depth) sourced from manufacturer specifications.

### Device Schema

```json
{
  "slug": "device-name",
  "name": "Device Name",
  "category": "everyday",
  "h": 100,
  "w": 200,
  "d": 50,
  "brand": "Brand Name",
  "year": 2024,
  "source": "https://example.com/specs",
  "radius": 10,
  "radiusAxis": "y",
  "aliases": ["alias1", "alias2"]
}
```

### Field Details

- **slug** (required): URL-friendly identifier, kebab-case, lowercase alphanumeric + hyphens
- **name** (required): Human-readable display name
- **category** (required): One of `everyday`, `paper`, `phone`, `tablet`, `laptop`, `console`, `pc-case`, `audio`, `camera`
- **h, w, d** (required): Dimensions in millimeters; must be between 0.1 and 100,000
- **brand**, **year**, **source** (optional): Metadata for provenance and credibility
- **radius**, **radiusAxis** (optional): For rounded or cylindrical objects
  - **radius**: Edge fillet radius in mm (must be ≤ half the smaller cross-sectional dimension)
  - **radiusAxis**: Which axis the rounded edges are parallel to: `x` (width), `y` (height), or `z` (depth)
- **aliases** (optional): Alternative names for search

### Example: Adding a Drinks Can

```json
{
  "slug": "drinks-can",
  "name": "Drinks Can",
  "category": "everyday",
  "h": 115,
  "w": 65,
  "d": 65,
  "radius": 32.5,
  "radiusAxis": "y",
  "source": "https://example.com/beverage-specs"
}
```

After editing, run `npm run validate` to ensure all devices pass validation (required fields, dimension ranges, slug uniqueness, radiusAxis correctness, etc.).

## URL Grammar

Comparisons are encoded in the URL path. The home path (`/`) shows an empty state; subsequent paths define what to compare.

### Device Comparisons

- `/drinks-can` — single device
- `/drinks-can-vs-paper-a4` — two devices
- `/credit-card-vs-banana-vs-cd-case` — three devices
- Maximum **8 items** per URL

### Custom Items

Combine catalog devices with custom dimensions using the `name~HxWxD` syntax:
- Dimensions are in millimeters as decimal numbers (e.g., `100.5`)
- Names use underscores instead of spaces: `my_item` renders as "My Item"

Examples:
- `/my_custom_box~200x300x100` — a custom 200×300×100mm box
- `/my_custom_box~200x300x100-vs-drinks-can` — custom box next to a real device
- `/item_1~100x100x100-vs-item_2~50x50x50-vs-credit-card` — multiple custom items

### View Modes

The UI offers four viewing modes:
- **3D** — Interactive three.js view with mouse/touch controls
- **Front** — Head-on view (height × width)
- **Side** — Side view (depth × height)
- **Top** — Top-down view (width × depth)

## Features

- **Responsive 3D rendering** with mouse/touch rotation and zoom
- **Multiple viewing angles** (front, side, top, 3D)
- **Unit toggle** between metric (mm) and imperial (inches/feet)
- **Search and add items** via combobox with device catalog
- **Custom dimensions** via URL-encoded syntax
- **Share comparisons** with native share API or copy URL
- **OG image injection** for social media previews
- **Local storage persistence** of recent comparisons and preferences
- **Graceful fallbacks** for WebGL-unavailable browsers

## Worker and API

The app is served by a Cloudflare Worker that:
- Serves the single-page app shell (`index.html`)
- Provides the catalog API at `/api/devices` with cache headers and ETags
- Injects Open Graph meta tags for social preview enrichment
- Falls back gracefully if the catalog cannot be loaded

### Catalog API

```
GET /api/devices
```

Returns the complete device catalog with HTTP caching headers:
```json
{
  "version": 1,
  "devices": [...]
}
```

## D1 Integration Note

The current implementation serves the catalog as static JSON via the Worker's `ASSETS` binding (static file uploads). This is lightweight and performant for a read-heavy catalog. If the catalog grows significantly or you need dynamic updates, the `/api/devices` endpoint structure is ready to integrate with D1 (Cloudflare's SQLite service) — simply replace the static file fetch with a D1 query at that path.

## Development Workflow

1. **Edit catalog:** Modify `data/devices/*.json` files
2. **Validate:** Run `npm run validate` to check syntax and constraints
3. **Test locally:** `npm run dev` to test the app with your changes
4. **Run tests:** `npm test` and `npm run test:worker` before committing
5. **Deploy:** `npm run deploy` to push to Cloudflare Workers

## License

[Specify your license here]
