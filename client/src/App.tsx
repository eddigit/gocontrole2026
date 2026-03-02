import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TargetDetail from './pages/TargetDetail';
import Sessions from './pages/Sessions';
import Alerts from './pages/Alerts';
import Messages from './pages/Messages';
import Calls from './pages/Calls';
import MediaGallery from './pages/MediaGallery';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';

function ProtectedLayout() {
  const { token, logout } = useAuth();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onLogout={logout} />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/targets/:id" element={<TargetDetail />} />
            <Route path="/targets/:id/messages" element={<Messages />} />
            <Route path="/targets/:id/calls" element={<Calls />} />
            <Route path="/targets/:id/media" element={<MediaGallery />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/alerts" element={<Alerts />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </BrowserRouter>
  );
}
