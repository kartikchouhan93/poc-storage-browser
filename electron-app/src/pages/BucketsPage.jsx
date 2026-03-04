import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Globe, HardDrive, Lock, RefreshCw, Database } from 'lucide-react';
import { Link } from 'react-router-dom';

const storageClassColors = {
  STANDARD:    "bg-emerald-500/10 text-emerald-600",
  STANDARD_IA: "bg-blue-500/10 text-blue-600",
  GLACIER:     "bg-cyan-500/10 text-cyan-600",
  DEEP_ARCHIVE:"bg-purple-500/10 text-purple-600",
};

const storageClassLabels = {
  STANDARD:    "Standard",
  STANDARD_IA: "Infrequent Access",
  GLACIER:     "Glacier",
  DEEP_ARCHIVE:"Deep Archive",
};

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

export default function BucketsPage() {
  const [buckets, setBuckets] = useState([]);
  const [bucketStats, setBucketStats] = useState({}); // bucketId → { count, size }
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBuckets = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) { setBuckets([]); setLoading(false); return; }

      // Fetch buckets
      const { rows: bucketRows } = await window.electronAPI.dbQuery(
        'SELECT * FROM "Bucket" ORDER BY "createdAt" DESC', []
      );
      setBuckets(bucketRows || []);

      // Fetch per-bucket file counts and total sizes
      const statsRes = await window.electronAPI.dbQuery(
        `SELECT "bucketId",
                COUNT(*) FILTER (WHERE "isFolder" = false) as file_count,
                COALESCE(SUM(size) FILTER (WHERE "isFolder" = false), 0) as total_size
         FROM "FileObject"
         GROUP BY "bucketId"`,
        []
      );

      const statsMap = {};
      for (const row of (statsRes.rows || [])) {
        statsMap[row.bucketId] = {
          count: parseInt(row.file_count || 0),
          size: parseInt(row.total_size || 0),
        };
      }
      setBucketStats(statsMap);
    } catch (error) {
      console.error('Failed to fetch buckets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBuckets();
    const interval = setInterval(fetchBuckets, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const filteredBuckets = buckets.filter(b =>
    b.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-auto bg-white p-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 text-2xl font-normal text-slate-800 tracking-tight">
              <HardDrive className="h-6 w-6 text-blue-500" />
              Buckets
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px] max-w-sm">
              <Input
                placeholder="Search buckets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" onClick={fetchBuckets}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Loading skeleton */}
          {loading && buckets.length === 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-44 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {filteredBuckets.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Database className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-lg font-medium text-slate-700">No buckets found locally</p>
              <p className="text-sm text-slate-400 mt-1">Waiting for the first sync with the cloud…</p>
              <Button className="mt-5 gap-1.5" variant="outline" onClick={fetchBuckets}>
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredBuckets.map((bucket) => {
                const st = bucketStats[bucket.id] || { count: 0, size: 0 };
                // Compute % of total aggregate size for the progress bar
                const totalAll = Object.values(bucketStats).reduce((s, v) => s + v.size, 0);
                const pct = totalAll > 0 ? Math.round((st.size / totalAll) * 100) : 0;

                return (
                  <Link key={bucket.id} to={`/files/${bucket.id}`} className="block h-full">
                    <Card className="h-full border border-slate-200 hover:border-blue-200 hover:shadow-md transition-all duration-200 cursor-pointer shadow-sm">
                      <CardHeader className="flex flex-row items-start justify-between pb-2 p-5 w-full">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 shrink-0">
                            <HardDrive className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="text-base font-semibold text-slate-900 truncate">
                              {bucket.name}
                            </CardTitle>
                            <div className="flex items-center gap-1.5 mt-0.5 text-slate-500">
                              <Globe className="h-3 w-3 shrink-0" />
                              <span className="text-xs">{bucket.region}</span>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="p-5 pt-0 space-y-3">
                        {/* Badges */}
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className={`px-2.5 py-0.5 rounded-full font-medium ${storageClassColors[bucket.storageClass] || 'bg-slate-100 text-slate-700'}`}>
                            {storageClassLabels[bucket.storageClass] || 'Standard'}
                          </span>
                          {bucket.encryption && (
                            <span className="px-2.5 py-0.5 rounded-full font-medium bg-slate-100 flex items-center gap-1 text-slate-700">
                              <Lock className="h-3 w-3" /> Encrypted
                            </span>
                          )}
                        </div>

                        {/* Storage bar */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">{st.count} file{st.count !== 1 ? 's' : ''}</span>
                            <span className="text-slate-700 font-medium">{formatBytes(st.size)}</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-700"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                          <span>{pct}% of total</span>
                          <span>Created {formatDate(bucket.createdAt)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
