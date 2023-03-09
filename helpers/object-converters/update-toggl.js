const { toBoolean, validateString, toArray, getEager, validatePropertyConfig, getDeepValue } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const TogglAPI = require('../../toggl');
const assert = require('assert');

module.exports = {

    init: async function ({ dstProperty, api, type, condition, create, idProperty, propertyMap: inPropertyMap }) {
        validateString(dstProperty);
        TogglAPI.validateType(type);
        idProperty = idProperty ? validatePropertyConfig(idProperty) : undefined;
        validateString(api);
        assert.strictEqual(typeof getEager(this.globals, api), 'object');
        condition = condition ? initCondition(condition) : undefined;
        create = toBoolean(create) || undefined;
        create || assert(idProperty, '"idProperty" is required');
        const propertyMap = {};
        let notEmpty = false;
        for (let k in inPropertyMap) {
            propertyMap[k] = validatePropertyConfig(inPropertyMap[k]);
            notEmpty = true;
        }
        assert(notEmpty);
        return { dstProperty, api, type, condition, idProperty, create, propertyMap };
    },

    convert: async function ({ dstProperty, api, type, condition, idProperty, create, propertyMap }, obj) {
        const { globals } = this.parentContext || this;

        let togglApi = getEager(globals, api);
        if (!(togglApi instanceof TogglAPI)) {
            togglApi = globals[api] = new TogglAPI(togglApi);
        }

        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            const id = idProperty && getDeepValue(e, idProperty);
            if (!id && !create) {
                continue;
            }
            const data = {};
            for (const k in propertyMap) {
                data[k] = getDeepValue(e, propertyMap[k]) || null;
            }
            let togglObj;
            try {
                togglObj = id && await togglApi.editEntity(type, id, data);
            } catch (e) {
                if (e.status !== TogglAPI.STATUS_NOT_FOUND) {
                    throw e;
                }
            }
            togglObj || create && (togglObj = await togglApi.createEntity(type, data));
            e[dstProperty] = togglObj;
        }

        return obj;
    }

};
