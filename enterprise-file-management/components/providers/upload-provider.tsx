
"use client"

import * as React from "react"
import { toast } from "sonner"
import { fetchWithAuth } from "@/lib/api"

export interface UploadFile {
    id: string
    name: string
    size: number
    progress: number
    status: "pending" | "uploading" | "paused" | "complete" | "error" | "cancelled"
    file: File
    bucketId: string
    parentId: string | null
    uploadId?: string
    key?: string
}

interface UploadContextType {
    files: UploadFile[]
    addFiles: (files: File[], bucketId: string, parentId: string | null) => void
    removeFile: (id: string) => void
    pauseFile: (id: string) => void
    resumeFile: (id: string) => void
    retryFile: (id: string) => void
    cancelFile: (id: string) => void
    isUploading: boolean
    isIndicatorOpen: boolean
    setIsIndicatorOpen: (isOpen: boolean) => void
}

const UploadContext = React.createContext<UploadContextType | undefined>(undefined)

export function useUpload() {
    const context = React.useContext(UploadContext)
    if (!context) {
        throw new Error("useUpload must be used within an UploadProvider")
    }
    return context
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
    const [files, setFiles] = React.useState<UploadFile[]>([])
    const [isProcessing, setIsProcessing] = React.useState(false)
    const [isIndicatorOpen, setIsIndicatorOpen] = React.useState(false)
    const pausedRef = React.useRef<Set<string>>(new Set())
    const cancelledRef = React.useRef<Set<string>>(new Set())
    const abortControllersRef = React.useRef<Record<string, AbortController[]>>({})

    // Constants
    const PART_SIZE = 20 * 1024 * 1024; // 20MB
    const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
    const CONCURRENCY = 3;

    const addFiles = (newFiles: File[], bucketId: string, parentId: string | null) => {
        const directories = new Set<string>();

        const uploadFiles: UploadFile[] = newFiles.map((f, i) => {
            const pathName = f.webkitRelativePath || f.name;
            if (f.webkitRelativePath) {
                const parts = f.webkitRelativePath.split('/');
                let currentPath = "";
                for (let j = 0; j < parts.length - 1; j++) {
                    currentPath = currentPath ? `${currentPath}/${parts[j]}` : parts[j];
                    directories.add(currentPath);
                }
            }

            return {
                id: `upload-${Date.now()}-${i}`,
                name: pathName,
                size: f.size,
                progress: 0,
                status: "pending",
                file: f,
                bucketId,
                parentId
            };
        });

        // Explicitly create 0-byte folder objects in S3
        Array.from(directories).forEach(async (dir) => {
            try {
                await fetchWithAuth('/api/files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: dir,
                        isFolder: true,
                        bucketId,
                        parentId
                    })
                });
            } catch (err) {
                console.error("Failed to pre-create folder", dir, err);
            }
        });

        setFiles((prev) => [...prev, ...uploadFiles])
        setIsIndicatorOpen(true)
    }

    const removeFile = (id: string) => {
        setFiles((prev) => prev.filter((f) => f.id !== id))
    }

    const pauseFile = (id: string) => {
        pausedRef.current.add(id)
        setFiles(prev => prev.map(f => f.id === id && (f.status === 'uploading' || f.status === 'pending') ? { ...f, status: 'paused' } : f))
        
        if (abortControllersRef.current[id]) {
            abortControllersRef.current[id].forEach(c => c.abort())
            abortControllersRef.current[id] = []
        }
    }

    const resumeFile = (id: string) => {
        pausedRef.current.delete(id)
        setFiles(prev => prev.map(f => f.id === id && f.status === 'paused' ? { ...f, status: 'pending' } : f))
    }

    const retryFile = (id: string) => {
        setFiles(prev => prev.map(f => {
            if (f.id === id && f.status === 'error') {
                // If it's a multipart upload that failed, we could keep the progress or reset.
                // Resetting to pending will naturally invoke `uploadMultipart` which fetches status and resumes.
                return { ...f, status: 'pending' }
            }
            return f
        }))
    }

    const cancelFile = async (id: string) => {
        cancelledRef.current.add(id)
        
        if (abortControllersRef.current[id]) {
            abortControllersRef.current[id].forEach(c => c.abort())
            abortControllersRef.current[id] = []
        }
        
        const fileToCancel = files.find(f => f.id === id)

        if (fileToCancel) {
            // Optimistically remove from UI
            setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'cancelled' } : f))
            
            if (fileToCancel.uploadId && fileToCancel.key) {
                try {
                    await fetchWithAuth('/api/files/multipart/abort', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bucketId: fileToCancel.bucketId,
                            key: fileToCancel.key,
                            uploadId: fileToCancel.uploadId
                        })
                    })
                } catch (error) {
                    console.error("Failed to abort multipart upload on cancellation:", error)
                }
            }
        }
        
        // Remove file entirely after a short delay so the user sees the 'cancelled' state briefly, or remove immediately
        setTimeout(() => {
            removeFile(id)
            cancelledRef.current.delete(id)
        }, 1000)
    }

    // Effect to process the queue
    React.useEffect(() => {
        if (isProcessing) return

        const pendingFile = files.find(f => f.status === 'pending')
        if (pendingFile) {
            processFile(pendingFile)
        }
    }, [files, isProcessing])

    const processFile = async (fileItem: UploadFile) => {
        setIsProcessing(true)

        // Mark as uploading
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'uploading' } : f))

        try {
            if (fileItem.size >= MULTIPART_THRESHOLD) {
                await uploadMultipart(fileItem)
            } else {
                await uploadSimple(fileItem)
            }

            // If we paused or cancelled during the upload, do not mark as complete.
            if (pausedRef.current.has(fileItem.id) || cancelledRef.current.has(fileItem.id)) {
                return;
            }

            setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'complete', progress: 100 } : f))
            toast.success(`Uploaded ${fileItem.name}`, { 
                description: 'Processing... The file will appear shortly.',
                duration: 10000,
                position: 'top-right'
            })

        } catch (error) {
            // Do not show error toasters if the user intentionally cancelled or paused but an error threw
            if (pausedRef.current.has(fileItem.id) || cancelledRef.current.has(fileItem.id)) {
                return;
            }
            console.error(error)
            setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'error', progress: 0 } : f))
            toast.error(`Failed to upload ${fileItem.name}`, { 
                duration: 5000,
                position: 'top-right'
            })
        } finally {
            setIsProcessing(false) // Trigger effect to pick up next file
        }
    }

    const uploadSimple = async (fileItem: UploadFile) => {
        // 1. Get Presigned URL
        const presignRes = await fetchWithAuth(`/api/files/presigned?bucketId=${fileItem.bucketId}&name=${encodeURIComponent(fileItem.name)}&parentId=${fileItem.parentId || ''}&contentType=${fileItem.file.type || 'application/octet-stream'}`)

        if (!presignRes.ok) throw new Error('Failed to get upload URL')

        const { url, key } = await presignRes.json()

        // 2. Upload to S3
        const uploadRes = await fetch(url, {
            method: 'PUT',
            body: fileItem.file,
            headers: {
                'Content-Type': fileItem.file.type || 'application/octet-stream'
            }
        })

        if (!uploadRes.ok) throw new Error('Failed to upload to S3')

        // DB record is now created asynchronously by the file-sync Lambda
        // via S3 ObjectCreated event → SQS → Lambda pipeline.
    }

    const uploadMultipart = async (fileItem: UploadFile) => {
        // 1. Client Internet Speed Logic to optimize chunk size
        let uploadSpeedMbps = 5; // Default fallback: 10 Mbps
        if (typeof navigator !== "undefined" && (navigator as any).connection) {
            const conn = (navigator as any).connection;
        console.log(`[Multipart Upload] Starting upload speed ${conn.downlink}-${Math.max(1, conn.downlink / 3)}`);

            if (conn.downlink) {
                // downlink is in Mbps. Assume upload is roughly 1/3 of download on typical asymmetrical links.
                // Clamp it to a minimum of 1 Mbps to avoid making chunks too tiny on spotty networks.
                uploadSpeedMbps = Math.max(1, conn.downlink / 3);
            }
        }

        // Calculate chunk size to ensure each chunk uploads comfortably within ~120 seconds.
        // We divide the bandwidth by CONCURRENCY because parts are uploaded in parallel.
        // This keeps chunks smaller on slow networks, reducing the penalty of a network drop.
        const bytesPerSecond = (uploadSpeedMbps * 1024 * 1024) / 8;
        const targetChunkSize = Math.floor((bytesPerSecond / CONCURRENCY) * 120); 

        // Clamp between S3 minimum (5MB) and a reasonable max (100MB)
        let currentPartSize = Math.max(5 * 1024 * 1024, Math.min(targetChunkSize, 100 * 1024 * 1024));
        
        // Ensure we don't exceed the 10,000 S3 part limit
        if (fileItem.size / currentPartSize > 9900) {
            currentPartSize = Math.ceil(fileItem.size / 9900);
        }
        
        const totalParts = Math.ceil(fileItem.size / currentPartSize);

        console.log(`[Multipart Upload] Starting upload for ${fileItem.name}`);
        console.log(`[Multipart Upload] Estimated Client Upload Speed: ${uploadSpeedMbps.toFixed(2)} Mbps`);
        console.log(`[Multipart Upload] Total File Size: ${(fileItem.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`[Multipart Upload] Dynamic Chunk Size: ${(currentPartSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`[Multipart Upload] Total Chunks: ${totalParts}`);

        // Generate deterministic file signature
        const fileHash = btoa(encodeURIComponent(`${fileItem.bucketId}-${fileItem.parentId || 'root'}-${fileItem.name}-${fileItem.size}-${fileItem.file.lastModified}`));

        // 1. Check existing status
        const statusRes = await fetchWithAuth('/api/files/multipart/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileHash })
        });
        
        let uploadId: string | undefined;
        let key: string | undefined;
        let parts: { ETag: string, PartNumber: number }[] = [];
        
        if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.active) {
                uploadId = statusData.uploadId;
                key = statusData.key;
                parts = statusData.parts || [];
            }
        }

        // 2. Initiate Multipart if no active upload found
        if (!uploadId) {
            const initRes = await fetchWithAuth('/api/files/multipart/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bucketId: fileItem.bucketId,
                    name: fileItem.name,
                    type: fileItem.file.type || "application/octet-stream",
                    parentId: fileItem.parentId,
                    fileHash
                })
            });

            if (!initRes.ok) throw new Error('Failed to initiate multipart upload');
            const initData = await initRes.json();
            uploadId = initData.uploadId;
            key = initData.key;
        }

        // Save uploadId and key immediately to state so it can be aborted if needed
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, uploadId, key } : f));

        let completedPartsCount = parts.length;
        
        if (completedPartsCount > 0) {
            const percent = Math.round((completedPartsCount / totalParts) * 100);
            setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, progress: percent } : f));
        }

        const uploadPart = async (partNumber: number) => {
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    const start = (partNumber - 1) * currentPartSize;
                    const end = Math.min(start + currentPartSize, fileItem.size);
                    const chunk = fileItem.file.slice(start, end);

                    const signRes = await fetchWithAuth('/api/files/multipart/sign-part', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bucketId: fileItem.bucketId, key, uploadId, partNumber })
                    });

                    if (!signRes.ok) throw new Error(`Failed to sign part ${partNumber}`);
                    const { url } = await signRes.json();

                    const controller = new AbortController()
                    if (!abortControllersRef.current[fileItem.id]) {
                        abortControllersRef.current[fileItem.id] = []
                    }
                    abortControllersRef.current[fileItem.id].push(controller)

                    const uploadRes = await fetch(url, {
                        method: 'PUT',
                        body: chunk,
                        signal: controller.signal
                    });

                    if (!uploadRes.ok) throw new Error(`Failed to upload part ${partNumber}`);

                    const removeQuotes = (str: string) => str.replace(/^"|"$/g, '');
                    const etag = removeQuotes(uploadRes.headers.get('ETag') || '');
                    if (!etag) throw new Error(`No ETag for part ${partNumber}`);

                    parts.push({ PartNumber: partNumber, ETag: etag });
                    completedPartsCount++;

                    const percent = Math.round((completedPartsCount / totalParts) * 100);
                    setFiles(prev => prev.map(f => {
                        if (f.id === fileItem.id) {
                            return { ...f, progress: percent };
                        }
                        return f;
                    }));
                    
                    return; // Success, exit retry loop
                    
                } catch (error: any) {
                    if (error.name === 'AbortError') {
                        throw error; // Bubble up instantly, no retry
                    }
                    attempts++;
                    console.warn(`Chunk ${partNumber} failed. Attempt ${attempts} of ${maxAttempts}. Error:`, error);
                    if (attempts >= maxAttempts) throw error;
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts))); // Exponential backoff
                }
            }
        };

        const allPartNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
        const remainingPartNumbers = allPartNumbers.filter(num => !parts.some(p => p.PartNumber === num));

        // Upload remaining parts in concurrent batches — stop if paused
        for (let i = 0; i < remainingPartNumbers.length; i += CONCURRENCY) {
            if (cancelledRef.current.has(fileItem.id)) {
                return
            }
            if (pausedRef.current.has(fileItem.id)) {
                setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'paused' } : f))
                return
            }
            const batch = remainingPartNumbers.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(partNum => uploadPart(partNum)));
        }

        parts.sort((a, b) => a.PartNumber - b.PartNumber);

        // 3. Complete Multipart Upload
        const completeRes = await fetchWithAuth('/api/files/multipart/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bucketId: fileItem.bucketId,
                key,
                uploadId,
                parts,
                name: fileItem.name,
                size: fileItem.size,
                mimeType: fileItem.file.type || "application/octet-stream",
                parentId: fileItem.parentId,
                fileHash
            })
        });

        if (!completeRes.ok) throw new Error('Failed to complete multipart upload');
    }

    const isUploading = files.some(f => f.status === 'uploading' || f.status === 'pending')

    return (
        <UploadContext.Provider value={{ 
            files, addFiles, removeFile, pauseFile, resumeFile, retryFile, cancelFile, 
            isUploading, isIndicatorOpen, setIsIndicatorOpen 
        }}>
            {children}
        </UploadContext.Provider>
    )
}
