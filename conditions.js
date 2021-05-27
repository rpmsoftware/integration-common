const assert = require('assert');
const { getEager, toBoolean, validateString, toArray, normalizeInteger, getDeepValue } = require('./util');
const { getField, toSimpleField, getFieldByUid, ISO_DATE_TIME_FORMAT } = require('./api-wrappers');
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
            const resultConf = init1.call(this, conf);
            resultConf.trim = toBoolean(conf.trim) || undefined;
            return resultConf;
        },
        process: function (data) {
            const { operand, trim } = this;
            let value = getOperandValue(operand, data);
            typeof value === 'string' && trim && (value = value.trim());
            return value === undefined || value === null || value === '';
        }

    },
    expired: {
        init: function (conf) {
            const resultConf = init1.call(this, conf);
            resultConf.format = conf.format ? validateString(conf.format) : ISO_DATE_TIME_FORMAT;
            let fvc = resultConf.increment = initOperand.call(this, conf.increment);
            if (fvc) {
                fvc.value = fvc.value && normalizeInteger(fvc.value);
                resultConf.unit = validateString(getEager(conf, 'unit'));
            }
            return resultConf;
        },
        process: function (form) {
            const conf = this;
            form = form.Form || form;
            const value = getOperandValue(conf.operand, form);
            const m = moment(value, conf.format);
            if (!m.isValid()) {
                throw new Error(`Cannot parse date "${value}". Format: "${conf.format}"`);
            }
            let ic = conf.increment;
            let increment;
            if (ic) {
                if (ic.field) {
                    increment = toSimpleField(getFieldByUid.call(form, ic.field.Uid, true)).Value;
                    increment = increment ? normalizeInteger(increment) : 0;
                } else {
                    increment = ic.value;
                }
            }
            increment && m.add(increment, conf.unit);
            const now = moment();
            return now.isSame(m) || now.isAfter(m);
        }
    },
    formStatus: {
        init: function (conf) {
            let statuses = {};
            for (let status of toArray(getEager(conf, 'statuses'))) {
                const { ID, Text } = this.StatusLevels.demand(s => s.Text === status);
                statuses[ID] = { ID, Text };
            }
            statuses = Object.values(statuses);
            assert(statuses.length > 0);
            return { statuses };
        },
        process: function (form) {
            form = form.Form || form;
            let prop, formStatus;
            if (form.hasOwnProperty('StatusID')) {
                prop = 'ID';
                formStatus = form.StatusID;
            } else {
                prop = 'Text';
                formStatus = form.Status;
            }
            return !!this.statuses.find(s => s[prop] === formStatus);
        }
    },
};

const trimField = ({ Name, Uid }) => ({ Name, Uid });

const DEFAULT_FIELD_PROPERTY = 'Value';

function initOperand(config) {
    if (!config) {
        return;
    }
    if (typeof config === 'string') {
        config = { field: config };
    }
    assert.strictEqual(typeof config, 'object');
    const { field, property, value } = config;
    let resultConfig;
    if (field) {
        resultConfig = {
            field: (this && Array.isArray(this.Fields)) ? trimField(getField.call(this, field, true)) : { Uid: validateString(field) },
            property: property ? validateString(property) : DEFAULT_FIELD_PROPERTY
        };
    } else if (property) {
        resultConfig = { property: toArray(property).map(validateString) };
    } else {
        assert(value !== undefined, '"property", "field" or "value" is required');
        resultConfig = { value };
    }
    return resultConfig;
}

function init1({ operand }) {
    typeof operand === 'string' && (operand = { field: operand });
    assert.strictEqual(typeof operand, 'object');
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
        assert(property);
        result = toSimpleField(getFieldByUid.call(form, field.Uid || field, true))[property];
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
        debug('Condition is disabled: ', conf);
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
    const { operator, not, message } = conf;
    const { init } = getEager(OPERATORS, operator);
    const result = init ? init.call(this, conf) : {};
    result.operator = operator;
    result.message = message || undefined;
    result.not = toBoolean(not) || undefined
    return result;
}

function process(conf, form) {
    const { not, message, operator } = conf;
    let result = getEager(OPERATORS, operator).process.call(conf, form);
    not && (result = !result);
    !result && debug('Condition is not met:', message || operator);
    return result;
}

module.exports = { init, process };