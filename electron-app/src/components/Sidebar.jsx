import React from 'react';
import { BarChart2, HardDrive, Clock, RefreshCw, LayoutGrid, FileUp } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/',       label: 'Dashboard',        icon: BarChart2,  exact: true },
  { path: '/buckets', label: 'Buckets',          icon: HardDrive  },
  {
    path: '/files', label: 'File Explorer', icon: FileUp
  },
  { path: '/sync',    label: 'Sync',             icon: RefreshCw  },
  { path: '/recent',  label: 'Recent Activities', icon: Clock      },
];

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item) => {
    if (item.exact) return location.pathname === item.path;
    if (item.path === '/buckets') {
      return location.pathname === '/buckets' || location.pathname.startsWith('/files');
    }
    return location.pathname.startsWith(item.path);
  };

  return (
    <div className="w-64 bg-slate-50 flex flex-col h-full shrink-0">
      <div className="p-3 px-3 space-y-1 mt-2">
        {navItems.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex items-center w-full px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
              isActive({ path, exact: path === '/' })
                ? 'bg-blue-100/70 text-blue-900'
                : 'text-slate-700 hover:bg-[#e8ebf0] hover:text-slate-900'
            }`}
          >
            <Icon className="h-[18px] w-[18px] mr-4" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
