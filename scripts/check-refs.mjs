/**
 * Catches the undefined-component bug at build time.
 *
 * Writing `icon: Tag` when only `Tags` was imported is not a syntax error, not
 * a type error, and not a bundler error — esbuild and Vite both build it
 * happily. It fails at RUNTIME with "Tag is not defined", and because it is in
 * the shared layout it white-screens the entire app. One missing character,
 * total outage, and nothing before the browser says a word about it.
 *
 * So: for every .jsx file, collect what is imported or declared, then check
 * every capitalised identifier used as a component or an `icon:` value.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('client/src');
// Globals and built-ins that are never imported.
const ALLOW = new Set(['React', 'Object', 'Array', 'Math', 'JSON', 'Number', 'String',
  'Boolean', 'Date', 'Promise', 'Map', 'Set', 'Intl', 'URL', 'URLSearchParams', 'Error',
  'FormData', 'Blob', 'File', 'Image', 'RegExp', 'Infinity', 'NaN', 'Symbol', 'BigInt',
  'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'ArrayBuffer', 'Uint8Array', 'TextEncoder',
  'TextDecoder', 'AbortController', 'Response', 'Request', 'Headers', 'Notification']);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : (/\.jsx?$/.test(e.name) ? [full] : []);
});

const problems = [];

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const defined = new Set(ALLOW);

  // import X, {a, b as c} from '…'  /  import * as N from '…'
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s*['"][^'"]+['"]/g)) {
    const clause = m[1];
    for (const part of clause.split(/[{},]/)) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim().replace(/^\*\s*/, '');
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }
  // local declarations
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g))
    defined.add(m[1]);
  // destructured consts, e.g. const { Foo, Bar } = ...
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g))
    for (const part of m[1].split(','))
      defined.add(part.trim().split(/[:=]/).pop().trim());
  // Aliases from PARAMETER destructuring only, e.g. function F({ icon: Icon }).
  // Scoped tightly on purpose: a loose `key: Alias` rule also matches the very
  // thing being checked — `icon: Tag` inside a nav array would register Tag as
  // defined and the check would pass while the app white-screens.
  for (const m of src.matchAll(/\(\s*\{([^}]*)\}\s*\)/g))
    for (const part of m[1].split(','))
      if (part.includes(':')) defined.add(part.split(':').pop().trim().split(/[=\s]/)[0]);

  const used = new Map();   // name -> line
  const note = (name, idx) => {
    if (!used.has(name)) used.set(name, src.slice(0, idx).split('\n').length);
  };
  // <Component …>   (not <div>, not <Foo.Bar> handled via the root name)
  for (const m of src.matchAll(/<([A-Z][\w$]*)/g)) note(m[1], m.index);
  // icon: Component
  for (const m of src.matchAll(/\bicon:\s*([A-Z][\w$]*)/g)) note(m[1], m.index);

  for (const [name, line] of used) {
    if (!defined.has(name)) {
      problems.push(`${path.relative('.', file)}:${line}  <${name}> is used but never imported or defined`);
    }
  }
}

if (problems.length) {
  console.log(`\nUndefined component references (${problems.length}):\n`);
  problems.forEach((p) => console.log(`  ${p}`));
  console.log('\nThese build fine and crash at runtime.\n');
  process.exit(1);
}
console.log('check-refs: every component reference resolves.');
