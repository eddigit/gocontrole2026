import { useState, useEffect } from 'react';
import { Plus, Radio, RefreshCw, Wifi, WifiOff, AlertTriangle, Trash2, Play, Square } from 'lucide-react';
import { sessionApi } from '../api/client';

interface Session {
  id: string;
  name: string;
  phoneNumber: string | null;
  status: string;
  targetCount: number;
}

const statusIcons: Record<string, React.ReactNode> = {
  CONNECTED: <Wifi size={16} className="text-green-500" />,
  CONNECTING: <RefreshCw size={16} className="text-blue-500 animate-spin" />,
  DISCONNECTED: <WifiOff size={16} className="text-gray-400" />,
  DEGRADED: <AlertTriangle size={16} className="text-orange-500" />,
  REQUIRES_REAUTH: <AlertTriangle size={16} className="text-red-500" />,
};

const statusLabels: Record<string, string> = {
  CONNECTED: 'Connecte',
  CONNECTING: 'Connexion...',
  DISCONNECTED: 'Deconnecte',
  DEGRADED: 'Degrade',
  REQUIRES_REAUTH: 'Re-authentification requise',
};

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchSessions = async () => {
    try {
      const res = await sessionApi.list();
      setSessions(res.data.sessions);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await sessionApi.create(newName);
      if (res.data.qr) {
        setQrCode(res.data.qr);
      }
      setNewName('');
      fetchSessions();
    } catch {
      alert('Erreur lors de la creation de la session');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette session WhatsApp ?')) return;
    await sessionApi.delete(id);
    fetchSessions();
  };

  const handleStart = async (id: string) => {
    await sessionApi.start(id);
    fetchSessions();
  };

  const handleStop = async (id: string) => {
    await sessionApi.stop(id);
    fetchSessions();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sessions WhatsApp</h2>
          <p className="text-sm text-gray-500 mt-1">
            Gerez les comptes WhatsApp utilises pour le monitoring
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} />
          Nouvelle session
        </button>
      </div>

      {/* QR Code Modal */}
      {qrCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 text-center max-w-sm">
            <h3 className="text-lg font-semibold mb-2">Scanner le QR Code</h3>
            <p className="text-sm text-gray-500 mb-4">
              Ouvrez WhatsApp &gt; Appareils lies &gt; Lier un appareil
            </p>
            <img src={qrCode} alt="QR Code WhatsApp" className="mx-auto mb-4 w-64 h-64" />
            <button
              onClick={() => setQrCode(null)}
              className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Nouvelle session WhatsApp</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom de la session</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Ligne monitoring 1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600">
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creation...' : 'Creer et connecter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions List */}
      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Radio size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium mb-1">Aucune session WhatsApp</h3>
          <p className="text-sm text-gray-500 mb-4">
            Creez une session et scannez le QR code pour commencer le monitoring
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                {statusIcons[session.status] || statusIcons.DISCONNECTED}
                <div>
                  <p className="font-medium text-gray-900">{session.name}</p>
                  <p className="text-xs text-gray-500">
                    {session.phoneNumber ? `+${session.phoneNumber}` : 'Non appaire'} - {session.targetCount} cible(s)
                  </p>
                </div>
                <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                  {statusLabels[session.status] || session.status}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {session.status === 'DISCONNECTED' && (
                  <button onClick={() => handleStart(session.id)} className="p-2 text-green-500 hover:bg-green-50 rounded-lg" title="Demarrer">
                    <Play size={16} />
                  </button>
                )}
                {session.status === 'CONNECTED' && (
                  <button onClick={() => handleStop(session.id)} className="p-2 text-orange-500 hover:bg-orange-50 rounded-lg" title="Arreter">
                    <Square size={16} />
                  </button>
                )}
                <button onClick={() => handleDelete(session.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg" title="Supprimer">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
