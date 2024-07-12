const { validateString, toArray, toBoolean } = require('../../util');
const SqlDatabase = require('better-sqlite3');
const assert = require('assert');

module.exports = {
    init: async function ({ database, query, dstProperty, single }) {
        dstProperty = validateString(dstProperty);
        single = toBoolean(single) || undefined;
        validateString(database);
        validateString(query);
        return { database, query, dstProperty, single };
    },

    convert: async function ({ database, query, dstProperty, single }, data) {
        const array = toArray(data);
        if (array.length > 0) {
            const db = new SqlDatabase(database, { readonly: true, fileMustExist: true });
            try {
                for (const srcObj of array) {
                    let sqlData = await db.prepare(query).all(srcObj);
                    if (single) {
                        assert(sqlData.length < 2);
                        sqlData = sqlData[0];
                    }
                    srcObj[dstProperty] = sqlData;
                }
            } finally {
                db.close();
            }
        }
        return data;
    }
};