// Only fixed preview decoration may become HTML. Escape each text slice AFTER
// character counting and BEFORE inserting mention/overflow wrappers.
export function escapePreviewText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
