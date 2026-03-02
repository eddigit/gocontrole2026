import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Image, Video, Mic, FileText, MapPin, RefreshCw,
  ChevronLeft, ChevronRight, X, Download, ExternalLink
} from 'lucide-react';
import { messageApi, targetApi } from '../api/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MediaMessage {
  id: string;
  type: string;
  direction: string;
  senderJid: string;
  content: string | null;
  timestamp: string;
  media: {
    mimeType: string;
    fileName: string | null;
    fileSize: number | null;
    thumbnailB64: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
  } | null;
}

interface Location {
  id: string;
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
  url: string | null;
  message: {
    senderJid: string;
    direction: string;
    timestamp: string;
    content: string | null;
  };
}

const filterTabs = [
  { key: '', label: 'Tout', icon: Image },
  { key: 'IMAGE', label: 'Photos', icon: Image },
  { key: 'VIDEO', label: 'Videos', icon: Video },
  { key: 'AUDIO', label: 'Audio', icon: Mic },
  { key: 'VOICE_NOTE', label: 'Vocaux', icon: Mic },
  { key: 'DOCUMENT', label: 'Docs', icon: FileText },
];

export default function MediaGallery() {
  const { id: targetId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [target, setTarget] = useState<any>(null);
  const [media, setMedia] = useState<MediaMessage[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('');
  const [showLocations, setShowLocations] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState<MediaMessage | null>(null);

  useEffect(() => {
    if (!targetId) return;
    targetApi.get(targetId).then(res => setTarget(res.data.target)).catch(() => navigate('/'));
    loadLocations();
  }, [targetId]);

  useEffect(() => {
    loadMedia();
  }, [targetId, page, activeFilter]);

  const loadMedia = async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '30' };
      if (activeFilter) params.type = activeFilter;
      const res = await messageApi.media(targetId, params);
      setMedia(res.data.media);
      setTotalPages(res.data.pagination.pages);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const loadLocations = async () => {
    if (!targetId) return;
    try {
      const res = await messageApi.locations(targetId);
      setLocations(res.data.locations);
    } catch { /* ignore */ }
  };

  const formatJid = (jid: string) => jid.replace('@s.whatsapp.net', '').replace(/@.*/, '');

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/targets/${targetId}`)} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Medias — {target.label || target.phoneNumber}
            </h2>
            <p className="text-xs text-gray-500">
              Galerie des fichiers interceptes
            </p>
          </div>
        </div>

        {/* Location toggle */}
        <button
          onClick={() => setShowLocations(!showLocations)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            showLocations ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <MapPin size={16} />
          Positions ({locations.length})
        </button>
      </div>

      {/* Locations Panel */}
      {showLocations && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-red-500" /> Positions GPS partagees
          </h3>
          {locations.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Aucune position partagee</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {locations.map((loc) => (
                <div key={loc.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {loc.name || loc.address || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        De: {formatJid(loc.message.senderJid)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {format(new Date(loc.message.timestamp), 'dd/MM/yyyy HH:mm', { locale: fr })}
                      </p>
                    </div>
                    <a
                      href={loc.url || `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"
                      title="Ouvrir dans Google Maps"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 overflow-x-auto">
        {filterTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setActiveFilter(key); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              activeFilter === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Media Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="animate-spin text-gray-400" size={20} />
        </div>
      ) : media.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 text-center py-12">
          <Image size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-400">Aucun media intercepte</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {media.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedMedia(item)}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow group"
            >
              {/* Thumbnail or type icon */}
              <div className="aspect-square bg-gray-100 flex items-center justify-center relative overflow-hidden">
                {item.media?.thumbnailB64 ? (
                  <img
                    src={`data:image/jpeg;base64,${item.media.thumbnailB64}`}
                    alt="Apercu"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-gray-300">
                    {item.type === 'VIDEO' && <Video size={40} />}
                    {item.type === 'IMAGE' && <Image size={40} />}
                    {(item.type === 'AUDIO' || item.type === 'VOICE_NOTE') && <Mic size={40} />}
                    {item.type === 'DOCUMENT' && <FileText size={40} />}
                    {item.type === 'STICKER' && <Image size={40} />}
                  </div>
                )}

                {/* Video duration overlay */}
                {item.media?.duration && (
                  <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                    {formatDuration(item.media.duration)}
                  </div>
                )}

                {/* Type badge */}
                <div className="absolute top-1 left-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                  {item.type}
                </div>
              </div>

              {/* Info */}
              <div className="p-2">
                <p className="text-xs text-gray-500 truncate">
                  {item.media?.fileName || item.content || formatJid(item.senderJid)}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-300">
                    {format(new Date(item.timestamp), 'dd/MM HH:mm', { locale: fr })}
                  </span>
                  {item.media?.fileSize && (
                    <span className="text-xs text-gray-300">{formatSize(item.media.fileSize)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
          >
            <ChevronLeft size={14} /> Precedent
          </button>
          <span className="text-sm text-gray-400">Page {page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
          >
            Suivant <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Media Detail Modal */}
      {selectedMedia && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setSelectedMedia(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{selectedMedia.type}</h3>
              <button onClick={() => setSelectedMedia(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-4">
              {/* Large thumbnail */}
              {selectedMedia.media?.thumbnailB64 && (
                <div className="mb-4 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                  <img
                    src={`data:image/jpeg;base64,${selectedMedia.media.thumbnailB64}`}
                    alt="Apercu"
                    className="max-w-full max-h-96 object-contain"
                  />
                </div>
              )}

              {/* Caption */}
              {selectedMedia.content && (
                <p className="text-sm text-gray-800 mb-4 whitespace-pre-wrap">{selectedMedia.content}</p>
              )}

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Expediteur</span>
                  <p className="font-medium">{formatJid(selectedMedia.senderJid)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Direction</span>
                  <p className="font-medium">{selectedMedia.direction === 'INCOMING' ? 'Recu' : 'Envoye'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Date</span>
                  <p className="font-medium">{format(new Date(selectedMedia.timestamp), 'dd/MM/yyyy HH:mm:ss', { locale: fr })}</p>
                </div>
                {selectedMedia.media?.mimeType && (
                  <div>
                    <span className="text-gray-500">Type MIME</span>
                    <p className="font-medium">{selectedMedia.media.mimeType}</p>
                  </div>
                )}
                {selectedMedia.media?.fileName && (
                  <div>
                    <span className="text-gray-500">Nom du fichier</span>
                    <p className="font-medium">{selectedMedia.media.fileName}</p>
                  </div>
                )}
                {selectedMedia.media?.fileSize && (
                  <div>
                    <span className="text-gray-500">Taille</span>
                    <p className="font-medium">{formatSize(selectedMedia.media.fileSize)}</p>
                  </div>
                )}
                {selectedMedia.media?.duration && (
                  <div>
                    <span className="text-gray-500">Duree</span>
                    <p className="font-medium">{formatDuration(selectedMedia.media.duration)}</p>
                  </div>
                )}
                {selectedMedia.media?.width && selectedMedia.media?.height && (
                  <div>
                    <span className="text-gray-500">Dimensions</span>
                    <p className="font-medium">{selectedMedia.media.width} x {selectedMedia.media.height}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
