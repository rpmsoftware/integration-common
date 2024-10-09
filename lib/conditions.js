const assert = require('assert');
const {
    getEager, toBoolean, validateString, toArray, normalizeInteger,
    getDeepValue, toMoment, validatePropertyConfig, demandDeepValue, isEmptyValue,
    isEmpty
} = require('./util');
const {
    getField, toSimpleField, getFieldByUid, ISO_DATE_TIME_FORMAT
} = require('./api-wrappers');
const operators = require('operators');
const moment = require('dayjs');
const debug = require('debug')('rpm:conditions');

function initMulti({ operands }) {
    assert(Array.isArray(operands));
    const result = [];
    operands.forEach(o => {
        const c = init.call(this, o);
        c && result.push(c);
    });
    return { operands: result };
}

function isTrue(form) {
    return toBoolean(getOperandValue(this.operand, form));
}

const REGEX_NOT_LETTERS = /\W+/g;

const OPERATORS = {
    and: {
        init: initMulti,
        process: function (form) {
            const { operands } = this;
            form = form.Form || form;
            let result = operands.length > 0;
            for (let c of operands) {
                result = result && process(c, form);
                if (!result) {
                    break;
                }
            }
            return result;
        }
    },
    or: {
        init: initMulti,
        process: function (form) {
            const { operands } = this;
            form = form.Form || form;
            let result = false;
            for (let c of operands) {
                result = result || process(c, form);
                if (result) {
                    break;
                }
            }
            return result;
        }
    },
    'true': {
        init: init1,
        process: isTrue
    },
    'false': {
        init: init1,
        process: function (form) { return !isTrue.call(this, form); }
    },

    empty: {
        init: function (conf) {
            const { trim, objects } = conf;
            const resultConf = init1.call(this, conf);
            resultConf.trim = toBoolean(trim) || undefined;
            resultConf.objects = toBoolean(objects) || undefined;
            return resultConf;
        },
        process: function (data) {
            const { operand, trim, objects } = this;
            let value = getOperandValue(operand, data);
            const t = typeof value;
            trim && t === 'string' && (value = value.trim());
            objects && t === 'object' && isEmpty(value) && (value = undefined);
            return isEmptyValue(value);
        }
    },

    expired: {
        init: function (conf) {
            const resultConf = init1.call(this, conf);
            resultConf.format = conf.format ? validateString(conf.format) : ISO_DATE_TIME_FORMAT;
            let fvc = resultConf.increment = conf.increment ? initOperand.call(this, conf.increment) : undefined;
            if (fvc) {
                fvc.value = fvc.value && normalizeInteger(fvc.value);
                resultConf.unit = validateString(getEager(conf, 'unit'));
            }
            return resultConf;
        },
        process: function (form) {
            const { operand, format, increment: ic, unit } = this;
            form = form.Form || form;
            const value = getOperandValue(operand, form);
            let m = moment(value, format);
            if (!m.isValid()) {
                throw new Error(`Cannot parse date "${value}". Format: "${format}"`);
            }
            let increment;
            if (ic) {
                increment = getOperandValue(ic, form);
                increment = increment ? normalizeInteger(increment) : 0;
            }
            increment && (m = m.add(increment, unit));
            const now = moment();
            return now.isSame(m) || now.isAfter(m);
        }
    },
    formStatus: {
        init: function ({ statuses: inStatuses, oldStatus }) {
            let statuses = {};
            for (let status of toArray(inStatuses)) {
                const { ID, Text } = this.StatusLevels.demand(s => s.Text === status);
                statuses[ID] = { ID, Text };
            }
            statuses = Object.values(statuses);
            assert(statuses.length > 0);
            if (oldStatus || (oldStatus = undefined)) {
                typeof oldStatus === 'string' && (oldStatus = { field: oldStatus });
            }
            return { statuses, oldStatus };
        },
        process: function (form) {
            let { statuses, oldStatus } = this;
            form = form.Form || form;
            let prop, formStatus;
            if (form.hasOwnProperty('StatusID')) {
                prop = 'ID';
                formStatus = form.StatusID;
            } else {
                prop = 'Text';
                formStatus = form.Status;
            }
            if (oldStatus) {
                oldStatus = getOperandValue(oldStatus, form);
                oldStatus = +oldStatus || oldStatus;
                if (oldStatus === formStatus) {
                    return false;
                }
            }
            return !!statuses.find(s => s[prop] === formStatus);
        }
    },

    oneOfValues: {
        init: function (conf) {
            const result = init1.call(this, conf);
            let { values } = conf;
            assert(values, '"values" is a required parameter');
            values = toArray(values);
            assert(values.length > 0, '"values" array is empty');
            result.values = values;
            return result;
        },
        process: function (data) {
            const { operand, values } = this;
            return values.indexOf(getOperandValue(operand, data)) >= 0;
        }
    },
    equalNumbers: {
        init: init2,
        process: function (form) {
            const { operand1, operand2 } = this;
            form = form.Form || form;
            const value1 = +getOperandValue(operand1, form);
            const value2 = +getOperandValue(operand2, form);
            return !isNaN(value1) && value1 === value2;
        }
    },
    equalBooleans: {
        init: init2,
        process: function (form) {
            const { operand1, operand2 } = this;
            form = form.Form || form;
            return toBoolean(getOperandValue(operand1, form)) === toBoolean(getOperandValue(operand2, form));
        }
    },
    equalDates: {
        init: init2,
        process: function (form) {
            const { operand1, operand2 } = this;
            form = form.Form || form;
            let value1 = toMoment(getOperandValue(operand1, form) || null);
            let value2 = toMoment(getOperandValue(operand2, form) || null);
            return value1.isSame(value2);
        }
    },
    equal: {
        init: init2,
        process: function (form) {
            const { operand1, operand2 } = this;
            form = form.Form || form;
            return getOperandValue(operand1, form) == getOperandValue(operand2, form);
        }
    },
    dateAfter: {
        init: function (conf) {
            const { equal } = conf;
            const result = init2.call(this, conf);
            toBoolean(equal) && (result.equal = true);
            return result;
        },
        process: function (form) {
            const { operand1, operand2, equal } = this;
            form = form.Form || form;
            let value1 = getOperandValue(operand1, form);
            let value2 = getOperandValue(operand2, form);
            value1 = toMoment(value1 || null);
            value2 = toMoment(value2 || null);
            return value1.isAfter(value2) || equal && value1.isSame(value2);
        }
    },
    exists: {
        init: function ({ array, condition }) {
            array = validatePropertyConfig(array);
            condition = init.call(this, condition);
            return { array, condition };
        },
        process: function (form) {
            let { array, condition } = this;
            let a = demandDeepValue(form, array);
            assert(Array.isArray(a), `Array is expected: ${array}`);
            return a.findIndex(e => process(condition, { parent: form, child: e })) >= 0;
        }
    },
    regexp: {
        init: function (conf) {
            const { regexp, flags } = conf;
            conf = init1.call(this, conf);
            conf.regexp = validateString(regexp);
            conf.flags = flags ? validateString(flags) : undefined;
            return conf;
        },
        process: function (data) {
            let { operand, regexp, flags } = this;
            regexp instanceof RegExp || (regexp = this.regexp = new RegExp(regexp, flags));
            return regexp.test(getOperandValue(operand, data) + '');
        }
    },

    all: {
        init: function ({ collection, condition }) {
            collection = validatePropertyConfig(collection);
            condition = init.call(this, condition);
            return { collection, condition };
        },
        process: function (data) {
            let { collection, condition } = this;
            collection = getDeepValue(data, collection);
            assert(typeof Array.isArray(collection));
            for (let e in collection) {
                if (!process(condition, collection[e])) {
                    return false;
                }
            }
            return true;
        }
    },

    equalKeys: {
        init: init2,

        process: function process2numbers(data) {
            const { operand1, operand2 } = this;
            const value1 = getOperandValue(operand1, data);
            const value2 = getOperandValue(operand2, data);
            if (value1 === undefined || value2 === undefined) {
                return false;
            }
            return value1 === value2 ||
                typeof value1 === 'string' &&
                typeof value2 === 'string' &&
                value1.replace(REGEX_NOT_LETTERS, '').toLowerCase() === value2.replace(REGEX_NOT_LETTERS, '').toLowerCase();
        }

    }


};

const DEFAULT_FIELD_PROPERTY = 'Value';

function initOperand(config) {
    Array.isArray(config) && (config = { property: config });
    typeof config === 'string' && (config = Array.isArray(this.Fields) ? { field: config } : { property: config });
    assert.strictEqual(typeof config, 'object');
    let { field, property, value } = config;
    let resultConfig;
    if (field) {
        resultConfig = {
            field: (this && Array.isArray(this.Fields)) ? getField.call(this, field, true).Uid : validateString(field),
            property: property ? validateString(property) : undefined
        };
    } else if (property) {
        property = toArray(property);
        assert(property.length > 0);
        property.forEach(p => typeof p === 'object' || validateString(p));
        resultConfig = { property };
    } else {
        assert(value !== undefined, '"property", "field" or "value" is required');
        resultConfig = { value };
    }
    return resultConfig;
}

function init1({ operand }) {
    return {
        operand: initOperand.call(this, operand)
    }
}

function init2({ operand1, operand2 }) {
    return {
        operand1: initOperand.call(this, operand1),
        operand2: initOperand.call(this, operand2)
    };
}

function getOperandValue({ field, property, value }, form) {
    form = form.Form || form;
    let result;
    if (value !== undefined) {
        result = value;
    } else if (field) {
        result = toSimpleField(getFieldByUid.call(form, field, true))[property || DEFAULT_FIELD_PROPERTY];
    } else {
        assert(property);
        result = getDeepValue(form, property);
    }
    return result;
}

function process2(form) {
    const { operator, operand1, operand2 } = this;
    form = form.Form || form;
    const value1 = getOperandValue(operand1, form);
    const value2 = getOperandValue(operand2, form);
    return operators[operator](value1, value2);
}

function process2numbers(form) {
    const { operator, operand1, operand2 } = this;
    form = form.Form || form;
    const value1 = getOperandValue(operand1, form);
    const value2 = getOperandValue(operand2, form);
    return operators[operator](+value1, +value2);
}

['eq2', 'neq2'].forEach(o => {
    getEager(operators, o);
    OPERATORS[o] = {
        init: init2,
        process: process2
    };
});

['gt2', 'lt2', 'gte2', 'lte2'].forEach(o => {
    getEager(operators, o);
    OPERATORS[o] = {
        init: init2,
        process: process2numbers
    };
});

function init(conf) {
    if (conf.enabled !== undefined && !toBoolean(conf.enabled)) {
        debug('Condition is disabled: %j', conf);
        return;
    }
    if (typeof conf === 'string') {
        conf = { operator: conf };
    } else if (Array.isArray(conf)) {
        conf = {
            operator: "and",
            operands: conf
        }
    }
    const { operator, not, description } = conf;
    const { init } = getEager(OPERATORS, operator);
    const result = init ? init.call(this, conf) : {};
    result.operator = operator;
    result.description = description || undefined;
    result.not = toBoolean(not) || undefined
    return result;
}

function process(conf, form) {
    const { not, operator, description } = conf;
    let result = getEager(OPERATORS, operator).process.call(conf, form);
    not && (result = !result);
    result || description && debug(`Condition "${description}" is not met`);
    return result;
}

module.exports = {
    init,
    process
};