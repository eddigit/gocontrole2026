import { LogOut } from 'lucide-react';

interface HeaderProps {
  onLogout: () => void;
}

export default function Header({ onLogout }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="text-sm text-gray-500">
        Tableau de bord de surveillance
      </div>
      <button
        onClick={onLogout}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <LogOut size={16} />
        Deconnexion
      </button>
    </header>
  );
}
