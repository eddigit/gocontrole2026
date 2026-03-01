import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Users } from 'lucide-react';
import { dashboardApi, targetApi } from '../api/client';
import { usePresenceUpdates } from '../hooks/usePresence';
import TargetCard from '../components/TargetCard';
import StatusBadge from '../components/StatusBadge';

interface Target {
  id: string;
  jid: string;
  phoneNumber: string;
  label: string | null;
  status: string;
  confidence: number;
  lastSeen: string | null;
  updatedAt: string;
}

interface DashboardData {
  targets: Target[];
  counts: {
    total: number;
    online: number;
    likelyOnline: number;
    uncertain: number;
    likelyOffline: number;
    offline: number;
  };
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const { scores, subscribeToTargets } = usePresenceUpdates();

  const fetchData = async () => {
    try {
      const res = await dashboardApi.summary();
      setData(res.data);
      // Subscribe to real-time updates for all targets
      const jids = res.data.targets.map((t: Target) => t.jid);
      subscribeToTargets(jids);
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleAddTarget = async () => {
    if (!newPhone.trim()) return;
    try {
      await targetApi.create({ phoneNumber: newPhone, label: newLabel || undefined });
      setNewPhone('');
      setNewLabel('');
      setShowAddModal(false);
      fetchData();
    } catch {
      alert('Erreur lors de l\'ajout du numero');
    }
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Surveillance</h2>
          <p className="text-sm text-gray-500 mt-1">
            {data?.counts.total ?? 0} numero(s) surveille(s)
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          Ajouter un numero
        </button>
      </div>

      {/* Summary Cards */}
      {data?.counts && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { status: 'ONLINE', count: data.counts.online, label: 'En ligne' },
            { status: 'LIKELY_ONLINE', count: data.counts.likelyOnline, label: 'Prob. en ligne' },
            { status: 'UNCERTAIN', count: data.counts.uncertain, label: 'Incertain' },
            { status: 'LIKELY_OFFLINE', count: data.counts.likelyOffline, label: 'Prob. hors ligne' },
            { status: 'OFFLINE', count: data.counts.offline, label: 'Hors ligne' },
          ].map(({ status, count, label }) => (
            <div key={status} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <StatusBadge status={status} size="sm" />
            </div>
          ))}
        </div>
      )}

      {/* Target Grid */}
      {data?.targets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Aucun numero surveille</h3>
          <p className="text-sm text-gray-500 mb-4">
            Commencez par ajouter un numero de telephone a surveiller
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
          >
            Ajouter un numero
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data?.targets.map((target) => (
            <TargetCard
              key={target.id}
              target={target}
              realtimeScore={scores.get(target.jid) ? {
                status: scores.get(target.jid)!.status,
                confidence: scores.get(target.jid)!.confidence,
                timestamp: scores.get(target.jid)!.timestamp,
              } : null}
            />
          ))}
        </div>
      )}

      {/* Add Target Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Ajouter un numero</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Numero de telephone (format international)
              </label>
              <input
                type="text"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="33612345678"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Label (optionnel)
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Nom ou identifiant"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Annuler
              </button>
              <button
                onClick={handleAddTarget}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
