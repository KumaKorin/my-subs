/**
 * 客户端全局状态管理模块
 */
import { AppData, Profile } from '../types/index.js'

let state: AppData = {
    globalBaseYaml: '',
    providersPool: [],
    profiles: [],
    publicOrigin: '',
    prefix: '',
    hasD1: false
}

let currentProfileId: string | null = null
type StateListener = (state: AppData, currentProfileId: string | null) => void
const listeners = new Set<StateListener>()

export function getState(): AppData {
    return state
}

export function setState(newState: Partial<AppData>): void {
    state = { ...state, ...newState }
    notifyListeners()
}

export function getCurrentProfileId(): string | null {
    return currentProfileId
}

export function setCurrentProfileId(id: string | null): void {
    currentProfileId = id
    notifyListeners()
}

export function getCurrentProfile(): Profile | null {
    if (!state.profiles || state.profiles.length === 0) return null
    return state.profiles.find(p => p.id === currentProfileId) || state.profiles[0]
}

export function updateCurrentProfile(updater: ((profile: Profile) => void) | Partial<Profile>): void {
    const profile = getCurrentProfile()
    if (!profile) return
    if (typeof updater === 'function') {
        updater(profile)
    } else if (typeof updater === 'object') {
        Object.assign(profile, updater)
    }
    notifyListeners()
}

export function subscribeState(listener: StateListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function notifyListeners(): void {
    for (const listener of listeners) {
        try {
            listener(state, currentProfileId)
        } catch (e) {
            console.error('State listener error:', e)
        }
    }
}
