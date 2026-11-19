import { promisify } from './util.mjs';
import { parseString } from 'xml2js';
const prs = promisify(parseString);

export const NAMESPACE_PREFIX = 'xmlns';
const NAMESPACE_PATTERN = new RegExp(`^${NAMESPACE_PREFIX}:(\\w+)$`);
export const PROP_ATTRIBUTES = '$';

export function parse(xml) {
    const namespaces = [];
    function removeNamespaces(tagName) {
        for (let { name } of namespaces) {
            if (tagName.startsWith(name + ':')) {
                return tagName.substr(name.length + 1);
            }
        }
        return tagName;
    }
    return prs(xml, {
        explicitArray: false,
        attrValueProcessors: [function (value, name) {
            let namespace;
            if (name === NAMESPACE_PREFIX) {
                namespaces.unshift({ name: 'xmlns', value });
            } else if ((namespace = NAMESPACE_PATTERN.exec(name))) {
                namespaces.push({ name: namespace[1], value });
            }
            return value;
        }],
        attrNameProcessors: [removeNamespaces],
        tagNameProcessors: [removeNamespaces],
    });
};

export function demandNamespace(obj, namespace) {
    obj = obj[PROP_ATTRIBUTES] || obj;
    for (let key in obj) {
        if (obj[key] === namespace) {
            if (key.startsWith(NAMESPACE_PREFIX + ':')) {
                key = key.substr(NAMESPACE_PREFIX.length + 1);
            }
            return key;
        }
    }
    throw new Error(`Namespace not found: "${namespace}"`);
}
