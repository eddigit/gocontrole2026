import { useNavigate } from 'react-router-dom';
import { Phone, Clock, MessageSquare, PhoneCall, Image, ChevronRight } from 'lucide-react';
import StatusBadge from './StatusBadge';
import ConfidenceMeter from './ConfidenceMeter';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface TargetCardProps {
  target: {
    id: string;
    jid: string;
    phoneNumber: string;
    label: string | null;
    status: string;
    confidence: number;
    lastSeen: string | null;
    updatedAt: string;
  };
  realtimeScore?: {
    status: string;
    confidence: number;
    timestamp: string;
  } | null;
}

export default function TargetCard({ target, realtimeScore }: TargetCardProps) {
  const navigate = useNavigate();
  const status = realtimeScore?.status ?? target.status;
  const confidence = realtimeScore?.confidence ?? target.confidence;
  const lastUpdate = realtimeScore?.timestamp ?? target.updatedAt;

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all overflow-hidden">
      {/* Main area — clickable to target detail */}
      <div
        onClick={() => navigate(`/targets/${target.id}`)}
        className="p-4 cursor-pointer"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Phone size={16} className="text-gray-400" />
              <span className="font-semibold text-gray-900">
                {target.label || target.phoneNumber}
              </span>
            </div>
            {target.label && (
              <p className="text-xs text-gray-500 mt-0.5 ml-6">{target.phoneNumber}</p>
            )}
          </div>
          <StatusBadge status={status} size="sm" />
        </div>

        <div className="space-y-2">
          <ConfidenceMeter confidence={confidence} size="sm" />

          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={12} />
            <span>
              {formatDistanceToNow(new Date(lastUpdate), { addSuffix: true, locale: fr })}
            </span>
          </div>
        </div>
      </div>

      {/* Quick actions bar */}
      <div className="border-t border-gray-100 px-2 py-1.5 flex items-center justify-between bg-gray-50/50">
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/targets/${target.id}/messages`); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-600 hover:bg-blue-50 transition-colors"
            title="Messages interceptes"
          >
            <MessageSquare size={13} />
            <span>Messages</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/targets/${target.id}/calls`); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-green-600 hover:bg-green-50 transition-colors"
            title="Appels detectes"
          >
            <PhoneCall size={13} />
            <span>Appels</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/targets/${target.id}/media`); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-purple-600 hover:bg-purple-50 transition-colors"
            title="Medias interceptes"
          >
            <Image size={13} />
            <span>Medias</span>
          </button>
        </div>
        <button
          onClick={() => navigate(`/targets/${target.id}`)}
          className="p-1 text-gray-400 hover:text-gray-600"
          title="Voir detail"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
