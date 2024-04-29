/* global __dirname, Buffer */

const { render } = require('mustache');
const pdfmake = require('pdfmake');
const { fetch } = require('../util');
const { readFileSync } = require('fs');

const PRINTER = (() => {
    let { join } = require('path');
    join = join.bind(undefined, join(__dirname, 'fonts'));
    return new pdfmake({
        Serif: {
            normal: join('FreeSerif.ttf'),
            bold: join('FreeSerifBold.ttf'),
            italics: join('FreeSerifItalic.ttf'),
            bolditalics: join('FreeSerifBoldItalic.ttf')
        },
        Mono: {
            normal: join('FreeMono.ttf'),
            bold: join('FreeMonoBold.ttf'),
            italics: join('FreeMonoOblique.ttf'),
            bolditalics: join('FreeMonoBoldOblique.ttf')
        },
        Sans: {
            normal: join('FreeSans.ttf'),
            bold: join('FreeSansBold.ttf'),
            italics: join('FreeSansOblique.ttf'),
            bolditalics: join('FreeSansBoldOblique.ttf')
        }
    });
})();

const DYNAMIC_PROPS = [
    "hLineWidth",
    "vLineWidth",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom"
];

const imageCache = {};

const fetchImage = url => imageCache[url] || (imageCache[url] = fetch(url).then(async r =>
    r.headers.get('content-type') + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64url')
));


module.exports = async docDefinition => {

    let { footer, tableLayouts, images } = docDefinition = Object.assign({}, docDefinition);

    if (tableLayouts || (tableLayouts = undefined)) {
        const tl = Object.assign({}, tableLayouts);
        for (const name in tl) {
            const l = tl[name] = Object.assign({}, tl[name]);
            DYNAMIC_PROPS.forEach(p => {
                const v = l[p];
                v === undefined || typeof v === 'function' || (l[p] = () => v);
            });
        }
        tableLayouts = tl;
    }

    if (footer) {
        footer = JSON.stringify(footer);
        docDefinition.footer = (currentPage, pageCount) => JSON.parse(render(footer, { currentPage, pageCount }, undefined, ["[[", "]]"]))
    }

    if (images) {
        images = docDefinition.images = Object.assign({}, images);
        for (let name in images) {
            const image = images[name];
            const { url, file } = image;
            if (url) {
                images[name] = await fetchImage(url);
            } else if (file) {
                images[name] = readFileSync(file);
            }
        }
    }


    return new Promise((resolve, reject) => {
        const pdfDoc = PRINTER.createPdfKitDocument(docDefinition, { tableLayouts });
        const buffs = [];
        pdfDoc.on('data', d => buffs.push(d));
        pdfDoc.on('end', () => resolve(Buffer.concat(buffs)));
        pdfDoc.on('error', e => reject(e));
        pdfDoc.end();
    });
};
