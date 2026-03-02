import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  PhoneOff, Video, RefreshCw, Clock, BarChart3
} from 'lucide-react';
import { callApi, targetApi } from '../api/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface CallEvent {
  id: string;
  waCallId: string;
  callerJid: string;
  callType: string;
  status: string;
  isGroup: boolean;
  groupJid: string | null;
  duration: number | null;
  timestamp: string;
}

interface CallStats {
  total: number;
  today: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
  OFFER: { label: 'Appel en cours', icon: Phone, color: 'text-blue-500' },
  RINGING: { label: 'Sonne', icon: PhoneIncoming, color: 'text-yellow-500' },
  ACCEPTED: { label: 'Accepte', icon: PhoneIncoming, color: 'text-green-500' },
  REJECTED: { label: 'Rejete', icon: PhoneOff, color: 'text-red-500' },
  TIMEOUT: { label: 'Expire', icon: PhoneOff, color: 'text-orange-500' },
  TERMINATED: { label: 'Termine', icon: Phone, color: 'text-gray-500' },
  MISSED: { label: 'Manque', icon: PhoneMissed, color: 'text-red-500' },
};

export default function Calls() {
  const { id: targetId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [target, setTarget] = useState<any>(null);
  const [calls, setCalls] = useState<CallEvent[]>([]);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!targetId) return;
    targetApi.get(targetId).then(res => setTarget(res.data.target)).catch(() => navigate('/'));
    loadStats();
  }, [targetId]);

  useEffect(() => {
    loadCalls();
  }, [targetId, page]);

  const loadCalls = async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const res = await callApi.list(targetId, { page: String(page), limit: '50' });
      setCalls(res.data.calls);
      setTotalPages(res.data.pagination.pages);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const loadStats = async () => {
    if (!targetId) return;
    try {
      const res = await callApi.stats(targetId);
      setStats(res.data);
    } catch { /* ignore */ }
  };

  const formatJid = (jid: string) => jid.replace('@s.whatsapp.net', '').replace(/@.*/, '');

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}min ${s}s`;
    if (m > 0) return `${m}min ${s}s`;
    return `${s}s`;
  };

  if (!target) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/targets/${targetId}`)} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Appels — {target.label || target.phoneNumber}
          </h2>
          <p className="text-xs text-gray-500">
            {stats ? `${stats.total} appels detectes dont ${stats.today} aujourd'hui` : 'Chargement...'}
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <Phone size={20} className="mx-auto text-gray-400 mb-1" />
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <Phone size={20} className="mx-auto text-blue-400 mb-1" />
            <p className="text-2xl font-bold text-blue-600">{stats.today}</p>
            <p className="text-xs text-gray-500">Aujourd'hui</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <Phone size={20} className="mx-auto text-green-400 mb-1" />
            <p className="text-2xl font-bold text-green-600">{stats.byType.VOICE || 0}</p>
            <p className="text-xs text-gray-500">Vocaux</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <Video size={20} className="mx-auto text-purple-400 mb-1" />
            <p className="text-2xl font-bold text-purple-600">{stats.byType.VIDEO || 0}</p>
            <p className="text-xs text-gray-500">Video</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <PhoneMissed size={20} className="mx-auto text-red-400 mb-1" />
            <p className="text-2xl font-bold text-red-600">{(stats.byStatus.MISSED || 0) + (stats.byStatus.REJECTED || 0)}</p>
            <p className="text-xs text-gray-500">Manques</p>
          </div>
        </div>
      )}

      {/* Call List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Historique des appels</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="animate-spin text-gray-400" size={20} />
          </div>
        ) : calls.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <Phone size={40} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">Aucun appel detecte</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {calls.map((call) => {
              const config = statusConfig[call.status] || statusConfig.OFFER;
              const StatusIcon = config.icon;

              return (
                <div key={call.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div className={`p-2 rounded-full bg-gray-100 ${config.color}`}>
                    {call.callType === 'VIDEO' ? <Video size={18} /> : <StatusIcon size={18} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm">{formatJid(call.callerJid)}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        call.callType === 'VIDEO' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {call.callType === 'VIDEO' ? 'Video' : 'Vocal'}
                      </span>
                      {call.isGroup && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Groupe</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs ${config.color}`}>{config.label}</span>
                      {call.duration && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={10} /> {formatDuration(call.duration)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-gray-400 text-right">
                    <p>{format(new Date(call.timestamp), 'dd/MM/yyyy', { locale: fr })}</p>
                    <p>{format(new Date(call.timestamp), 'HH:mm:ss', { locale: fr })}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
            >
              Precedent
            </button>
            <span className="text-xs text-gray-400">Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
            >
              Suivant
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
