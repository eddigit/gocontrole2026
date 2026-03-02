import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Smartphone, Radio, Bell,
  MessageSquare, PhoneCall, Image, Shield,
  Database, FileText, Scale
} from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sessions', label: 'Sessions WhatsApp', icon: Radio },
  { to: '/alerts', label: 'Alertes', icon: Bell },
  { to: '/piste', label: 'API PISTE', icon: Database },
];

const featureItems = [
  { icon: MessageSquare, label: 'Messages', color: 'text-blue-400' },
  { icon: PhoneCall, label: 'Appels', color: 'text-green-400' },
  { icon: Image, label: 'Medias', color: 'text-purple-400' },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-tight">GO CONTROLE</h1>
        <p className="text-xs text-gray-400 mt-1">v3.0 — Surveillance avancee</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}

        {/* Capabilities section */}
        <div className="pt-4 mt-4 border-t border-gray-700">
          <p className="text-xs text-gray-500 uppercase tracking-wider px-3 mb-2">Interception</p>
          {featureItems.map(({ icon: Icon, label, color }) => (
            <div
              key={label}
              className="flex items-center gap-3 px-3 py-2 text-sm text-gray-400"
            >
              <Icon size={16} className={color} />
              <span>{label}</span>
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500" title="Actif" />
            </div>
          ))}
        </div>
      </nav>

      {/* Footer — Legal + Status */}
      <div className="p-4 border-t border-gray-700 space-y-2">
        <NavLink
          to="/legal"
          className={({ isActive }) =>
            `flex items-center gap-2 text-xs transition-colors ${
              isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`
          }
        >
          <Scale size={14} />
          <span>CGU & Confidentialite</span>
        </NavLink>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Shield size={14} className="text-green-500" />
          <span>6 modules actifs</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Smartphone size={14} />
          <span>Monitoring en cours</span>
        </div>
      </div>
    </aside>
  );
}
