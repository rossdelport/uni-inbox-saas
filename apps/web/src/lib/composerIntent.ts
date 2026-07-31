// Bridge from the keyboard layer to the reply composer. Pressing "r" in the
// reading pane should put the caret in the editor, but the composer is a
// distant child that exposes no imperative handle; a module-level intent is
// smaller than threading refs through three components.

type Intent = () => void;

let current: Intent | null = null;

/** The composer registers itself on mount. Returns the unsubscribe. */
export function onReplyIntent(fn: Intent): () => void {
  current = fn;
  return () => {
    if (current === fn) current = null;
  };
}

/** True if a composer was mounted to take the focus. */
export function requestReply(): boolean {
  if (!current) return false;
  current();
  return true;
}

// Dirty check, same shape. Keyboard actions that would unmount the composer
// (back, archive, j/k to another thread) ask this first: the reply body is an
// uncontrolled contentEditable, so unmounting is unrecoverable loss, and there
// is no draft store to fall back on.

let dirty: (() => boolean) | null = null;

export function onComposerDirty(fn: () => boolean): () => void {
  dirty = fn;
  return () => {
    if (dirty === fn) dirty = null;
  };
}

/** True when a mounted composer holds unsent content. */
export function composerDirty(): boolean {
  return dirty?.() ?? false;
}
