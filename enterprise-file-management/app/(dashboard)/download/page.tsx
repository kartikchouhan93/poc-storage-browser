"use client";

import * as React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Download,
  Monitor,
  Apple,
  Terminal,
  ChevronDown,
  CheckCircle2,
  Clock,
  RefreshCw,
  Package,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Build {
  platform: string;
  label: string;
  arch: string;
  filename: string;
  ext: string;
  size: string | null;
  available: boolean;
}

interface Manifest {
  version: string;
  releaseDate: string;
  changelog: string;
  builds: Build[];
}

const PLATFORM_META: Record<
  string,
  {
    icon: React.ElementType;
    emoji: string;
    color: string;
    installSteps: string[];
  }
> = {
  linux: {
    icon: Terminal,
    emoji: "🐧",
    color: "text-orange-500",
    installSteps: [
      "Download the .deb package",
      "Run: sudo dpkg -i porter-*.deb",
      "Launch Porter from your applications menu or run: porter",
      "Sign in with your CloudVault credentials",
    ],
  },
  windows: {
    icon: Monitor,
    emoji: "🪟",
    color: "text-blue-500",
    installSteps: [
      "Download the .exe installer",
      "Run the installer and follow the setup wizard",
      "Launch Porter from the Start menu",
      "Sign in with your CloudVault credentials",
    ],
  },
  mac: {
    icon: Apple,
    emoji: "🍎",
    color: "text-gray-500",
    installSteps: [
      "Download the .dmg file",
      "Open the .dmg and drag Porter to Applications",
      "Launch Porter from Applications (right-click → Open on first launch)",
      "Sign in with your CloudVault credentials",
    ],
  },
};

function detectOS(): string {
  if (typeof window === "undefined") return "linux";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

export default function DownloadPage() {
  const [manifest, setManifest] = React.useState<Manifest | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [detectedOS, setDetectedOS] = React.useState<string>("linux");
  const [openInstructions, setOpenInstructions] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetectedOS(detectOS());
    fetch("/api/agent/download")
      .then((r) => {
        if (!r.ok) throw new Error("Manifest not found");
        return r.json();
      })
      .then((data) => setManifest(data))
      .catch(() => setError("Could not load build manifest."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Download Porter</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Hero */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-primary/10 p-2.5 rounded-lg">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Download Porter</h1>
              {manifest && (
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-xs">
                    v{manifest.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Released {new Date(manifest.releaseDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                  </span>
                </div>
              )}
            </div>
          </div>
          <p className="text-muted-foreground mt-2 max-w-xl">
            Porter is the CloudVault desktop sync agent. Install it on your machine to keep your local files in sync with your cloud storage buckets automatically.
          </p>
          {manifest?.changelog && (
            <p className="text-sm text-muted-foreground mt-1 italic">
              {manifest.changelog}
            </p>
          )}
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading available builds…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive max-w-xl">
            {error} — builds will appear here once they are published.
          </div>
        )}

        {/* Platform Cards */}
        {manifest && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
            {manifest.builds.map((build) => {
              const meta = PLATFORM_META[build.platform];
              const Icon = meta?.icon ?? Package;
              const isRecommended = build.platform === detectedOS;

              return (
                <Card
                  key={build.platform}
                  className={cn(
                    "relative flex flex-col transition-shadow",
                    isRecommended
                      ? "border-primary shadow-md ring-1 ring-primary/30"
                      : "hover:shadow-sm",
                  )}
                >
                  {isRecommended && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="text-xs px-2 py-0.5 bg-primary text-primary-foreground shadow-sm">
                        Recommended for your OS
                      </Badge>
                    </div>
                  )}

                  <CardHeader className="pb-3 pt-6">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-md bg-muted", meta?.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{build.label}</CardTitle>
                        <CardDescription className="text-xs">
                          {build.arch} · {build.ext}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 pb-3">
                    <div className="flex items-center gap-1.5">
                      {build.available ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            Available
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            Coming soon
                          </span>
                        </>
                      )}
                      {build.size && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {build.size}
                        </span>
                      )}
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col gap-2 pt-0">
                    <Button
                      className="w-full gap-2"
                      disabled={!build.available}
                      asChild={build.available}
                      variant={isRecommended ? "default" : "outline"}
                    >
                      {build.available ? (
                        <a
                          href={`/api/agent/download/file?file=${build.filename}`}
                          download={build.filename}
                        >
                          <Download className="h-4 w-4" />
                          Download {build.ext}
                        </a>
                      ) : (
                        <span>
                          <Clock className="h-4 w-4" />
                          Not yet available
                        </span>
                      )}
                    </Button>

                    {/* Install instructions collapsible */}
                    <Collapsible
                      open={openInstructions === build.platform}
                      onOpenChange={(open) =>
                        setOpenInstructions(open ? build.platform : null)
                      }
                      className="w-full"
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs text-muted-foreground gap-1 h-7"
                        >
                          Install instructions
                          <ChevronDown
                            className={cn(
                              "h-3 w-3 transition-transform",
                              openInstructions === build.platform && "rotate-180",
                            )}
                          />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground list-none">
                          {meta?.installSteps.map((step, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-foreground">
                                {i + 1}
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {/* System requirements */}
        {manifest && (
          <div className="mt-8 max-w-4xl">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              System Requirements
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { platform: "Linux", req: "Ubuntu 20.04+ / Debian 11+, 64-bit" },
                { platform: "Windows", req: "Windows 10 or later, 64-bit" },
                { platform: "macOS", req: "macOS 12 Monterey or later, Apple Silicon or Intel" },
              ].map((r) => (
                <div
                  key={r.platform}
                  className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3"
                >
                  <Cpu className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium">{r.platform}</p>
                    <p className="text-xs text-muted-foreground">{r.req}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
