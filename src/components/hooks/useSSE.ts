/**
 * useSSE — React hook for Server-Sent Events connection.
 * Maintains a persistent connection to /api/events/stream and
 * dispatches job events to subscribers.
 */

import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../config';

export interface JobEvent {
    type: 'job_queued' | 'job_progress' | 'job_completed' | 'job_failed';
    jobId: string;
    jobType: string;
    targetId?: string;
    targetTitle?: string;
    progress?: number;
    progressMsg?: string;
    error?: string;
    metadata?: any;
    timestamp: string;
}

type SSEEventHandler = (event: JobEvent) => void;

const subscribers = new Set<SSEEventHandler>();

let globalEventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

function connectSSE(token: string): void {
    if (globalEventSource) return;

    const url = `${API_BASE_URL}/api/analyze-edital/events/stream`;
    
    // EventSource doesn't support custom headers, so we use a cookie-based approach
    // or pass the token as a query parameter for SSE
    const eventSource = new EventSource(`${url}?token=${encodeURIComponent(token)}`, {
        withCredentials: false,
    });

    globalEventSource = eventSource;

    const handleEvent = (e: MessageEvent) => {
        try {
            const data = JSON.parse(e.data) as JobEvent;
            subscribers.forEach(handler => handler(data));
        } catch (err) {
            console.warn('[SSE] Failed to parse event:', err);
        }
    };

    eventSource.addEventListener('job_queued', handleEvent);
    eventSource.addEventListener('job_progress', handleEvent);
    eventSource.addEventListener('job_completed', handleEvent);
    eventSource.addEventListener('job_failed', handleEvent);

    eventSource.addEventListener('connected', (e: MessageEvent) => {
        console.log('[SSE] Connected:', JSON.parse(e.data));
    });

    eventSource.onerror = () => {
        console.warn('[SSE] Connection lost — reconnecting in 5s...');
        eventSource.close();
        globalEventSource = null;
        
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => connectSSE(token), 5000);
    };
}

function disconnectSSE(): void {
    if (globalEventSource) {
        globalEventSource.close();
        globalEventSource = null;
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

/**
 * Hook to subscribe to SSE job events.
 * Call once in a top-level component (e.g., App.tsx).
 */
export function useSSE(onEvent?: SSEEventHandler) {
    const [isConnected, setIsConnected] = useState(false);
    const handlerRef = useRef(onEvent);
    handlerRef.current = onEvent;

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        const handler: SSEEventHandler = (event) => {
            handlerRef.current?.(event);
        };

        subscribers.add(handler);

        // Connect only once globally
        if (!globalEventSource) {
            connectSSE(token);
            setIsConnected(true);
        }

        return () => {
            subscribers.delete(handler);
            if (subscribers.size === 0) {
                disconnectSSE();
                setIsConnected(false);
            }
        };
    }, []);

    return { isConnected };
}

/**
 * Submit a background job and return the jobId.
 */
export async function submitBackgroundJob(params: {
    type: string;
    input: Record<string, any>;
    targetId?: string;
    targetTitle?: string;
}): Promise<{ jobId: string }> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE_URL}/api/jobs/submit`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit job');
    }

    return res.json();
}

/**
 * Fetch job result when completed.
 */
export async function fetchJobResult(jobId: string): Promise<any> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/result`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch job result');
    }

    const data = await res.json();
    return data.result;
}

/**
 * Fetch list of recent jobs.
 */
export async function fetchJobList(): Promise<any[]> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE_URL}/api/jobs`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) return [];
    return res.json();
}
