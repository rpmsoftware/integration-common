const { validateString, toArray, toBoolean, validatePropertyConfig, getDeepValue } = require('../../util');
const { getGlobalDB } = require('./sqlite-select');
const assert = require('assert');

const COL_FORM_ID = 'FormID';

module.exports = {
    init: async function ({ dstProperty, sqlTables: inSqlTables, sqlTable, process, view, sqlColumns, query, parameters, single }) {
        validateString(dstProperty);
        const processes = await this.api.getProcesses();
        inSqlTables || ((inSqlTables = {})[validateString(sqlTable)] = { process, view, sqlColumns });
        const sqlTables = [];
        for (const sqlTable in inSqlTables) {
            let { process, view, sqlColumns, enabled } = inSqlTables[sqlTable];
            if (enabled !== undefined && !toBoolean(enabled)) {
                continue;
            }
            process = processes.getActiveProcess(process, true);
            view = view ? (await process.getViews()).Views.demand(({ Name }) => Name === view).ID : undefined;
            process = process.ProcessID;
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
            sqlTables.push({ process, view, sqlTable, sqlColumns });
        }
        assert(sqlTables.length > 0);
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

    convert: async function ({ dstProperty, sqlTables, query, parameters, single }, data) {
        const db = getGlobalDB();

        for (const { process, view, sqlTable, sqlColumns } of sqlTables) {
            const columns = [COL_FORM_ID];
            const { Columns, Forms } = await this.api.getForms(process, view);
            if (sqlColumns) {
                const { length } = Forms;
                for (const name in sqlColumns) {
                    length > 0 && assert(Columns[sqlColumns[name]]);
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
        }

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