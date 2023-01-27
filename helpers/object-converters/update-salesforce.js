const { toBoolean, validateString, toArray, getEager, validatePropertyConfig, getDeepValue } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const SalesforceAPI = require('../../salesforce-api');
const assert = require('assert');
const { render } = require('mustache');

const ERR_NOT_UNIQUE = 'More then one record returned';

module.exports = {

    init: async function (conf) {
        let { dstProperty, api, type, condition, create, getObjectID, fieldMap: inFieldMap } = conf;
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        validateString(type);
        validateString(api);
        assert.strictEqual(typeof getEager(this.globals, api), 'object');
        condition = condition ? initCondition(condition) : undefined;
        create = toBoolean(create) || undefined;
        const fieldMap = {};
        let notEmpty = false;
        for (let k in inFieldMap) {
            fieldMap[k] = validatePropertyConfig(inFieldMap[k]);
            notEmpty = true;
        }
        assert(notEmpty);
        {
            let { property, query } = getObjectID;
            if (property) {
                property = validatePropertyConfig(property);
                query = undefined;
            } else {
                query = validateString(query);
                property = undefined;
            }
            getObjectID = { property, query }
        }
        return { dstProperty, api, type, getObjectID, condition, create, fieldMap };
    },

    convert: async function ({ dstProperty, api, type, condition, getObjectID, fieldMap }, obj) {
        const { globals } = this.parentContext || this;

        let sfApi = getEager(globals, api);
        if (!(sfApi instanceof SalesforceAPI)) {
            sfApi = globals[api] = new SalesforceAPI(sfApi);
        }

        let { property: objIdProperty, query } = getObjectID;

        if (objIdProperty) {
            getObjectID = e => getDeepValue(e, objIdProperty);
        } else {
            query = `select Id from ${type} where ${query}`;
            getObjectID = async e => {
                const q = render(query, e);
                const result = await sfApi.query(q);
                assert(result.length < 2, ERR_NOT_UNIQUE);
                return result[0]?.Id;
            };
        }

        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const id = await getObjectID(e);
            if (!id) {
                continue;
            }
            const data = {};
            for (const k in fieldMap) {
                data[k] = getDeepValue(e, fieldMap[k]);
            }
            await sfApi.updateSObject(type, id, data);
            dstProperty && (e[dstProperty] = await sfApi.getSObject(type, id));
        }

        return obj;
    }

};
