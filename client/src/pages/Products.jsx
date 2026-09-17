import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Search, Copy, Trash2, Package, FileSpreadsheet, Download, CheckSquare, Square, Layers,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, ConfirmButton } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import ExportButtons from '../components/ExportButtons.jsx';

export default function Products() {
  const { can, locationId } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ q: '', category_id: '', brand_id: '', type: '', active: '' });
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState({ brands: [], categories: [] });
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await api.get(`/api/products${qs({ ...filters, page, limit: 25 })}`));
    } catch (e) { toast.error(e.message); }
  }, [filters, page, locationId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/catalog').then(setCatalog).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [filters]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const duplicate = async (p) => {
    try {
      const copy = await api.post(`/api/products/${p.id}/duplicate`, {});
      toast.success(`Duplicated as "${copy.name}"`);
      navigate(`/products/${copy.id}`);
    } catch (e) { toast.error(e.message); }
  };

  const remove = async (p) => {
    try {
      const res = await api.del(`/api/products/${p.id}`);
      toast.success(res.message || 'Product deleted');
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Products" subtitle="Catalogue, variants and pricing"
        actions={
          <>
            <button className="btn-secondary" onClick={() => api.download('/api/io/products/export?format=xlsx')}>
              <Download size={16} /> Export catalogue
            </button>
            <Link to="/import-export" className="btn-secondary"><FileSpreadsheet size={16} /> Import</Link>
            {can('products.write') && (
              <Link to="/products/new" className="btn-primary"><Plus size={16} /> New product</Link>
            )}
          </>
        } />

      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search name, SKU or barcode…"
              value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <select className="input w-auto" value={filters.category_id}
            onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}>
            <option value="">All categories</option>
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</option>
            ))}
          </select>
          <select className="input w-auto" value={filters.brand_id}
            onChange={(e) => setFilters((f) => ({ ...f, brand_id: e.target.value }))}>
            <option value="">All brands</option>
            {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="input w-auto" value={filters.active}
            onChange={(e) => setFilters((f) => ({ ...f, active: e.target.value }))}>
            <option value="">Active & inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
          {can('products.write') && selected.length > 0 && (
            <button className="btn-primary" onClick={() => setBulk(true)}>
              <Layers size={16} /> Edit {selected.length}
            </button>
          )}
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No products match" icon={Package}
            hint="Adjust the filters, or import your catalogue from a spreadsheet."
            action={<Link to="/import-export" className="btn-primary"><FileSpreadsheet size={16} /> Import products</Link>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {can('products.write') && <th className="w-10"></th>}
                    <th>Product</th>
                    <th>Category</th>
                    <th>Variants</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Stock here</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((p) => (
                    <tr key={p.id}>
                      {can('products.write') && (
                        <td>
                          <button onClick={() => toggle(p.id)} className="text-slate-400 hover:text-brand-600">
                            {selected.includes(p.id) ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}
                          </button>
                        </td>
                      )}
                      <td>
                        <Link to={`/products/${p.id}`} className="font-medium text-slate-800 hover:text-brand-700">
                          {p.name}
                        </Link>
                        <div className="text-xs text-slate-500 font-mono">{p.sku}</div>
                        {!p.is_active && <Badge status="cancelled" className="mt-1">Inactive</Badge>}
                      </td>
                      <td className="text-slate-600">
                        <div>{p.category_name || '—'}</div>
                        {p.sub_category_name && <div className="text-xs text-slate-400">{p.sub_category_name}</div>}
                        {p.brand_name && <div className="text-xs text-slate-400">{p.brand_name}</div>}
                      </td>
                      <td>
                        <Badge>{p.type === 'variable' ? `${p.variant_count} variants` : p.type === 'bundle' ? 'Bundle' : 'Single'}</Badge>
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {Number(p.min_price) === Number(p.max_price)
                          ? money(p.min_price)
                          : `${money(p.min_price)} – ${money(p.max_price)}`}
                      </td>
                      <td className="text-right tabular-nums">
                        <span className={Number(p.stock) <= Number(p.reorder_point) ? 'text-amber-700 font-medium' : ''}>
                          {num(p.stock)}
                        </span>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {can('products.write') && (
                          <>
                            <button className="btn-ghost p-2" title="Duplicate" onClick={() => duplicate(p)}>
                              <Copy size={15} />
                            </button>
                            <ConfirmButton className="btn-ghost p-2 text-rose-600" message="Delete?"
                              onConfirm={() => remove(p)}>
                              <Trash2 size={15} />
                            </ConfirmButton>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <BulkModal open={bulk} onClose={() => setBulk(false)} ids={selected} catalog={catalog}
        onDone={() => { setBulk(false); setSelected([]); load(); }} />
    </>
  );
}

function BulkModal({ open, onClose, ids, catalog, onDone }) {
  const [action, setAction] = useState('activate');
  const [value, setValue] = useState('');
  const toast = useToast();

  const run = async () => {
    const payload = { product_ids: ids, action };
    if (action === 'set_category') payload.category_id = value;
    if (action === 'set_brand') payload.brand_id = value;
    if (action === 'set_tax') payload.tax_rate = value;
    if (action === 'set_reorder_point') payload.reorder_point = value;
    if (action === 'adjust_price') payload.percent = value;
    if (action === 'set_price') payload.selling_price = value;
    try {
      const res = await api.post('/api/products/bulk', payload);
      toast.success(`${res.updated} record(s) updated`);
      onDone();
    } catch (e) { toast.error(e.message); }
  };

  const needsValue = !['activate', 'deactivate'].includes(action);

  return (
    <Modal open={open} onClose={onClose} title={`Bulk edit ${ids.length} products`} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={run}>Apply</button></>}>
      <Field label="Action">
        <select className="input" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}>
          <option value="activate">Activate</option>
          <option value="deactivate">Deactivate</option>
          <option value="set_category">Set category</option>
          <option value="set_brand">Set brand</option>
          <option value="set_tax">Set tax rate (%)</option>
          <option value="set_reorder_point">Set reorder point</option>
          <option value="adjust_price">Adjust prices by %</option>
          <option value="set_price">Set the same price on every variant</option>
        </select>
      </Field>
      {needsValue && (
        <Field label="Value" className="mt-3">
          {action === 'set_category' ? (
            <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</option>
              ))}
            </select>
          ) : action === 'set_brand' ? (
            <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <input type="number" className="input" value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={action === 'adjust_price' ? 'e.g. 10 for +10%, -5 for −5%' : ''} />
          )}
        </Field>
      )}
    </Modal>
  );
}
