const assert = require('assert');
const FIELD_ACCESSORS = exports.FIELD_ACCESSORS = {};

function getFieldValue(procField, formField) {
    if (formField === undefined) {
        formField = procField;
        procField = this;
    }
    assert.equal(procField.Uid, formField.Uid);
    let accessor = FIELD_ACCESSORS[procField.FieldType];
    accessor = accessor && accessor[procField.SubType];
    assert(accessor, `No field accessor for FieldType=${procField.FieldType}, SubType=${procField.SubType}`)
    return accessor.getValue(formField, procField);
}

exports.getFieldValue = getFieldValue;

(() => {

    const rpmUtil = require('./util');
    const { FIELD_TYPE, getFieldByUid } = require('./api-wrappers');
    const norm = require('./normalizers');

    let f, subTypes, st;

    f = function (formField) {
        return formField.ID || null;
    };


    st = FIELD_ACCESSORS[FIELD_TYPE.FormReference.value] = {};
    subTypes = FIELD_TYPE.FormReference.subTypes;
    for (let name in subTypes) {
        st[subTypes[name].value] = { getValue: f };
    }

    st = FIELD_ACCESSORS[FIELD_TYPE.CustomField.value] = {};
    subTypes = FIELD_TYPE.CustomField.subTypes;

    f = function (formField) {
        return norm.normalizeDate(formField.Value);
    };
    ['Date', 'DateTime'].forEach(name => st[subTypes[name].value] = { getValue: f });

    st[subTypes.YesNo.value] = {
        getValue: function (formField) {
            return norm.normalizeBoolean(formField.Value);
        }
    };

    f = function (formField) {
        return norm.normalizeNumber(formField.Value);
    };

    ['Money', 'Number', 'Money4', 'Percent', 'FixedNumber', 'Decimal',
        'MeasureLengthSmall', 'MeasureLengthMedium', 'MeasurePressure', 'MeasureArea',
        'MeasureWeight', 'MeasureForce', 'MeasureDensity', 'MeasureFlow', 'MeasureTemperature']
        .forEach(name => st[subTypes[name].value] = { getValue: f });


    st[subTypes.List.value] = {
        getValue: function (formField, processField) {
            if (!processField) {
                return formField.Value;
            }
            assert.equal(formField.Uid, processField.Uid);
            return formField.Value ? processField.Options.find(option => option.Text == formField.Value).ID : null;
        }
    };

    const MULTI_LIST_DELIMITER = ', ';
    st[subTypes.ListMultiSelect.value] = {
        getValue: function (formField, processField) {
            const result = formField.Value.split(MULTI_LIST_DELIMITER);
            if (!processField) {
                return result;
            }
            assert.equal(formField.Uid, processField.Uid);
            return result.filter(value => value).map(value => processField.Options.find(option => option.Text == value).ID);
        }
    };

    const DEPRICATED_TABLE_COL_DELIMITER = ' %%';
    const DEPRICATED_TABLE_ROW_DELIMITER = ' ||';

    st[subTypes.DeprecatedTable.value] = {
        getValue: function (formField, processField) {
            assert.equal(formField.Uid, processField.Uid);
            const result = [];
            formField.Value.split(DEPRICATED_TABLE_ROW_DELIMITER).forEach(row => {
                const normalizedRow = {};
                row.split(DEPRICATED_TABLE_COL_DELIMITER).forEach((value, idx) => {
                    value = value.trim();
                    if (value) {
                        normalizedRow[processField.Options[idx].Text] = value;
                    }
                });
                if (!rpmUtil.isEmpty(normalizedRow)) result.push(normalizedRow);
            });
            return result;
        }
    };

    st[subTypes.FieldTable.value] = {
        getValue: function (formField, processField) {
            assert.equal(formField.Uid, processField.Uid);
            const result = [];
            const defRow = processField.Rows.find(r => r.IsDefinition);
            assert(defRow, 'No definition row');
            formField.Rows.filter(r => !r.IsDefinition && !r.IsLabelRow).forEach(row => {
                const normalizedRow = {};
                row.Fields.forEach(f => {
                    const defField = getFieldByUid.call(defRow, f.Uid, true);
                    assert(defField, 'No definition field');
                    normalizedRow[defField.Name] = f.Values.length > 0 ?
                        getFieldValue(defField, Object.assign({ Uid: f.Uid }, f.Values[0])) : null;
                });
                !rpmUtil.isEmpty(normalizedRow) && result.push(normalizedRow);
            });
            return result;
        }
    };

    f = function (formField) {
        return formField.Value;
    };

    ['Text', 'Http', 'Description', 'TextArea', 'Link', 'SpecialPhone', 'LocationLatLong',
        'LocationUTM', 'LocationDLS', 'LocationNTS', 'WellUWI', 'WellAPI', 'Html']
        .forEach(name => st[subTypes[name].value] = { getValue: f });

})();

