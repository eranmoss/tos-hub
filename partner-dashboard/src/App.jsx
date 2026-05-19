import { Routes, Route, Navigate } from 'react-router-dom';
import MagicLinkForm from './auth/MagicLinkForm.jsx';
import VerifyToken from './auth/VerifyToken.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import Shell from './layout/Shell.jsx';
import Overview from './pages/Overview.jsx';
import Inventory from './pages/Inventory.jsx';
import Transactions from './pages/Transactions.jsx';
import Intelligence from './pages/Intelligence.jsx';
import Settings from './pages/Settings.jsx';
import SystemLog from './pages/SystemLog.jsx';
import Builder from './pages/Builder.jsx';
import ComponentEditor from './pages/ComponentEditor.jsx';


export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/verify/:token" element={<VerifyToken />} />
      <Route path="/dashboard" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
        <Route index element={<Overview />} />
        <Route path="integrations" element={<Navigate to="/dashboard" replace />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="intelligence" element={<Intelligence />} />
        <Route path="builder" element={<Builder />} />
        <Route path="components" element={<ComponentEditor />} />
        <Route path="system-log" element={<SystemLog />} />
        <Route path="jobs" element={<Navigate to="/dashboard/system-log" replace />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
