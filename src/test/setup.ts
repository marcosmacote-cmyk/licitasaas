import '@testing-library/jest-dom';

// Mock localStorage
const localStorageMock: Record<string, string> = {};
Object.defineProperty(window, 'localStorage', {
    value: {
        getItem: vi.fn((key: string) => localStorageMock[key] || null),
        setItem: vi.fn((key: string, value: string) => { localStorageMock[key] = value; }),
        removeItem: vi.fn((key: string) => { delete localStorageMock[key]; }),
        clear: vi.fn(() => { Object.keys(localStorageMock).forEach(k => delete localStorageMock[k]); }),
    },
    writable: true,
});

// Mock clipboard
Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
});

// Mock Notification
Object.defineProperty(window, 'Notification', {
    value: class { static permission = 'granted'; static requestPermission = vi.fn(); },
    writable: true,
});

// Mock Audio
Object.defineProperty(window, 'Audio', {
    value: class { loop = false; play = vi.fn().mockResolvedValue(undefined); pause = vi.fn(); currentTime = 0; },
    writable: true,
});

// Global fetch mock
global.fetch = vi.fn();
