const {
    getDeepValue, toBoolean, toArray, isEmpty, validateString, validatePropertyConfig, isEmptyValue
} = require('../../../util');
const assert = require('assert');
const { sheet_add_aoa } = require('xlsx').utils;

const REGEXP_WORDS_NUMBERS = /\W+/g;
const lowLettersNumbers = s => s.replace(REGEXP_WORDS_NUMBERS, '').toLowerCase();

const TYPES = { stub: 'z', string: 's', number: 'n', boolean: 'b' };

const getCellType = v => isEmptyValue(v) ? TYPES.stub : TYPES[typeof v] || TYPES.string;

class Row {
    #cells;
    values = {};

    constructor(cells) {
        this.#cells = cells;
        for (const k in this.#cells) {
            this.values[k] = this.#cells[k].v || undefined;
        }
    }

    set(key, value) {
        const cell = this.#cells[key];
        if (!cell) {
            return;
        }
        delete cell.w;
        if (isEmptyValue(value)) {
            cell.v = undefined;
            cell.t = TYPES.stub;
        } else {
            cell.v = value;
            cell.t = getCellType(value);
        }
        this.values[key] = cell.v;
    }

}

const loadBook = (book, columns, normalize) => {

    normalize = normalize ? v => lowLettersNumbers(v + '') : v => v + '';
    const cns = {};
    columns.forEach(c => {
        let { name } = c;
        c.id = name = validateString(normalize(name));
        cns[name] = c
    });
    const data = [];

    const loadSheet = sheet => {
        assert.strictEqual(typeof sheet, 'object');
        let header;
        let newColumnIdx = 0;
        sheet.forEach((row, rowIdx) => {
            if (!row) {
                return;
            }
            let match = 0;
            const columns = {};
            row.length < newColumnIdx || (newColumnIdx = row.length);
            row.forEach(({ v }, colIdx) => (v = normalize(v)) && cns[v] && (++match) && (columns[v] = colIdx));
            (!header || match > header.match) && (header = { rowIdx, match, columns });
        });
        const { columns, rowIdx: headerRowIdx, } = header;
        for (let c in cns) {
            const { name, required, create, id } = cns[c];
            if (columns[id] >= 0) {
                continue;
            }
            if (create) {
                sheet_add_aoa(sheet, [[name]], { origin: { r: headerRowIdx, c: newColumnIdx } });
                columns[id] = newColumnIdx;
                ++newColumnIdx;
            } else if (required) {
                throw `Column is required: "${name}"`;
            }
        }
        for (let rowIdx = headerRowIdx + 1; rowIdx < sheet.length; rowIdx++) {
            const row = sheet[rowIdx];
            if (!row) {
                return;
            }
            const cells = {};
            for (let id in columns) {
                const colIdx = columns[id];
                const cell = row[colIdx];
                cells[id] = cell || (row[colIdx] = { t: TYPES.stub });
            }
            isEmpty(cells) || data.push(new Row(cells));
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
        const cns = {};
        columns = toArray(columns).map(c => {
            let { name, required, create } = typeof c === 'object' ? c : { name: c, required: true };
            name = validateString(name);
            create = toBoolean(create) || undefined;
            required = !create && toBoolean(required) || undefined;
            assert(!cns[name]);
            return (cns[name] = { name, required, create });
        });
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