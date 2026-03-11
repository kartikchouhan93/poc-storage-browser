"use client"

import * as React from "react"
import { JsonView, allExpanded, defaultStyles } from "react-json-view-lite"
import "react-json-view-lite/dist/index.css"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle } from "lucide-react"

interface JsonViewerProps {
  content: string
}

export function JsonViewer({ content }: JsonViewerProps) {
  const parsed = React.useMemo(() => {
    try {
      const data = JSON.parse(content)
      return { valid: true as const, data }
    } catch {
      return { valid: false as const }
    }
  }, [content])

  if (!parsed.valid) {
    return (
      <div className="w-full max-h-[70vh] overflow-auto">
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Not valid JSON
          </Badge>
        </div>
        <pre className="bg-muted/30 p-4 rounded-md border font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </pre>
      </div>
    )
  }

  return (
    <div className="w-full max-h-[70vh] overflow-auto bg-muted/30 p-4 rounded-md border text-sm">
      <JsonView
        data={parsed.data}
        shouldExpandNode={allExpanded}
        clickToExpandNode
        style={{
          ...defaultStyles,
          container: "font-mono leading-relaxed",
        }}
      />
    </div>
  )
}
