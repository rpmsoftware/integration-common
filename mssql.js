var Deferred = require('promised-io/promise').Deferred;
var tedious = require('tedious');
var TYPES = tedious.TYPES;
var Request = tedious.Request;
var Connection = tedious.Connection;

function getMsSqlType(value) {
    if(value===undefined || value===null) {
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
        if(value instanceof Date) {
            result = TYPES.DateTime2; 
        } else {
            throw 'Unknown value type: '+ value ;
        }
    }
    return result;
}


function executeStatement(sqlQuery, parameters, metadataOnly) {
    var rows = [];
    var metadata;
    var deferred = new Deferred();

    var request = new Request(sqlQuery, function (err, rowCount) {
        if (err) {
            err.sqlQuery = sqlQuery;
            deferred.reject(err);
        } else {
            deferred.resolve({ metadata: metadata, rows: rows, rowCount: rowCount });
        }
    });
    if(parameters) {
        Object.keys(parameters).forEach(function(key) {
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

    if(!metadataOnly) {
        request.on('row', function (columns) {
            rows.push(columnsToValues(columns));
        });
    }
    
    this.execSql(request);
    return deferred.promise;
}


exports.createConnection =  function (config) {
    var deferred = new Deferred();
    var connection = new Connection(config);
    connection.on('connect', function (err) {
        if (err) {
            connection.close();
            deferred.reject(err);
        } else {
            connection.execute = executeStatement;
            deferred.resolve(connection);
        }
    });
    return deferred.promise;
}


