import React, { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock, Stethoscope } from 'lucide-react';
import HeartbeatRibbon from '../components/HeartbeatRibbon';

const STATUS_ICONS = {
  pass: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  warn: <AlertTriangle className="h-5 w-5 text-yellow-600" />,
  fail: <XCircle className="h-5 w-5 text-red-600" />,
};

const STATUS_COLORS = {
  pass: 'bg-emerald-50 border-emerald-200',
  warn: 'bg-yellow-50 border-yellow-200',
  fail: 'bg-red-50 border-red-200',
};

export default function DoctorPage() {
  const [heartbeatLogs, setHeartbeatLogs] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('UNKNOWN');

  useEffect(() => {
    loadHeartbeatHistory();
    loadPersistedDiagnostics();
    const interval = setInterval(loadHeartbeatHistory, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadHeartbeatHistory() {
    if (!window.electronAPI?.doctor) return;
    const logs = await window.electronAPI.doctor.getHeartbeatHistory(60);
    setHeartbeatLogs(logs || []);
    if (logs && logs.length > 0) {
      const latest = logs[logs.length - 1];
      const isRecent = Date.now() - new Date(latest.timestamp).getTime() < 2 * 60 * 1000;
      setCurrentStatus(isRecent && latest.status === 'SUCCESS' ? 'ACTIVE' : 'OFFLINE');
    } else {
      setCurrentStatus('UNKNOWN');
    }
  }

  async function loadPersistedDiagnostics() {
    if (!window.electronAPI?.doctor) return;
    const last = await window.electronAPI.doctor.getLastDiagnostics();
    if (last && last.length > 0) setDiagnostics(last);
  }

  async function runAllDiagnostics() {
    if (!window.electronAPI?.doctor) return;
    setLoading(true);
    const results = await window.electronAPI.doctor.runDiagnostics();
    setDiagnostics(results || []);
    setLoading(false);
  }

  async function runSingleDiagnostic(name) {
    if (!window.electronAPI?.doctor) return;
    setDiagnostics(prev => prev.map(d => d.name === name ? { ...d, _loading: true } : d));
    const result = await window.electronAPI.doctor.runSingle(name);
    // Re-persist after single run
    setDiagnostics(prev => {
      const updated = prev.map(d => d.name === name ? result : d);
      return updated;
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 p-3 rounded-xl">
              <Stethoscope className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Agent Doctor</h1>
              <p className="text-sm text-slate-500 mt-0.5">Health checks and diagnostics</p>
            </div>
          </div>
          <Button onClick={runAllDiagnostics} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Run All Diagnostics
          </Button>
        </div>

        {/* Heartbeat Ribbon */}
        <HeartbeatRibbon logs={heartbeatLogs} currentStatus={currentStatus} />

        {/* Diagnostics Grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900">System Diagnostics</h2>
            {diagnostics.length > 0 && diagnostics[0].ranAt && (
              <p className="text-xs text-slate-400">
                Last run: {new Date(diagnostics[0].ranAt).toLocaleString()}
              </p>
            )}
          </div>
          {diagnostics.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Stethoscope className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">No diagnostics run yet</p>
              <p className="text-sm text-slate-400 mt-1">Click "Run All Diagnostics" to start</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {diagnostics.map((diag) => (
                <div
                  key={diag.name}
                  className={`bg-white rounded-2xl border-2 p-5 shadow-sm transition-all ${
                    STATUS_COLORS[diag.status] || 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {STATUS_ICONS[diag.status] || <Clock className="h-5 w-5 text-slate-400" />}
                      <div>
                        <h3 className="font-bold text-slate-900">{diag.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {diag.durationMs ? `${diag.durationMs}ms` : '—'}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runSingleDiagnostic(diag.name)}
                      disabled={diag._loading}
                      className="h-8 w-8 p-0"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${diag._loading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{diag.detail}</p>
                  {diag.data && typeof diag.data === 'object' && (
                    <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(diag.data).map(([key, value]) => (
                        <div key={key}>
                          <span className="text-slate-500 font-medium">{key}:</span>{' '}
                          <span className="text-slate-700">
                            {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
