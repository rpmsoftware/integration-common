/* global Promise */
var tedious = require('tedious');
var TYPES = tedious.TYPES;
var Request = tedious.Request;
var Connection = tedious.Connection;

function getMsSqlType(value) {
    if (value === undefined || value === null) {
        return TYPES.Null;
    }
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


function executeStatement(sqlQuery, parameters, metadataOnly) {
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
            Object.keys(parameters).forEach(function (key) {
                var value = parameters[key];
                request.addParameter(key, getMsSqlType(value), value);
            });
        }

        request.on('columnMetadata', function (columns) {
            metadata = columns;
        });

        function columnsToValues(columns) {
            return columns.map(function (column) {
                return column.value;
            });
        }

        if (!metadataOnly) {
            request.on('row', function (columns) {
                rows.push(columnsToValues(columns));
            });
        }

        this.execSql(request);
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
                resolve(connection);
            }
        });
    });
};


