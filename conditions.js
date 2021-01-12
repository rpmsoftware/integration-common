const assert = require('assert');
const { getEager, toBoolean, validateString, toArray, normalizeInteger } = require('./util');
const { getField, toSimpleField, getFieldByUid, ISO_DATE_TIME_FORMAT } = require('./api-wrappers');
const operators = require('operators');
const moment = require('dayjs');
const debug = require('debug')('rpm:contitions');

function initMulti(conf) {
    const fields = this;
    const operands = [];
    assert(Array.isArray(conf.operands));
    conf.operands.forEach(o => {
        const c = init.call(fields, o);
        c && operands.push(c);
    });
    return { operands };
}

function isTrue(form) {
    return toBoolean(getOperandValue(this.operand, form));
}

function initIsEmpty(conf) {
    const resultConf = init1.call(this, conf);
    resultConf.trim = toBoolean(conf.trim);
    return resultConf;
}

function isEmpty(data) {
    let value = getOperandValue(this.operand, data);
    typeof value === 'string' && this.trim && (value = value.trim());
    return value === undefined || value === null || value === '';
}

const OPERATORS = {
    and: {
        init: initMulti,
        process: function (form) {
            const conf = this;
            form = form.Form || form;
            let result = conf.operands.length > 0;
            for (let c of conf.operands) {
                result = operators.and2(result, process(c, form));
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
            const conf = this;
            form = form.Form || form;
            let result = false;
            for (let c of conf.operands) {
                result = operators.or2(result, process(c, form));
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
        init: initIsEmpty,
        process: isEmpty
    },
    notEmpty: {
        init: initIsEmpty,
        process: function (form) { return !isEmpty.call(this, form); }
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
            const statuses = {};
            for (let status of toArray(getEager(conf, 'statuses'))) {
                const { ID, Text } = this.StatusLevels.demand(s => s.Text === status);
                statuses[ID] = { ID, Text };
            }
            const resultConf = { statuses: Object.values(statuses), not: !!conf.not || undefined };
            assert(resultConf.statuses.length > 0);
            return resultConf;
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
            const result = !!this.statuses.find(s => s[prop] === formStatus);
            return this.not ? !result : result;
        }
    },
};

const trimField = (field) => (({ Name, Uid }) => ({ Name, Uid }))(field);

const DEFAULT_FIELD_PROPERTY = 'Value';

function initOperand(config) {
    if (!config) {
        return;
    }
    if (typeof config === 'string') {
        config = { field: config };
    }
    assert.strictEqual(typeof config, 'object');
    let resultConfig;
    if (config.field) {
        resultConfig = {
            field: trimField(getField.call(this, config.field, true)),
            property: config.property ? validateString(config.property) : DEFAULT_FIELD_PROPERTY
        };
    } else if (config.property) {
        resultConfig = { property: validateString(config.property) };
    } else {
        assert(config.value !== undefined, '"property", "field" or "value" is required');
        resultConfig = { value: config.value };
    }
    return resultConfig;
}

function init1(conf) {
    const fields = this;
    const result = { operator: conf.operator };
    let operandConfig = getEager(conf, 'operand');
    if (typeof operandConfig === 'string') {
        operandConfig = { field: operandConfig };
    }
    assert.strictEqual(typeof operandConfig, 'object');
    result.operand = initOperand.call(fields, operandConfig);
    return result;
}

function init2(conf) {
    const result = { operator: conf.operator };
    ['operand1', 'operand2'].forEach(p => result[p] = initOperand.call(this, getEager(conf, p)));
    return result;
}

function getOperandValue(operandConfig, form) {
    form = form.Form || form;
    let result;
    const { field, property, value } = operandConfig;
    if (value !== undefined) {
        result = value;
    } else if (field) {
        assert(property);
        result = toSimpleField(getFieldByUid.call(form, field.Uid || field, true))[property];
    } else {
        assert(property);
        result = form[property];
    }
    return result;
}

function process2(form) {
    const conf = this;
    form = form.Form || form;
    const value1 = getOperandValue(conf.operand1, form);
    const value2 = getOperandValue(conf.operand2, form);
    const result = operators[conf.operator](value1, value2);
    return result;
}

function process2numbers(form) {
    const conf = this;
    form = form.Form || form;
    const value1 = getOperandValue(conf.operand1, form);
    const value2 = getOperandValue(conf.operand2, form);
    const result = operators[conf.operator](+value1, +value2);
    return result;
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
    const { operator } = conf;
    const initializer = getEager(OPERATORS, operator).init;
    const result = initializer ? initializer.call(this, conf) : {};
    result.operator = operator;
    result.message = conf.message || undefined;
    return result;
}

function process(conf, form) {
    const result = getEager(OPERATORS, conf.operator).process.call(conf, form);
    !result && debug('Condition is not met:', conf.message || conf.operator);
    return result;
}

module.exports = { init, process };