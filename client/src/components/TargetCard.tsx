import { useNavigate } from 'react-router-dom';
import { Phone, Clock } from 'lucide-react';
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
    <div
      onClick={() => navigate(`/targets/${target.id}`)}
      className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
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
  );
}
