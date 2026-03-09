import React, { useState, useEffect, useRef } from 'react';
import { Timer, X, ChevronDown, ChevronUp } from 'lucide-react';

const IpcTimingOverlay = () => {
  const [entries, setEntries] = useState([]);
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!window.ipcTiming) return;
    // Load existing log
    setEntries(window.ipcTiming.getLog());
    // Subscribe to new entries
    const unsub = window.ipcTiming.onEntry((entry) => {
      setEntries(prev => {
        const next = [...prev, entry];
        return next.length > 50 ? next.slice(-50) : next;
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (listRef.current && expanded) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, expanded]);

  if (!visible || !window.ipcTiming) return null;

  const recent = entries.slice(-20).reverse();
  const avgMs = entries.length > 0
    ? Math.round(entries.reduce((s, e) => s + e.duration, 0) / entries.length * 100) / 100
    : 0;

  const getDurationColor = (ms) => {
    if (ms < 10) return 'text-emerald-600';
    if (ms < 50) return 'text-amber-600';
    return 'text-rose-600';
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const shortChannel = (ch) => {
    // Trim common prefixes for compact display
    return ch.replace(/^(auth:|bot:|doctor:)/, (m) => m);
  };

  return (
    <div className="fixed bottom-16 right-4 z-[9999] font-mono text-[11px]">
      {/* Collapsed pill */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900/90 text-slate-200 rounded-full shadow-lg hover:bg-slate-800 transition-colors backdrop-blur-sm"
        >
          <Timer className="w-3 h-3 text-blue-400" />
          <span>IPC</span>
          <span className={getDurationColor(avgMs)}>{avgMs}ms</span>
          <span className="text-slate-500">avg</span>
          <span className="text-slate-500">({entries.length})</span>
          <ChevronUp className="w-3 h-3 text-slate-500" />
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="w-80 bg-slate-900/95 text-slate-200 rounded-xl shadow-2xl backdrop-blur-sm border border-slate-700/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <Timer className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold">IPC Timing</span>
              <span className="text-[10px] text-slate-500">{entries.length} calls</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400">avg</span>
              <span className={`text-xs font-bold ${getDurationColor(avgMs)}`}>{avgMs}ms</span>
              <button onClick={() => setExpanded(false)} className="ml-2 p-0.5 hover:bg-slate-700 rounded transition-colors">
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <button onClick={() => setVisible(false)} className="p-0.5 hover:bg-slate-700 rounded transition-colors">
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          {/* List */}
          <div ref={listRef} className="max-h-64 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-3 py-4 text-center text-slate-500 text-xs">No IPC calls yet</div>
            ) : (
              <table className="w-full">
                <tbody>
                  {recent.map((e, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/40">
                      <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{formatTime(e.ts)}</td>
                      <td className="px-1 py-1 text-slate-300 truncate max-w-[140px]" title={e.channel}>{shortChannel(e.channel)}</td>
                      <td className={`px-2 py-1 text-right font-bold whitespace-nowrap ${getDurationColor(e.duration)}`}>
                        {e.duration}ms
                      </td>
                      <td className="px-1 py-1">
                        {e.ok
                          ? <span className="text-emerald-500">✓</span>
                          : <span className="text-rose-500">✗</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IpcTimingOverlay;
