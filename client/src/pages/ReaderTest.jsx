import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Radio, CheckCircle2, XCircle, AlertTriangle, Trash2, ClipboardCopy, Keyboard, Info,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, Empty, Badge, useToast, Stat } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

/**
 * Reader test — what is the scanner ACTUALLY sending?
 *
 * Every other RFID screen tries to make sense of a code. This one deliberately
 * does not: it records the raw keystrokes, their timing and their terminator,
 * and reports what arrived before any interpretation. That distinction matters
 * because the three ways a reader fails all look identical on a normal scan
 * box — nothing happens — but need completely different fixes:
 *
 *   nothing arrives          → the reader is not in keyboard/wedge mode at all
 *   characters but no Enter  → no terminator configured
 *   a code that will not match → wrong format, or a prefix/suffix the reader adds
 *
 * Told apart, each is a two-minute settings change. Guessed at, they are a
 * lost afternoon.
 */

const EPC_LEN = 24;
const IDLE_MS = 300;   // generous here — this screen is diagnosing, not counting

const classify = (raw) => {
  const s = String(raw).trim();
  const stripped = s.replace(/^epc[:=]/i, '').replace(/[\s:\-_.]/g, '').toUpperCase();

  if (/^[0-9A-F]+$/.test(stripped) && stripped.length === EPC_LEN) {
    return { kind: 'epc', label: 'Valid EPC', tone: 'good',
      note: 'A 96-bit EPC. This is what the RFID chip holds.' };
  }
  if (/^[0-9A-F]+$/.test(stripped) && stripped.length > 8) {
    return { kind: 'hex', label: `Hex, ${stripped.length} chars`, tone: 'warn',
      note: `Looks like a tag but is ${stripped.length} characters, not ${EPC_LEN}. The reader may be sending TID or a different memory bank instead of EPC.` };
  }
  // A printed label is the variant SKU plus a zero-padded serial, and the SKU
  // itself contains dashes — "MF-OXFORD-41-BLACK-000014", not just "SKU-000014".
  if (/^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4,}$/i.test(s)) {
    return { kind: 'label', label: 'Printed label', tone: 'good',
      note: 'The barcode printed on the label. It names the same individual unit as the chip.' };
  }
  if (!s) {
    return { kind: 'empty', label: 'Empty', tone: 'bad', note: 'Nothing captured.' };
  }
  return { kind: 'other', label: 'Unrecognised', tone: 'warn',
    note: 'Not an EPC and not a printed label. Check for a prefix or suffix the reader is adding.' };
};

export default function ReaderTest() {
  const toast = useToast();
  const { locationId } = useAuth();
  const inputRef = useRef(null);
  const idleTimer = useRef(null);
  // Keystroke bookkeeping for the read being assembled. A SEUIC handheld in
  // Focus mode delivers through InputMethodManager.setCommitText, which the
  // browser sees as one `input` event with no keydowns at all — so counting
  // keydowns is how we tell the two delivery styles apart, not how we read
  // the data. The field's own value is the data.
  const keyCount = useRef(0);
  const firstKeyAt = useRef(0);
  const lastKeyAt = useRef(0);

  const [reads, setReads] = useState([]);
  const [listening, setListening] = useState(true);
  const [sawInput, setSawInput] = useState(null);

  useEffect(() => {
    if (!listening) return undefined;
    const focus = () => inputRef.current?.focus();
    focus();
    const t = setInterval(focus, 1000);
    document.addEventListener('click', focus);
    return () => { clearInterval(t); document.removeEventListener('click', focus); };
  }, [listening]);

  const finalise = useCallback(async (terminator) => {
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const el = inputRef.current;
    const text = (el?.value || '').replace(/[\r\n\t]+$/, '');
    const keys = keyCount.current;
    const span = keys > 1 ? lastKeyAt.current - firstKeyAt.current : 0;
    keyCount.current = 0;
    if (el) el.value = '';
    if (!text) return;

    // Did this arrive as keystrokes, or as a single committed string?
    // Most of the characters having a keydown behind them means a wedge typing;
    // none of them means an IME-style commit.
    const via = keys >= Math.max(1, text.length * 0.6) ? 'keystrokes' : 'commit';
    const perChar = via === 'keystrokes' && keys > 1
      ? Math.round((span / (keys - 1)) * 10) / 10 : 0;
    const verdict = classify(text);

    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      text,
      chars: text.length,
      span,
      perChar,
      via,
      terminator,
      verdict,
      typedByHand: via === 'keystrokes' && perChar > 40,
      at: new Date(),
      resolved: null,
    };
    setReads((r) => [entry, ...r].slice(0, 30));

    // Then — and only then — ask the server whether it knows this unit.
    try {
      const res = await api.post('/api/rfid/resolve', { codes: [text], context: 'lookup' });
      const hit = res.results?.[0];
      setReads((r) => r.map((x) => (x.id === entry.id
        ? { ...x, resolved: { ok: !!hit?.resolved, message: hit?.message, unit: hit?.unit } }
        : x)));
    } catch (e) {
      setReads((r) => r.map((x) => (x.id === entry.id
        ? { ...x, resolved: { ok: false, message: `Lookup failed: ${e.message}` } } : x)));
    }
  }, []);

  const onKeyDown = useCallback((e) => {
    if (!listening) return;
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      finalise(e.key);
      return;
    }
    if (e.key.length === 1) {
      const now = performance.now();
      if (keyCount.current === 0) firstKeyAt.current = now;
      lastKeyAt.current = now;
      keyCount.current += 1;
    }
  }, [listening, finalise]);

  // Fires for BOTH delivery styles — a wedge typing character by character and
  // a one-shot text commit. This, not onKeyDown, is what guarantees a read is
  // seen at all.
  const onInput = useCallback(() => {
    if (!listening) return;
    setSawInput(Date.now());
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => finalise('none'), IDLE_MS);
  }, [listening, finalise]);

  /* ---------- aggregate diagnosis ---------- */
  const withTerm = reads.filter((r) => r.terminator !== 'none').length;
  const wedgeLike = reads.filter((r) => !r.typedByHand).length;
  const commits = reads.filter((r) => r.via === 'commit').length;
  const keyed = reads.filter((r) => r.via === 'keystrokes').length;
  const good = reads.filter((r) => r.verdict.kind === 'epc' || r.verdict.kind === 'label').length;
  const matched = reads.filter((r) => r.resolved?.ok).length;

  const diagnosis = (() => {
    if (!reads.length) {
      return {
        tone: 'idle',
        title: 'Waiting for a read',
        body: 'Pull the trigger, or scan a barcode. Nothing at all appearing here means the reader is not sending to the focused field — on a SEUIC handheld that is UHF app → Settings → Send Mode, which must be Focus rather than Broadcast.',
      };
    }
    if (good === 0) {
      return {
        tone: 'bad',
        title: 'Reads arrive, but not in a format this system knows',
        body: 'Reads are arriving, but what they contain is neither an EPC nor a printed label. Usually the reader is sending a different memory bank (TID rather than EPC), or adding a prefix or suffix. On a SEUIC handheld check UHF app → Settings → Region (should be EPC), Prefix and Suffix (should be empty), and Data start / Data length (both 0).',
      };
    }
    if (matched === 0) {
      return {
        tone: 'warn',
        title: 'Format is right, but these tags are not in the system',
        body: 'The reader is set up correctly. These particular tags simply are not registered here — they may be blank inlays, tags from another system, or stock booked in at a different branch. Receive stock to mint EPCs, then read those labels.',
      };
    }
    const how = commits && !keyed
      ? 'The reader commits each read as a block of text rather than typing it key by key — that is how a SEUIC handheld behaves in Focus mode, and it is fine.'
      : keyed && !commits
        ? 'The reader types each read key by key, like a keyboard.'
        : 'Reads are arriving both as keystrokes and as committed text.';
    const term = withTerm === 0
      ? ' No Enter is sent after a read, which is normal for this mode — every scan box here finishes a read on a short pause instead, so nothing is lost.'
      : '';
    return {
      tone: 'good',
      title: 'Reader is working end to end',
      body: `${matched} of ${reads.length} read(s) matched a real unit. ${how}${term}`,
    };
  })();

  const copyDiagnostics = async () => {
    const report = [
      `Reader test — ${new Date().toISOString()}`,
      `reads: ${reads.length}, with terminator: ${withTerm}, wedge-speed: ${wedgeLike}, ` +
      `valid format: ${good}, matched a unit: ${matched}`,
      `diagnosis: ${diagnosis.title}`,
      '',
      ...reads.slice(0, 15).map((r) =>
        `"${r.text}" | ${r.chars} chars | via ${r.via} | ${r.perChar}ms/char | terminator: ${r.terminator} | ` +
        `${r.verdict.label} | ${r.resolved ? (r.resolved.ok ? 'matched' : 'no match') : 'pending'}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(report);
      toast.success('Diagnostics copied — paste them wherever you need');
    } catch {
      toast.error('Could not copy. Screenshot this page instead.');
    }
  };

  const TONE = {
    good: 'bg-emerald-50 ring-emerald-200 text-emerald-900',
    warn: 'bg-amber-50 ring-amber-200 text-amber-900',
    bad: 'bg-rose-50 ring-rose-200 text-rose-900',
    idle: 'bg-slate-50 ring-slate-200 text-slate-700',
  };
  const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle, idle: Radio };
  const DIcon = TONE_ICON[diagnosis.tone];

  return (
    <>
      <PageHeader title="Reader test"
        subtitle="What the scanner actually sends, before this system tries to interpret it"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setListening((l) => !l)}>
              <Keyboard size={16} /> {listening ? 'Stop listening' : 'Start listening'}
            </button>
            <button className="btn-secondary" onClick={copyDiagnostics} disabled={!reads.length}>
              <ClipboardCopy size={16} /> Copy diagnostics
            </button>
            <button className="btn-secondary" onClick={() => setReads([])} disabled={!reads.length}>
              <Trash2 size={16} /> Clear
            </button>
          </>
        } />

      {/* the capture field — invisible, always focused while listening */}
      <input ref={inputRef} inputMode="none" autoComplete="off" defaultValue=""
        onKeyDown={onKeyDown} onInput={onInput}
        className="absolute opacity-0 pointer-events-none h-0 w-0" />

      <div className={`rounded-xl ring-1 p-4 mb-4 flex items-start gap-3 ${TONE[diagnosis.tone]}`}>
        <DIcon size={20} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">{diagnosis.title}</p>
          <p className="text-sm mt-1 leading-relaxed">{diagnosis.body}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Reads captured" value={reads.length} icon={Radio} />
        <Stat label="Delivery"
          value={reads.length ? (commits && !keyed ? 'Commit' : keyed && !commits ? 'Keystrokes' : 'Mixed') : '—'}
          sub={reads.length ? (withTerm ? 'with a terminator' : 'no terminator — handled') : 'how reads arrive'} />
        <Stat label="Recognised format" value={`${good} / ${reads.length}`}
          tone={reads.length && good === reads.length ? 'good' : reads.length ? 'warn' : 'default'}
          sub="EPC or printed label" />
        <Stat label="Matched a unit" value={`${matched} / ${reads.length}`}
          tone={matched ? 'good' : reads.length ? 'warn' : 'default'}
          sub="Found in this system" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" bodyClass="p-0" title="Raw reads"
          subtitle="Exactly what arrived, in order, with nothing cleaned up">
          {reads.length === 0 ? (
            <div className="p-10 text-center">
              <Radio size={44} className={`mx-auto mb-3 ${
                listening ? 'text-brand-500 animate-pulse' : 'text-slate-300'}`} />
              <p className="text-lg font-medium text-slate-700">
                {listening ? 'Listening — pull the trigger' : 'Not listening'}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {sawInput ? 'Something arrived but no complete read yet.' : 'Nothing has arrived yet.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reads.map((r) => <ReadRow key={r.id} r={r} />)}
            </div>
          )}
        </Card>

        <Card title="How to read this">
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              <strong className="text-slate-800">Nothing appears at all.</strong> The reader is not
              in keyboard / wedge mode. Open the scanner or UHF app on the handheld and switch its
              output to keyboard emulation.
            </p>
            <p>
              <strong className="text-slate-800">Characters but no terminator.</strong> Set the
              suffix to Enter / CR. Without it, fast reads can run into each other.
            </p>
            <p>
              <strong className="text-slate-800">Wrong length.</strong> A tag should arrive as
              exactly {EPC_LEN} hex characters. More or fewer usually means the reader is sending
              the TID rather than the EPC bank.
            </p>
            <p>
              <strong className="text-slate-800">Right format, no match.</strong> The reader is
              fine — those tags just are not registered here yet.
            </p>
            <p className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
              <Info size={14} className="mt-0.5 shrink-0" />
              Timing per character tells a wedge from a person: a reader types a whole code in
              under a millisecond per character, a person takes well over forty.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function ReadRow({ r }) {
  const tone = {
    good: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
    warn: 'text-amber-700 bg-amber-50 ring-amber-200',
    bad: 'text-rose-700 bg-rose-50 ring-rose-200',
  }[r.verdict.tone] || 'text-slate-600 bg-slate-50 ring-slate-200';

  return (
    <div className="p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm text-slate-900 break-all">{r.text}</p>
          <p className="text-xs text-slate-500 mt-1">{r.verdict.note}</p>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-md ring-1 ${tone}`}>
          {r.verdict.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Badge>{r.chars} chars</Badge>
        <Badge status={r.terminator === 'none' ? 'partial' : 'completed'}>
          {r.terminator === 'none' ? 'no terminator' : `${r.terminator} suffix`}
        </Badge>
        <Badge status={r.via === 'commit' ? 'found' : undefined}>
          {r.via === 'commit' ? 'text commit' : `${r.perChar}ms/char`}
        </Badge>
        {r.via === 'keystrokes' && (
          <Badge status={r.typedByHand ? undefined : 'found'}>
            {r.typedByHand ? 'typed by hand' : 'scanner speed'}
          </Badge>
        )}
        {r.resolved && (
          <Badge status={r.resolved.ok ? 'completed' : 'cancelled'}>
            {r.resolved.ok
              ? `${r.resolved.unit?.product_name || 'matched'}${
                r.resolved.unit?.size ? ` · ${r.resolved.unit.size}` : ''}`
              : 'no match in this system'}
          </Badge>
        )}
      </div>
    </div>
  );
}
