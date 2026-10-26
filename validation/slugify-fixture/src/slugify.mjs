/** Convert a title into a stable URL slug. */
export function slugify(title) {
  // Step 1: remove leading/trailing whitespace and convert to lowercase
  let result = title.trim().toLowerCase();

  // Step 2: replace non-unicode-letter / non-unicode-number characters with '-'
  result = result.replace(/[^\p{L}\p{N}]/gu, '-');

  // Step 3: collapse consecutive '-' into single '-'
  result = result.replace(/-+/g, '-');

  // Step 4: strip leading/trailing '-'
  result = result.replace(/^-|-$/g, '');

  // Step 5: fallback for empty or punctuation-only input
  if (result === '') {
    return 'item';
  }

  return result;
}
