/** Browser composition marker; its declared dependency owns the single Changes tab. */
export const name = 'worktree-review-client'

/** Keep the composition marker loadable; injected owners register its services and UI. */
export function apply(): void {}
