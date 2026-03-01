"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, File as FileIcon, Clock, AlertTriangle } from "lucide-react";

export default function ShareViewerClient({ shareId, file, share }: { shareId: string, file: any, share: any }) {
  const bytesToSize = (bytes: number) => {
    if (bytes === 0 || !bytes) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
  };

  const handleDownload = () => {
    window.location.href = `/api/shares/${shareId}/download`;
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
        <div className="flex flex-col gap-3 p-5 bg-gray-50 rounded-xl border border-gray-100">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">Size</span>
            <span className="font-semibold text-gray-800">{bytesToSize(Number(file.size))}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">Type</span>
            <span className="font-semibold text-gray-800">{file.mimeType || "Unknown"}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-orange-400" /> Expires
            </span>
            <span className="font-semibold text-gray-800">{new Date(share.expiry).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 bg-amber-50 text-amber-900 rounded-lg text-sm border border-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <p className="leading-relaxed">
            You have <strong className="font-bold text-amber-700">{share.downloadLimit - share.downloads}</strong> downloads remaining out of {share.downloadLimit}. 
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
