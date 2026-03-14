import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import AdminDashboard from '@/pages/AdminDashboard';
import AdminUsers from '@/pages/AdminUsers';
import AdminUserDetail from '@/pages/AdminUserDetail';
import AdminAnalytics from '@/pages/AdminAnalytics';
import AdminErrors from '@/pages/AdminErrors';
import AdminCoupons from '@/pages/AdminCoupons';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:email" element={<AdminUserDetail />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="errors" element={<AdminErrors />} />
          <Route path="coupons" element={<AdminCoupons />} />
        </Route>
        {/* Catch-all redirects to dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
