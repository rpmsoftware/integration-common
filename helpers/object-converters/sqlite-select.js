const { validateString, toArray, toBoolean, validatePropertyConfig, getDeepValue, isEmpty } = require('../../util');
const SqlDatabase = require('better-sqlite3');
const assert = require('assert');
const debug = require('debug')('rpm:sqlite-select');

module.exports = {
    init: function ({ dstProperty, sqlTables: inSqlTables, query, parameters, single }) {
        validateString(dstProperty);
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
        validateString(query);
        if (parameters || (parameters = undefined)) {
            const r = {};
            for (let name in parameters) {
                r[name] = validatePropertyConfig(parameters[name]);
            }
            parameters = r;
        }
        single = toBoolean(single);
        return { dstProperty, sqlTables, query, parameters, single };
    },

    convert: function ({ dstProperty, sqlTables, query, parameters, single }, data) {
        const db = new SqlDatabase(undefined, { verbose: debug });

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
                        columns.forEach(c => result[c] = getDeepValue(row, sqlColumns[c]));
                        yield result;
                    }
                }
            });
        }

        const stmt = db.prepare(query);
        for (srcObj of toArray(data)) {
            const params = {};
            if (parameters) {
                for (const name in parameters) {
                    const value = getDeepValue(srcObj, parameters[name]);
                    params[name] = (value === '' || value === undefined) ? null : value;
                }
            }
            srcObj[dstProperty] = single ? stmt.get(params) : stmt.all(params);
        }

        db.close();

        return data;
    }
};