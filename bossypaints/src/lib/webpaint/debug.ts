import APP_CONFIG from './config';

/**
 * Debug utility for conditional console logging
 */
export const debug = {
    log: (...args: any[]) => {
        if (APP_CONFIG.debug) {
            console.log(...args);
        }
    },
    warn: (...args: any[]) => {
        if (APP_CONFIG.debug) {
            console.warn(...args);
        }
    },
    error: (...args: any[]) => {
        if (APP_CONFIG.debug) {
            console.error(...args);
        }
    },
    info: (...args: any[]) => {
        if (APP_CONFIG.debug) {
            console.info(...args);
        }
    }
};
