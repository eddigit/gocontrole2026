import { useState, useEffect } from 'react';
import {
  Search, Database, Scale, Building2, FileText, AlertCircle,
  CheckCircle, XCircle, Loader2, ExternalLink, ChevronDown, ChevronUp
} from 'lucide-react';
import api from '../api/client';

type SearchTab = 'bodacc' | 'legifrance' | 'judilibre';

interface PisteStatus {
  configured: boolean;
  bodaccAvailable: boolean;
  ok?: boolean;
  environment?: string;
  message?: string;
}

export default function Piste() {
  const [status, setStatus] = useState<PisteStatus | null>(null);
  const [activeTab, setActiveTab] = useState<SearchTab>('bodacc');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState('');

  // Search fields
  const [searchQuery, setSearchQuery] = useState('');
  const [denomination, setDenomination] = useState('');
  const [nomPersonne, setNomPersonne] = useState('');
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  useEffect(() => {
    api.get('/piste/status').then(r => setStatus(r.data)).catch(() => {});
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setResults(null);

    try {
      let res;
      switch (activeTab) {
        case 'bodacc':
          res = await api.get('/piste/bodacc', {
            params: {
              ...(denomination && { denomination }),
              ...(nomPersonne && { nomPersonne }),
            },
          });
          setResults(res.data);
          break;

        case 'legifrance':
          res = await api.post('/piste/legifrance/search', {
            recherche: searchQuery,
            pageSize: 10,
          });
          setResults(res.data);
          break;

        case 'judilibre':
          res = await api.get('/piste/judilibre/search', {
            params: { query: searchQuery, page_size: '10' },
          });
          setResults(res.data);
          break;
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la recherche');
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: SearchTab; label: string; icon: any; requiresPiste: boolean; description: string }[] = [
    { key: 'bodacc', label: 'BODACC', icon: Building2, requiresPiste: false, description: 'Annonces legales (procedures collectives, radiations, creations)' },
    { key: 'legifrance', label: 'Legifrance', icon: Scale, requiresPiste: true, description: 'Codes, lois, decrets, jurisprudence' },
    { key: 'judilibre', label: 'JUDILIBRE', icon: FileText, requiresPiste: true, description: 'Decisions Cour de cassation' },
  ];

  const currentTab = tabs.find(t => t.key === activeTab)!;
  const tabDisabled = currentTab.requiresPiste && !status?.configured;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Database size={24} className="text-blue-600" />
            API PISTE
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Plateforme d'Intermediation des Services pour la Transformation de l'Etat
          </p>
        </div>

        {/* Status badge */}
        {status && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            status.configured && status.ok
              ? 'bg-green-100 text-green-700'
              : status.bodaccAvailable
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-red-100 text-red-700'
          }`}>
            {status.configured && status.ok ? (
              <><CheckCircle size={14} /> PISTE connecte ({status.environment})</>
            ) : (
              <><AlertCircle size={14} /> BODACC uniquement (PISTE non configure)</>
            )}
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6">
        {tabs.map(({ key, label, icon: Icon, requiresPiste }) => {
          const disabled = requiresPiste && !status?.configured;
          return (
            <button
              key={key}
              onClick={() => { if (!disabled) { setActiveTab(key); setResults(null); setError(''); } }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
                activeTab === key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : disabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Icon size={16} />
              {label}
              {disabled && <XCircle size={12} className="text-gray-300" />}
            </button>
          );
        })}
      </div>

      {/* Search form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <currentTab.icon size={20} className="text-blue-600" />
          <h3 className="font-semibold text-gray-900">{currentTab.label}</h3>
          <span className="text-xs text-gray-400">— {currentTab.description}</span>
        </div>

        {tabDisabled ? (
          <div className="text-center py-8">
            <XCircle size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">
              Cette API necessite les identifiants PISTE (PISTE_CLIENT_ID / PISTE_CLIENT_SECRET).
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Inscrivez-vous sur piste.gouv.fr pour obtenir vos identifiants.
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'bodacc' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Denomination / Raison sociale</label>
                  <input
                    type="text"
                    value={denomination}
                    onChange={(e) => setDenomination(e.target.value)}
                    placeholder="Ex: SCI DUPONT"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nom de personne</label>
                  <input
                    type="text"
                    value={nomPersonne}
                    onChange={(e) => setNomPersonne(e.target.value)}
                    placeholder="Ex: DUPONT"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">Recherche</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={activeTab === 'legifrance' ? 'Ex: interception telecommunications' : 'Ex: escroquerie'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
            )}

            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Rechercher
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-600 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">
              Resultats
              {results.results?.length !== undefined && ` (${results.results.length})`}
              {results.total_count !== undefined && ` sur ${results.total_count}`}
            </h3>
          </div>

          <div className="divide-y divide-gray-50">
            {activeTab === 'bodacc' && renderBodaccResults(results, expandedResult, setExpandedResult)}
            {activeTab === 'legifrance' && renderLegifranceResults(results)}
            {activeTab === 'judilibre' && renderJudilibreResults(results, expandedResult, setExpandedResult)}

            {/* No results */}
            {getResultCount(results) === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Search size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">Aucun resultat</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getResultCount(results: any): number {
  if (results.results) return results.results.length;
  if (results.records) return results.records.length;
  if (Array.isArray(results)) return results.length;
  return -1;
}

function renderBodaccResults(data: any, expanded: string | null, setExpanded: (id: string | null) => void) {
  const records = data.records || data.results || [];
  return records.map((record: any, i: number) => {
    const fields = record.record?.fields || record.fields || record;
    const id = record.record?.id || `${i}`;
    const isExpanded = expanded === id;

    return (
      <div key={id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
        <div
          className="flex items-start justify-between cursor-pointer"
          onClick={() => setExpanded(isExpanded ? null : id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                {fields.typeavis || fields.fampisteabrege || 'Annonce'}
              </span>
              {fields.dateparution && (
                <span className="text-xs text-gray-400">{fields.dateparution}</span>
              )}
            </div>
            <p className="font-medium text-gray-900 text-sm">
              {fields.denomination || fields.nom_personne || fields.commercant || 'Sans denomination'}
            </p>
            {fields.ville && (
              <p className="text-xs text-gray-500 mt-0.5">{fields.ville}</p>
            )}
          </div>
          {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>

        {isExpanded && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 space-y-1">
            {fields.registre && <p><strong>Registre :</strong> {fields.registre}</p>}
            {fields.tribunal && <p><strong>Tribunal :</strong> {fields.tribunal}</p>}
            {fields.numerodepartement && <p><strong>Dept :</strong> {fields.numerodepartement}</p>}
            {fields.listepersonnes && <p><strong>Personnes :</strong> {fields.listepersonnes}</p>}
            {fields.jugement && <p><strong>Jugement :</strong> {fields.jugement}</p>}
            <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap">{JSON.stringify(fields, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  });
}

function renderLegifranceResults(data: any) {
  const results = data.results || [];
  return results.map((item: any, i: number) => {
    const title = item.titles?.titreLong || item.titles?.titre || item.titre || `Resultat ${i + 1}`;
    return (
      <div key={i} className="px-4 py-3 hover:bg-gray-50 transition-colors">
        <p className="font-medium text-gray-900 text-sm">{title}</p>
        {item.nor && <p className="text-xs text-gray-400 mt-0.5">NOR: {item.nor}</p>}
        {item.dateDebut && <p className="text-xs text-gray-400">Debut: {item.dateDebut}</p>}
        {item.texteHtml && (
          <div className="mt-2 text-xs text-gray-600 line-clamp-3" dangerouslySetInnerHTML={{ __html: item.texteHtml }} />
        )}
      </div>
    );
  });
}

function renderJudilibreResults(data: any, expanded: string | null, setExpanded: (id: string | null) => void) {
  const results = data.results || [];
  return results.map((item: any, i: number) => {
    const id = item.id || `${i}`;
    const isExpanded = expanded === id;

    return (
      <div key={id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
        <div
          className="flex items-start justify-between cursor-pointer"
          onClick={() => setExpanded(isExpanded ? null : id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                {item.chamber || 'Chambre'}
              </span>
              {item.decision_date && (
                <span className="text-xs text-gray-400">{item.decision_date}</span>
              )}
            </div>
            <p className="font-medium text-gray-900 text-sm">
              {item.number || item.ecli || `Decision ${i + 1}`}
            </p>
            {item.themes && item.themes.length > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">{item.themes.join(', ')}</p>
            )}
          </div>
          {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>

        {isExpanded && item.text && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 max-h-60 overflow-y-auto whitespace-pre-wrap">
            {item.text}
          </div>
        )}
      </div>
    );
  });
}
