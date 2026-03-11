"use client"

import * as React from "react"
import { CalendarIcon, X } from "lucide-react"
import { format } from "date-fns"
import { type DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export interface DateRangePickerProps {
  dateRange: { from?: Date; to?: Date }
  onDateRangeChange: (range: { from?: Date; to?: Date }) => void
  className?: string
  placeholder?: string
  numberOfMonths?: number
}

export function DateRangePicker({
  dateRange,
  onDateRangeChange,
  className,
  placeholder = "Pick a date range",
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const selected: DateRange | undefined =
    dateRange.from || dateRange.to
      ? { from: dateRange.from, to: dateRange.to }
      : undefined

  const hasSelection = dateRange.from || dateRange.to

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-[240px] justify-start text-left font-normal h-8 text-xs",
              !hasSelection && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "LLL dd, y")} –{" "}
                  {format(dateRange.to, "LLL dd, y")}
                </>
              ) : (
                format(dateRange.from, "LLL dd, y")
              )
            ) : (
              <span>{placeholder}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            defaultMonth={dateRange.from}
            selected={selected}
            onSelect={(range) => {
              if (!range) {
                onDateRangeChange({})
                return
              }
              // Enforce to >= from: if user somehow picks to < from, ignore the to
              if (range.from && range.to && range.to < range.from) {
                onDateRangeChange({ from: range.from })
                return
              }
              onDateRangeChange({ from: range.from, to: range.to })
            }}
            disabled={(date) => {
              // When from is selected but to is not yet, disable dates before from
              // This enforces the to >= from constraint at the UI level
              if (selected?.from && !selected?.to) {
                return date < selected.from
              }
              return false
            }}
            numberOfMonths={numberOfMonths}
          />
        </PopoverContent>
      </Popover>
      {hasSelection && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onDateRangeChange({})}
          aria-label="Clear date range"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
