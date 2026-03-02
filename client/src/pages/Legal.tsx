import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Lock, FileText } from 'lucide-react';
import api from '../api/client';

type Tab = 'cgu' | 'privacy';

export default function Legal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'cgu');
  const [cguContent, setCguContent] = useState('');
  const [privacyContent, setPrivacyContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/legal/cgu').then(r => setCguContent(r.data.content)),
      api.get('/legal/privacy').then(r => setPrivacyContent(r.data.content)),
    ]).finally(() => setLoading(false));
  }, []);

  const content = activeTab === 'cgu' ? cguContent : privacyContent;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Cadre legal et reglementaire</h2>
          <p className="text-xs text-gray-500">Conditions d'utilisation et protection des donnees</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6">
        <button
          onClick={() => setActiveTab('cgu')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
            activeTab === 'cgu' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <FileText size={16} />
          Conditions Generales d'Utilisation
        </button>
        <button
          onClick={() => setActiveTab('privacy')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
            activeTab === 'privacy' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <Lock size={16} />
          Politique de confidentialite
        </button>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-4xl">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        ) : (
          <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-li:text-gray-700">
            <MarkdownRenderer content={content} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Simple markdown-to-HTML renderer for legal content.
 * Handles: headings (#), bold (**), lists (-), tables (|), horizontal rules (---).
 */
function MarkdownRenderer({ content }: { content: string }) {
  const html = content
    .split('\n')
    .map(line => {
      // Headings
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      // Horizontal rule
      if (line.trim() === '---') return '<hr/>';
      // List items
      if (line.startsWith('- ')) return `<li>${formatInline(line.slice(2))}</li>`;
      // Table rows
      if (line.startsWith('|')) {
        if (line.includes('---')) return ''; // Skip separator rows
        const cells = line.split('|').filter(c => c.trim());
        const tag = cells.length > 0 ? 'td' : 'td';
        return `<tr>${cells.map(c => `<${tag} class="border border-gray-200 px-3 py-1.5 text-sm">${formatInline(c.trim())}</${tag}>`).join('')}</tr>`;
      }
      // Empty line = paragraph break
      if (line.trim() === '') return '<br/>';
      // Regular paragraph
      return `<p>${formatInline(line)}</p>`;
    })
    .join('\n');

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function formatInline(text: string): string {
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Inline code
  text = text.replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>');
  return text;
}
