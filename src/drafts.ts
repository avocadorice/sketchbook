import type { Scene } from "./history";

/** Unsaved edits kept per checkpoint while you switch away; "next" is the not-yet-saved checkpoint. */
export type SavedDraft = { id?: string; cleanSlate?: boolean; scene: Scene; title: string; notes: string };
export type Drafts = Record<string, SavedDraft>;

export const draftKey = (index: number | null): string => index === null ? "next" : String(index);

/** Re-key checkpoint drafts after positions change; returning null drops that draft. */
export function rekeyDrafts(drafts: Drafts, position: (index: number) => number | null): Drafts {
  return Object.fromEntries(Object.entries(drafts).flatMap(([key, draft]) => {
    if (key === "next") return [[key, draft]];
    const moved = position(Number(key));
    return moved === null ? [] : [[String(moved), draft]];
  }));
}

/** Deleting a checkpoint drops its draft and shifts later drafts down by one. */
export const draftsAfterDelete = (drafts: Drafts, deleted: number): Drafts =>
  rekeyDrafts(drafts, index => index === deleted ? null : index > deleted ? index - 1 : index);
