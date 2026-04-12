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

// ── Mock useToast globally ──
// This prevents "useToast must be used within ToastProvider" errors
// in hook tests that don't render the full component tree.
vi.mock('../components/ui/Toast', () => ({
    useToast: () => ({
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    }),
    ToastProvider: ({ children }: any) => children,
}));

vi.mock('../components/ui', async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return {
        ...actual,
        useToast: () => ({
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
        }),
        ToastProvider: ({ children }: any) => children,
    };
});
