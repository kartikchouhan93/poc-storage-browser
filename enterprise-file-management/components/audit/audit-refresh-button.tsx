"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import React from "react";

export function AuditRefreshButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-9">
      <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      Refresh
    </Button>
  );
}
