import { expect, test } from 'vitest';
// Imported through vite's ?raw loader rather than node:fs: this tsconfig has no node types, and the
// point stands either way — the ids come from the templates themselves, not from memory.
import addForm from '../../../.github/ISSUE_TEMPLATE/add-a-device.yml?raw';
import errorForm from '../../../.github/ISSUE_TEMPLATE/report-an-error.yml?raw';
import type { ComparisonItem, Device } from '../../shared/types';
import { catalogIssueUrl, dimsText, errorIssueUrl } from '../github';

const custom: ComparisonItem = { kind: 'custom', name: "Rubik's Cube", h: 57, w: 57, d: 57 };
const device: ComparisonItem = {
  kind: 'device',
  device: { slug: 'iphone-16-pro', name: 'iPhone 16 Pro', h: 149.6, w: 71.5, d: 8.25 } as Device,
};

const params = (u: string) => new URL(u).searchParams;

// GitHub drops a query key that matches no field id, in silence — the form opens empty and nothing
// says why. So the keys we send have to be checked against the templates themselves, not against
// what we remember writing in them.
const fieldIds = (yaml: string) => [...yaml.matchAll(/^\s{4}id:\s*(\S+)/gm)].map((m) => m[1]);

test('every prefilled key exists as a field in the template it targets', () => {
  for (const [url, file, yaml] of [
    [catalogIssueUrl(custom), 'add-a-device.yml', addForm],
    [errorIssueUrl(device), 'report-an-error.yml', errorForm],
  ] as const) {
    const ids = fieldIds(yaml);
    expect(ids.length).toBeGreaterThan(0); // the scrape itself works
    for (const key of params(url).keys()) {
      if (key === 'template' || key === 'title') continue;
      expect(ids, `${file} has no field "${key}"`).toContain(key);
    }
  }
});

test('a custom item suggests itself for the catalog', () => {
  const p = params(catalogIssueUrl(custom));
  expect(p.get('template')).toBe('add-a-device.yml');
  expect(p.get('title')).toBe("Add: Rubik's Cube");
  expect(p.get('name')).toBe("Rubik's Cube");
  expect(p.get('dimensions')).toBe('57 × 57 × 57 mm');
  // Left for the person to fill: it is the field that makes a request actionable, and the one we
  // cannot know from a typed-in item.
  expect(p.has('source')).toBe(false);
});

test('a device reports what the site currently claims', () => {
  const p = params(errorIssueUrl(device));
  expect(p.get('template')).toBe('report-an-error.yml');
  expect(p.get('title')).toBe('Error: iPhone 16 Pro');
  // Slug included so a maintainer can find the file without searching by name.
  expect(p.get('item')).toBe('iPhone 16 Pro (iphone-16-pro)');
  expect(p.get('current')).toBe('149.6 × 71.5 × 8.25 mm');
  expect(p.has('correct')).toBe(false);
});

test('names with spaces and apostrophes survive the round trip', () => {
  // Reading the URL back is the real test; an apostrophe encoded as %27 is still correct.
  expect(params(catalogIssueUrl(custom)).get('name')).toBe("Rubik's Cube");
  const tricky: ComparisonItem = { kind: 'custom', name: 'A&B "thing" +1', h: 1, w: 2, d: 3 };
  expect(params(catalogIssueUrl(tricky)).get('name')).toBe('A&B "thing" +1');
});

test('dimensions are millimetres regardless of the reader’s units', () => {
  // The issue is a data submission; a maintainer pastes these into JSON, where mm is what is stored.
  expect(dimsText(device)).toBe('149.6 × 71.5 × 8.25 mm');
});

test('reporting an error is meaningless for something not in the catalog', () => {
  expect(() => errorIssueUrl(custom)).toThrow();
});
