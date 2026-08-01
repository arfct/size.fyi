import { useEffect } from 'react';
import type { View } from '../shared/types';
import { useComparison } from './store';

// One source of truth for the shortcuts: this hook binds them and the menus render them as hints, so a
// key can't drift from its label. Single letters, no modifiers — there is nothing to conflict with on a
// page whose only text field is the search box, and that field swallows them itself (see the typing
// guard below).
export const HOTKEYS = {
  '3d': 'd',
  front: 'x',
  side: 'y',
  top: 'z',
  perspective: 'p',
  stack: 's',
  remove: 'Backspace',
} as const;

// What each key shows in a menu. Backspace gets its glyph; the letters are shown uppercase because
// that's how a keycap reads, even though the binding is case-insensitive.
export const hotkeyLabel = (key: string) => (key === 'Backspace' ? '⌫' : key.toUpperCase());

const VIEW_KEYS: Record<string, View> = {
  [HOTKEYS['3d']]: '3d',
  [HOTKEYS.front]: 'front',
  [HOTKEYS.side]: 'side',
  [HOTKEYS.top]: 'top',
};

// Typing in a field means the keystroke belongs to that field, not to the page.
const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

export function useHotkeys(enabled: boolean) {
  const { state, dispatch } = useComparison();
  const { hovered, projection, layoutMode } = state;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Modified keystrokes are the browser's or the OS's (⌘R, ⌥←). Only bare keys are ours.
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;

      if (e.key === HOTKEYS.remove) {
        // Only ever removes what the pointer is actually on, so there's no way to delete the wrong
        // item by mistake. Prevented regardless, because in some browsers a bare Backspace outside a
        // field still navigates back.
        e.preventDefault();
        if (hovered !== null) dispatch({ type: 'remove', index: hovered });
        return;
      }

      const key = e.key.toLowerCase();
      const view = VIEW_KEYS[key];
      if (view) {
        e.preventDefault();
        dispatch({ type: 'setView', view });
        return;
      }
      if (key === HOTKEYS.perspective) {
        e.preventDefault();
        dispatch({
          type: 'setProjection',
          projection: projection === 'perspective' ? 'orthographic' : 'perspective',
        });
        return;
      }
      if (key === HOTKEYS.stack) {
        e.preventDefault();
        dispatch({ type: 'setLayout', mode: layoutMode === 'stack' ? 'row' : 'stack' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, hovered, projection, layoutMode, dispatch]);
}
