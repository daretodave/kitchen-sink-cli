const chalk  = require('chalk');
const figlet = require('figlet');
const clear  = require('clear');

module.exports = Logger = {};

Logger.options = {
    line: '\n',
    banner: {
        theme: chalk["dim"]["cyan"],
        prefix: ' ',
        suffix: '\n\n',
        delimiter: '',
        font: 'isometric1'
    },
    clear: {
        content: '\n'
    },
    table: {
        label: {
            prefix: '\t',
            theme: chalk["bgRed"]["white"]["bold"]
        },
        delimiter: '\t\t',
        value: {
            theme: chalk["red"]
        }
    },
    info: {
        theme: chalk["cyan"]["bold"]
    },
    warn: {
        theme: chalk["yellow"]["bold"]
    }
};

Logger.err = (...args) => console.error.apply(console.log, args);
Logger.log = (...args) => console.log.apply(console.log, args);

Logger.clear = () => {
  clear();
  Logger.log(Logger.options.clear.content);
};

Logger.info = (...args) => Logger.log(Logger.options.info.theme(args.join('')));
Logger.warn = (...args) => Logger.log(Logger.options.warn.theme(args.join('')));
Logger.banner = (...args) => Logger.log(
    Logger.options.banner.prefix,
    Logger.options.banner.theme(
        figlet["textSync"](
            args.join(Logger.options.banner.delimiter),
            Logger.options.banner
        )
    ),
    Logger.options.banner.suffix
);

Logger.table = (...args) => args.forEach(table => Object.keys(table).forEach(key => Logger.log(
    Logger.options.table.label.prefix,
    Logger.options.table.label.theme(key),
    Logger.options.table.delimiter + (key.length < 6 ? '\t' : ''),
    Logger.options.table.value.theme(table[key])
)));

Logger.line = (amount = 0) => Logger.log(Logger.options.line.repeat(amount));