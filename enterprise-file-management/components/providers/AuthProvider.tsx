
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { jwtDecode } from 'jwt-decode';

interface TenantAssignment {
    userId: string;
    tenantId: string;
    tenantName: string;
    role: string;
}

interface User {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
    tenantName?: string;
    policies?: any[];
    teams?: any[];
    tenants?: TenantAssignment[];
}

interface AuthContextType {
    user: User | null;
    login: (token: string, userData: User, redirectPath?: string) => void;
    logout: () => void;
    loading: boolean;
    activeTenantId: string | null;
    tenants: TenantAssignment[];
    switchTenant: (tenantId: string) => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    login: () => { },
    logout: () => { },
    loading: true,
    activeTenantId: null,
    tenants: [],
    switchTenant: () => { },
});

function setActiveTenantCookie(tenantId: string) {
    document.cookie = `x-active-tenant-id=${tenantId}; path=/; SameSite=Strict`;
}

function clearActiveTenantCookie() {
    document.cookie = `x-active-tenant-id=; path=/; SameSite=Strict; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
    const router = useRouter();

    const logout = useCallback(async () => {
        // Clear server-side httpOnly cookies
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (_) { /* best-effort */ }

        // Clear client-side storage
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        localStorage.removeItem('activeTenantId');
        clearActiveTenantCookie();
        setUser(null);
        setActiveTenantId(null);
        router.push('/login');
    }, [router]);

    const switchTenant = useCallback((tenantId: string) => {
        localStorage.setItem('activeTenantId', tenantId);
        setActiveTenantCookie(tenantId);
        setActiveTenantId(tenantId);
        window.location.reload();
    }, []);

    // Attempt a silent token refresh using the httpOnly refreshToken cookie.
    // Returns the new accessToken string on success, or null on failure.
    const tryRefresh = useCallback(async (): Promise<string | null> => {
        try {
            const res = await fetch('/api/auth/refresh', { method: 'POST' });
            if (!res.ok) return null;
            const data = await res.json();
            return data.accessToken ?? null;
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        async function initAuth() {
            // Read activeTenantId from localStorage on init
            const storedActiveTenantId = localStorage.getItem('activeTenantId');

            const storedToken = localStorage.getItem('accessToken');
            const storedUser = localStorage.getItem('user');

            if (storedToken && storedUser) {
                try {
                    const decoded: any = jwtDecode(storedToken);
                    const isExpired = decoded.exp * 1000 < Date.now();

                    if (!isExpired) {
                        const parsedUser = JSON.parse(storedUser);

                        // Determine activeTenantId: localStorage value or fallback to user.tenantId
                        const resolvedTenantId = storedActiveTenantId ?? parsedUser.tenantId ?? null;
                        setActiveTenantId(resolvedTenantId);
                        if (resolvedTenantId) {
                            setActiveTenantCookie(resolvedTenantId);
                        }

                        setUser(parsedUser);

                        // Silently refresh user data (including new policies/teams/tenants) in background
                        fetch('/api/auth/me', {
                            headers: resolvedTenantId ? { 'x-active-tenant-id': resolvedTenantId } : {}
                        })
                            .then(res => res.ok ? res.json() : null)
                            .then(data => {
                                if (data && data.email) {
                                    setUser(data);
                                    localStorage.setItem('user', JSON.stringify(data));
                                }
                            })
                            .catch(() => {});

                        // Schedule a proactive refresh ~1 minute before expiry
                        const msUntilExpiry = decoded.exp * 1000 - Date.now();
                        const refreshIn = Math.max(msUntilExpiry - 60_000, 0);
                        const timer = setTimeout(async () => {
                            const newToken = await tryRefresh();
                            if (newToken) {
                                localStorage.setItem('accessToken', newToken);
                            } else {
                                await logout();
                            }
                        }, refreshIn);
                        setLoading(false);
                        return () => clearTimeout(timer);
                    }

                    // Token expired — try refresh
                    const newToken = await tryRefresh();
                    if (newToken) {
                        localStorage.setItem('accessToken', newToken);
                        const parsedUser = JSON.parse(storedUser);
                        const resolvedTenantId = storedActiveTenantId ?? parsedUser.tenantId ?? null;
                        setActiveTenantId(resolvedTenantId);
                        if (resolvedTenantId) setActiveTenantCookie(resolvedTenantId);
                        setUser(parsedUser);
                    } else {
                        localStorage.removeItem('accessToken');
                        localStorage.removeItem('user');
                        localStorage.removeItem('activeTenantId');
                        clearActiveTenantCookie();
                        router.push('/login');
                    }
                } catch {
                    // Malformed token — try refresh as a fallback
                    const newToken = await tryRefresh();
                    if (!newToken) {
                        localStorage.removeItem('accessToken');
                        localStorage.removeItem('user');
                        localStorage.removeItem('activeTenantId');
                        clearActiveTenantCookie();
                        router.push('/login');
                    }
                }
            } else {
                // No localStorage — check if server httpOnly cookie still has a valid session
                try {
                    const res = await fetch('/api/auth/me', {
                        headers: storedActiveTenantId ? { 'x-active-tenant-id': storedActiveTenantId } : {}
                    });
                    if (res.ok) {
                        const userData = await res.json();
                        const resolvedTenantId = storedActiveTenantId ?? userData.tenantId ?? null;
                        setActiveTenantId(resolvedTenantId);
                        if (resolvedTenantId) setActiveTenantCookie(resolvedTenantId);
                        setUser(userData);
                    }
                    // If 401, user is simply not logged in — stay null, proxy will redirect
                } catch { /* network error — stay null */ }
            }

            setLoading(false);
        }

        initAuth();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const login = (token: string, userData: User, redirectPath: string = '/') => {
        // Store token client-side for JWT decode / expiry checks
        localStorage.setItem('accessToken', token);
        localStorage.setItem('user', JSON.stringify(userData));

        // Set activeTenantId from user data on login
        const resolvedTenantId = userData.tenantId ?? null;
        if (resolvedTenantId) {
            localStorage.setItem('activeTenantId', resolvedTenantId);
            setActiveTenantCookie(resolvedTenantId);
        }
        setActiveTenantId(resolvedTenantId);
        setUser(userData);
        
        // Clear all bot diagnostics on login (fresh start)
        fetch('/api/bot/clear-diagnostics', { method: 'POST' }).catch(() => {});
        
        // Note: the login API already set accessToken + refreshToken as httpOnly cookies
        window.location.href = redirectPath;
    };

    return (
        <AuthContext.Provider value={{
            user,
            login,
            logout,
            loading,
            activeTenantId,
            tenants: user?.tenants ?? [],
            switchTenant,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
