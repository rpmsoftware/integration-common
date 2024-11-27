const { validateString, toArray, toBoolean, validatePropertyConfig, getDeepValue, isEmpty, getGlobal } = require('../../util');
const SqlDatabase = require('better-sqlite3');
const assert = require('assert');
const debug = require('debug')('rpm:sqlite-select').bind(undefined, '%s');

const PROP_DB = Symbol();

const fixType = (() => {
    const fixers = {
        boolean: v => v ? 1 : 0
    };
    const self = v => v;
    return v => (fixers[typeof v] || self)(v);
})();

const getGlobalDB = () => {
    const gl = getGlobal();
    return gl[PROP_DB] || (gl[PROP_DB] = new SqlDatabase(undefined, { verbose: debug }));
};

module.exports = {
    getGlobalDB,

    init: function ({ sqlTables: inSqlTables, queries: inQueries, dstProperty, query, parameters, single }) {

        inSqlTables || (inSqlTables = {});
        const sqlTables = [];
        for (const sqlTable in inSqlTables) {
            let { srcProperty, sqlColumns: sqlColumnsConf, enabled } = inSqlTables[sqlTable];
            if (enabled !== undefined && !toBoolean(enabled)) {
                continue;
            }
            srcProperty = validatePropertyConfig(srcProperty);
            const sqlColumns = {};
            for (let name in sqlColumnsConf) {
                sqlColumns[name] = validatePropertyConfig(sqlColumnsConf[name]);
            }
            assert(!isEmpty(sqlColumns));
            sqlTables.push({ sqlTable, sqlColumns, srcProperty });
        }

        inQueries || (inQueries = { dstProperty, query, parameters, single });
        const queries = [];
        toArray(inQueries).forEach(({ dstProperty, query, parameters, single, enabled }) => {
            if (enabled !== undefined && !toBoolean(enabled)) {
                return;
            }
            single = toBoolean(single) || undefined;
            if (dstProperty) {
                validateString(dstProperty);
            } else {
                assert(single);
                dstProperty = undefined;
            }
            if (parameters || (parameters = undefined)) {
                const r = {};
                for (let name in parameters) {
                    r[name] = validatePropertyConfig(parameters[name]);
                }
                parameters = r;
            }
            queries.push({ dstProperty, query, parameters, single });
        });

        assert(queries.length > 0);

        return { sqlTables, queries };
    },

    convert: function ({ sqlTables, queries }, data) {
        const db = getGlobalDB();

        let srcObj;

        for (const { sqlTable, sqlColumns, srcProperty } of sqlTables) {
            const columns = Object.keys(sqlColumns);
            db.table(sqlTable, {
                columns,
                rows: function* () {
                    const data = getDeepValue(srcObj, srcProperty) || [];
                    for (const key in data) {
                        const row = data[key];
                        const result = {};
                        columns.forEach(c => result[c] = fixType(getDeepValue(row, sqlColumns[c])));
                        yield result;
                    }
                }
            });
        }

        const stmts = queries.map(({ query }) => db.prepare(query));
        for (srcObj of toArray(data)) {
            queries.forEach(({ dstProperty, parameters, single }, idx) => {
                const params = {};
                if (parameters) {
                    for (const name in parameters) {
                        const value = getDeepValue(srcObj, parameters[name]);
                        params[name] = (value === '' || value === undefined) ? null : value;
                    }
                }
                const stmt = stmts[idx];
                const r = single ? stmt.get(params) : stmt.all(params);
                dstProperty ? (srcObj[dstProperty] = r) : Object.assign(srcObj, r);
            });
        }

        // db.close();

        return data;
    }
};