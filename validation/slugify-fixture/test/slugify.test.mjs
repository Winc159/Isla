import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.mjs';

test('normalizes a basic title', () => assert.equal(slugify('Hello World'), 'hello-world'));
test('removes punctuation and collapses separators', () => assert.equal(slugify('  Hello,   World!  '), 'hello-world'));
test('supports unicode and avoids empty output for punctuation-only input', () => {
  assert.equal(slugify('你好，世界'), '你好-世界');
  assert.equal(slugify('!!!'), 'item');
});
test('does not create leading or trailing separators', () => assert.equal(slugify('  A -- B  '), 'a-b'));
