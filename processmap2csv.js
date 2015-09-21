/* global process */
(function () {
    var promised = require('promised-io/promise');
    var Deferred = promised.Deferred;
    var rpm = require('./api-wrappers');
    var api = new rpm.RpmApi(require('./util').readConfig('RPM_CONFIG', 'config.json'));
    var util = require('util');

    var fieldType = rpm.OBJECT_TYPE.FormReference;
    var refSubTypes = {};
    for (var key in rpm.REF_DATA_TYPE) {
        refSubTypes[rpm.REF_DATA_TYPE[key]] = key;
    }

    function getFields(proc) {
        processes[proc.ProcessID] = proc;
        var deferred = new Deferred();
        proc.getFields().then(
            function (result) {
                deferred.resolve(result);
            },
            function (error) {
                console.error(util.format('Cannot get fields for process "%s" (%d)', proc.Process, proc.ProcessID), error);
                deferred.resolve();
            });
        return deferred.promise;
    }

    var processes = {};

    promised.seq([
        function () {
            return api.getProcesses(true);
        },
        function (response) {
            var steps = [];
            var data = [];

            response.forEach(function (proc) {
                steps.push(function () {
                    return getFields(proc);
                });
                steps.push(function (fields) {
                    if (!fields) {
                        return;
                    }
                    var process = processes[fields.ProcessID];
                    fields.Fields.forEach(function (f) {

                        if (f.FieldType !== fieldType) {
                            return;
                        }

                        var refProcName = processes[f.ProcessID];
                        refProcName = refProcName && refProcName.Process || util.format('[%s]', refSubTypes[f.SubType]);
                        data.push({
                            'Process ID': process.ProcessID,
                            'Process Name': process.Process,
                            'Process Enabled': process.Enabled,
                            'Field Name': f.Name,
                            'Field Archived': f.Archived,
                            'Ref Process ID': f.ProcessID,
                            'Ref Process Name': refProcName,
                        });
                    });
                });
            });
            steps.push(function() {
                return data;
            })   
            return promised.seq(steps);
        }
    ]).then(
        function (result) {
            result = require('to-csv')(result);
            var fileName = process.argv[2];
            fileName ? require('fs').writeFileSync(fileName, result) : console.info(result);
        },
        function (error) {
            console.error(error);
        });
})();