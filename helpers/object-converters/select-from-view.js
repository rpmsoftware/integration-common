const { validateString, toArray, toBoolean, validatePropertyConfig, getDeepValue } = require('../../util');
const SqlDatabase = require('better-sqlite3');
const assert = require('assert');

const COL_FORM_ID = 'FormID';

module.exports = {
    init: async function ({ dstProperty, process, view, sqlTable, sqlColumns, query, parameters, single }) {
        validateString(dstProperty);
        process = (await this.api.getProcesses()).getActiveProcess(process, true);
        view = (await process.getViews()).Views.demand(({ Name }) => Name === view).ID;
        process = process.ProcessID;
        validateString(sqlTable);
        validateString(query);

        if (parameters || (parameters = undefined)) {
            const r = {};
            for (let name in parameters) {
                r[name] = validatePropertyConfig(parameters[name]);
            }
            parameters = r;
        }

        if (sqlColumns || (sqlColumns = undefined)) {
            const r = {};
            for (let name in sqlColumns) {
                assert.notStrictEqual(name, COL_FORM_ID);
                const idx = +sqlColumns[name];
                assert(!isNaN(idx));
                r[name] = idx;
            }
            sqlColumns = r;
        }
        single = toBoolean(single);
        return { dstProperty, process, view, sqlTable, sqlColumns, query, parameters, single };
    },

    convert: async function ({ dstProperty, process, view, sqlTable, sqlColumns, query, parameters, single }, data) {
        const db = new SqlDatabase();
        const columns = [COL_FORM_ID];
        const { Columns, Forms } = await this.api.getForms(process, view);
        if (sqlColumns) {
            for (const name in sqlColumns) {
                assert(Columns[sqlColumns[name]]);
                columns.push(name);
            }
        }
        db.table(sqlTable, {
            columns,
            rows: function* () {
                for (const { FormID, Values } of Forms) {
                    const result = {};
                    result[COL_FORM_ID] = FormID;
                    if (sqlColumns) {
                        for (let name in sqlColumns) {
                            result[name] = Values[sqlColumns[name]];
                        }
                    }
                    yield result;
                }
            },
        });

        const stmt = db.prepare(query);
        toArray(data).forEach(srcObj => {
            const params = {};
            if (parameters) {
                for (const name in parameters) {
                    const value = getDeepValue(srcObj, parameters[name]);
                    params[name] = (value === '' || value === undefined) ? null : value;
                }
            }
            srcObj[dstProperty] = single ? stmt.get(params) : stmt.all(params);
        });

        db.close();
        
        return data;
    }
};