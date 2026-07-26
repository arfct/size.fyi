import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest.config.ts doesn't set `test.globals`, so @testing-library/react's own
// auto-cleanup (which relies on a global `afterEach`) never registers. Without
// this, DOM from one test's render() leaks into the next test in the same file.
afterEach(cleanup);

// jsdom logs "Not implemented" for scrollIntoView; the search box calls it on focus/typing.
Element.prototype.scrollIntoView = () => {};
