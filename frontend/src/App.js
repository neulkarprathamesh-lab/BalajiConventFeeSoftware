import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { Toaster } from 'sonner';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Students from '@/pages/Students';
import StudentDetail from '@/pages/StudentDetail';
import NewReceipt from '@/pages/NewReceipt';
import ReceiptTypeSelector from '@/pages/ReceiptTypeSelector';
import ReceiptTypes from '@/pages/ReceiptTypes';
import Finance from '@/pages/Finance';
import ConfigExportImport from '@/pages/ConfigExportImport';
import NewReceiptAdvanced from '@/pages/NewReceiptAdvanced';
import Receipts from '@/pages/Receipts';
import ReceiptView from '@/pages/ReceiptView';
import Adjustments from '@/pages/Adjustments';
import FeeAdjustments from '@/pages/FeeAdjustments';
import Extensions from '@/pages/Extensions';
import Reminders from '@/pages/Reminders';
import Reports from '@/pages/Reports';
import FeeStructure from '@/pages/FeeStructure';
import BulkFeeUpdate from '@/pages/BulkFeeUpdate';
import BusFeeReport from '@/pages/BusFeeReport';
import Admin from '@/pages/Admin';
import Cancellations from '@/pages/Cancellations';
import Concessions from '@/pages/Concessions';
import Promotion from '@/pages/Promotion';
import BusRoutes from '@/pages/BusRoutes';
import BusStops from '@/pages/BusStops';
import BusFees from '@/pages/BusFees';
import FeeNotices from '@/pages/FeeNotices';
import Profile from '@/pages/Profile';
import Settings from '@/pages/Settings';
import AssignStudents from '@/pages/AssignStudents';
import FeeBrochure from '@/pages/FeeBrochure';
import Defaulters from '@/pages/Defaulters';
import Lookup from '@/pages/Lookup';
import KioskPoster from '@/pages/KioskPoster';
import StudentLookup from '@/pages/StudentLookup';
import FeeSlip from '@/pages/FeeSlip';
import DayEnd from '@/pages/DayEnd';
import SetupWizard from '@/pages/SetupWizard';
import ImportExcel from '@/pages/ImportExcel';
import ImportsHistory from '@/pages/ImportsHistory';
import Diagnostics from '@/pages/Diagnostics';
import DeliveryCenter from '@/pages/DeliveryCenter';
import ConfigSnapshots from '@/pages/ConfigSnapshots';
import SoftwareUpdates from '@/pages/SoftwareUpdates';
import FactoryReset from '@/pages/FactoryReset';
import LockScreen from '@/components/LockScreen';
import PrintLab from '@/pages/PrintLab';
import '@/index.css';

const Protected = ({ children, roles }) => {
  const { user, loading, locked } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}{locked && <LockScreen />}</>;
};

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><Layout /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentDetail />} />
            <Route path="new-receipt" element={<ReceiptTypeSelector />} />
            <Route path="new-receipt/entry" element={<NewReceipt />} />
            <Route path="new-receipt-advanced" element={<NewReceiptAdvanced />} />
            <Route path="finance" element={<Protected roles={['administrator','manager','accountant']}><Finance /></Protected>} />
            <Route path="receipt-types" element={<Protected roles={['administrator']}><ReceiptTypes /></Protected>} />
            <Route path="config-io" element={<Protected roles={['administrator']}><ConfigExportImport /></Protected>} />
            <Route path="receipts" element={<Receipts />} />
            <Route path="adjustments" element={<Adjustments />} />
            <Route path="fee-adjustment-applications" element={<FeeAdjustments />} />
            <Route path="extensions" element={<Extensions />} />
            <Route path="reminders" element={<Reminders />} />
            <Route path="reports" element={<Reports />} />
            <Route path="day-end" element={<DayEnd />} />
            <Route path="setup-wizard" element={<SetupWizard />} />
            <Route path="defaulters" element={<Defaulters />} />
            <Route path="cancellations" element={<Protected roles={['administrator','manager','accountant']}><Cancellations /></Protected>} />
            <Route path="concessions" element={<Protected roles={['administrator','manager','accountant']}><Concessions /></Protected>} />
            <Route path="promotion" element={<Protected roles={['administrator','manager']}><Promotion /></Protected>} />
            <Route path="bus-routes" element={<BusRoutes />} />
            <Route path="bus-stops" element={<BusStops />} />
            <Route path="bus-fees" element={<Protected roles={['administrator','manager']}><BusFees /></Protected>} />
            <Route path="fee-notices" element={<FeeNotices />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Protected roles={['administrator']}><Settings /></Protected>} />
            <Route path="fee-structure" element={<Protected roles={['administrator','manager','accountant']}><FeeStructure /></Protected>} />
            <Route path="bulk-fee-update" element={<Protected roles={['administrator','manager','accountant']}><BulkFeeUpdate /></Protected>} />
            <Route path="bus-fee-report" element={<Protected roles={['administrator','manager','accountant']}><BusFeeReport /></Protected>} />
            <Route path="fee-brochure" element={<FeeBrochure />} />
            <Route path="kiosk-poster" element={<Protected roles={['administrator','manager','accountant']}><KioskPoster /></Protected>} />
            <Route path="assign-students" element={<Protected roles={['administrator','manager','accountant']}><AssignStudents /></Protected>} />
            <Route path="import-excel" element={<Protected roles={['administrator','manager','accountant']}><ImportExcel /></Protected>} />
            <Route path="imports-history" element={<Protected roles={['administrator','manager','accountant']}><ImportsHistory /></Protected>} />
            <Route path="admin" element={<Protected roles={['administrator']}><Admin /></Protected>} />
            <Route path="delivery-center" element={<Protected roles={['administrator']}><DeliveryCenter /></Protected>} />
            <Route path="config-snapshots" element={<Protected roles={['administrator','manager']}><ConfigSnapshots /></Protected>} />
            <Route path="software-updates" element={<Protected roles={['administrator','manager']}><SoftwareUpdates /></Protected>} />
            <Route path="factory-reset" element={<Protected roles={['administrator']}><FactoryReset /></Protected>} />
            <Route path="diagnostics" element={<Diagnostics />} />
            <Route path="dashboard" element={<Navigate to="/" replace />} />
          </Route>
          <Route path="/receipts/:id" element={<Protected><ReceiptView /></Protected>} />
          <Route path="/lookup/:number" element={<Lookup />} />
          <Route path="/parent/:adm" element={<StudentLookup />} />
          <Route path="/parent/:adm/slip" element={<FeeSlip />} />
          <Route path="/print-lab" element={<PrintLab />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
