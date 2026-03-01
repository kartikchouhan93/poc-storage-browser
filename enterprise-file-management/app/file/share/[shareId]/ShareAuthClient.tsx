"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function ShareAuthClient({ shareId, requiresPassword }: { shareId: string, requiresPassword: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(`/api/shares/${shareId}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }
      
      setSent(true);
      toast({
        title: "Magic Link Sent",
        description: "Check your email for the secure access link.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Card className="w-full max-w-md mx-auto mt-20 shadow-lg border-t-4 border-t-green-500">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-green-100 rounded-full text-green-600">
              <ShieldCheck className="w-10 h-10" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Check your email</CardTitle>
          <CardDescription>
            We've sent a magic link to <strong>{email}</strong>. Click the link in the email to access the file. The link expires in 15 minutes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto mt-20 shadow-xl border-t-4 border-t-blue-600">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Secure File Access</CardTitle>
        <CardDescription>
          This file is protected. Please verify your identity to continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleRequestAccess} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
              <Input 
                id="email" 
                type="email" 
                placeholder="you@example.com" 
                className="pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          
          {requiresPassword && (
            <div className="space-y-2">
              <Label htmlFor="password">Access Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
                <Input 
                  id="password" 
                  type="password" 
                  placeholder="Enter password" 
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          )}
          
          <Button type="submit" className="w-full py-6 text-md mt-4" disabled={loading}>
            {loading ? "Verifying..." : "Request Access Link"}
            {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
