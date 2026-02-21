import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { 
  Folder, File, ArrowLeft, RefreshCw, Download, 
  FileText, Image as ImageIcon, Video, Music, Archive, 
  ChevronRight, ArrowUpDown, List, Grid3X3, FolderPlus, Upload, 
  MoreHorizontal, HardDrive
} from 'lucide-react';

export default function FilesPage() {
  const { bucketId } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [folderStack, setFolderStack] = useState([]); 
  const [viewMode, setViewMode] = useState("list");
  const [sortKey, setSortKey] = useState("name");
  const [bucketInfo, setBucketInfo] = useState(null);

  const fetchFiles = async () => {
    if (!bucketId) return;
    setLoading(true);
    try {
        if (window.electronAPI) {
            const bucketRes = await window.electronAPI.dbQuery('SELECT name FROM "Bucket" WHERE id = $1', [bucketId]);
            if (bucketRes.rows.length > 0) {
               setBucketInfo(bucketRes.rows[0]);
            }

            let query = 'SELECT * FROM "FileObject" WHERE "bucketId" = $1';
            let params = [bucketId];

            if (currentFolderId) {
                query += ' AND "parentId" = $2';
                params.push(currentFolderId);
            } else {
                query += ' AND "parentId" IS NULL';
            }
            
            query += ' ORDER BY "isFolder" DESC, "name" ASC';

            const { rows } = await window.electronAPI.dbQuery(query, params);
            setFiles(rows);
        } else {
            console.warn('Electron API unavailable');
            setFiles([]);
        }
    } catch (error) {
        console.error('Failed to fetch files:', error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, [bucketId, currentFolderId]);

  const handleFolderClick = (folder) => {
    setFolderStack([...folderStack, { id: currentFolderId, name: folder.name }]);
    setCurrentFolderId(folder.id);
  };

  const navigateToBreadcrumb = (index) => {
    if (index === 0) {
      setCurrentFolderId(null);
      setFolderStack([]);
    } else {
      const prev = folderStack[index - 1];
      setCurrentFolderId(prev.id);
      setFolderStack(folderStack.slice(0, index));
    }
  };

  const handleUpload = async () => {
    if (!window.electronAPI || !bucketInfo) return;
    const filePaths = await window.electronAPI.selectFileForUpload();
    if (!filePaths || filePaths.length === 0) return;

    const rootPath = "/home/abhishek/FMS";
    const currentPhysicalPath = [rootPath, bucketInfo.name, ...folderStack.map(f => f.name)].join('/');
    
    setLoading(true);
    await window.electronAPI.uploadItems(filePaths, currentPhysicalPath, false);
    setTimeout(fetchFiles, 1500); 
  };

  const handleNewFolder = async () => {
    if (!window.electronAPI || !bucketInfo) return;
    const folderName = prompt("Enter new folder name:");
    if (!folderName) return;

    const rootPath = "/home/abhishek/FMS";
    const currentPhysicalPath = [rootPath, bucketInfo.name, ...folderStack.map(f => f.name)].join('/');
    const folderPath = currentPhysicalPath + "/" + folderName;
    
    await window.electronAPI.createFolder(folderPath);
    setTimeout(fetchFiles, 1500);
  };

  const getFileIcon = (file) => {
      if (file.isFolder) return <Folder className="h-4 w-4 shrink-0 text-blue-500 fill-blue-500/20" />;
      if (file.mimeType?.startsWith('image/')) return <ImageIcon className="h-4 w-4 shrink-0 text-emerald-500" />;
      if (file.mimeType?.startsWith('video/')) return <Video className="h-4 w-4 shrink-0 text-purple-500" />;
      if (file.mimeType?.startsWith('audio/')) return <Music className="h-4 w-4 shrink-0 text-pink-500" />;
      return <FileText className="h-4 w-4 shrink-0 text-slate-500" />;
  }

  const formatBytes = (bytes) => {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-auto p-6 bg-white">
        <div className="space-y-4">
          
          {/* Toolbar */}
          <div className="flex flex-col gap-4 pb-4 border-b border-slate-100 mb-2">
            <div className="flex items-center justify-between w-full">
                <nav className="flex items-center gap-1.5 text-[17px] font-normal tracking-tight text-slate-600">
                  <button 
                    onClick={() => { navigate('/'); }} 
                    className="hover:text-slate-900 hover:bg-slate-100 px-2.5 py-1 rounded-md transition-colors"
                    title="Home"
                  >
                    Home
                  </button>
                  <ChevronRight className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                  <button 
                    onClick={() => navigateToBreadcrumb(0)}
                    className={`transition-colors px-3 py-1.5 rounded-full ${folderStack.length === 0 ? 'text-slate-900 bg-slate-100' : 'hover:text-slate-900 hover:bg-slate-100'}`}
                  >
                    {bucketInfo ? bucketInfo.name : 'All Files'}
                  </button>
                  {folderStack.map((segment, i) => (
                    <React.Fragment key={i}>
                      <ChevronRight className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                      <button 
                        onClick={() => navigateToBreadcrumb(i + 1)}
                        className={`transition-colors px-3 py-1.5 rounded-full ${i === folderStack.length - 1 ? 'text-slate-900 bg-slate-100' : 'hover:text-slate-900 hover:bg-slate-100'}`}
                      >
                        {segment.name}
                      </button>
                    </React.Fragment>
                  ))}
                </nav>

                <div className="flex items-center gap-3">
                  <Button variant="outline" className="gap-1.5 h-10 rounded-full px-4 border-slate-300 shadow-sm" onClick={handleNewFolder}>
                    <FolderPlus className="h-4 w-4" />
                    New folder
                  </Button>
                  <Button className="gap-1.5 h-10 rounded-full px-5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-medium" onClick={handleUpload}>
                    <Upload className="h-4 w-4" />
                    Upload
                  </Button>
                </div>
            </div>

            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3 text-sm">
                    {/* View Options Could Go Here */}
                </div>
                
                <div className="flex items-center gap-2">
                  <select className="border border-input bg-background px-3 h-8 rounded-full text-xs text-slate-700 w-[140px] focus:ring-0">
                      <option value="name">Name</option>
                      <option value="size">Size</option>
                      <option value="modifiedAt">Modified</option>
                  </select>
                  
                  <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-slate-300" onClick={fetchFiles}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </Button>

                  <div className="flex items-center justify-center border border-slate-300 rounded-full h-8 overflow-hidden bg-white ml-1">
                    <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className={`h-full w-9 rounded-none border-0 ${viewMode === 'list' ? 'bg-slate-100' : 'hover:bg-slate-50'}`} onClick={() => setViewMode("list")}>
                      <List className="h-4 w-4 text-slate-600" />
                    </Button>
                    <div className="w-[1px] h-full bg-slate-300" />
                    <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" className={`h-full w-9 rounded-none border-0 ${viewMode === 'grid' ? 'bg-slate-100' : 'hover:bg-slate-50'}`} onClick={() => setViewMode("grid")}>
                      <Grid3X3 className="h-4 w-4 text-slate-600" />
                    </Button>
                  </div>
                </div>
            </div>
          </div>

          {!bucketId && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <HardDrive className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-lg font-medium text-slate-900">No bucket selected</p>
              <p className="text-sm text-slate-500 mt-1">Please select a bucket from the Buckets page to view files.</p>
            </div>
          )}

          {bucketId && !loading && files.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl border-dashed">
              <Folder className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-lg font-medium text-slate-900">This folder is empty</p>
              <p className="text-sm text-slate-500 mt-1">Upload files or create a new folder to get started</p>
            </div>
          )}

          {bucketId && files.length > 0 && viewMode === "list" && (
            <div className="rounded-lg border overflow-hidden mt-4">
              <table className="w-full text-sm text-left align-middle border-collapse">
                <thead className="bg-slate-50/50 border-b border-border">
                  <tr className="text-slate-500 font-medium">
                    <th className="p-3 w-10 text-center"><input type="checkbox" className="rounded border-slate-300" /></th>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium hidden md:table-cell">Size</th>
                    <th className="p-3 font-medium hidden lg:table-cell">Modified</th>
                    <th className="p-3 font-medium hidden lg:table-cell">Owner</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr 
                      key={file.id} 
                      className="border-b last:border-0 hover:bg-slate-50 cursor-pointer group transition-colors"
                      onClick={() => file.isFolder ? handleFolderClick(file) : null}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-slate-300" />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          {getFileIcon(file)}
                          <span className="font-medium text-slate-900 text-sm truncate max-w-[200px] sm:max-w-[400px]">{file.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-500 hidden md:table-cell">
                        {file.isFolder ? '--' : formatBytes(file.size)}
                      </td>
                      <td className="p-3 text-slate-500 hidden lg:table-cell">
                        {formatDate(file.updatedAt)}
                      </td>
                      <td className="p-3 text-slate-500 hidden lg:table-cell">
                        Admin
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="h-4 w-4 text-slate-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bucketId && files.length > 0 && viewMode === "grid" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 mt-4">
              {files.map((file) => (
                <Card 
                  key={file.id} 
                  className="group cursor-pointer hover:border-slate-300 transition-colors shadow-sm"
                  onClick={() => file.isFolder ? handleFolderClick(file) : null}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                        {getFileIcon(file)}
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                           <MoreHorizontal className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
                      <p className="text-xs text-slate-500">
                        {file.isFolder ? 'Folder' : formatBytes(file.size)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
