import assert from 'assert';

const RE_NON_LETTERS = /\W+/g;
export const lowerLettersOnly = (s: string) => s.replace(RE_NON_LETTERS, '').toLowerCase();

export const getTrigrams = (str: string, tgSize: number = 3) => {
    const result = new Set();
    assert(tgSize > 2);
    for (const word of str.trim().toLowerCase().split(RE_NON_LETTERS)) {
        if (!word) continue;
        let { length } = word;
        length -= tgSize;
        if (length <= 0) {
            result.add(word);
            continue;
        }
        for (let ii = 0; ii <= length; ii++) {
            result.add(word.slice(ii, ii + tgSize));
        }
    }
    return result;
};

export const diceSimilarity = (str1: string, str2: string, size?: number) => {
    if (!str1 || !str2) return 0.0;
    if (str1 === str2) return 1.0;
    const set1 = getTrigrams(str1, size);
    const set2 = getTrigrams(str2, size);
    let intersection = 0;
    for (const trigram of set1) {
        if (set2.has(trigram)) {
            intersection++;
        }
    }
    const totalSize = set1.size + set2.size;
    return totalSize === 0 ? 0.0 : intersection * 2 / totalSize;
};