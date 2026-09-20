import { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { needsServerSetup } from './lib/platform.js';
import ServerSetup from './pages/ServerSetup.jsx';
import { Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import Products from './pages/Products.jsx';
import ProductEditor from './pages/ProductEditor.jsx';
import ImportExport from './pages/ImportExport.jsx';
import Inventory from './pages/Inventory.jsx';
import Purchases from './pages/Purchases.jsx';
import Transfers from './pages/Transfers.jsx';
import RfidUnits from './pages/RfidUnits.jsx';
import TagLookup from './pages/TagLookup.jsx';
import ReaderTest from './pages/ReaderTest.jsx';
import TagStock from './pages/TagStock.jsx';
import StockTake from './pages/StockTake.jsx';
import StockTakeMode from './pages/StockTakeMode.jsx';
import FindItem from './pages/FindItem.jsx';
import Customers from './pages/Customers.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import Sales from './pages/Sales.jsx';
import SaleDetail from './pages/SaleDetail.jsx';
import Returns from './pages/Returns.jsx';
import Register from './pages/Register.jsx';
import Expenses from './pages/Expenses.jsx';
import Accounts from './pages/Accounts.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Devices from './pages/Devices.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Quarantine from './pages/Quarantine.jsx';
import Commissions from './pages/Commissions.jsx';
import PublicReceipt from './pages/PublicReceipt.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center"><Loading label="Starting up…" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  // The Android app has to be told its server's address before anything else
  // can happen. In a browser this is always false — the server is right there.
  const [needsServer] = useState(needsServerSetup);
  if (needsServer) return <ServerSetup />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* A customer's receipt. No login — the token in the URL is the credential. */}
      <Route path="/r/:token" element={<PublicReceipt />} />

      {/* Full-screen handheld mode, outside the normal chrome */}
      <Route path="/stock-take-mode" element={<Protected><StockTakeMode /></Protected>} />

      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="pos" element={<POS />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductEditor />} />
        <Route path="products/:id" element={<ProductEditor />} />
        <Route path="import-export" element={<ImportExport />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="purchases" element={<Purchases />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="rfid" element={<RfidUnits />} />
        <Route path="rfid/lookup" element={<TagLookup />} />
        <Route path="rfid/reader-test" element={<ReaderTest />} />
        <Route path="rfid/tag-stock" element={<TagStock />} />
        <Route path="rfid/stock-take" element={<StockTake />} />
        <Route path="rfid/find" element={<FindItem />} />
        <Route path="rfid/quarantine" element={<Quarantine />} />
        <Route path="commissions" element={<Commissions />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="sales" element={<Sales />} />
        <Route path="sales/:id" element={<SaleDetail />} />
        <Route path="returns" element={<Returns />} />
        <Route path="register" element={<Register />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="devices" element={<Devices />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
