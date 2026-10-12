import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/hooks/use-auth';
import { isTokenExpired } from '@/context/AuthContext';
import { toast } from '@/hooks/use-toast';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false });

export const useSocket = () => useContext(SocketContext);

const getSocketUrl = () => {
    let url = '/';
    if (import.meta.env.VITE_WS_BASE_URL) {
        url = import.meta.env.VITE_WS_BASE_URL;
    }
    
    // Fix for "Invalid namespace" error:
    // If the URL ends with /api, Socket.IO tries to connect to the "/api" namespace.
    // Our server only has the default "/" namespace.
    // We strip /api to ensure we connect to the root namespace.
    return url.replace(/\/api\/?$/, '');
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isAuthenticated, logout } = useAuth();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        if (!isAuthenticated || !user) {
            if (socketRef.current) {
                console.log('[SocketProvider] Disconnecting socket due to logout');
                socketRef.current.disconnect();
                socketRef.current = null;
                setSocket(null);
                setIsConnected(false);
            }
            return;
        }

        if (socketRef.current && socketRef.current.connected) {
            // Already connected
            return;
        }

        const token = localStorage.getItem('auth_token');
        if (!token || isTokenExpired(token)) {
            console.warn('[SocketProvider] Token missing or expired, logging out');
            logout();
            return;
        }

        const socketUrl = getSocketUrl();
        console.log('[SocketProvider] Connecting to', socketUrl);

        const newSocket = io(socketUrl, {
            auth: { token },
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket', 'polling'],
        });

        newSocket.on('connect', () => {
            console.log('[SocketProvider] Connected');
            setIsConnected(true);
        });

        newSocket.on('connect_error', (err: any) => {
            console.error('[SocketProvider] Connection error:', err);
            const isAuthError =
                err.message === 'Authentication failed' ||
                err?.data?.code === 'AUTH_INVALID' ||
                err?.data?.code === 'AUTH_MISSING';
            if (isAuthError) {
                toast({ title: 'Session Expired', description: 'Please log in again.', variant: 'destructive' });
                newSocket.disconnect();
                socketRef.current = null;
                setSocket(null);
                setIsConnected(false);
                logout();
            }
        });

        newSocket.on('disconnect', (reason) => {
            console.log('[SocketProvider] Disconnected:', reason);
            setIsConnected(false);
        });

        newSocket.on('reconnect', (attemptNumber) => {
            console.log('[SocketProvider] Reconnected after', attemptNumber, 'attempts');
            setIsConnected(true);
        });

        socketRef.current = newSocket;
        setSocket(newSocket);

        return () => {
            // Don't disconnect on re-render, only on actual unmount or user change
        };
    }, [isAuthenticated, user]);

    useEffect(() => {
        // Cleanup on unmount of the entire provider (app close)
        return () => {
            if (socketRef.current) {
                console.log('[SocketProvider] Cleanup disconnect');
                socketRef.current.disconnect();
            }
        };
    }, []);

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
        </SocketContext.Provider>
    );
};
