import { StateEffect } from "@codemirror/state";

/**
 * Dispatched to the EditorView when an async verse fetch completes or settings change,
 * so the ViewPlugin knows to rebuild decorations.
 */
export const verseFetchedEffect = StateEffect.define<void>();
