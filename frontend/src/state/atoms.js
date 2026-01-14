import { atom } from 'jotai';
import { atomWithQuery } from 'jotai-tanstack-query';

const CORE = import.meta.env.VITE_CORE_BASE_URL //|| 'http://localhost:4000';
const fetchJson = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return Array.isArray(j) ? j : j.data ?? [];
};

/* ───────────────── 인증 상태 ───────────────── */
export const sessionIdAtom = atom(localStorage.getItem('sessionId') || null);
export const isLoggedInAtom = atom(false);
export const userInfoAtom = atom({ userType: null, loginTime: null });

/* ───────────────── 맵 목록 ───────────────── */
export const mapsQueryAtom = atomWithQuery(() => ({
    queryKey: ['maps'],
    queryFn: () => fetchJson(`${CORE}/api/maps`),
    staleTime: 10_000,
}));

/* ───────────────── 로봇 목록 ──────────────── */
export const robotsQueryAtom = atomWithQuery(() => ({
    queryKey: ['robots'],
    queryFn: () => fetchJson(`${CORE}/api/robots`),
    refetchInterval: 200,
}));

/* ───────────────── 선택 맵 ──────────────────
 *  1순위: is_current === true
 *  2순위: 목록 첫 번째                                   */
const _sel = atom(null);
export const selectedMapAtom = atom(
    (get) => {
        const explicit = get(_sel);
        if (explicit) return explicit;

        const list = get(mapsQueryAtom).data ?? [];
        const current = list.find((m) => m.is_current);
        return current ?? list[0] ?? null;
    },
    (_get, set, next) => set(_sel, next)
);