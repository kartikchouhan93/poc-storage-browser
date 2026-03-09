import React, { useState, useEffect, useRef } from 'react';
import {
  Download, Upload, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp, Archive, FileText, X,
  Pause, Play, Square
} from 'lucide-react';

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const TransferStatus = () => {
  const [transfers, setTransfers] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    let unsub = null;

    const setup = async () => {
      // Fetch initial state
      try {
        if (window.electronAPI.getActiveTransfers) {
          const initial = await window.electronAPI.getActiveTransfers();
          if (!mountedRef.current) return;
          if (Array.isArray(initial) && initial.length > 0) {
            setTransfers(initial);
            setIsExpanded(true);
            setDismissed(false);
          }
        }
      } catch (e) {
        console.warn('[TransferStatus] Could not get initial transfers:', e.message);
      }

      // Subscribe to live updates
      if (window.electronAPI.onTransferStatusUpdate) {
        unsub = window.electronAPI.onTransferStatusUpdate((updated) => {
          if (!mountedRef.current) return;
          if (!Array.isArray(updated)) return;
          setTransfers(updated);
          if (updated.length > 0) {
            setIsExpanded(true);
            setDismissed(false);
          }
        });
      }
    };

    setup();

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // Auto-dismiss removed — panel stays open until user clicks X
  // so they can review completed/failed transfers at their own pace

  if (dismissed || transfers.length === 0) return null;

  const activeTransfers = transfers.filter(t => t?.status === 'active');
  const completedTransfers = transfers.filter(t => t?.status !== 'active');
  const hasErrors = transfers.some(t => t?.status === 'error');

  const getTypeIcon = (type) => {
    switch (type) {
      case 'upload': return <Upload className="w-3.5 h-3.5 shrink-0" />;
      case 'download': return <Download className="w-3.5 h-3.5 shrink-0" />;
      case 'zip': return <Archive className="w-3.5 h-3.5 shrink-0" />;
      default: return <FileText className="w-3.5 h-3.5 shrink-0" />;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'upload':   return 'bg-amber-50 text-amber-500';
      case 'download': return 'bg-emerald-50 text-emerald-500';
      case 'zip':      return 'bg-purple-50 text-purple-500';
      default:         return 'bg-slate-50 text-slate-500';
    }
  };

  const getProgressColor = (type) => {
    switch (type) {
      case 'upload':   return 'bg-amber-400';
      case 'download': return 'bg-emerald-500';
      case 'zip':      return 'bg-purple-500';
      default:         return 'bg-slate-400';
    }
  };

  const getBadgeColor = (status, type) => {
    if (status === 'done')       return 'bg-emerald-100 text-emerald-700';
    if (status === 'error')      return 'bg-rose-100 text-rose-700';
    if (status === 'paused')     return 'bg-amber-100 text-amber-700';
    if (status === 'terminated') return 'bg-slate-100 text-slate-500';
    // active — color by type
    switch (type) {
      case 'upload':   return 'bg-amber-100 text-amber-700';
      case 'download': return 'bg-emerald-100 text-emerald-700';
      case 'zip':      return 'bg-purple-100 text-purple-700';
      default:         return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] w-96 bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 transition-all duration-300 overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
          activeTransfers.length > 0 ? 'bg-blue-50/70' : hasErrors ? 'bg-rose-50/50' : 'bg-emerald-50/50'
        } hover:brightness-95`}
        onClick={() => setIsExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl shadow-sm ${
            activeTransfers.length > 0 ? 'bg-blue-100 text-blue-600' :
            hasErrors ? 'bg-rose-100 text-rose-500' : 'bg-emerald-100 text-emerald-600'
          }`}>
            {activeTransfers.length > 0 ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : hasErrors ? (
              <XCircle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">
              {activeTransfers.length > 0
                ? `${activeTransfers.length} Transfer${activeTransfers.length > 1 ? 's' : ''} in Progress`
                : hasErrors ? 'Some Transfers Failed'
                : 'All Transfers Complete'}
            </p>
            <p className="text-[11px] text-slate-500">
              {activeTransfers.length} active · {completedTransfers.length} completed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
          <button
            className="p-1 rounded-lg hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-colors"
            onClick={e => { e.stopPropagation(); setDismissed(true); }}
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Transfer list */}
      {isExpanded && (
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 bg-slate-50/30">
          {[...transfers].reverse().map((transfer) => {
            if (!transfer?.id) return null;
            const type = transfer.type || 'copy';
            const status = transfer.status || 'active';
            const progress = typeof transfer.progress === 'number' ? Math.min(100, Math.max(0, transfer.progress)) : 0;

            return (
              <div key={transfer.id} className="px-4 py-3 flex flex-col gap-2 hover:bg-white transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`p-1.5 rounded-lg shrink-0 ${getTypeColor(type)}`}>
                      {getTypeIcon(type)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{transfer.name || 'Unknown'}</p>
                      <p className="text-[10px] text-slate-400">
                        {type.toUpperCase()} · {formatBytes(transfer.size)}
                        {status === 'active' && transfer.speed > 0 && (
                          <span className="text-blue-500 font-medium ml-1">· {formatBytes(transfer.speed)}/s</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getBadgeColor(status, type)}`}>
                      {status === 'active'
                        ? progress === 0 && transfer.speed === 0 ? '...' : `${Math.round(progress)}%`
                        : status === 'paused' ? 'PAUSED'
                        : status.toUpperCase()}
                    </span>
                    {(status === 'active' || status === 'paused') && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); status === 'paused'
                            ? window.electronAPI.resumeTransfer(transfer.id)
                            : window.electronAPI.pauseTransfer(transfer.id); }}
                          className="p-1 rounded-md hover:bg-slate-200/70 text-slate-500 hover:text-slate-700 transition-colors"
                          title={status === 'paused' ? 'Resume' : 'Pause'}
                        >
                          {status === 'paused'
                            ? <Play className="w-3 h-3" />
                            : <Pause className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); window.electronAPI.terminateTransfer(transfer.id); }}
                          className="p-1 rounded-md hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Terminate"
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {(status === 'active' || status === 'paused') && (
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ease-out ${getProgressColor(type)} ${
                        progress === 0 ? 'animate-pulse w-full opacity-30' :
                        status === 'paused' ? 'opacity-50' : ''
                      }`}
                      style={progress > 0 ? { width: `${progress}%` } : undefined}
                    />
                  </div>
                )}

                {/* Per-chunk progress — only shown when chunks exist */}
                {(status === 'active' || status === 'paused') && Array.isArray(transfer.chunks) && transfer.chunks.length > 1 && (
                  <div className="flex gap-0.5 w-full mt-0.5">
                    {transfer.chunks.map((chunk) => {
                      const chunkColor =
                        chunk.status === 'done'  ? getProgressColor(type) :
                        chunk.status === 'error' ? 'bg-rose-400' :
                        chunk.status === 'active' ? getProgressColor(type) :
                        'bg-slate-200';
                      return (
                        <div
                          key={chunk.index}
                          className="relative flex-1 h-1 bg-slate-200 rounded-sm overflow-hidden"
                          title={`Chunk ${chunk.index}: ${chunk.status} ${chunk.status === 'active' ? `(${Math.round(chunk.progress)}%)` : ''}`}
                        >
                          <div
                            className={`absolute inset-y-0 left-0 rounded-sm transition-all duration-200 ${chunkColor} ${chunk.status === 'active' ? 'opacity-80' : ''}`}
                            style={{ width: chunk.status === 'done' ? '100%' : chunk.status === 'active' ? `${chunk.progress}%` : '0%' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TransferStatus;
