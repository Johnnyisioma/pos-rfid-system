import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Save, Plus, Trash2, Wand2, ArrowLeft, Radio, Tag, Layers } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, variantLabel } from '../lib/format.js';
import { Card, Loading, useToast, Field, Badge, Modal, Spinner } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

const blankVariant = () => ({ size: '', color: '', cost_price: '', selling_price: '', barcode: '', is_active: true });

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, can, feature, locationId, locations } = useAuth();
  const [warranties, setWarranties] = useState([]);

  const [catalog, setCatalog] = useState({ brands: [], categories: [], templates: [], taxRates: [] });
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([blankVariant()]);
  const [saving, setSaving] = useState(false);
  const [matrix, setMatrix] = useState(false);
  const [priceModal, setPriceModal] = useState(null);
  const [tierModal, setTierModal] = useState(null);

  useEffect(() => { api.get('/api/catalog').then(setCatalog).catch(() => {}); }, []);
  useEffect(() => {
    if (feature('warranties')) api.get('/api/svc/warranties').then(setWarranties).catch(() => {});
  }, [feature]);

  useEffect(() => {
    if (isNew) {
      setProduct({
        name: '', sku: '', type: 'variable', brand_id: '', category_id: '', sub_category_id: '', tax_rate_id: '',
        unit: 'pair', description: '', image_url: '',
        tax_rate: settings?.vat_rate ?? 7.5, reorder_point: settings?.low_stock_default ?? 3,
        track_rfid: true, is_active: true,
      });
      setVariants([blankVariant()]);
      return;
    }
    api.get(`/api/products/${id}`).then((p) => {
      setProduct(p);
      setVariants(p.variants.map((v) => ({
        id: v.id, sku: v.sku, size: v.size || '', color: v.color || '',
        cost_price: v.cost_price, selling_price: v.selling_price, barcode: v.barcode || '',
        is_active: v.is_active, stock: v.stock, units_in_stock: v.units_in_stock,
        location_price: v.location_price,
      })));
    }).catch((e) => toast.error(e.message));
  }, [id, isNew, settings]); // eslint-disable-line

  const parents = useMemo(() => catalog.categories.filter((c) => !c.parent_id), [catalog]);
  const children = useMemo(
    () => catalog.categories.filter((c) => c.parent_id === Number(product?.category_id)),
    [catalog, product?.category_id]);

  if (!product) return <Loading />;

  const setP = (patch) => setProduct((p) => ({ ...p, ...patch }));
  const setV = (i, patch) => setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  const save = async () => {
    if (!product.name.trim()) return toast.error('Give the product a name');
    const clean = variants
      .filter((v) => v.selling_price !== '' || v.id)
      .map((v) => ({
        ...v,
        cost_price: Number(v.cost_price) || 0,
        selling_price: Number(v.selling_price) || 0,
        size: v.size || null, color: v.color || null, barcode: v.barcode || null,
      }));
    if (!clean.length) return toast.error('Add at least one variant with a price');

    setSaving(true);
    try {
      const body = {
        ...product,
        brand_id: product.brand_id || null,
        tax_rate_id: product.tax_rate_id || null,
        category_id: product.category_id || null,
        sub_category_id: product.sub_category_id || null,
        tax_rate: Number(product.tax_rate),
        reorder_point: Number(product.reorder_point),
        variants: clean,
      };
      const saved = isNew
        ? await api.post('/api/products', body)
        : await api.put(`/api/products/${id}`, body);
      toast.success(isNew ? 'Product created' : 'Changes saved');
      if (isNew) navigate(`/products/${saved.id}`);
      else { setProduct(saved); setVariants(saved.variants.map((v) => ({ ...v, size: v.size || '', color: v.color || '' }))); }
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'New product' : product.name}
        subtitle={isNew ? 'Add a style and all of its size/colour variants' : `SKU ${product.sku}`}
        actions={
          <>
            <Link to="/products" className="btn-secondary"><ArrowLeft size={16} /> Back</Link>
            {can('products.write') && (
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? <Spinner /> : <Save size={16} />} Save
              </button>
            )}
          </>
        } />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Details">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Product name" className="sm:col-span-2">
                <input className="input" value={product.name} onChange={(e) => setP({ name: e.target.value })} />
              </Field>
              <Field label="SKU" hint={isNew ? 'Leave blank to generate one automatically' : undefined}>
                <input className="input font-mono" value={product.sku || ''} disabled={!isNew}
                  onChange={(e) => setP({ sku: e.target.value })} />
              </Field>
              <Field label="Type">
                <select className="input" value={product.type} onChange={(e) => setP({ type: e.target.value })}>
                  <option value="variable">Variable (sizes / colours)</option>
                  <option value="single">Single</option>
                  <option value="bundle">Bundle / kit</option>
                </select>
              </Field>
              <Field label="Brand">
                <select className="input" value={product.brand_id || ''} onChange={(e) => setP({ brand_id: e.target.value })}>
                  <option value="">—</option>
                  {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Unit">
                <input className="input" value={product.unit} onChange={(e) => setP({ unit: e.target.value })} />
              </Field>
              <Field label="Category">
                <select className="input" value={product.category_id || ''}
                  onChange={(e) => setP({ category_id: e.target.value, sub_category_id: '' })}>
                  <option value="">—</option>
                  {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Sub-category">
                <select className="input" value={product.sub_category_id || ''}
                  onChange={(e) => setP({ sub_category_id: e.target.value })}>
                  <option value="">—</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Tax rate"
                hint={(catalog.taxRates || []).length
                  ? 'Picking a named rate keeps the VAT return right for exempt lines'
                  : 'Add named rates under Settings → Tax rates to handle exempt items'}>
                <select className="input" value={product.tax_rate_id || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const hit = (catalog.taxRates || []).find((t) => String(t.id) === String(id));
                    // Keep the plain percentage in step so older receipts and the
                    // reports that read p.tax_rate never disagree with the named rate.
                    setP(hit ? { tax_rate_id: id, tax_rate: hit.rate } : { tax_rate_id: '' });
                  }}>
                  <option value="">Business default ({settings?.vat_rate ?? 7.5}%)</option>
                  {(catalog.taxRates || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {Number(t.rate).toFixed(2)}%</option>
                  ))}
                </select>
              </Field>
              <Field label="VAT rate (%)" hint="Used when no named rate is picked">
                <input type="number" step="0.1" className="input" value={product.tax_rate}
                  disabled={!!product.tax_rate_id}
                  onChange={(e) => setP({ tax_rate: e.target.value })} />
              </Field>
              <Field label="Reorder point">
                <input type="number" className="input" value={product.reorder_point}
                  onChange={(e) => setP({ reorder_point: e.target.value })} />
              </Field>
              {feature('warranties') && (
                <Field label="Warranty"
                  hint="Registers to each unit's serial when sold — check coverage later by scanning the tag">
                  <select className="input" value={product.warranty_id || ''}
                    onChange={(e) => setP({ warranty_id: e.target.value })}>
                    <option value="">No warranty</option>
                    {warranties.map((w) => (
                      <option key={w.id} value={w.id}>{w.name} ({w.duration} {w.duration_unit})</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Image URL" className="sm:col-span-2">
                <input className="input" value={product.image_url || ''} placeholder="https://…"
                  onChange={(e) => setP({ image_url: e.target.value })} />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <textarea className="input" rows="2" value={product.description || ''}
                  onChange={(e) => setP({ description: e.target.value })} />
              </Field>
            </div>

            <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-slate-100">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!product.track_rfid} className="rounded border-slate-300"
                  onChange={(e) => setP({ track_rfid: e.target.checked })} />
                <Radio size={14} /> Track each unit with its own RFID tag
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={product.is_active !== false} className="rounded border-slate-300"
                  onChange={(e) => setP({ is_active: e.target.checked })} />
                Active
              </label>
            </div>
          </Card>

          <Card title="Variants" subtitle="Each row is a size/colour combination with its own SKU and stock"
            actions={
              <>
                <button className="btn-secondary text-xs" onClick={() => setMatrix(true)}>
                  <Wand2 size={14} /> Generate matrix
                </button>
                <button className="btn-secondary text-xs" onClick={() => setVariants((v) => [...v, blankVariant()])}>
                  <Plus size={14} /> Add row
                </button>
              </>
            } bodyClass="p-0">

            <CascadeBar variants={variants} setVariants={setVariants} />

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Size</th><th>Colour</th><th>SKU</th><th>Barcode</th>
                    <th className="text-right">Cost</th><th className="text-right">Price</th>
                    {!isNew && <th className="text-right">Stock</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => (
                    <tr key={i} className={v.is_active === false ? 'opacity-50' : ''}>
                      <td><input className="input py-1 w-20" value={v.size}
                        onChange={(e) => setV(i, { size: e.target.value })} /></td>
                      <td><input className="input py-1 w-28" value={v.color}
                        onChange={(e) => setV(i, { color: e.target.value })} /></td>
                      <td className="font-mono text-xs text-slate-500">{v.sku || <span className="italic">auto</span>}</td>
                      <td><input className="input py-1 w-32 font-mono text-xs" value={v.barcode || ''}
                        onChange={(e) => setV(i, { barcode: e.target.value })} /></td>
                      <td><input type="number" className="input py-1 w-24 text-right" value={v.cost_price}
                        onChange={(e) => setV(i, { cost_price: e.target.value })} /></td>
                      <td><input type="number" className="input py-1 w-24 text-right" value={v.selling_price}
                        onChange={(e) => setV(i, { selling_price: e.target.value })} /></td>
                      {!isNew && (
                        <td className="text-right">
                          <div className="tabular-nums">{num(v.stock ?? 0)}</div>
                          {Number(v.units_in_stock) > 0 && (
                            <div className="text-[10px] text-emerald-700">{num(v.units_in_stock)} tagged</div>
                          )}
                        </td>
                      )}
                      <td className="text-right whitespace-nowrap">
                        {!isNew && v.id && (
                          <>
                            {locations.length > 1 && (
                              <button className="btn-ghost p-1.5" title="Location price override"
                                onClick={() => setPriceModal(v)}><Tag size={14} /></button>
                            )}
                            <button className="btn-ghost p-1.5" title="Price tiers"
                              onClick={() => setTierModal(v)}><Layers size={14} /></button>
                          </>
                        )}
                        <button className="btn-ghost p-1.5 text-rose-600" title="Remove"
                          onClick={() => setVariants((vs) => vs.filter((_, x) => x !== i))}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isNew && (
              <p className="text-xs text-slate-500 px-4 py-3 border-t border-slate-100">
                Removing a row deactivates the variant rather than deleting it — past sales and any physical
                RFID tags already in the shop still refer to it.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!isNew && (
            <Card title="Stock summary">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Variants</dt>
                  <dd className="tabular-nums">{variants.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">On hand here</dt>
                  <dd className="tabular-nums">{num(variants.reduce((s, v) => s + Number(v.stock || 0), 0))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Tagged units</dt>
                  <dd className="tabular-nums">{num(variants.reduce((s, v) => s + Number(v.units_in_stock || 0), 0))}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Stock value (cost)</dt>
                  <dd className="tabular-nums">
                    {money(variants.reduce((s, v) => s + Number(v.stock || 0) * Number(v.cost_price || 0), 0))}
                  </dd>
                </div>
              </dl>
              <Link to={`/rfid?product_id=${id}`} className="btn-secondary w-full mt-3">
                <Radio size={15} /> View tagged units
              </Link>
            </Card>
          )}

          <Card title="Variation templates" subtitle="Reusable size and colour sets">
            <div className="space-y-2">
              {catalog.templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-700">{t.name}</p>
                    <p className="text-xs text-slate-500">{(t.values_json || []).join(', ')}</p>
                  </div>
                  <Badge>{t.axis}</Badge>
                </div>
              ))}
              {!catalog.templates.length && (
                <p className="text-sm text-slate-500">None yet — add them under Settings.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <MatrixModal open={matrix} onClose={() => setMatrix(false)} templates={catalog.templates}
        onGenerate={(rows) => {
          setVariants((prev) => {
            const existing = new Set(prev.map((v) => `${v.size}|${v.color}`));
            const fresh = rows.filter((r) => !existing.has(`${r.size}|${r.color}`));
            const base = prev.filter((v) => v.id || v.selling_price !== '' || v.size || v.color);
            return [...base, ...fresh];
          });
          setMatrix(false);
        }} />

      {tierModal && <TierPriceModal variant={tierModal} onClose={() => setTierModal(null)} />}
      <LocationPriceModal variant={priceModal} onClose={() => setPriceModal(null)} locations={locations}
        currentLocation={locationId} />
    </>
  );
}

function MatrixModal({ open, onClose, templates, onGenerate }) {
  const [sizes, setSizes] = useState('');
  const [colors, setColors] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');

  const parse = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const generate = () => {
    const S = parse(sizes).length ? parse(sizes) : [''];
    const C = parse(colors).length ? parse(colors) : [''];
    const rows = [];
    for (const size of S) for (const color of C) {
      rows.push({ ...blankVariant(), size, color, cost_price: cost, selling_price: price });
    }
    onGenerate(rows);
  };

  return (
    <Modal open={open} onClose={onClose} title="Generate the variant matrix" size="sm"
      subtitle="Every size × every colour, in one step"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={generate}>Generate</button></>}>
      <div className="space-y-3">
        <Field label="Sizes (comma separated)">
          <input className="input" value={sizes} onChange={(e) => setSizes(e.target.value)}
            placeholder="40, 41, 42, 43, 44" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {templates.filter((t) => t.axis === 'size').map((t) => (
            <button key={t.id} className="badge bg-slate-100 text-slate-700 hover:bg-slate-200"
              onClick={() => setSizes((t.values_json || []).join(', '))}>{t.name}</button>
          ))}
        </div>
        <Field label="Colours (comma separated)">
          <input className="input" value={colors} onChange={(e) => setColors(e.target.value)}
            placeholder="Black, Brown, Tan" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {templates.filter((t) => t.axis === 'color').map((t) => (
            <button key={t.id} className="badge bg-slate-100 text-slate-700 hover:bg-slate-200"
              onClick={() => setColors((t.values_json || []).join(', '))}>{t.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost price for all">
            <input type="number" className="input" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label="Selling price for all">
            <input type="number" className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function LocationPriceModal({ variant, onClose, locations, currentLocation }) {
  const [locId, setLocId] = useState(currentLocation);
  const [price, setPrice] = useState('');
  const toast = useToast();
  useEffect(() => { if (variant) { setLocId(currentLocation); setPrice(variant.location_price ?? ''); } }, [variant, currentLocation]);
  if (!variant) return null;

  const save = async () => {
    try {
      await api.put(`/api/products/variants/${variant.id}/location-price`, {
        location_id: locId, selling_price: price === '' ? null : Number(price),
      });
      toast.success(price === '' ? 'Override cleared' : 'Location price saved');
      onClose();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Modal open onClose={onClose} title="Location price override" size="sm"
      subtitle={`${variantLabel(variant)} · base price ${money(variant.selling_price)}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save</button></>}>
      <Field label="Location">
        <select className="input" value={locId} onChange={(e) => setLocId(Number(e.target.value))}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Price at this location" className="mt-3"
        hint="Leave blank to fall back to the base price.">
        <input type="number" className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
    </Modal>
  );
}

/**
 * Set a price across every variant at once.
 *
 * Forty sizes of the same shoe are usually the same price, and typing it forty
 * times is where people give up and go back to the spreadsheet. The awkward
 * part is the exceptions — the one size that genuinely does cost more — so
 * this counts the rows that already disagree and offers to leave those alone
 * rather than flattening them silently.
 *
 * Nothing is written until the form is saved: this only fills the rows on
 * screen, so a mistake is undone by not pressing Save.
 */
function CascadeBar({ variants, setVariants }) {
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [keep, setKeep] = useState(null);      // null = follow the default below

  const distinct = (key) => [...new Set(
    variants.map((v) => String(v[key] ?? '')).filter((x) => x !== ''))];

  /**
   * Is there a "usual" value for this column, and what is it?
   *
   * Only when the commonest value covers more than half the filled rows. Below
   * that there is no rule, only twelve different prices — and calling eight of
   * them "exceptions to protect" would leave the button looking broken,
   * because pressing it would change almost nothing.
   */
  const rule = (key) => {
    const counts = {};
    let filled = 0;
    for (const v of variants) {
      const k = String(v[key] ?? '');
      if (k === '') continue;
      filled += 1;
      counts[k] = (counts[k] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] <= filled / 2) return null;
    return { value: best[0], odd: filled - best[1] };
  };

  const costRule = rule('cost_price');
  const priceRule = rule('selling_price');
  const costValues = distinct('cost_price');
  const priceValues = distinct('selling_price');

  // Only offer to protect exceptions when there is something to protect them
  // from — a usual price, and rows that disagree with it.
  const exceptions = (cost !== '' ? (costRule?.odd || 0) : 0)
    + (price !== '' ? (priceRule?.odd || 0) : 0);
  const keepOverrides = keep === null ? exceptions > 0 : keep;

  const apply = () => {
    setVariants((vs) => vs.map((v) => {
      const next = { ...v };
      if (cost !== '') {
        const isException = keepOverrides && costRule
          && String(v.cost_price ?? '') !== '' && String(v.cost_price) !== costRule.value;
        if (!isException) next.cost_price = cost;
      }
      if (price !== '') {
        const isException = keepOverrides && priceRule
          && String(v.selling_price ?? '') !== '' && String(v.selling_price) !== priceRule.value;
        if (!isException) next.selling_price = price;
      }
      return next;
    }));
    setCost('');
    setPrice('');
    setKeep(null);
  };

  const willChange = variants.filter((v) => {
    if (cost !== '') {
      const ex = keepOverrides && costRule
        && String(v.cost_price ?? '') !== '' && String(v.cost_price) !== costRule.value;
      if (!ex) return true;
    }
    if (price !== '') {
      const ex = keepOverrides && priceRule
        && String(v.selling_price ?? '') !== '' && String(v.selling_price) !== priceRule.value;
      if (!ex) return true;
    }
    return false;
  }).length;

  return (
    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">
          Cost for all
        </label>
        <input type="number" className="input py-1 w-28 text-right" value={cost}
          placeholder={costValues.length === 1 ? costValues[0] : 'mixed'}
          onChange={(e) => setCost(e.target.value)} />
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">
          Price for all
        </label>
        <input type="number" className="input py-1 w-28 text-right" value={price}
          placeholder={priceValues.length === 1 ? priceValues[0] : 'mixed'}
          onChange={(e) => setPrice(e.target.value)} />
      </div>

      <button className="btn-secondary text-xs" disabled={cost === '' && price === ''}
        onClick={apply}>
        Apply to {cost === '' && price === ''
          ? `${variants.length} variant${variants.length === 1 ? '' : 's'}`
          : `${willChange} of ${variants.length}`}
      </button>

      {exceptions > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-1">
          <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300"
            checked={keepOverrides} onChange={(e) => setKeep(e.target.checked)} />
          Leave the {exceptions} row{exceptions === 1 ? '' : 's'} priced differently alone
        </label>
      )}

      <p className="text-[11px] text-slate-400 w-full">
        {costValues.length > 1 && priceValues.length > 1 && !costRule && !priceRule
          ? 'Every row is priced differently, so there is no usual price to protect — this will set all of them.'
          : 'Nothing is saved until you press Save — this only fills the rows below.'}
      </p>
    </div>
  );
}

/**
 * Set this variant's price in each selling tier.
 *
 * Blank means "no tier price" — the till falls back to the shelf price, so a
 * shop that has not set wholesale numbers is unaffected. The tag can also carry
 * its own tier, which wins over these.
 */
function TierPriceModal({ variant, onClose }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/catalog-ext/variants/${variant.id}/prices`)
      .then((r) => setRows(r.map((x) => ({ ...x, price: x.price ?? '' }))))
      .catch(() => setRows([]));
  }, [variant.id]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/catalog-ext/variants/${variant.id}/prices`, {
        prices: rows.map((r) => ({ group_id: r.group_id, price: r.price === '' ? null : Number(r.price) })),
      });
      toast.success('Tier prices saved');
      onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm"
      title="Price tiers"
      subtitle={`${variantLabel(variant)} · shelf ${money(variant.selling_price)}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy || !rows}>Save tiers</button></>}>
      {!rows ? <Loading /> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No price tiers exist yet. Create them under Catalogue setup → Price tiers.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.group_id} className="flex items-center gap-3">
              <span className="text-sm text-slate-700 w-32">{r.name}</span>
              <input type="number" className="input py-1 text-right flex-1"
                placeholder={`shelf ${money(variant.selling_price)}`}
                value={r.price}
                onChange={(e) => setRows((x) => x.map((y, idx) => (idx === i ? { ...y, price: e.target.value } : y)))} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
