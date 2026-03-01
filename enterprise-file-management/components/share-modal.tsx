"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Copy } from "lucide-react"

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: any
}

export function ShareModal({ open, onOpenChange, file }: ShareModalProps) {
  const [loading, setLoading] = React.useState(false)
  const [toEmail, setToEmail] = React.useState("")
  const [expiryDays, setExpiryDays] = React.useState("7")
  const [downloadLimit, setDownloadLimit] = React.useState("5")
  const [password, setPassword] = React.useState("")
  const [shareUrl, setShareUrl] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setToEmail("")
      setExpiryDays("7")
      setDownloadLimit("5")
      setPassword("")
      setShareUrl("")
    }
  }, [open])

  const handleShare = async () => {
    if (!toEmail) return toast.error("Email is required")
    
    setLoading(true)
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          toEmail,
          expiryDays: parseInt(expiryDays, 10),
          downloadLimit: parseInt(downloadLimit, 10),
          password
        })
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("File shared successfully! Email sent to the recipient.")
        setShareUrl(data.shareUrl)
      } else {
        toast.error(data.error || "Failed to share file")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to share file")
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl)
    toast.success("Link copied to clipboard")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share "{file?.name}"</DialogTitle>
          <DialogDescription>
            Create a secure access link and email it to the recipient.
          </DialogDescription>
        </DialogHeader>
        
        {shareUrl ? (
          <div className="space-y-4 py-4">
            <div className="p-3 bg-green-50 border border-green-100 rounded-md text-green-800 text-sm">
              Share link created successfully! An email has been sent.
            </div>
            <div className="space-y-2">
              <Label>Share URL</Label>
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly />
                <Button variant="outline" size="icon" onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button className="w-full mt-4" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="toEmail">Recipient Email*</Label>
              <Input
                id="toEmail"
                type="email"
                placeholder="colleague@example.com"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="expiryDays">Valid For (Days)*</Label>
                <Input
                  id="expiryDays"
                  type="number"
                  min="1"
                  max="365"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="downloadLimit">Download Limit*</Label>
                <Input
                  id="downloadLimit"
                  type="number"
                  min="1"
                  max="100"
                  value={downloadLimit}
                  onChange={(e) => setDownloadLimit(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2 pt-2">
              <Label htmlFor="password">Protect with Password (Optional)</Label>
              <Input
                id="password"
                type="password"
                placeholder="Leave blank for no password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                If provided, the recipient must enter this password to request their Magic Link.
              </p>
            </div>
          </div>
        )}
        
        {!shareUrl && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleShare} disabled={loading || !toEmail}>
              {loading ? "Creating..." : "Create Share Link"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
