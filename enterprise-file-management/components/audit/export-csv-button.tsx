"use client";

import { Button } from "@/components/ui/button";
import { ArrowDownToLine } from "lucide-react";
import { formatDateTime } from "@/lib/mock-data";

export function ExportCsvButton({ logs }: { logs: any[] }) {
  const exportCsv = () => {
    if (!logs || logs.length === 0) return;

    // Build CSV headers
    const headers = ["Action", "User Name", "User Email", "File", "Bucket", "IP Address", "Timestamp"];
    
    // Build CSV rows
    const rows = logs.map(log => {
      const details = log.details || {};
      const resourceId = log.resourceId || "-";
      const displayResource = details.name || details.key || details.email || resourceId;
      const bucket = details.bucketName || (details.bucketId ? "S3 Bucket" : log.resource.split(':')[0]);
      
      const row = [
        log.action,
        log.user?.name || "Unknown",
        log.user?.email || "N/A",
        displayResource,
        bucket,
        details.ip || "System",
        formatDateTime(new Date(log.createdAt).toISOString())
      ];
      
      return row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}>
      <ArrowDownToLine className="h-4 w-4" />
      Export CSV
    </Button>
  );
}
