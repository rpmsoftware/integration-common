const { validateString, toArray, toBoolean, isEmptyValue } = require('../../util');
const assert = require('assert');

const DEFAULT_CONVERTER = 'getter';
const BREAK_TAG = Symbol();

async function init(conf) {
    const result = [];
    for (let c of conf ? toArray(conf) : []) {
        let { name, enabled, throwError, errorProperty } = c;
        if (enabled !== undefined && !toBoolean(enabled)) {
            continue;
        }
        name || (name = DEFAULT_CONVERTER);
        const { init } = OBJECT_CONVERTERS[name] || require('./' + name);
        c = init ? await init.call(this, c) : {};
        if (!c) {
            continue;
        }
        c.name || (c.name = name);
        c.throwError = throwError === undefined || toBoolean(throwError);
        c.errorProperty = errorProperty ? validateString(errorProperty) : undefined;
        result.push(c);
    }
    return result;
}

async function convert(conf, obj) {
    for (let c of conf) {
        const { name, throwError, errorProperty } = c;
        try {
            obj = await (OBJECT_CONVERTERS[name] || require('./' + name)).convert.call(this, c, obj);
            errorProperty && delete obj[errorProperty];
        } catch (error) {
            if (error === BREAK_TAG) {
                throw error;
            }
            if (errorProperty) {
                obj[errorProperty] = error;
            } else if (throwError) {
                throw error;
            }
            console.error(error);
        }
        if (isEmptyValue(obj) || toArray(obj).length < 1) {
            break;
        }
    }
    return obj;
}

const OBJECT_CONVERTERS = {

    break: {
        convert: () => {
            throw BREAK_TAG;
        }
    },

    blank: {
        init: function () {
            return {};
        },

        convert: function () {
            return {};
        }
    }


};

const addConverter = (name, init, convert) => {
    validateString(name);
    assert(typeof init, 'function');
    assert(typeof convert, 'function');
    OBJECT_CONVERTERS[name] = { init, convert };
};

module.exports = {
    init,
    addConverter,
    convert,
    convertBreakable: async function () {
        try {
            return await convert.apply(this, arguments)
        } catch (error) {
            if (error !== BREAK_TAG) {
                throw error;
            }
        }
    }
};