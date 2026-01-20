// src/hooks/useApiClient.js
import { useCallback, useMemo } from 'react';

// 백엔드 베이스 URL (dev는 로컬 서버로 폴백)
const CORE =
  import.meta.env.VITE_CORE_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:4000' : '');

export function useApiClient() {
    const apiRequest = useCallback(async (method, url, data = null) => {
        const config = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (data) {
            config.body = JSON.stringify(data);
        }

        const response = await fetch(`${CORE}${url}`, config);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }, []);

    return useMemo(() => ({
        get: (url) => apiRequest('GET', url),
        post: (url, data) => apiRequest('POST', url, data),
        put: (url, data) => apiRequest('PUT', url, data),
        delete: (url) => apiRequest('DELETE', url),
    }), [apiRequest]);
}
