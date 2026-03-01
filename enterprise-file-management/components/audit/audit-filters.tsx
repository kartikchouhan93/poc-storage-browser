"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCallback, useState, useEffect, useTransition } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, RefreshCw, X } from "lucide-react";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

export function AuditFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentAction = searchParams.get("action") || "all";
  const currentTimeRange = searchParams.get("timeRange") || "all";
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const [date, setDate] = useState<DateRange | undefined>(() => {
    if (dateFrom && dateTo) {
      return {
        from: new Date(dateFrom),
        to: new Date(dateTo),
      };
    }
    return undefined;
  });

  // Sync state if URL changes externally
  useEffect(() => {
    if (currentTimeRange !== "custom") {
      setDate(undefined);
    } else if (dateFrom && dateTo) {
      setDate({
        from: new Date(dateFrom),
        to: new Date(dateTo),
      });
    }
  }, [currentTimeRange, dateFrom, dateTo]);

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);
      return params.toString();
    },
    [searchParams]
  );

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <Select
          value={currentAction}
          onValueChange={(val) => {
            router.push(`${pathname}?${createQueryString("action", val)}`);
          }}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="upload">Upload</SelectItem>
            <SelectItem value="download">Download</SelectItem>
            <SelectItem value="delete">Delete</SelectItem>
            <SelectItem value="share">Share</SelectItem>
            <SelectItem value="create_bucket">Create Bucket</SelectItem>
            <SelectItem value="invite_user">User Activity</SelectItem>
            <SelectItem value="sync">Sync</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentTimeRange}
          onValueChange={(val) => {
            if (val !== "custom") {
              const params = new URLSearchParams(searchParams.toString());
              params.set("timeRange", val);
              params.delete("dateFrom");
              params.delete("dateTo");
              router.push(`${pathname}?${params.toString()}`);
            } else {
              router.push(`${pathname}?${createQueryString("timeRange", val)}`);
            }
          }}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="90d">Last 90 Days</SelectItem>
            <SelectItem value="custom">Custom Range</SelectItem>
          </SelectContent>
        </Select>

        {currentTimeRange === "custom" && (
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant={"outline"}
                  size="sm"
                  className={cn(
                    "w-[240px] justify-start text-left font-normal h-8 text-xs",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date?.from ? (
                    date.to ? (
                      <>
                        {format(date.from, "LLL dd, y")} -{" "}
                        {format(date.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(date.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={date?.from}
                  selected={date}
                  onSelect={(newDate) => {
                    setDate(newDate);
                    if (newDate?.from && newDate?.to) {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set("timeRange", "custom");
                      params.set("dateFrom", newDate.from.toISOString());
                      params.set("dateTo", newDate.to.toISOString());
                      router.push(`${pathname}?${params.toString()}`);
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            {date && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setDate(undefined);
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("timeRange", "all");
                  params.delete("dateFrom");
                  params.delete("dateTo");
                  router.push(`${pathname}?${params.toString()}`);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => startTransition(() => router.refresh())}
        disabled={isPending}
        title="Refresh logs"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isPending && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}
