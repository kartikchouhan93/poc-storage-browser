"use client"

import * as React from "react"
import { Loader2, Minimize2, Maximize2, X, File, CheckCircle, AlertCircle, Pause, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUpload } from "@/components/providers/upload-provider"
import { useAuth } from "@/components/providers/AuthProvider"
import { cn } from "@/lib/utils"

export function GlobalUploadIndicator() {
    const { user } = useAuth()
    const { files, isUploading, pauseFile, resumeFile, retryFile, cancelFile, isIndicatorOpen, setIsIndicatorOpen } = useUpload()
    const [isMinimized, setIsMinimized] = React.useState(false)

    React.useEffect(() => {
        if (isUploading) setIsIndicatorOpen(true)
    }, [isUploading, setIsIndicatorOpen])

    const activeFiles = files.filter(f => f.status === 'uploading' || f.status === 'pending' || f.status === 'paused')
    const completedFiles = files.filter(f => f.status === 'complete' || f.status === 'error')

    if (!user || files.length === 0 || !isIndicatorOpen) return null

    const progressSum = files.reduce((acc, f) => acc + f.progress, 0)
    const totalProgress = files.length > 0 ? Math.round(progressSum / files.length) : 0

    return (
        <div className={cn(
            "fixed bottom-4 right-4 z-50 bg-background border rounded-lg shadow-lg transition-all duration-300 overflow-hidden",
            isMinimized ? "w-64" : "w-80 sm:w-96"
        )}>
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-muted/50 border-b">
                <div className="flex items-center gap-2">
                    {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    )}
                    <span className="text-sm font-medium">
                        {isUploading
                            ? `Uploading ${activeFiles.length} file${activeFiles.length !== 1 ? 's' : ''}`
                            : activeFiles.some(f => f.status === 'paused')
                                ? `${activeFiles.filter(f => f.status === 'paused').length} paused`
                                : "Uploads complete"}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsMinimized(!isMinimized)}>
                        {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsIndicatorOpen(false)}>
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            </div>

            {/* Expanded Content */}
            {!isMinimized && (
                <div className="max-h-60 overflow-y-auto p-2 space-y-2">
                    {files.map(file => (
                        <div key={file.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
                            <File className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm truncate font-medium">{file.name}</span>
                                    <span className="text-xs text-muted-foreground ml-1 shrink-0">{file.progress}%</span>
                                </div>
                                <Progress value={file.progress} className={cn("h-1",
                                    file.status === 'error' && "bg-destructive/20 [&>div]:bg-destructive",
                                    file.status === 'complete' && "bg-green-500/20 [&>div]:bg-green-500",
                                    file.status === 'paused' && "bg-yellow-500/20 [&>div]:bg-yellow-500"
                                )} />
                            </div>
                            {/* Status icons / retry controls */}
                            {file.status === 'error' && (
                                <div className="flex items-center gap-1 shrink-0">
                                    <AlertCircle className="h-4 w-4 text-destructive" />
                                    <Button
                                        variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                        onClick={() => retryFile(file.id)}
                                        title="Retry upload"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                    </Button>
                                </div>
                            )}
                            
                            {/* Complete icon */}
                            {file.status === 'complete' && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                            
                            {/* Pause / Resume / Cancel controls */}
                            {(file.status === 'uploading' || file.status === 'pending' || file.status === 'paused') && (
                                <div className="flex items-center gap-1 shrink-0">
                                    {file.status !== 'paused' ? (
                                        <Button
                                            variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                            onClick={() => pauseFile(file.id)}
                                            title="Pause upload"
                                        >
                                            <Pause className="h-3 w-3" />
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                            onClick={() => resumeFile(file.id)}
                                            title="Resume upload"
                                        >
                                            <Play className="h-3 w-3" />
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                        onClick={() => cancelFile(file.id)}
                                        title="Cancel upload"
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Minimized Progress Bar */}
            {isMinimized && isUploading && (
                <div className="p-2">
                    <Progress value={totalProgress} className="h-1" />
                </div>
            )}
        </div>
    )
}
