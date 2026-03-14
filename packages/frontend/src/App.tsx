import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AdminLayout } from '@/components/AdminLayout';
import { CookieBanner } from '@/components/CookieBanner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { usePageTracking } from '@/hooks/usePageTracking';
import Home from '@/pages/Home';
import Lobby from '@/pages/Lobby';
import CreateGame from '@/pages/CreateGame';
import GameRoom from '@/pages/GameRoom';
import Groups from '@/pages/Groups';
import CreateGroup from '@/pages/CreateGroup';
import JoinGroup from '@/pages/JoinGroup';
import GroupLobby from '@/pages/GroupLobby';
import NotFound from '@/pages/NotFound';
import About from '@/pages/About';
import HowToPlay from '@/pages/HowToPlay';
import CategoryPage from '@/pages/CategoryPage';
import RiddleWordle from '@/pages/RiddleWordle';
import CreateHunt from '@/pages/CreateHunt';
import HuntRoom from '@/pages/HuntRoom';
import Login from '@/pages/Login';
import Credits from '@/pages/Credits';
import CreditsPurchaseSuccess from '@/pages/CreditsPurchaseSuccess';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import AdminUsers from '@/pages/admin/AdminUsers';
import AdminUserDetail from '@/pages/admin/AdminUserDetail';
import AdminAnalytics from '@/pages/admin/AdminAnalytics';
import AdminErrors from '@/pages/admin/AdminErrors';

function AppRoutes() {
  usePageTracking();

  return (
    <Routes>
      {/* Admin routes — separate layout, no public nav/footer */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="users/:email" element={<AdminUserDetail />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="errors" element={<AdminErrors />} />
      </Route>

      {/* Public routes */}
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/create" element={<CreateGame />} />
        <Route path="/game/:gameId" element={<GameRoom />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/group/new" element={<CreateGroup />} />
        <Route path="/group/join" element={<JoinGroup />} />
        <Route path="/group/:groupId" element={<GroupLobby />} />
        <Route path="/about" element={<About />} />
        <Route path="/how-to-play" element={<HowToPlay />} />
        <Route path="/trivia/:categoryId" element={<CategoryPage />} />
        <Route path="/riddle-wordle" element={<RiddleWordle />} />
        <Route path="/hunt/create" element={<CreateHunt />} />
        <Route path="/hunt/:huntId" element={<HuntRoom />} />
        <Route path="/login" element={<Login />} />
        <Route path="/credits" element={<ProtectedRoute><Credits /></ProtectedRoute>} />
        <Route path="/credits/success" element={<ProtectedRoute><CreditsPurchaseSuccess /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <CookieBanner />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
