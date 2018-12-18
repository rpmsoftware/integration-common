var rpm = require('./api-wrappers');

var factories = {};
factories[rpm.OBJECT_TYPE.CustomField] = {};

factories[rpm.OBJECT_TYPE.CustomField][rpm.DATA_TYPE.FieldTable] = function (tableField, useUids) {
    const tableFieldName = tableField.Name;
    const definitionRow = tableField.Rows.find(row => row.IsDefinition);
    const tableFields = definitionRow.Fields;

    return function (rows, form) {
        const existingRows = form && (form.Form || form).getField(tableFieldName, true).Rows.filter(r => !r.IsDefinition);

        function getRowID() {
            return (existingRows && existingRows.length) ? existingRows.shift().RowID : 0;
        }

        const result = [];

        function add(id, row) {
            result.push({
                RowID: id,
                Fields: tableFields.map(field => {
                    var result = row && row[field.Uid];
                    return {
                        Values: result ? [result] : [],
                        Uid: field.Uid,
                    };
                })
            });

        }

        const prop = useUids ? 'Uid' : 'Name';

        rows.forEach(object => {
            var row;
            row = {};
            for (var fieldNameOrUid in object) {
                var field = tableFields.find(field => field[prop] === fieldNameOrUid);
                if (!field) {
                    throw new Error('Unknown table field: ' + fieldNameOrUid);
                }
                var value = object[fieldNameOrUid];
                if (value && field.Options) {
                    var option = field.Options.find(o => o.Text === value || option.ID === value);
                    if (!option) {
                        throw new Error('Unknown option: ' + value);
                    }
                    value = {
                        ID: option.ID,
                    };
                } else if (field.FieldType === rpm.OBJECT_TYPE.FormReference) {
                    value = {
                        ID: value || 0,
                    };
                } else {
                    value = {
                        Value: normalizeValue(value)
                    };

                }
                row[field.Uid] = value;
            }
            add(getRowID(), row);
        });

        let id;
        while ((id = getRowID())) {
            add(id);
        }

        if (result.length < 1) {
            result.push({
                RowID: definitionRow.RowID,
                IsDefinition: true,
                Fields: tableFields.map(f => ({
                    Values: [],
                    Uid: f.Uid
                }))
            });
        }

        return { Field: tableFieldName, Rows: result };

    };
};

function normalizeValue(value) {
    if (typeof value === 'boolean') {
        value = value ? 'Yes' : 'No';
    } else if (value instanceof Date) {
        value = value.toISOString();
    }
    return value;
}

module.exports = function (field) {
    var result = factories[field.FieldType];
    if (result) {
        result = result[field.SubType];
    }
    return result ? result.apply(undefined, arguments) :
        function (value) {
            return { Field: field.Name, Uid: field.Uid, Value: normalizeValue(value) };
        };
};