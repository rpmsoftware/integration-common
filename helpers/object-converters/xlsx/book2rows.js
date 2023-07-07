const { 
    getDeepValue, toBoolean, toArray, isEmpty, validateString, validatePropertyConfig
 } = require('../../../util');
const assert = require('assert');

const REGEXP_WORDS_NUMBERS = /\W+/g;
const lowLettersNumbers = s => s.replace(REGEXP_WORDS_NUMBERS, '').toLowerCase();

const TYPE_STUB = 'z';

class Row {
    #cells;
    values = {};

    constructor(cells) {
        this.#cells = cells;
        for (const k in this.#cells) {
            this.values[k] = this.#cells[k].v;
        }
    }

    set(key, value) {
        const cell = this.#cells[key];
        if (!cell) {
            return;
        }
        if (value === undefined || value === null || value === '') {
            cell.v = undefined;
            cell.t = TYPE_STUB;
        } else {
            cell.v = value;
            cell.t = 's';
        }
        this.values[key] = cell.v;
    }

}

const loadBook = (book, columns, normalize) => {

    normalize = normalize ? v => lowLettersNumbers(v + '') : v => v + '';
    const cns = {};
    columns.forEach(n => {
        let { name, required } = typeof n === 'object' ? n : { name: n, required: true };
        name = validateString(normalize(name));
        assert(!cns[name]);
        cns[name] = { name, required, n };
    });

    const data = [];

    const loadSheet = sheet => {
        assert.strictEqual(typeof sheet, 'object');
        let header;
        sheet.forEach((row, rowIdx) => {
            if (!row) {
                return;
            }
            let match = 0;
            const columns = {};
            row.forEach(({ v }, colIdx) => (v = normalize(v)) && cns[v] && (++match) && (columns[v] = colIdx));
            (!header || match > header.match) && (header = { row: rowIdx, match, columns });
        });
        const { columns, row: headerRow } = header;
        for (let c in cns) {
            const { name, required } = cns[c];
            required && assert(columns[name] >= 0, `Column is required: "${name}"`);
        }
        for (let rowIdx = headerRow + 1; rowIdx < sheet.length; rowIdx++) {
            const row = sheet[rowIdx];
            if (!row) {
                return;
            }
            const cells = {};
            for (let columnName in columns) {
                const colIdx = columns[columnName];
                const cell = row[colIdx];
                cells[columnName] = cell || (row[colIdx] = { t: TYPE_STUB });
            }
            if (!isEmpty(cells)) {
                data.push(new Row(cells));
                // break;
            }
        }
    };

    const { Sheets } = book;
    for (let name in Sheets) {
        loadSheet(Sheets[name]);
    }
    return data;
};

module.exports = {
    init: async function ({ srcProperty, dstProperty, columns, normalize }) {
        validateString(dstProperty);
        srcProperty = validatePropertyConfig(srcProperty);
        columns = toArray(columns).map(validateString);
        assert(columns.length > 0);
        normalize = toBoolean(normalize) || undefined;
        return { srcProperty, dstProperty, columns, normalize };
    },

    convert: async function ({ srcProperty, dstProperty, columns, normalize }, data) {
        toArray(data).forEach(e => {
            const d = getDeepValue(e, srcProperty);
            d && (e[dstProperty] = loadBook(d, columns, normalize));
        });
        return data;
    }
};