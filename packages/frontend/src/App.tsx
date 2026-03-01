import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { CookieBanner } from '@/components/CookieBanner';
import { usePageTracking } from '@/hooks/usePageTracking';
import Home from '@/pages/Home';
import Lobby from '@/pages/Lobby';
import CreateGame from '@/pages/CreateGame';
import GameRoom from '@/pages/GameRoom';
import Results from '@/pages/Results';
import Groups from '@/pages/Groups';
import CreateGroup from '@/pages/CreateGroup';
import JoinGroup from '@/pages/JoinGroup';
import GroupLobby from '@/pages/GroupLobby';
import NotFound from '@/pages/NotFound';
import About from '@/pages/About';
import HowToPlay from '@/pages/HowToPlay';
import CategoryPage from '@/pages/CategoryPage';

function AppRoutes() {
  usePageTracking();

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/create" element={<CreateGame />} />
        <Route path="/game/:gameId" element={<GameRoom />} />
        <Route path="/results/:gameId" element={<Results />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/group/new" element={<CreateGroup />} />
        <Route path="/group/join" element={<JoinGroup />} />
        <Route path="/group/:groupId" element={<GroupLobby />} />
        <Route path="/about" element={<About />} />
        <Route path="/how-to-play" element={<HowToPlay />} />
        <Route path="/trivia/:categoryId" element={<CategoryPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <CookieBanner />
    </BrowserRouter>
  );
}

export default App;
