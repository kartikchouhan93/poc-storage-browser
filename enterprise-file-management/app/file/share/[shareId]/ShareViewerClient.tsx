"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, File as FileIcon, Clock, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ShareViewerClient({ shareId, file, share }: { shareId: string, file: any, share: any }) {
  const router = useRouter();

  const bytesToSize = (bytes: number) => {
    if (bytes === 0 || !bytes) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
  };

  const formatFileType = (mimeType: string | null, filename: string) => {
    if (!mimeType) return "Unknown File Type";
    
    // Check known mime types
    if (mimeType.includes("pdf")) return "PDF Document";
    if (mimeType.includes("word") || mimeType.includes("msword")) return "Word Document";
    if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "Excel Spreadsheet";
    if (mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "PowerPoint Presentation";
    if (mimeType.includes("image/")) return `Image (${mimeType.split("/")[1].toUpperCase()})`;
    if (mimeType.includes("video/")) return `Video (${mimeType.split("/")[1].toUpperCase()})`;
    if (mimeType.includes("audio/")) return `Audio (${mimeType.split("/")[1].toUpperCase()})`;
    if (mimeType.includes("zip") || mimeType.includes("compressed")) return "ZIP Archive";
    if (mimeType.includes("text/csv")) return "CSV Document";
    if (mimeType.includes("text/plain")) return "Text Document";
    if (mimeType.includes("text/html")) return "HTML Document";
    if (mimeType.includes("json")) return "JSON File";
    
    // Fallback: extract extension or just return original
    const ext = filename.split(".").pop();
    if (ext && ext !== filename) return `${ext.toUpperCase()} File`;
    
    return mimeType;
  };

  const handleDownload = () => {
    window.location.href = `/api/shares/${shareId}/download`;
    // Refresh the page data after a short delay to update the download counter
    setTimeout(() => {
      router.refresh();
    }, 1500);
  };

  return (
    <Card className="w-full max-w-lg mx-auto mt-20 shadow-xl border-t-4 border-t-green-500">
      <CardHeader>
        <CardTitle className="text-2xl font-bold flex items-center gap-3 break-all">
          <FileIcon className="h-7 w-7 text-blue-500 shrink-0" />
          {file.name}
        </CardTitle>
        <CardDescription>
          Securely shared with <strong>{share.toEmail}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 p-5 bg-muted/50 rounded-xl border">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Size</span>
            <span className="font-semibold text-foreground">{bytesToSize(Number(file.size))}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Type</span>
            <span className="font-semibold text-foreground text-right">{formatFileType(file.mimeType, file.name)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-orange-400" /> Expires
            </span>
            <span className="font-semibold text-foreground">{new Date(share.expiry).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 rounded-lg text-sm border border-amber-200 dark:border-amber-900/50">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
          <p className="leading-relaxed">
            You have <strong className="font-bold text-amber-700 dark:text-amber-400">{share.downloadLimit - share.downloads}</strong> downloads remaining out of {share.downloadLimit}. 
            Downloading this file will decrease your available limit.
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleDownload} className="w-full py-7 text-lg shadow-md hover:shadow-lg transition-all" size="lg">
          <Download className="mr-2 h-6 w-6" />
          Download File
        </Button>
      </CardFooter>
    </Card>
  );
}
