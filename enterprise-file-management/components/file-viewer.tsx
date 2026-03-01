"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Download, ExternalLink, FileText, Loader2, X } from "lucide-react"

// Types
import type { ApiFileItem } from "@/app/(dashboard)/explorer/page"
import { fetchWithAuth } from "@/lib/api"
import { useAuth } from "@/components/providers/AuthProvider"

// Doc Viewer for Office formats
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer"
import "@cyntler/react-doc-viewer/dist/index.css";

interface FileViewerProps {
  file: ApiFileItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FileViewer({ file, open, onOpenChange }: FileViewerProps) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [textContent, setTextContent] = React.useState<string | null>(null)
  
  const { user } = useAuth()

  const canDownload = React.useMemo(() => {
    if (!user || !file) return false;
    if (user.role === 'PLATFORM_ADMIN' || user.role === 'TENANT_ADMIN') return true;
    
    let allPolicies: any[] = [];
    if (user.policies) allPolicies = [...allPolicies, ...user.policies];
    if (user.teams) {
      user.teams.forEach((t: any) => {
         if (t.team && t.team.policies) {
            allPolicies = [...allPolicies, ...t.team.policies];
         }
      });
    }

    return allPolicies.some(p => {
      const typeMatch = p.resourceType?.toLowerCase() === 'bucket';
      const idMatch = p.resourceId === null || p.resourceId === undefined || p.resourceId === file.bucketId;
      const actionMatch = p.actions?.includes('DOWNLOAD');
      return typeMatch && idMatch && actionMatch;
    });
  }, [user, file]);

  React.useEffect(() => {
    if (!open || !file) {
      setUrl(null)
      setTextContent(null)
      setError(null)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    const fetchUrl = async () => {
      try {
        const res = await fetchWithAuth(`/api/files/presigned?bucketId=${file.bucketId}&key=${encodeURIComponent(file.key)}&action=read`)

        if (!res.ok) throw new Error('Failed to get file access url')
        
        const data = await res.json()
        if (isMounted) {
            setUrl(data.url)
            
            // For simple text/code/csv files, fetch the content directly to render in a pre block
            if (file.type === 'code' || file.type === 'spreadsheet' && file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
                try {
                    const textRes = await fetch(data.url)
                    const text = await textRes.text()
                    if (isMounted) setTextContent(text)
                } catch(e) {
                    console.warn("Silent text fetch failure:", e);
                    // Ignore text fetch errors, fallback to download
                }
            }
        }
      } catch (err: any) {
        console.error("DocViewer URL Fetch Error:", err);
        if (isMounted) setError(err.message || 'An error occurred')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchUrl()

    return () => { isMounted = false }
  }, [open, file])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center p-12 h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading viewer...</p>
        </div>
      )
    }

    if (error || !url) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center h-64">
          <FileText className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <p className="text-sm font-medium text-destructive">{error || 'Could not load file'}</p>
        </div>
      )
    }

    const { type, name } = file!

    if (type === 'image') {
      return (
        <div className="flex items-center justify-center bg-muted/30 p-4 rounded-md min-h-64 h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={name} className="max-w-full max-h-[70vh] object-contain rounded-md" />
        </div>
      )
    }

    if (type === 'video') {
      return (
        <div className="flex items-center justify-center bg-black p-4 rounded-md h-[70vh]">
          <video controls className="max-w-full max-h-full" src={url} />
        </div>
      )
    }

    if (type === 'audio') {
      return (
        <div className="flex items-center justify-center p-12 bg-muted/30 rounded-md">
          <audio controls src={url} className="w-full max-w-md" />
        </div>
      )
    }

    if (type === 'pdf') {
       return (
         <div className="w-full h-[75vh] rounded-md overflow-hidden border bg-muted/10 relative">
           <iframe src={`${url}#toolbar=0`} className="w-full h-full" title={name} />
         </div>
       )
    }

    if (textContent !== null) {
      return (
        <div className="w-full max-h-[70vh] overflow-auto bg-muted/30 p-4 rounded-md border font-mono text-sm leading-relaxed whitespace-pre" style={{ tabSize: 4 }}>
          {textContent}
        </div>
      )
    }

    if (type === 'document' || type === 'spreadsheet') {
      // Use react-doc-viewer for Word/Excel
      return (
          <div className="w-full h-full min-h-[75vh] sm:min-h-[85vh] bg-background flex rounded-md overflow-hidden relative">
              <DocViewer 
                documents={[{ uri: url, fileType: name.split('.').pop() }]}
                pluginRenderers={DocViewerRenderers}
                style={{ height: '100%', width: '100%' }}
                config={{
                    header: {
                        disableHeader: true,
                        disableFileName: true,
                        retainURLParams: false
                    }
                }}
                className="doc-viewer-override w-full h-full"
              />
          </div>
      )
    }

    return (
      <div className="flex flex-col items-center justify-center p-16 text-center border rounded-md bg-muted/10 h-64">
        <FileText className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="font-semibold text-lg">{name}</h3>
        <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-sm">
          No rich preview is available for this file type. Download it to view on your device.
        </p>
        {canDownload && (
          <Button onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download File
          </Button>
        )}
      </div>
    )
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!file) return;
    
    try {
      // Calling the API with action=download triggers the audit log on the backend
      const res = await fetchWithAuth(`/api/files/presigned?bucketId=${file.bucketId}&key=${encodeURIComponent(file.key)}&action=download`);
      if (!res.ok) throw new Error('Failed to get download url');
      
      const data = await res.json();
      
      // Trigger actual download in browser
      const a = document.createElement('a');
      a.href = data.url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={`h-[95vh] sm:h-[90vh] p-0 overflow-hidden flex flex-col bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${file?.type === 'document' || file?.type === 'spreadsheet' || file?.type === 'pdf' ? '!max-w-[95vw] !w-[95vw]' : 'max-w-6xl w-[95vw]'}`}>
        <DialogHeader className="p-4 border-b bg-background/80 flex flex-row items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 bg-primary/10 rounded-md shrink-0">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="truncate text-base">{file?.name}</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {file?.bucketName}
              </DialogDescription>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
             {url && canDownload && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownload} title="Download Source">
                  <Download className="h-4 w-4" />
                </Button>
             )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className={`flex-1 overflow-auto flex flex-col ${file?.type === 'document' || file?.type === 'spreadsheet' || file?.type === 'pdf' ? 'bg-background p-0' : 'p-4 md:p-6'}`}>
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
