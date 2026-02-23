// src/lib/store.ts
export const sessionStore = new Map<string, any>(); 
export const userState = new Map<string, 'IDLE' | 'TESTING'>();