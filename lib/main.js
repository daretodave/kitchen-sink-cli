const inquirer = require('inquirer');
const path     = require('path');
const fs       = require('fs-promise');
const args     = require('optimist')["argv"];
const hljs     = require('highlight.js');
const md       = require('markdown-it')({
    html: true,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(lang, str).value;
            } catch (__) {}
        }

        return ''; // use external default escaping
    }
});

const logger   = require('./logger');

const options  = {
    version:   "1.0",
    exclude:   new RegExp(args["exclude"] || 'node_modules|^[.]'),
    directory: args["dir"] || process.cwd()
};

options.target = args["target"] || path.join(options.directory, "docs");

logger.clear();
logger.banner('KS');
logger.table(options);
logger.line();

async function run() {

    const inquiry = await inquirer.prompt({
        name: 'confirmation',
        type: 'confirm',
        message: 'continue',
        default: false
    });

    logger.line();

    if(!inquiry["confirmation"]) {
        return;
    }

    await crawl();
}

function build(store, structure, parent) {

    if(Array.isArray(structure)) {

        structure = structure.slice();

        if(structure.length === 0) {
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
    const target = path.join(options.target, `${module}.json`);

    logger.info(`||| emitting ${target}`);

    contents =  contents.structure.map(block => build(contents.mappings, block, module)).filter(child => child !== null);

    const result = JSON.stringify(contents, null, 2);

    try {
        await fs.mkdir(options.target);
    } catch(error) {
        // ignore
        if(error.code !== 'EEXIST') {
            throw error;
        }
    }

    await fs.writeFile(target, result);

    logger.info(`|||| ${contents.length} sections emitted at ${target}`);
}

async function read(location) {
    logger.info(`|| reading ${location}`);

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
            map[path.basename(result[0], '.md')] = result[1];
            return map
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
    if(exclude(location)) {
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

run().catch(logger.err);