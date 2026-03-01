import { useState, useEffect } from 'react';
import { Bell, Trash2, RefreshCw } from 'lucide-react';
import { alertApi, targetApi } from '../api/client';

interface Alert {
  id: string;
  triggerOn: string;
  channel: string;
  isActive: boolean;
  cooldownMin: number;
  target: { jid: string; phoneNumber: string; label: string | null };
}

interface Target {
  id: string;
  phoneNumber: string;
  label: string | null;
}

const triggerLabels: Record<string, string> = {
  CAME_ONLINE: 'Passage en ligne',
  WENT_OFFLINE: 'Passage hors ligne',
  LONG_SESSION: 'Session longue',
  UNUSUAL_HOUR: 'Heure inhabituelle',
};

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTargetId, setNewTargetId] = useState('');
  const [newTrigger, setNewTrigger] = useState('CAME_ONLINE');

  const fetchData = async () => {
    try {
      const [alertRes, targetRes] = await Promise.all([
        alertApi.list(),
        targetApi.list(),
      ]);
      setAlerts(alertRes.data.alerts);
      setTargets(targetRes.data.targets);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async () => {
    if (!newTargetId) return;
    await alertApi.create({ targetId: newTargetId, triggerOn: newTrigger });
    setShowCreate(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await alertApi.delete(id);
    fetchData();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await alertApi.update(id, { isActive: !isActive });
    fetchData();
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
          <h2 className="text-2xl font-bold text-gray-900">Alertes</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configurez des alertes sur les changements de statut
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Nouvelle alerte
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Nouvelle alerte</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Numero cible</label>
              <select
                value={newTargetId}
                onChange={(e) => setNewTargetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Choisir...</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label || t.phoneNumber}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Declencheur</label>
              <select
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                {Object.entries(triggerLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600">
                Annuler
              </button>
              <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                Creer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerts List */}
      {alerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Bell size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium mb-1">Aucune alerte configuree</h3>
          <p className="text-sm text-gray-500">
            Creez des alertes pour etre notifie des changements de statut
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Bell size={16} className={alert.isActive ? 'text-blue-500' : 'text-gray-300'} />
                <div>
                  <p className="font-medium text-gray-900">
                    {alert.target.label || alert.target.phoneNumber}
                  </p>
                  <p className="text-xs text-gray-500">
                    {triggerLabels[alert.triggerOn] || alert.triggerOn} - Cooldown: {alert.cooldownMin}min
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(alert.id, alert.isActive)}
                  className={`px-3 py-1 rounded text-xs font-medium ${
                    alert.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {alert.isActive ? 'Actif' : 'Inactif'}
                </button>
                <button onClick={() => handleDelete(alert.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg">
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
