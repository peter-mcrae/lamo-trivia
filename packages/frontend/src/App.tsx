import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { usePageTracking } from '@/hooks/usePageTracking';
import Home from '@/pages/Home';
import Lobby from '@/pages/Lobby';
import CreateGame from '@/pages/CreateGame';
import GameRoom from '@/pages/GameRoom';
import Results from '@/pages/Results';
import NotFound from '@/pages/NotFound';

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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
