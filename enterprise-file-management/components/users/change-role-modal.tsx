"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateUserRole } from "@/app/actions/users";
import { Role } from "@/lib/generated/prisma/client";

interface ChangeRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onSuccess: () => void;
}

export function ChangeRoleModal({ isOpen, onClose, user, onSuccess }: ChangeRoleModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<Role | "">(user?.role || "");

  async function handleSave() {
    if (!user || user.id === undefined) return;
    if (!role) {
      toast.error("Please select a role");
      return;
    }

    try {
      setIsLoading(true);
      const result = await updateUserRole(user.id, role as Role);

      if (result.success) {
        toast.success("Role updated successfully");
        onSuccess();
        onClose();
      } else {
        toast.error(result.error || "Failed to update role");
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
          <DialogDescription>
            Update the role for {user?.name || user?.email}. This determines their access level in the tenant.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Select value={role} onValueChange={(val) => setRole(val as Role)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TENANT_ADMIN">Tenant Admin</SelectItem>
              <SelectItem value="TEAMMATE">Teammate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading || role === user?.role}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
