const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs-promise');
const args = require('optimist')["argv"];
const hljs = require('highlight.js');
const watch = require('node-watch');
const mmm = require('mmmagic');
const sizeOf = require('image-size');
const md = require('markdown-it')({
    html: true,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(lang, str).value;
            } catch (__) {
            }
        }

        return ''; // use external default escaping
    }
}).use(require('markdown-it-imsize'), {autofill: true});

const logger = require('./logger');
const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);

const options = {
    version: "1.0",
    confirm: args.hasOwnProperty('confirm') && args["confirm"] !== false,
    exclude: new RegExp(args["exclude"] || 'node_modules|^[.]'),
    watch: args.hasOwnProperty('watch') && args["watch"] !== false,
    directory: args["dir"] || process.cwd()
};

options.target = args["target"] || path.join(options.directory, "docs");
options.static = args["static"] || path.join(options.directory, "static");

logger.clear();
logger.banner('KS');
logger.table(options);
logger.line();

async function run() {

    if (!options.confirm) {
        const inquiry = await inquirer.prompt({
            name: 'confirmation',
            type: 'confirm',
            message: 'continue',
            default: false
        });

        logger.line();

        if (!inquiry["confirmation"]) {
            return;
        }

        options.confirm = true;
    }


    try {
        await fs.mkdir(options.target).catch(error => {
            //ignore...
        });
    } catch (error) {
        // ignore
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }

    await crawl();
}

function build(store, structure, parent) {

    if (Array.isArray(structure)) {

        structure = structure.slice();

        if (structure.length === 0) {
            return null;
        }

        const lead = structure.shift();

        if (!store.hasOwnProperty(lead)) {
            logger.warn(`|||| can not find child module ${lead} inside the ${parent} module`);
            return null;
        }

        let element = store[lead];
        element.children = structure.map(block => build(store, block, parent)).filter(child => child !== null);

        return element;
    }

    if (!store.hasOwnProperty(structure)) {
        logger.warn(`|||| can not find child module ${structure} inside the ${parent} module`);
        return null;
    }

    const element = store[structure];
    element.children = [];

    return element;
}

async function emit(module, contents) {
    const metaTarget = path.join(options.target, `${module}.meta.json`);
    const contentTarget = path.join(options.target, `${module}.json`);

    logger.info(`||| emitting ${contentTarget}`);

    const model = contents.structure.map(block => build(contents.mappings, block, module)).filter(child => child !== null);
    const result = JSON.stringify(model, null, 2);
    const move = Object.values(contents.mappings).filter(value => typeof value === 'string');

    let meta = {};

    if (move.length > 0) {
        logger.info(`||| moving static contents, collecting meta data`);

        const assetInformation = await Promise.all(move.map(dir => {

            return fs.readdir(dir).then(assets => Promise.all(assets.map(asset => {
                return new Promise(resolve => {
                    magic.detectFile(path.join(dir, asset), function (err, result) {
                        if (err) {
                            logger.err(err);
                            resolve('');
                        } else {
                            resolve(result);
                        }
                    });
                }).then(type => {
                    const results = [];

                    results.push(path.join(path.basename(dir), asset).toLowerCase());
                    results.push(type);

                    if (type.startsWith("image")) {
                        results.push(sizeOf(path.join(dir, asset)));
                    }

                    return Promise.all(results);
                }).then(([key, type, size]) => {

                    return {
                        key,
                        type,
                        size
                    }
                });
            })))
        })).catch(error => logger.err(error));
        meta = assetInformation.reduce((meta, assets) => {
            assets.forEach(asset => meta[asset.key] = asset);

            return meta;
        }, {});

        const keys = Object.keys(meta);

        if (keys.length > 0) {
            const maxLength = keys.map(key => key.length).sort()[0] + 50;

            logger.info(
                `||||| ${keys.length} properties to emit at ${metaTarget}` +
                `| assets = [\n\t| > ${keys.map(
                    function (key) {
                        const {type, size} = meta[key];

                        return `${key}${' '.repeat(maxLength - key.length)} | type = ${type} ${size ? `| width = ${size.width} | height = ${size.height}` : ''
                            }`
                    }
                ).join(",\n\t| > ")}]`);
        }

        await Promise.all(move.map(dir => fs.copy(dir, path.join(options.static, path.basename(dir)))))
    }

    await Promise.all([
        fs.writeFile(contentTarget, result),
        fs.writeFile(metaTarget, JSON.stringify(meta))
    ]);


    logger.info(`|||| ${model.length} sections emitted at ${contentTarget}`);
}

async function read(location) {
    logger.info(`|| reading ${location}`);

    let stat = await fs.stat(location);

    if (stat.isDirectory()) {
        return location;
    }

    let markdown = await fs.readFile(location, 'utf8');
    const id = path.basename(location, '.md');

    let title = /<!--TITLE:(.*?)-->/g.exec(markdown);
    if (title) {
        markdown = markdown.slice(0, title.index) + markdown.slice(title.index + title[0].length);
        title = title[1];
    } else {
        title = id
            .replace(/-/g, ' ')
            .split(' ')
            .map(word => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ');
    }

    let about = /<!--ABOUT:(.*?)-->/g.exec(markdown);
    if (about) {
        markdown = markdown.slice(0, about.index) + markdown.slice(about.index + about[0].length);
        about = about[1];
    } else {
        about = '';
    }

    const content = md.render(markdown);

    return {
        id: id,
        title: title,
        about: about,
        content: content.trim()
    };
}

async function resolve(location) {
    let files = await fs.readdir(location);

    files = files.filter(file => !exclude(file));

    logger.info(`| traversing ${location} | contents.length = ${files.length}`);

    return await Promise.all(
        files.map(file => Promise.all([
            file,
            read(path.join(location, file))
        ]))
    ).then(results => results
        .filter(result => !!result[1])
        .reduce((map, result) => {
            if (typeof result[1] !== 'string') {
                map[path.basename(result[0], '.md')] = result[1];
            } else {
                let key = result[1].replace(path.normalize(options.directory), '');
                if (key.startsWith("\\")) {
                    key = key.slice(1);
                }
                key = key.replace(/\\/g, '.');

                map[key] = result[1];
            }

            return map;
        }, {})
    );

}

async function explore(location) {
    let files = await fs.readdir(location);

    files = files.filter(file => !exclude(file));

    const structureIndex = files.indexOf('structure.json');

    if (structureIndex === -1) {
        logger.warn(`excluding  ${location} | missing structure.json`);
        return false;
    }

    files.splice(structureIndex, 1);

    const structure = JSON.parse(await fs.readFile(path.join(location, 'structure.json')));

    logger.info(`traversing ${location} | contents.length = ${files.length}`);

    return await Promise.all(
        files.map(file => Promise.all([
            file,
            traverse(path.join(location, file), resolve)
        ]))
    ).then(results => results
        .filter(result => !!result[1])
        .reduce((map, results) => {
            Object.assign(map.mappings, results[1]);

            return map;
        }, {
            mappings: {},
            structure: structure
        })
    );

}

async function traverse(location, action) {
    if (exclude(location)) {
        logger.warn(`excluding  ${location}`);
        return false;
    }

    const stat = await fs.stat(location);

    if (!stat.isDirectory()) {
        return false;
    }

    return await action(location);
}

async function crawl() {

    const modules = await fs.readdir(options.directory);

    return await Promise.all(
        modules.map(
            module => Promise.all([module, traverse(
                path.join(options.directory, module),
                explore
            )])
        )
    ).then(results => {
        results = results.filter(result => !!result[1]);

        logger.line();

        return results.filter(result => !!result[1]).map(result => emit(result[0], result[1]));
    })
}

function exclude(location) {
    return path.basename(location).match(options.exclude);
}

logger.info(`will watch ${options.directory} for changes`);

run().catch(logger.err);

if (options.watch) {

    watch(options.directory, {recursive: true}, function (evt, name) {
        if (!options.confirm || exclude(name)) {
            return;
        }

        const ext = path.extname(name).toLowerCase();
        if (ext !== '.json' && ext !== '.md') {
            return;
        }

        logger.line(2);
        logger.info(`${name} modified, remaking`);

        run().catch(logger.err);
    });

}