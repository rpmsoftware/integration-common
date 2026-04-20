import assert from 'assert';

export const toArray = <T,>(x?: T[] | T): T[] => Array.isArray(x) ? x : (x ? [x] : []);

type Cache<T> = {
    value?: T
};

export const cachify = <T,>(callback: () => T | undefined, secTimeout: number) => {
    let cache: Cache<T> | undefined;
    secTimeout = +secTimeout;
    secTimeout = secTimeout > 0 ? secTimeout * 1000 : 0;
    let timestamp: number = 0;
    return (reset: boolean): Promise<T | undefined> => {
        if (reset || secTimeout && Date.now() - timestamp > secTimeout) {
            cache = undefined;
        }
        return cache ? Promise.resolve(cache.value) : Promise.resolve().then(callback).then(value => {
            cache = { value };
            timestamp = secTimeout && Date.now();
            return value;
        });
    };
};

export const assertInteger = (value: number, positive?: boolean) => {
    assert.strictEqual(typeof value, 'number');
    assert.strictEqual(value % 1, 0);
    positive && assert(value > 0);
    return value;
};
