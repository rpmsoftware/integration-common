/* global Promise */
var assert = require('assert');
var tedious = require('tedious');
var util = require('util');
var rpmUtil = require('./util');
var TYPES = exports.TYPES = tedious.TYPES;
var Request = tedious.Request;
var Connection = tedious.Connection;
var norm = require('./normalizers');

TYPES.DateN.normalize = norm.normalizeDate;
TYPES.Date.normalize = norm.normalizeDate;
TYPES.DateTime2N.normalize = norm.normalizeDate;
TYPES.DateTime2.normalize = norm.normalizeDate;
TYPES.VarChar.normalize = norm.returnOriginal;
TYPES.Bit.normalize = norm.normalizeBoolean;
TYPES.BitN.normalize = norm.normalizeBoolean;
TYPES.IntN.normalize = norm.normalizeInt;
TYPES.Int.normalize = norm.normalizeInt;
TYPES.Money.normalize = norm.normalizeNumber;
TYPES.MoneyN.normalize = norm.normalizeNumber;
TYPES.Numeric.normalize = norm.normalizeNumber;
TYPES.SmallMoney.normalize = norm.normalizeNumber;
TYPES.Decimal.normalize = norm.normalizeNumber;

function getMsSqlType(value) {
    var result;
    switch (typeof value) {
        case 'boolean':
            result = TYPES.Bit;
            break;
        case 'number':
            result = (value % 1) ? TYPES.Float : TYPES.Int;
            break;
        case 'string':
            result = TYPES.VarChar;
            break;
        default:
            if (value instanceof Date) {
                result = TYPES.DateTime2;
            } else {
                throw 'Unknown value type: ' + value;
            }
    }
    return result;
}

function SqlTypedValue(value, type) {
    if (!type.normalize) {
        console.log(type);
    }
    this.value = norm.isNull(value) ? null : type.normalize(value);
    this.type = type;
}

exports.SqlTypedValue = SqlTypedValue;

function executeStatement(sqlQuery, parameters, metadataOnly) {
    var connection = this;
    return new Promise(function (resolve, reject) {
        var rows = [];
        var metadata;

        var request = new Request(sqlQuery, function (err, rowCount) {
            if (err) {
                err.sqlQuery = sqlQuery;
                reject(err);
            } else {
                resolve({ metadata: metadata, rows: rows, rowCount: rowCount });
            }
        });
        if (parameters) {
            for (var key in parameters) {
                var value = parameters[key];
                var type;
                if (value instanceof SqlTypedValue) {
                    type = value.type;
                    value = value.value;
                } else {
                    type = getMsSqlType(value);
                }
                request.addParameter(key, type, value);
            };
        }

        request.on('columnMetadata', function (columns) {
            metadata = columns;
        });

        if (!metadataOnly) {
            request.on('row', function (columns) {
                if (Array.isArray(columns)) {
                    columns = columns.map(function (column) {
                        return column.value;
                    });
                } else {
                    for (var key in columns) {
                        columns[key] = columns[key].value;
                    }
                }
                rows.push(columns);
            });
        }

        connection.execSql(request);
    });
}

exports.createConnection = function (config) {
    return new Promise(function (resolve, reject) {
        var connection = new Connection(config);
        connection.on('connect', function (err) {
            if (err) {
                connection.close();
                reject(err);
            } else {
                connection.execute = executeStatement;
                connection.getObjectID = getObjectID;
                connection.getColumnTypes = getColumnTypes;
                resolve(connection);
            }
        });
    });
};


function getObjectID(object, demand) {
    return this.execute(util.format("select object_id('%s')", object)).then(function (result) {
        result = result.rows[0][0];
        if (!result && demand) {
            throw new Error('No OBJECT_ID for ' + object);
        }
        return +result;
    });

}

var nullableSubstitutions = {}
nullableSubstitutions[TYPES.BitN.name] = TYPES.Bit;
nullableSubstitutions[TYPES.IntN.name] = TYPES.Int;
nullableSubstitutions[TYPES.DateN.name] = TYPES.Date;
nullableSubstitutions[TYPES.TimeN.name] = TYPES.Time;
nullableSubstitutions[TYPES.DateTime2N.name] = TYPES.DateTime2;
nullableSubstitutions[TYPES.DateTimeN.name] = TYPES.DateTime;
nullableSubstitutions[TYPES.DateTimeOffsetN.name] = TYPES.DateTimeOffset;
nullableSubstitutions[TYPES.DecimalN.name] = TYPES.Decimal;
nullableSubstitutions[TYPES.NumericN.name] = TYPES.Numeric;
nullableSubstitutions[TYPES.FloatN.name] = TYPES.Float;
nullableSubstitutions[TYPES.MoneyN.name] = TYPES.Money;

function getColumnTypes(table) {
    return this.execute(util.format("select top 0 * from %s", table), undefined, true).then(function (response) {
        var result = {};
        response.metadata.forEach(function (column) {
            var type = nullableSubstitutions[column.type.name] || column.type;
            assert.equal(typeof type.validate, 'function', 'validate() is absent for ' + type.name);
            assert.equal(typeof type.normalize, 'function', 'normalize() is absent for ' + type.name);
            result[column.colName] = type;
        });
        return result;
    });

}

var PARAMETER_PREFIX = 'param';

exports.getInsertQuery = function (table, values) {
    var result = {
        params: {}
    };
    var ii = 0;
    var names = [];
    var keys = [];
    for (var name in values) {
        var param = PARAMETER_PREFIX + ii;
        result.params[param] = values[name];
        names.push('[' + name + ']');
        keys.push('@' + param);
        ++ii;
    }
    result.sql = `insert into ${table} (${names.join(',')}) values (${keys.join(',')})`;
    return result;
};

exports.getUpdateQuery = function (table, values) {
    var result = {
        params: {}
    };
    var ii = 0;
    var pairs = [];

    for (var name in values) {
        var param = PARAMETER_PREFIX + ii;
        result.params[param] = values[name];
        pairs.push(`[${name}]=@${param}`);
        ++ii;
    }
    result.sql = `update ${table} set ${pairs.join(',')}`;
    return result;
};
