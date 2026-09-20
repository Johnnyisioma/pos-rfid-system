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

  /*
    The other half of the same bug.

    A component that calls `feature(...)` without destructuring `feature` from
    useAuth() builds perfectly and throws ReferenceError the moment it renders
    — exactly like `icon: Tag` did. The names below are the ones useAuth hands
    out, so a component that CALLS one must also take it from the hook.

    Checked PER COMPONENT, not per file. One file usually holds several
    components, and a sibling that happens to destructure `feature` is exactly
    what let this bug through the first time: the file looked fine, the
    component next to it crashed.

    Deliberately limited to these names — a general "is this identifier bound"
    check is a linter, and half a linter finds false positives all day.
  */
  const HOOK_VALUES = ['can', 'feature', 'switchLocation', 'reloadSettings', 'logout'];

  // Top-level function declarations, which is how every component in this
  // codebase is written. Each one's body runs from its `function` keyword to
  // the next one's.
  const starts = [...src.matchAll(/^(?:export\s+default\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => ({ name: m[1], index: m.index }));

  for (let i = 0; i < starts.length; i++) {
    const body = src.slice(starts[i].index, starts[i + 1]?.index ?? src.length);
    if (!/useAuth\(\)/.test(body) && !HOOK_VALUES.some((n) => body.includes(`${n}(`))) continue;

    const bound = new Set();
    for (const m of body.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*useAuth\(\)/g))
      for (const part of m[1].split(',')) bound.add(part.trim().split(/[:=]/).pop().trim());

    for (const name of HOOK_VALUES) {
      if (bound.has(name)) continue;
      // A call, not a mention: `feature(` rather than `feature:` in a nav entry.
      const call = new RegExp(`(?<![.\\w$'"\`])${name}\\s*\\(`, 'g');
      const hit = [...body.matchAll(call)].find((m) => {
        const before = body.slice(Math.max(0, m.index - 40), m.index);
        // its own declaration, or a prop being passed down
        return !/(function|const|let|var)\s+$/.test(before) && !/[.:]\s*$/.test(before);
      });
      if (!hit) continue;
      // It may legitimately arrive as a prop instead of from the hook.
      const params = body.slice(0, body.indexOf(')') + 1);
      if (params.includes(name)) continue;
      const line = src.slice(0, starts[i].index + hit.index).split('\n').length;
      problems.push(
        `${path.relative('.', file)}:${line}  ${starts[i].name}() calls ${name}() `
        + 'but never takes it from useAuth()');
    }
  }
}

if (problems.length) {
  console.log(`\nReferences that build but crash at runtime (${problems.length}):\n`);
  problems.forEach((p) => console.log(`  ${p}`));
  console.log('\nThese build fine and crash at runtime.\n');
  process.exit(1);
}
console.log('check-refs: every component reference resolves.');
