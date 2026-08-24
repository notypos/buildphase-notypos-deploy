/**
 * The most recent answer, kept in sessionStorage.
 *
 * Two problems this solves, both the same bug: the answer lived only in React
 * state, so any navigation destroyed it.
 *   1. Navigating to /cards and back lost the answer on screen.
 *   2. Worse — the answer invites an anonymous reader to sign in so they can
 *      save it, and signing in is a navigation, so the thing they wanted to save
 *      was gone by the time they could save it.
 *
 * sessionStorage survives same-tab navigation and full page loads (which the
 * auth redirect is), and still clears when the tab closes. It holds NIH content
 * and the question, which the reader typed and can see; the health context that
 * produced it is stored separately and under the same session-only rules.
 */

export interface StoredAnswer {
  question: string;
  /** Shape mirrors the /api/ask response; kept loose to avoid a circular import. */
  result: unknown;
  savedCardId?: string;
  at: number;
}

const KEY = 'clearlabel.last-answer';

/** Older than this and it is probably not what the reader came back for. */
const MAX_AGE_MS = 60 * 60 * 1000;

export function storeAnswer(question: string, result: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ question, result, at: Date.now() }));
  } catch {
    /* storage disabled — the app still works, the answer just won't survive navigation */
  }
}

export function loadAnswer(): StoredAnswer | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAnswer;
    if (!parsed?.question || Date.now() - (parsed.at ?? 0) > MAX_AGE_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Remember that this answer was saved, so returning to it doesn't offer to save it twice. */
export function markSaved(cardId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = loadAnswer();
    if (!current) return;
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...current, savedCardId: cardId }));
  } catch {
    /* ignore */
  }
}

export function clearAnswer(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
