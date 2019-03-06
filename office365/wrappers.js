const { createOutlookTokenFactory } = require("./lib");
const { Microsoft } = require("node-outlook");
const assert = require('assert');

function fixDates(data) {
    assert.strictEqual(typeof data, 'object');
    data.DateTimeCreated = data.CreatedDateTime;
    data.DateTimeLastModified = data.LastModifiedDateTime;
    if (Array.isArray(data.value)) {
        data.value.forEach(fixDates);
    }
    return data;
}

const DataContext = Microsoft.OutlookServices.Extensions.DataContext;
const Contact = Microsoft.OutlookServices.Contact;
const Contacts = Microsoft.OutlookServices.Contacts;

DataContext.prototype._originalAjax = DataContext.prototype.ajax;
DataContext.prototype.ajax = function (request) {
    return new Promise((resolve, reject) => this._originalAjax(request).then(data => {
        try {
            if (data) {
                data = JSON.stringify(fixDates(JSON.parse(data)));
            }
        } catch (err) {
            console.error('Unexpected ', err, err.stack, data);
        }
        resolve(data);
    }, reject));
};

function pathFnGetContacts(context, data) {
    return Contact.parseContacts(context, data => this.getPath(data.Id), data.value);
}

Contacts.prototype.getContacts = function () {
    return new Microsoft.OutlookServices.Extensions.CollectionQuery(this.context, this.path, pathFnGetContacts.bind(this));
};

Contacts.prototype.getContact = function (Id) {
    return new Microsoft.OutlookServices.ContactFetcher(this.context, this.getPath(Id));
};

Microsoft.OutlookServices.ContactFetcher.prototype.fetch = function () {
    return new Promise((resolve, reject) => this.context.readUrl(this.path).then(data =>
        resolve(Contact.parseContact(this.context, this.path, JSON.parse(data))), reject));
};

Contact.prototype.update = function () {
    const request = new Microsoft.OutlookServices.Extensions.Request(this.path);
    request.method = 'PATCH';
    request.data = JSON.stringify(this.getRequestBody());
    return new Promise((resolve, reject) => this.context.request(request).then(data =>
        resolve(Contact.parseContact(this.context, this.path, JSON.parse(data))), reject)
    );
};

Contact.prototype.delete = function () {
    const request = new Microsoft.OutlookServices.Extensions.Request(this.path);
    request.method = 'DELETE';
    return new Promise((resolve, reject) => this.context.request(request).then(resolve, reject));

};

Contacts.prototype.addContact = function (item) {
    const request = new Microsoft.OutlookServices.Extensions.Request(this.path);
    request.method = 'POST';
    request.data = JSON.stringify(item.getRequestBody());
    return new Promise((resolve, reject) => this.context.request(request).then(data =>
        resolve(Contact.parseContact(this.context, this.getPath(data.Id), JSON.parse(data))), reject)
    );
};


const RESOURCE = 'https://outlook.office.com/api/v2.0';
exports.createOutlookClient = async function (config) {
    const getToken = await createOutlookTokenFactory(config);
    return new Microsoft.OutlookServices.Client(RESOURCE, getToken).users.getUser(config.mailbox)
};
