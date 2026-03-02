import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, FileText, Lock, CheckCircle } from 'lucide-react';
import api from '../api/client';

interface ConsentModalProps {
  onAccepted: () => void;
}

/**
 * Modal obligatoire qui s'affiche si l'utilisateur n'a pas encore accepté les CGU/RGPD.
 * Bloque l'accès à la plateforme tant que non accepté.
 */
export default function ConsentModal({ onAccepted }: ConsentModalProps) {
  const [loading, setLoading] = useState(true);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [cguChecked, setCguChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [habilitationChecked, setHabilitationChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCgu, setShowCgu] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [cguContent, setCguContent] = useState('');
  const [privacyContent, setPrivacyContent] = useState('');

  useEffect(() => {
    checkConsent();
  }, []);

  const checkConsent = async () => {
    try {
      const res = await api.get('/legal/consent-status');
      if (!res.data.cguAccepted || !res.data.privacyAccepted) {
        setNeedsConsent(true);
        // Preload content
        const [cgu, privacy] = await Promise.all([
          api.get('/legal/cgu'),
          api.get('/legal/privacy'),
        ]);
        setCguContent(cgu.data.content);
        setPrivacyContent(privacy.data.content);
      } else {
        onAccepted();
      }
    } catch {
      // If consent check fails, allow access (API may not be available yet)
      onAccepted();
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    setSubmitting(true);
    try {
      await api.post('/legal/accept');
      onAccepted();
    } catch {
      alert('Erreur lors de l\'enregistrement du consentement');
    } finally {
      setSubmitting(false);
    }
  };

  const allChecked = cguChecked && privacyChecked && habilitationChecked;

  if (loading) return null;
  if (!needsConsent) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="bg-gray-900 text-white p-6 rounded-t-2xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-600 rounded-lg">
              <AlertTriangle size={24} />
            </div>
            <h2 className="text-xl font-bold">Cadre legal obligatoire</h2>
          </div>
          <p className="text-gray-300 text-sm">
            L'acces a la plateforme GO CONTROLE est soumis a l'acceptation des conditions suivantes.
            Cette plateforme est un outil de surveillance reglemente — son utilisation non autorisee
            constitue une infraction penale.
          </p>
        </div>

        {/* Content preview panels */}
        <div className="p-6 space-y-4">
          {/* CGU Section */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowCgu(!showCgu)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-blue-600" />
                <div className="text-left">
                  <p className="font-semibold text-gray-900 text-sm">Conditions Generales d'Utilisation</p>
                  <p className="text-xs text-gray-500">Version 1.0 — 01/03/2026</p>
                </div>
              </div>
              <span className="text-xs text-blue-600 font-medium">
                {showCgu ? 'Masquer' : 'Lire'}
              </span>
            </button>
            {showCgu && (
              <div className="border-t border-gray-200 p-4 max-h-60 overflow-y-auto bg-gray-50">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{cguContent}</pre>
              </div>
            )}
          </div>

          {/* Privacy Section */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowPrivacy(!showPrivacy)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock size={20} className="text-green-600" />
                <div className="text-left">
                  <p className="font-semibold text-gray-900 text-sm">Politique de confidentialite et RGPD</p>
                  <p className="text-xs text-gray-500">Version 1.0 — 01/03/2026</p>
                </div>
              </div>
              <span className="text-xs text-green-600 font-medium">
                {showPrivacy ? 'Masquer' : 'Lire'}
              </span>
            </button>
            {showPrivacy && (
              <div className="border-t border-gray-200 p-4 max-h-60 overflow-y-auto bg-gray-50">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{privacyContent}</pre>
              </div>
            )}
          </div>

          {/* Checkboxes */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={cguChecked}
                onChange={(e) => setCguChecked(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">
                J'ai lu et j'accepte les <strong>Conditions Generales d'Utilisation</strong> de la plateforme GO CONTROLE.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={privacyChecked}
                onChange={(e) => setPrivacyChecked(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">
                J'ai lu et j'accepte la <strong>Politique de confidentialite</strong> et les dispositions RGPD.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={habilitationChecked}
                onChange={(e) => setHabilitationChecked(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">
                J'atteste disposer de l'<strong>habilitation requise</strong> (commission rogatoire, autorisation CNCTR,
                requisition judiciaire) pour utiliser cette plateforme et je m'engage a respecter
                le cadre legal de mon autorisation.
              </span>
            </label>
          </div>

          {/* Warning */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">
              <strong>Avertissement :</strong> Toute utilisation non autorisee de cette plateforme constitue
              une infraction penale (art. 226-1 et suivants, art. 323-1 et suivants du Code penal)
              passible de 5 ans d'emprisonnement et 300 000 euros d'amende. Toutes les actions sont
              journalisees et auditables.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0">
          <button
            onClick={handleAccept}
            disabled={!allChecked || submitting}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
              allChecked
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {submitting ? (
              'Enregistrement...'
            ) : allChecked ? (
              <>
                <CheckCircle size={18} />
                J'accepte et j'accede a la plateforme
              </>
            ) : (
              <>
                <Shield size={18} />
                Veuillez cocher les trois cases ci-dessus
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
