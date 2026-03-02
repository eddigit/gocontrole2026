import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Phone, Trash2, RefreshCw, MessageSquare,
  PhoneCall, Image, MapPin, Users, Trash
} from 'lucide-react';
import { targetApi, messageApi, callApi } from '../api/client';
import { usePresenceUpdates } from '../hooks/usePresence';
import StatusBadge from '../components/StatusBadge';
import ConfidenceMeter from '../components/ConfidenceMeter';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface TargetData {
  id: string;
  jid: string;
  phoneNumber: string;
  label: string | null;
  status: string;
  confidence: number;
  lastSeen: string | null;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  ONLINE: '#22c55e',
  LIKELY_ONLINE: '#84cc16',
  UNCERTAIN: '#eab308',
  LIKELY_OFFLINE: '#f97316',
  OFFLINE: '#ef4444',
};

export default function TargetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [target, setTarget] = useState<TargetData | null>(null);
  const [timeline, setTimeline] = useState<{ status: string; confidence: number; timestamp: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [msgStats, setMsgStats] = useState<any>(null);
  const [callStats, setCallStats] = useState<any>(null);
  const { scores, subscribeToTargets } = usePresenceUpdates();

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      try {
        const targetRes = await targetApi.get(id);
        setTarget(targetRes.data.target);
        setTimeline(targetRes.data.timeline || []);
        subscribeToTargets([targetRes.data.target.jid]);

        // Load stats (non-blocking)
        messageApi.stats(id).then(r => setMsgStats(r.data)).catch(() => {});
        callApi.stats(id).then(r => setCallStats(r.data)).catch(() => {});
      } catch {
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleDelete = async () => {
    if (!confirm('Supprimer ce numero de la surveillance ?')) return;
    try {
      await targetApi.delete(id!);
      navigate('/');
    } catch {
      alert('Erreur lors de la suppression');
    }
  };

  if (loading || !target) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  const realtimeScore = scores.get(target.jid);
  const currentStatus = realtimeScore?.status ?? target.status;
  const currentConfidence = realtimeScore?.confidence ?? target.confidence;

  // Prepare chart data
  const chartData = timeline.map((entry) => ({
    time: format(new Date(entry.timestamp), 'HH:mm', { locale: fr }),
    confidence: Math.round(entry.confidence * 100),
    status: entry.status,
  }));

  return (
    <div>
      {/* Back Button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4 text-sm"
      >
        <ArrowLeft size={16} />
        Retour au dashboard
      </button>

      {/* Target Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Phone size={20} className="text-gray-400" />
              <h2 className="text-xl font-bold text-gray-900">
                {target.label || target.phoneNumber}
              </h2>
              <StatusBadge status={currentStatus} />
            </div>
            {target.label && (
              <p className="text-gray-500 ml-8">{target.phoneNumber}</p>
            )}
            <p className="text-xs text-gray-400 ml-8 mt-1">JID: {target.jid}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-gray-500">Confiance</p>
              <ConfidenceMeter confidence={currentConfidence} />
            </div>
            <button
              onClick={handleDelete}
              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Supprimer"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        {target.lastSeen && (
          <div className="mt-4 ml-8 text-sm text-gray-500">
            Derniere activite : {format(new Date(target.lastSeen), 'dd/MM/yyyy HH:mm:ss', { locale: fr })}
          </div>
        )}
      </div>

      {/* Quick Access Cards - NEW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Link
          to={`/targets/${id}/messages`}
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100">
              <MessageSquare size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Messages</p>
              <p className="text-xs text-gray-500">
                {msgStats ? `${msgStats.total} interceptes` : 'Chargement...'}
              </p>
            </div>
          </div>
          {msgStats && msgStats.today > 0 && (
            <div className="mt-2 text-xs text-blue-600 font-medium">
              +{msgStats.today} aujourd'hui
            </div>
          )}
        </Link>

        <Link
          to={`/targets/${id}/calls`}
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-green-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100">
              <PhoneCall size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Appels</p>
              <p className="text-xs text-gray-500">
                {callStats ? `${callStats.total} detectes` : 'Chargement...'}
              </p>
            </div>
          </div>
          {callStats && callStats.today > 0 && (
            <div className="mt-2 text-xs text-green-600 font-medium">
              +{callStats.today} aujourd'hui
            </div>
          )}
        </Link>

        <Link
          to={`/targets/${id}/media`}
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-purple-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600 group-hover:bg-purple-100">
              <Image size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Medias</p>
              <p className="text-xs text-gray-500">
                {msgStats?.byType ? `${(msgStats.byType.IMAGE || 0) + (msgStats.byType.VIDEO || 0) + (msgStats.byType.AUDIO || 0) + (msgStats.byType.VOICE_NOTE || 0) + (msgStats.byType.DOCUMENT || 0)} fichiers` : 'Chargement...'}
              </p>
            </div>
          </div>
        </Link>

        <Link
          to={`/targets/${id}/messages`}
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-red-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100">
              <Trash size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Supprimes</p>
              <p className="text-xs text-gray-500">
                {msgStats ? `${msgStats.deleted} messages` : 'Chargement...'}
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Timeline Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Timeline de confiance (24h)</h3>

        {chartData.length === 0 ? (
          <p className="text-gray-400 text-center py-8">Pas encore de donnees de timeline</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: '%', position: 'insideLeft' }} />
              <Tooltip
                formatter={(value: number) => [`${value}%`, 'Confiance']}
              />
              <Bar dataKey="confidence" radius={[2, 2, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={statusColors[entry.status] || '#9ca3af'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Informations</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Surveille depuis</span>
            <p className="font-medium">{format(new Date(target.createdAt), 'dd/MM/yyyy HH:mm', { locale: fr })}</p>
          </div>
          <div>
            <span className="text-gray-500">Statut actuel</span>
            <div className="mt-1"><StatusBadge status={currentStatus} size="sm" /></div>
          </div>
          {msgStats && (
            <>
              <div>
                <span className="text-gray-500">Messages recus</span>
                <p className="font-medium">{msgStats.byDirection?.INCOMING || 0}</p>
              </div>
              <div>
                <span className="text-gray-500">Messages envoyes</span>
                <p className="font-medium">{msgStats.byDirection?.OUTGOING || 0}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
