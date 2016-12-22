var rpm = require('./api-wrappers');

var factories = {};
factories[rpm.OBJECT_TYPE.CustomField] = {};

factories[rpm.OBJECT_TYPE.CustomField][rpm.DATA_TYPE.FieldTable] = function (field, useUids) {
    var defRow = field.Rows.find(function (row) {
        return row.IsDefinition;
    });
    defRow.fieldsByName = {};
    var prop = useUids ? 'Uid' : 'Name';
    defRow.Fields.forEach(function (field) {
        defRow.fieldsByName[field[prop]] = field;
        field.Options = field.Options && field.Options.toObject('Text');
    });

    return function (rows, form) {
        var existingRows;

        function getRowID() {
            if (!existingRows || !existingRows.length) {
                return 0;
            }
            var row = existingRows.shift();
            return row.IsDefinition ? getRowID() : row.RowID;
        }

        if (form) {
            form = form.Form || form;
            var formTableField = form.Fields.find(function (f) {
                return f.Uid === field.Uid;
            });
            if (!formTableField) {
                throw new Error('Form does not contain table field ' + field.Name);
            }
            existingRows = formTableField.Rows.slice();
            var existingDefRow = existingRows.find(function (row) {
                return row.IsDefinition;
            });
            if (existingDefRow && existingDefRow.RowID !== defRow.ID) {
                throw new Error('Incompatible rows');
            }
        }
        var newDefRow = {
            RowID: defRow.ID,
            IsDefinition: true,
            IsLabelRow: defRow.IsLabelRow,
            IsShown: defRow.IsShown,
            Fields: defRow.Fields.map(function (field) {
                return {
                    Values: [],
                    Uid: field.Uid
                };
            })
        };


        var result = [newDefRow];

        function add(id, row) {
            result.push({
                RowID: id,
                IsDefinition: false,
                IsLabelRow: false,
                IsShown: true,
                Fields: newDefRow.Fields.map(function (field) {
                    var result = row && row[field.Uid];
                    return {
                        Values: result ? [result] : [],
                        Uid: field.Uid
                    };
                })
            });

        }

        rows.forEach(function (object) {
            var row;
            row = {};
            for (var fieldNameOrUid in object) {
                var field = defRow.fieldsByName[fieldNameOrUid];
                if (!field) {
                    throw new Error('Unknown table field: ' + fieldNameOrUid);
                }
                var value = object[fieldNameOrUid];
                if (value && field.Options) {
                    var option = field.Options[value];
                    if (!option) {
                        throw new Error('Unknown option: ' + value);
                    }
                    value = {
                        ID: option.ID,
                        Value: option.Text
                    };
                } else if (field.FieldType === rpm.OBJECT_TYPE.FormReference) {
                    value = {
                        ID: value,
                    };

                } else {
                    value = {
                        ID: 0,
                        Value: normalizeValue(value)
                    };

                }
                row[field.Uid] = value;
            }
            add(getRowID(), row);
        });

        var id;
        while ((id = getRowID())) {
            add(id);
        }

        return { Field: field.Name, Uid: field.Uid, Rows: result };

    };
};

function normalizeValue(value) {
    if (typeof value === 'boolean') {
        value = value ? 'Yes' : 'No';
    } else if (value instanceof Date) {
        value = value.toUTCString();
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