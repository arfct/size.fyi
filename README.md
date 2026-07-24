<img src="public/logo.svg" alt="" width="44" align="left">

# size.fyi

Compare the real-world size of phones, tablets, laptops, consoles, watches — and everyday objects like a credit card or a banana 🍌 — side-by-side in 3D, at true relative scale.

### → [**size.fyi**](https://size.fyi)

## What it does

- See any set of items next to each other in an interactive **3D** view, or head-on in **front / side / top**.
- Everything is drawn to **true relative scale**, so a phone next to a tablet is exactly right.
- Switch between **metric and imperial**.
- Every comparison is a **shareable link** — e.g. [`size.fyi/iphone-17-pro-vs-galaxy-z-fold8-open`](https://size.fyi/iphone-17-pro-vs-galaxy-z-fold8-open) — and you can drop in custom dimensions too (`my_box~200x300x100`).
- ~100 devices and objects in the catalog, and growing.

## Add a device or object

Missing something? There are two ways to get it in — pick whichever is easier for you:

- **📝 File an issue** — no code required. [**Request an item**](https://github.com/arfct/size.fyi/issues/new/choose) with its name and dimensions (height × width × depth) and a link to the source, and we'll add it.
- **🔧 Open a pull request** — add one small JSON file per item. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the format and a copy-paste template.

Accurate, manufacturer-sourced dimensions are the whole point, so a source link (spec page, product listing) is always appreciated.

## Development

```sh
npm install
npm run dev     # local dev server
npm test        # tests
```

Built with React + three.js, served from a Cloudflare Worker. The device catalog lives in [`data/devices/`](data/devices) as one JSON file per item and compiles to `public/devices.json` at build time — see [CONTRIBUTING.md](CONTRIBUTING.md) for the schema.
